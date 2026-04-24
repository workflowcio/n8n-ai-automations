/**
 * Normalizes ChatGPT and Claude export files into a unified schema.
 *
 * Works in the browser (loaded via <script>) and in Node (CommonJS-compatible
 * via the bottom-of-file UMD shim) so the same code can be used by the UI and
 * by the test runner.
 *
 * Schema:
 *   {
 *     schemaVersion, generatedAt,
 *     sources:       [{ source, filename, counts }],
 *     projects:      [Project],
 *     conversations: [Conversation]
 *   }
 *
 *   Project = {
 *     id, source, sourceId, name, description,
 *     systemPrompt, createdAt, updatedAt, documents: [Document]
 *   }
 *
 *   Conversation = {
 *     id, source, sourceId, projectId, title, createdAt, updatedAt,
 *     model, messageCount, messages: [Message]
 *   }
 *
 *   Message = {
 *     id, role, content, parts, createdAt, model, attachments
 *   }
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Normalizer = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const SCHEMA_VERSION = "1.0";

  // ---------- helpers ----------

  function epochSecondsToISO(value) {
    if (value === null || value === undefined || value === "") return null;
    const seconds = typeof value === "number" ? value : parseFloat(value);
    if (!isFinite(seconds)) return null;
    return new Date(seconds * 1000).toISOString();
  }

  function toISO(value) {
    if (!value) return null;
    if (typeof value === "number") return epochSecondsToISO(value);
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function safeId(prefix, raw) {
    if (raw === null || raw === undefined || raw === "") {
      return `${prefix}:anon-${Math.random().toString(36).slice(2, 10)}`;
    }
    return `${prefix}:${raw}`;
  }

  function pushUnique(arr, item, key) {
    if (arr.some((x) => x[key] === item[key])) return;
    arr.push(item);
  }

  // ---------- ChatGPT ----------

  /**
   * Walk the ChatGPT message tree along the active branch.
   * Returns ordered nodes from the conversation root to current_node.
   */
  function walkChatGPTBranch(mapping, currentNode) {
    if (!mapping) return [];
    const nodes = [];
    const seen = new Set();

    let cursor = currentNode;
    if (!cursor || !mapping[cursor]) {
      // fall back to a deepest leaf if current_node is missing
      cursor = pickDeepestLeaf(mapping);
    }

    while (cursor && !seen.has(cursor) && mapping[cursor]) {
      seen.add(cursor);
      nodes.push(mapping[cursor]);
      cursor = mapping[cursor].parent;
    }
    nodes.reverse();
    return nodes;
  }

  function pickDeepestLeaf(mapping) {
    let best = null;
    let bestDepth = -1;
    const depth = (id, cache) => {
      if (cache.has(id)) return cache.get(id);
      const node = mapping[id];
      if (!node || !node.parent) {
        cache.set(id, 0);
        return 0;
      }
      const d = depth(node.parent, cache) + 1;
      cache.set(id, d);
      return d;
    };
    const cache = new Map();
    for (const id of Object.keys(mapping)) {
      const node = mapping[id];
      const isLeaf = !node.children || node.children.length === 0;
      if (!isLeaf) continue;
      const d = depth(id, cache);
      if (d > bestDepth) {
        bestDepth = d;
        best = id;
      }
    }
    return best;
  }

  function chatGPTContentToParts(content) {
    if (!content) return { text: "", parts: [] };
    const ct = content.content_type;
    const parts = [];
    let text = "";

    const rawParts = Array.isArray(content.parts) ? content.parts : [];
    for (const part of rawParts) {
      if (typeof part === "string") {
        if (part) {
          parts.push({ type: "text", text: part });
          text += (text ? "\n\n" : "") + part;
        }
      } else if (part && typeof part === "object") {
        if (part.content_type === "image_asset_pointer") {
          parts.push({
            type: "image",
            assetPointer: part.asset_pointer || null,
            width: part.width || null,
            height: part.height || null,
          });
        } else if (part.content_type === "audio_asset_pointer") {
          parts.push({
            type: "audio",
            assetPointer: part.asset_pointer || null,
          });
        } else if (part.text) {
          parts.push({ type: "text", text: part.text });
          text += (text ? "\n\n" : "") + part.text;
        } else {
          parts.push({ type: part.content_type || "unknown", raw: part });
        }
      }
    }

    if (ct === "code" && content.text) {
      parts.push({ type: "code", language: content.language || null, text: content.text });
      text += (text ? "\n\n" : "") + content.text;
    }
    if (ct === "execution_output" && content.text) {
      parts.push({ type: "tool_result", text: content.text });
      text += (text ? "\n\n" : "") + content.text;
    }
    if (ct === "tether_quote" && content.text) {
      parts.push({ type: "tool_result", text: content.text });
      text += (text ? "\n\n" : "") + content.text;
    }

    return { text, parts };
  }

  function chatGPTRole(author) {
    if (!author) return "user";
    const role = author.role;
    if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
      return role;
    }
    return "user";
  }

  function isChatGPTHidden(node) {
    const m = node && node.message;
    if (!m) return true;
    if (m.author && m.author.role === "system") {
      // hide context/system stubs that have no content and weight 0
      const empty =
        !m.content ||
        ((!m.content.parts || m.content.parts.every((p) => !p || (typeof p === "string" && !p.trim()))) &&
          !m.content.text);
      if (empty) return true;
    }
    return false;
  }

  function normalizeChatGPTConversation(conv, sourceTag) {
    const mapping = conv.mapping || {};
    const branch = walkChatGPTBranch(mapping, conv.current_node);
    const messages = [];
    let lastModel = null;

    for (const node of branch) {
      if (isChatGPTHidden(node)) continue;
      const m = node.message;
      const role = chatGPTRole(m.author);
      const { text, parts } = chatGPTContentToParts(m.content);
      if (!text && parts.length === 0) continue;
      const model = (m.metadata && m.metadata.model_slug) || null;
      if (model) lastModel = model;
      messages.push({
        id: safeId("cgpt-msg", m.id || node.id),
        role,
        content: text,
        parts,
        createdAt: epochSecondsToISO(m.create_time),
        model,
        attachments: extractChatGPTAttachments(m),
      });
    }

    const projectId = conv.gizmo_id ? safeId("cgpt-proj", conv.gizmo_id) : null;

    return {
      id: safeId("cgpt-conv", conv.conversation_id || conv.id),
      source: sourceTag,
      sourceId: conv.conversation_id || conv.id || null,
      projectId,
      title: conv.title || "(untitled)",
      createdAt: epochSecondsToISO(conv.create_time),
      updatedAt: epochSecondsToISO(conv.update_time),
      model: lastModel || conv.default_model_slug || null,
      messageCount: messages.length,
      messages,
    };
  }

  function extractChatGPTAttachments(message) {
    const out = [];
    const meta = (message && message.metadata) || {};
    const list = meta.attachments || [];
    for (const a of list) {
      out.push({
        name: a.name || a.id || null,
        type: a.mime_type || a.mimeType || null,
        size: typeof a.size === "number" ? a.size : null,
      });
    }
    return out;
  }

  function normalizeChatGPT(json, filename) {
    const conversations = Array.isArray(json) ? json : json.conversations || [];
    const sourceTag = "chatgpt";
    const projectsById = new Map();
    const convs = [];

    for (const c of conversations) {
      const norm = normalizeChatGPTConversation(c, sourceTag);
      convs.push(norm);

      // Synthesize a project entry for any custom GPT (gizmo) we encounter.
      if (c.gizmo_id) {
        const id = safeId("cgpt-proj", c.gizmo_id);
        if (!projectsById.has(id)) {
          projectsById.set(id, {
            id,
            source: sourceTag,
            sourceId: c.gizmo_id,
            name: c.gizmo_title || `Custom GPT (${c.gizmo_id})`,
            description: null,
            systemPrompt: null,
            createdAt: null,
            updatedAt: null,
            documents: [],
          });
        }
      }
    }

    return {
      source: sourceTag,
      filename,
      counts: { projects: projectsById.size, conversations: convs.length },
      projects: Array.from(projectsById.values()),
      conversations: convs,
    };
  }

  // ---------- Claude ----------

  function claudeRole(sender) {
    if (sender === "human" || sender === "user") return "user";
    if (sender === "assistant" || sender === "ai") return "assistant";
    if (sender === "system") return "system";
    return "user";
  }

  function claudeMessageContent(msg) {
    const parts = [];
    let text = "";

    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block) continue;
        if (block.type === "text" && typeof block.text === "string") {
          parts.push({ type: "text", text: block.text });
          text += (text ? "\n\n" : "") + block.text;
        } else if (block.type === "tool_use") {
          parts.push({
            type: "tool_use",
            name: block.name || null,
            input: block.input || null,
          });
        } else if (block.type === "tool_result") {
          parts.push({
            type: "tool_result",
            content: block.content || null,
          });
        } else {
          parts.push({ type: block.type || "unknown", raw: block });
        }
      }
    }

    if (!text && typeof msg.text === "string") {
      text = msg.text;
      if (text) parts.unshift({ type: "text", text });
    }

    return { text, parts };
  }

  function extractClaudeAttachments(msg) {
    const out = [];
    const atts = msg.attachments || [];
    for (const a of atts) {
      out.push({
        name: a.file_name || a.fileName || null,
        type: a.file_type || a.fileType || null,
        size: typeof a.file_size === "number" ? a.file_size : null,
      });
    }
    const files = msg.files || [];
    for (const f of files) {
      out.push({
        name: f.file_name || f.fileName || null,
        type: f.file_type || null,
        size: null,
      });
    }
    return out;
  }

  function normalizeClaudeConversation(conv, sourceTag) {
    const raw = Array.isArray(conv.chat_messages) ? conv.chat_messages.slice() : [];
    raw.sort((a, b) => {
      const ai = typeof a.index === "number" ? a.index : 0;
      const bi = typeof b.index === "number" ? b.index : 0;
      if (ai !== bi) return ai - bi;
      const at = a.created_at ? Date.parse(a.created_at) : 0;
      const bt = b.created_at ? Date.parse(b.created_at) : 0;
      return at - bt;
    });

    const messages = raw.map((m) => {
      const { text, parts } = claudeMessageContent(m);
      return {
        id: safeId("claude-msg", m.uuid),
        role: claudeRole(m.sender),
        content: text,
        parts,
        createdAt: toISO(m.created_at),
        model: null,
        attachments: extractClaudeAttachments(m),
      };
    });

    const projectUuid = conv.project_uuid || (conv.project && conv.project.uuid) || null;

    return {
      id: safeId("claude-conv", conv.uuid),
      source: sourceTag,
      sourceId: conv.uuid || null,
      projectId: projectUuid ? safeId("claude-proj", projectUuid) : null,
      title: conv.name || "(untitled)",
      createdAt: toISO(conv.created_at),
      updatedAt: toISO(conv.updated_at),
      model: null,
      messageCount: messages.length,
      messages,
    };
  }

  function normalizeClaudeProject(p, sourceTag) {
    const docs = Array.isArray(p.docs) ? p.docs : [];
    return {
      id: safeId("claude-proj", p.uuid),
      source: sourceTag,
      sourceId: p.uuid || null,
      name: p.name || "(untitled project)",
      description: p.description || null,
      systemPrompt: p.prompt_template || null,
      createdAt: toISO(p.created_at),
      updatedAt: toISO(p.updated_at),
      documents: docs.map((d) => ({
        id: safeId("claude-doc", d.uuid),
        name: d.filename || d.file_name || d.name || null,
        content: typeof d.content === "string" ? d.content : null,
        createdAt: toISO(d.created_at),
      })),
    };
  }

  function normalizeClaude(payload, filename) {
    const sourceTag = "claude";
    const projectsArr = (payload.projects || []).map((p) => normalizeClaudeProject(p, sourceTag));
    const convs = (payload.conversations || []).map((c) => normalizeClaudeConversation(c, sourceTag));

    return {
      source: sourceTag,
      filename,
      counts: { projects: projectsArr.length, conversations: convs.length },
      projects: projectsArr,
      conversations: convs,
    };
  }

  // ---------- format detection ----------

  function detectFormat(parsed) {
    if (Array.isArray(parsed)) {
      const sample = parsed[0] || {};
      if (sample.mapping || sample.conversation_id) return "chatgpt";
      // Projects must be checked before conversations: both shapes carry
      // {uuid, name}, so we look for the project-only fields first.
      if (sample.prompt_template !== undefined || Array.isArray(sample.docs)) return "claude-projects";
      if (Array.isArray(sample.chat_messages) || (sample.uuid && sample.name)) return "claude-conversations";
    }
    return "unknown";
  }

  // Detect from a {filename: contents} bag (e.g. extracted zip).
  function detectFromBundle(files) {
    const names = Object.keys(files);
    const hasClaudeShape = names.some(
      (n) => /(^|\/)conversations\.json$/i.test(n) || /(^|\/)projects\.json$/i.test(n)
    );
    if (!hasClaudeShape) return null;

    // Try to differentiate Claude vs ChatGPT both of which use "conversations.json".
    for (const n of names) {
      if (/(^|\/)conversations\.json$/i.test(n)) {
        try {
          const parsed = JSON.parse(files[n]);
          const fmt = detectFormat(parsed);
          if (fmt === "chatgpt") return "chatgpt-zip";
          if (fmt === "claude-conversations") return "claude-zip";
        } catch (_) {
          // ignore
        }
      }
    }
    return null;
  }

  // ---------- top-level entry points ----------

  /**
   * Parse a single JSON file's contents. The caller tells us the filename so we
   * can record provenance; format is auto-detected from the JSON shape.
   */
  function normalizeJSON(text, filename) {
    const parsed = JSON.parse(text);
    const fmt = detectFormat(parsed);
    if (fmt === "chatgpt") return normalizeChatGPT(parsed, filename);
    if (fmt === "claude-conversations") return normalizeClaude({ conversations: parsed }, filename);
    if (fmt === "claude-projects") return normalizeClaude({ projects: parsed }, filename);
    throw new Error(`Unrecognized JSON shape in ${filename}`);
  }

  /**
   * Normalize an extracted Claude/ChatGPT zip represented as
   * { "path/in/zip": "file contents" }. Only conversations.json / projects.json
   * are used; other files (HTML pages, message_feedback.json, etc.) are ignored.
   */
  function normalizeBundle(files, filename) {
    const fmt = detectFromBundle(files);
    if (!fmt) throw new Error(`No conversations.json/projects.json found in ${filename}`);

    const find = (re) => {
      const key = Object.keys(files).find((k) => re.test(k));
      return key ? files[key] : null;
    };

    if (fmt === "chatgpt-zip") {
      const text = find(/(^|\/)conversations\.json$/i);
      const parsed = JSON.parse(text);
      return normalizeChatGPT(parsed, filename);
    }
    if (fmt === "claude-zip") {
      const convText = find(/(^|\/)conversations\.json$/i);
      const projText = find(/(^|\/)projects\.json$/i);
      const payload = {};
      if (convText) payload.conversations = JSON.parse(convText);
      if (projText) payload.projects = JSON.parse(projText);
      return normalizeClaude(payload, filename);
    }
    throw new Error(`Unhandled bundle format ${fmt}`);
  }

  /**
   * Merge multiple per-file normalization outputs into a single document and
   * link conversations to projects by id.
   */
  function combine(results) {
    const projects = [];
    const conversations = [];
    const sources = [];

    for (const r of results) {
      sources.push({ source: r.source, filename: r.filename, counts: r.counts });
      for (const p of r.projects) pushUnique(projects, p, "id");
      for (const c of r.conversations) pushUnique(conversations, c, "id");
    }

    // Drop projectId references that don't resolve to a known project. This
    // keeps the data honest when a Claude export has conversations but no
    // matching projects.json.
    const projectIds = new Set(projects.map((p) => p.id));
    for (const c of conversations) {
      if (c.projectId && !projectIds.has(c.projectId)) c.projectId = null;
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      sources,
      projects,
      conversations,
    };
  }

  return {
    SCHEMA_VERSION,
    normalizeJSON,
    normalizeBundle,
    normalizeChatGPT,
    normalizeClaude,
    detectFormat,
    detectFromBundle,
    combine,
  };
});
