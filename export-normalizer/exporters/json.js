/**
 * Exports the SQLite store back into the v1 normalized JSON shape.
 * Used by `chat-archive export --format json` and by the test harness for
 * round-trip checks against the browser path.
 */
function buildJson(db, opts = {}) {
  const { projectId = null, source = null, since = null } = opts;

  const projects = db
    .prepare(
      `SELECT id, source, source_id AS sourceId, name, description,
              system_prompt AS systemPrompt, created_at AS createdAt, updated_at AS updatedAt
       FROM projects
       WHERE (@projectId IS NULL OR id = @projectId)
         AND (@source    IS NULL OR source = @source)
       ORDER BY source, name`
    )
    .all({ projectId, source });

  const projectIds = new Set(projects.map((p) => p.id));

  const docsByProject = new Map();
  for (const d of db
    .prepare(
      `SELECT id, project_id AS projectId, name, content, created_at AS createdAt
       FROM documents`
    )
    .all()) {
    if (!projectIds.has(d.projectId)) continue;
    const list = docsByProject.get(d.projectId) || [];
    list.push({ id: d.id, name: d.name, content: d.content, createdAt: d.createdAt });
    docsByProject.set(d.projectId, list);
  }
  for (const p of projects) p.documents = docsByProject.get(p.id) || [];

  const conversations = db
    .prepare(
      `SELECT id, source, source_id AS sourceId, project_id AS projectId,
              title, created_at AS createdAt, updated_at AS updatedAt,
              model, message_count AS messageCount
       FROM conversations
       WHERE (@projectId IS NULL OR project_id = @projectId)
         AND (@source    IS NULL OR source     = @source)
         AND (@since     IS NULL OR (updated_at IS NOT NULL AND updated_at >= @since))
       ORDER BY COALESCE(updated_at, created_at, '') DESC`
    )
    .all({ projectId, source, since });

  const messagesStmt = db.prepare(
    `SELECT id, role, content, parts_json AS partsJson, created_at AS createdAt, model
     FROM messages WHERE conversation_id = ? ORDER BY ord`
  );
  const attachmentsStmt = db.prepare(
    `SELECT message_id AS messageId, name, type, size FROM attachments WHERE message_id IN
     (SELECT id FROM messages WHERE conversation_id = ?)`
  );

  for (const c of conversations) {
    const messages = messagesStmt.all(c.id).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      parts: m.partsJson ? JSON.parse(m.partsJson) : [],
      createdAt: m.createdAt,
      model: m.model,
      attachments: [],
    }));
    const atts = attachmentsStmt.all(c.id);
    const byMsg = new Map();
    for (const a of atts) {
      const list = byMsg.get(a.messageId) || [];
      list.push({ name: a.name, type: a.type, size: a.size });
      byMsg.set(a.messageId, list);
    }
    for (const m of messages) m.attachments = byMsg.get(m.id) || [];
    c.messages = messages;
    c.messageCount = messages.length;
  }

  const sources = db
    .prepare(
      `SELECT source, filename,
              json_object('projects', proj_count, 'conversations', conv_count) AS counts
       FROM sources ORDER BY id`
    )
    .all()
    .map((r) => ({ source: r.source, filename: r.filename, counts: JSON.parse(r.counts) }));

  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    sources,
    projects,
    conversations,
  };
}

module.exports = { buildJson };
