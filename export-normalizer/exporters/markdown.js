/**
 * Writes a Markdown folder tree:
 *   out/<source>/<project|"_no-project">/<slug>--<id>.md
 *
 * Each file has YAML frontmatter + per-message sections so it renders nicely
 * in editors, in Drive Docs preview, and on GitHub.
 */
const fs = require("fs");
const path = require("path");

function buildMarkdownTree(db, outDir, opts = {}) {
  const { projectId = null, source = null, since = null } = opts;
  fs.mkdirSync(outDir, { recursive: true });

  const conversations = db
    .prepare(
      `SELECT c.id, c.source, c.source_id, c.project_id, c.title,
              c.created_at, c.updated_at, c.model, c.message_count,
              p.name AS project_name
       FROM conversations c
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE (@projectId IS NULL OR c.project_id = @projectId)
         AND (@source    IS NULL OR c.source     = @source)
         AND (@since     IS NULL OR (c.updated_at IS NOT NULL AND c.updated_at >= @since))
       ORDER BY c.source, COALESCE(p.name, ''), COALESCE(c.updated_at, c.created_at, '') DESC`
    )
    .all({ projectId, source, since });

  const messagesStmt = db.prepare(
    `SELECT role, content, created_at, model FROM messages
     WHERE conversation_id = ? ORDER BY ord`
  );

  let written = 0;
  for (const c of conversations) {
    const projectFolder = c.project_name ? slug(c.project_name) : "_no-project";
    const dir = path.join(outDir, c.source, projectFolder);
    fs.mkdirSync(dir, { recursive: true });

    const fileName = `${slug(c.title || "untitled")}--${shortId(c.id)}.md`;
    const filePath = path.join(dir, fileName);

    const front = [
      "---",
      `id: ${escapeYaml(c.id)}`,
      `source: ${c.source}`,
      `sourceId: ${escapeYaml(c.source_id || "")}`,
      `projectId: ${escapeYaml(c.project_id || "")}`,
      `project: ${escapeYaml(c.project_name || "")}`,
      `title: ${escapeYaml(c.title || "")}`,
      `model: ${escapeYaml(c.model || "")}`,
      `createdAt: ${c.created_at || ""}`,
      `updatedAt: ${c.updated_at || ""}`,
      `messageCount: ${c.message_count || 0}`,
      "---",
      "",
      `# ${c.title || "(untitled)"}`,
      "",
    ].join("\n");

    const body = messagesStmt
      .all(c.id)
      .map((m) => {
        const ts = m.created_at ? ` _(${m.created_at})_` : "";
        return `## ${m.role}${ts}\n\n${m.content || ""}\n`;
      })
      .join("\n");

    fs.writeFileSync(filePath, front + body, "utf8");
    written++;
  }
  return { written, outDir };
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

function shortId(id) {
  // Take last 8 chars of any source-prefixed id; good enough for filename uniqueness.
  return String(id).replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "x";
}

function escapeYaml(s) {
  if (s === null || s === undefined) return '""';
  if (typeof s !== "string") s = String(s);
  if (/[:#\-?\[\]{},&*!|>'"%@`]/.test(s) || s.includes("\n")) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

module.exports = { buildMarkdownTree };
