/**
 * `chat-archive ingest <export...> --db ./store.db [--source auto|...]`
 *
 * Streams each conversation through the matching per-conversation normalizer
 * and writes to SQLite in batches. Designed to handle multi-GB exports
 * without loading the whole file into memory.
 */
const fs = require("fs");
const path = require("path");
const Normalizer = require("../normalizer.js");
const Store = require("../db/store.js");
const Streaming = require("./streaming.js");
const Progress = require("./progress.js");

async function ingest(args) {
  const { db: dbPath, source: sourceHint = "auto", inputs } = args;
  if (!dbPath) throw new Error("--db <path> is required");
  if (!inputs.length) throw new Error("Provide at least one export file or directory");

  const db = Store.open(dbPath);
  const writer = Store.makeWriter(db);

  let totalConvs = 0;
  let totalProjects = 0;
  let totalMsgs = 0;
  const sourceCounts = new Map();

  for (const input of inputs) {
    const result = await ingestOne(writer, input, sourceHint);
    totalConvs += result.conversations;
    totalProjects += result.projects;
    totalMsgs += result.messages;
    sourceCounts.set(result.source, (sourceCounts.get(result.source) || 0) + result.conversations);
    writer.writeSourceRecord({
      source: result.source,
      filename: path.basename(input),
      importedAt: new Date().toISOString(),
      schemaVersion: Normalizer.SCHEMA_VERSION,
      convCount: result.conversations,
      projCount: result.projects,
      msgCount: result.messages,
    });
  }

  writer.dropOrphanProjectLinks();
  db.close();

  Progress.info(
    `\nImported ${totalConvs} conversations, ${totalProjects} projects, ${totalMsgs} messages into ${dbPath}`
  );
  for (const [src, count] of sourceCounts) Progress.info(`  ${src}: ${count} conversations`);
  Progress.nextSteps([
    `chat-archive projects --db ${dbPath}            # list projects across all sources`,
    `chat-archive search   --db ${dbPath} "query"     # full-text search`,
    `chat-archive export   --db ${dbPath} --format md --out ./out`,
    `chat-archive serve    --db ${dbPath}             # browse in localhost:8000`,
  ]);
}

async function ingestOne(writer, input, sourceHint) {
  const desc = await Streaming.describeSource(input);
  const detected = await detectSource(desc, sourceHint);
  Progress.info(`Ingesting ${path.basename(input)} as ${detected}`);
  if (detected === "chatgpt") return ingestChatGPT(writer, desc, "chatgpt");
  if (detected === "claude") return ingestClaude(writer, desc, "claude");
  if (detected === "claude-projects") return ingestClaudeProjectsOnly(writer, desc, "claude");
  if (detected === "gemini") return ingestGemini(writer, desc, "gemini");
  if (detected === "grok") return ingestGeneric(writer, desc, "grok");
  if (detected === "mistral") return ingestGeneric(writer, desc, "mistral");
  if (detected === "deepseek") return ingestGeneric(writer, desc, "deepseek");
  throw new Error(`Unknown source for ${input}`);
}

async function ingestClaudeProjectsOnly(writer, desc, source) {
  const text = fs.readFileSync(desc.path, "utf8");
  const projects = JSON.parse(text);
  let projectCount = 0;
  const txn = writer.transaction(() => {
    for (const p of projects) {
      writer.writeProject(Normalizer.normalizeClaudeProject(p, source));
      projectCount++;
    }
  });
  txn();
  // Re-attach previously-orphaned conversations whose project_id now exists.
  const db = getDbFromWriter(writer);
  if (db) {
    db.exec(`-- noop, link reconciliation handled at end of full ingest`);
  }
  Progress.info(`Claude (projects only): ${projectCount} projects`);
  return { source, conversations: 0, messages: 0, projects: projectCount };
}

function getDbFromWriter() {
  // The writer object doesn't expose the underlying db; orphan-link reattachment
  // is handled after all inputs have been ingested by ingest()'s
  // dropOrphanProjectLinks pass. We keep this hook as a placeholder for a
  // future relink step (which would need to re-walk conversations whose
  // project_id had been nulled during a prior ingest).
  return null;
}

