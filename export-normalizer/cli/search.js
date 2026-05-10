/**
 * `chat-archive search --db ./store.db "query" [--project X] [--source Y] [--limit N]`
 *
 * Uses FTS5 for fast full-text search over message content, scoped optionally
 * to a project (by id or case-insensitive name) and/or source.
 */
const Store = require("../db/store.js");
const Progress = require("./progress.js");

function search(args) {
  const { db: dbPath, project, source, limit = 25 } = args;
  const query = args.query || (args.inputs && args.inputs[0]);
  if (!dbPath) throw new Error("--db <path> is required");
  if (!query) throw new Error('search query is required: chat-archive search --db ... "term"');

  const db = Store.open(dbPath, { readonly: true });
  const projectId = project ? resolveProjectId(db, project) : null;
  if (project && !projectId) {
    Progress.info(`No project matches "${project}". Try: chat-archive projects --db ${dbPath}`);
    db.close();
    return;
  }

  const rows = db
    .prepare(
      `SELECT m.id            AS message_id,
              m.role          AS role,
              m.content       AS content,
              c.id            AS conversation_id,
              c.title         AS conversation_title,
              c.source        AS source,
              p.id            AS project_id,
              p.name          AS project_name,
              snippet(messages_fts, 0, '«', '»', '…', 12) AS snippet
       FROM messages_fts
       JOIN messages m       ON m.id = messages_fts.message_id
       JOIN conversations c  ON c.id = m.conversation_id
       LEFT JOIN projects p  ON p.id = c.project_id
       WHERE messages_fts MATCH @query
         AND (@projectId IS NULL OR c.project_id = @projectId)
         AND (@source    IS NULL OR c.source     = @source)
       ORDER BY rank
       LIMIT @limit`
    )
    .all({
      query: ftsQuote(query),
      projectId,
      source: source || null,
      limit: Number(limit) || 25,
    });

  if (!rows.length) {
    Progress.info(`No matches for "${query}"${project ? ` in project ${project}` : ""}.`);
    db.close();
    return;
  }

  for (const r of rows) {
    const proj = r.project_name ? `[${r.project_name}] ` : "";
    console.log(`\n${r.source} ${proj}${r.conversation_title}`);
    console.log(`  ${r.role}: ${r.snippet}`);
    console.log(`  conv-id=${r.conversation_id}  msg-id=${r.message_id}`);
  }
  console.log(`\n${rows.length} match${rows.length === 1 ? "" : "es"}`);

  db.close();
}

function resolveProjectId(db, identifier) {
  // Accept exact id, source-prefixed id, or case-insensitive name.
  const byId = db.prepare("SELECT id FROM projects WHERE id = ?").get(identifier);
  if (byId) return byId.id;
  const byName = db
    .prepare("SELECT id FROM projects WHERE LOWER(name) = LOWER(?)")
    .get(identifier);
  if (byName) return byName.id;
  // Substring fallback — only if it uniquely matches.
  const candidates = db
    .prepare("SELECT id, name FROM projects WHERE LOWER(name) LIKE ?")
    .all(`%${String(identifier).toLowerCase()}%`);
  if (candidates.length === 1) return candidates[0].id;
  return null;
}

// Quote a user-typed FTS5 query so words with hyphens etc don't break parsing.
function ftsQuote(q) {
  if (/^"[^"]*"$/.test(q)) return q;
  if (/[\s\-:."']/.test(q)) return `"${q.replace(/"/g, '""')}"`;
  return q;
}

module.exports = { search, resolveProjectId };
