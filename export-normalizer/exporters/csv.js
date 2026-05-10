/**
 * Two CSVs (conversations.csv + messages.csv). Useful for spreadsheet
 * triage and pivot tables; not a lossless export.
 */
const fs = require("fs");
const path = require("path");

function buildCsv(db, outDir, opts = {}) {
  const { projectId = null, source = null, since = null } = opts;
  fs.mkdirSync(outDir, { recursive: true });

  const convs = db
    .prepare(
      `SELECT c.id, c.source, c.source_id, c.project_id, p.name AS project_name,
              c.title, c.created_at, c.updated_at, c.model, c.message_count
       FROM conversations c
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE (@projectId IS NULL OR c.project_id = @projectId)
         AND (@source    IS NULL OR c.source     = @source)
         AND (@since     IS NULL OR (c.updated_at IS NOT NULL AND c.updated_at >= @since))
       ORDER BY c.source, c.updated_at DESC`
    )
    .all({ projectId, source, since });

  const convPath = path.join(outDir, "conversations.csv");
  fs.writeFileSync(
    convPath,
    toCsv(
      ["id", "source", "source_id", "project_id", "project_name", "title", "created_at", "updated_at", "model", "message_count"],
      convs.map((r) => [
        r.id, r.source, r.source_id || "", r.project_id || "", r.project_name || "",
        r.title || "", r.created_at || "", r.updated_at || "", r.model || "", r.message_count || 0,
      ])
    )
  );

  const msgs = db
    .prepare(
      `SELECT m.id AS message_id, m.conversation_id, m.ord, m.role, m.content,
              m.created_at, m.model, c.source, c.title AS conversation_title,
              c.project_id
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE (@projectId IS NULL OR c.project_id = @projectId)
         AND (@source    IS NULL OR c.source     = @source)
         AND (@since     IS NULL OR (c.updated_at IS NOT NULL AND c.updated_at >= @since))
       ORDER BY c.id, m.ord`
    )
    .all({ projectId, source, since });

  const msgPath = path.join(outDir, "messages.csv");
  fs.writeFileSync(
    msgPath,
    toCsv(
      ["message_id", "conversation_id", "conversation_title", "source", "project_id", "ord", "role", "model", "created_at", "content"],
      msgs.map((m) => [
        m.message_id, m.conversation_id, m.conversation_title || "", m.source,
        m.project_id || "", m.ord, m.role, m.model || "", m.created_at || "", m.content || "",
      ])
    )
  );

  return { conversationsCount: convs.length, messagesCount: msgs.length, outDir };
}

function toCsv(header, rows) {
  const out = [header.map(escape).join(",")];
  for (const r of rows) out.push(r.map(escape).join(","));
  return out.join("\n") + "\n";
}

function escape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

module.exports = { buildCsv };