async function detectSource(desc, hint) {
  if (hint && hint !== "auto") return hint;
  const names = desc.entries ? desc.entries.map((e) => e.name) : [path.basename(desc.path)];

  if (names.some((n) => /(^|\/)gemini[ _-]?apps?(\/|$)/i.test(n))) return "gemini";
  if (names.some((n) => /(^|\/)my activity\/gemini(\/|$)/i.test(n))) return "gemini";

  // Zip with both projects.json + conversations.json => Claude.
  if (
    names.some((n) => /(^|\/)projects\.json$/i.test(n)) &&
    names.some((n) => /(^|\/)conversations\.json$/i.test(n))
  ) {
    return "claude";
  }

  // Otherwise peek at first conversation to disambiguate.
  return resolveByPeek(desc);
}

async function resolveByPeek(desc) {
  let firstItem = null;
  try {
    await streamConversationsJson(desc, (item) => {
      firstItem = item;
      throw new Error("__stop__");
    });
  } catch (e) {
    if (e.message !== "__stop__") throw e;
  }
  if (!firstItem) throw new Error(`No conversations found in ${desc.path}`);
  if (firstItem.mapping || firstItem.conversation_id) return "chatgpt";
  if (firstItem.prompt_template !== undefined || Array.isArray(firstItem.docs)) {
    return "claude-projects";
  }
  if (firstItem.chat_messages || firstItem.project_uuid) return "claude";
  const tag = (firstItem._source || firstItem.source || "").toLowerCase();
  if (["grok", "mistral", "deepseek", "gemini"].includes(tag)) return tag;
  if (Array.isArray(firstItem.turns) || Array.isArray(firstItem.contents)) return "gemini";
  throw new Error(
    `Couldn't auto-detect source for ${desc.path}. Pass --source chatgpt|claude|gemini|grok|mistral|deepseek.`
  );
}

// --- Per-source ingest paths ---

async function ingestChatGPT(writer, desc, source) {
  const txn = writer.transaction((fn) => fn());
  let conversations = 0;
  let messages = 0;
  const projectsSeen = new Map();
  const progress = Progress.newProgress("ChatGPT");

  await streamConversationsJson(desc, (raw) => {
    const norm = Normalizer.normalizeChatGPTConversation(raw, source);
    txn(() => {
      writer.writeConversation(norm);
      if (raw.gizmo_id && !projectsSeen.has(`cgpt-proj:${raw.gizmo_id}`)) {
        const proj = synthGptProject(raw);
        if (proj) {
          writer.writeProject(proj);
          projectsSeen.set(proj.id, true);
        }
      }
    });
    conversations++;
    messages += norm.messageCount;
    progress.tick({ convs: conversations, msgs: messages });
  });

  progress.done(`${messages} messages`);
  return { source, conversations, messages, projects: projectsSeen.size };
}

function synthGptProject(rawConv) {
  if (!rawConv.gizmo_id) return null;
  return {
    id: `cgpt-proj:${rawConv.gizmo_id}`,
    source: "chatgpt",
    sourceId: rawConv.gizmo_id,
    name: rawConv.gizmo_title || `Custom GPT (${rawConv.gizmo_id})`,
    description: null,
    systemPrompt: null,
    createdAt: null,
    updatedAt: null,
    documents: [],
  };
}

async function ingestClaude(writer, desc, source) {
  let projectCount = 0;
  const projectsText = await readBundleFile(desc, /(^|\/)projects\.json$/i);
  if (projectsText) {
    const projects = JSON.parse(projectsText);
    const txn = writer.transaction(() => {
      for (const p of projects) {
        writer.writeProject(Normalizer.normalizeClaudeProject(p, source));
        projectCount++;
      }
    });
    txn();
  }

  let conversations = 0;
  let messages = 0;
  const txn = writer.transaction((fn) => fn());
  const progress = Progress.newProgress("Claude");

  await streamConversationsJson(desc, (raw) => {
    const norm = Normalizer.normalizeClaudeConversation(raw, source);
    txn(() => writer.writeConversation(norm));
    conversations++;
    messages += norm.messageCount;
    progress.tick({ convs: conversations, msgs: messages });
  });

  progress.done(`${messages} messages, ${projectCount} projects`);
  return { source, conversations, messages, projects: projectCount };
}

