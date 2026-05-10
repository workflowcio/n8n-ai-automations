/**
 * `chat-archive projects --db ./store.db`
 *
 * Lists projects across all sources with conversation counts. Useful for
 * picking a `--project` value for export/search.
 */
const Store = require("../db/store.js");
const Progress = require("./progress.js");

function listProjects(args) {
  const { db: dbPath, source } = args;
  if (!dbPath) throw new Error("--db <path> is required");
  const db = Store.open(dbPath, { readonly: true });

  const where = source ? "WHERE p.source = @source" : "";
  const rows = db
    .prepare(
      `SELECT p.id, p.source, p.name, p.description,
              (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id) AS conv_count
       FROM projects p
       ${where}
       ORDER BY p.source, p.name`
    )
    .all(source ? { source } : {});

  // Also include a synthetic "(no project)" bucket so users see how many
  // conversations are unscoped.
  const looseQuery = source
    ? `SELECT source, COUNT(*) AS n FROM conversations
       WHERE project_id IS NULL AND source = @source GROUP BY source`
    : `SELECT source, COUNT(*) AS n FROM conversations
       WHERE project_id IS NULL GROUP BY source`;
  const loose = db.prepare(looseQuery).all(source ? { source } : {});

  if (!rows.length && !loose.length) {
    Progress.info("(no projects in this database)");
    return;
  }

  const rowsByCount = rows.slice().sort((a, b) => b.conv_count - a.conv_count);
  const idWidth = Math.max(2, ...rows.map((r) => r.id.length));
  const nameWidth = Math.max(4, ...rows.map((r) => r.name.length));
  const sourceWidth = Math.max(6, ...rows.map((r) => r.source.length));
  console.log(
    `${pad("SOURCE", sourceWidth)}  ${pad("CONVS", 5)}  ${pad("ID", idWidth)}  ${pad("NAME", nameWidth)}`
  );
  console.log("-".repeat(sourceWidth + 5 + idWidth + nameWidth + 6));
  for (const r of rowsByCount) {
    console.log(
      `${pad(r.source, sourceWidth)}  ${pad(String(r.conv_count), 5)}  ${pad(r.id, idWidth)}  ${r.name}`
    );
  }
  for (const l of loose) {
    console.log(
      `${pad(l.source, sourceWidth)}  ${pad(String(l.n), 5)}  ${pad("-", idWidth)}  (no project)`
    );
  }

  db.close();
  Progress.nextSteps([
    `chat-archive search --db ${dbPath} "term" --project "<name>"`,
    `chat-archive export --db ${dbPath} --format md --out ./out --project "<name>"`,
  ]);
}

function pad(s, n) {
  s = String(s);
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

module.exports = { listProjects };
