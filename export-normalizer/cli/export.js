/**
 * `chat-archive export --db ./store.db --format json|csv|md --out ./out
 *                      [--project X] [--source Y] [--since YYYY-MM-DD]`
 */
const fs = require("fs");
const path = require("path");
const Store = require("../db/store.js");
const { buildJson } = require("../exporters/json.js");
const { buildMarkdownTree } = require("../exporters/markdown.js");
const { buildCsv } = require("../exporters/csv.js");
const { resolveProjectId } = require("./search.js");
const Progress = require("./progress.js");

function exportCmd(args) {
  const { db: dbPath, format = "md", out = "./out", project, source, since } = args;
  if (!dbPath) throw new Error("--db <path> is required");
  if (!["json", "csv", "md"].includes(format)) {
    throw new Error(`unknown --format ${format} (expected json|csv|md)`);
  }

  const db = Store.open(dbPath, { readonly: true });
  const projectId = project ? resolveProjectId(db, project) : null;
  if (project && !projectId) {
    db.close();
    throw new Error(`No project matches "${project}". Try: chat-archive projects --db ${dbPath}`);
  }

  const opts = { projectId, source: source || null, since: since || null };
  if (format === "json") {
    fs.mkdirSync(out, { recursive: true });
    const doc = buildJson(db, opts);
    const file = path.join(out, "normalized.json");
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));
    Progress.info(
      `Wrote ${file}: ${doc.conversations.length} conversations, ${doc.projects.length} projects`
    );
  } else if (format === "md") {
    const res = buildMarkdownTree(db, out, opts);
    Progress.info(`Wrote ${res.written} Markdown files under ${res.outDir}`);
    Progress.info(
      `Drop the folder into Drive Desktop or OneDrive sync to back it up to the cloud.`
    );
  } else if (format === "csv") {
    const res = buildCsv(db, out, opts);
    Progress.info(
      `Wrote ${res.conversationsCount} conversations.csv rows and ${res.messagesCount} messages.csv rows under ${res.outDir}`
    );
  }
  db.close();
}

module.exports = { exportCmd };