async function ingestGemini(writer, desc, source) {
  let conversations = 0;
  let messages = 0;
  const progress = Progress.newProgress("Gemini");
  const txn = writer.transaction((fn) => fn());

  const handleConv = (raw) => {
    const norm = Normalizer.normalizeGeminiConversation(raw, source);
    if (norm.messageCount === 0) return;
    txn(() => writer.writeConversation(norm));
    conversations++;
    messages += norm.messageCount;
    progress.tick({ convs: conversations, msgs: messages });
  };

  if (desc.kind === "zip") {
    const zip = await Streaming.openZip(desc.path);
    const entries = await Streaming.listZipEntries(zip);
    for (const e of entries) {
      if (!Streaming.isJsonName(e.fileName)) continue;
      if (
        !/(^|\/)gemini[ _-]?apps?(\/|$)/i.test(e.fileName) &&
        !/(^|\/)my activity\/gemini(\/|$)/i.test(e.fileName)
      ) {
        continue;
      }
      const text = await Streaming.readZipEntryToString(zip, e);
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) parsed.forEach(handleConv);
      else handleConv(parsed);
    }
    zip.close();
  } else if (desc.kind === "dir") {
    for (const e of desc.entries) {
      if (!/\.json$/i.test(e.name)) continue;
      const parsed = JSON.parse(fs.readFileSync(e.fullPath, "utf8"));
      if (Array.isArray(parsed)) parsed.forEach(handleConv);
      else handleConv(parsed);
    }
  } else if (desc.kind === "json") {
    const parsed = JSON.parse(fs.readFileSync(desc.path, "utf8"));
    if (Array.isArray(parsed)) parsed.forEach(handleConv);
    else handleConv(parsed);
  }

  progress.done(`${messages} messages`);
  return { source, conversations, messages, projects: 0 };
}

async function ingestGeneric(writer, desc, source) {
  let conversations = 0;
  let messages = 0;
  const progress = Progress.newProgress(source);
  const txn = writer.transaction((fn) => fn());

  const opts = {
    source,
    convPrefix: source === "grok" ? "grok-conv" : source === "mistral" ? "mistral-conv" : "ds-conv",
    msgPrefix: source === "grok" ? "grok-msg" : source === "mistral" ? "mistral-msg" : "ds-msg",
  };

  await streamConversationsJson(desc, (raw) => {
    const norm = Normalizer.normalizeGenericLinearConversation(raw, opts);
    if (norm.messageCount === 0) return;
    txn(() => writer.writeConversation(norm));
    conversations++;
    messages += norm.messageCount;
    progress.tick({ convs: conversations, msgs: messages });
  });

  progress.done(`${messages} messages`);
  return { source, conversations, messages, projects: 0 };
}

// --- Stream helpers ---

async function streamConversationsJson(desc, onItem) {
  if (desc.kind === "zip") {
    const zip = await Streaming.openZip(desc.path);
    const entries = await Streaming.listZipEntries(zip);
    const conv = entries.find((e) => /(^|\/)conversations\.json$/i.test(e.fileName));
    if (!conv) {
      zip.close();
      throw new Error(`zip ${desc.path} has no conversations.json`);
    }
    const stream = await Streaming.readZipEntryStream(zip, conv);
    try {
      await Streaming.streamJsonArrayFromStream(stream, onItem);
    } finally {
      zip.close();
    }
    return;
  }
  if (desc.kind === "json") {
    await Streaming.streamJsonArrayFromFile(desc.path, onItem);
    return;
  }
  if (desc.kind === "dir") {
    const conv = desc.entries.find((e) => /(^|\/)conversations\.json$/i.test(e.name));
    if (!conv) throw new Error(`directory ${desc.path} has no conversations.json`);
    await Streaming.streamJsonArrayFromFile(conv.fullPath, onItem);
    return;
  }
  throw new Error(`unsupported source kind: ${desc.kind}`);
}

async function readBundleFile(desc, regex) {
  if (desc.kind === "zip") {
    const zip = await Streaming.openZip(desc.path);
    const entries = await Streaming.listZipEntries(zip);
    const e = entries.find((x) => regex.test(x.fileName));
    if (!e) {
      zip.close();
      return null;
    }
    const text = await Streaming.readZipEntryToString(zip, e);
    zip.close();
    return text;
  }
  if (desc.kind === "dir") {
    const e = desc.entries.find((x) => regex.test(x.name));
    return e ? fs.readFileSync(e.fullPath, "utf8") : null;
  }
  return null;
}

module.exports = { ingest };
