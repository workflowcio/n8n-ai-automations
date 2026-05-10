/**
 * Thin wrapper around better-sqlite3 with prepared inserts for the canonical
 * schema. All write paths are idempotent (INSERT OR REPLACE) so re-ingesting
 * the same export overwrites instead of duplicating.
 */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const SCHEMA_PATH = path.join(__dirname, "schema.sql");

function open(dbPath, opts = {}) {
  const db = new Database(dbPath, { readonly: !!opts.readonly });
  db.pragma("journal_mode = WAL");
  // FK enforcement is intentionally OFF during writes (better-sqlite3
  // defaults it to ON) so a Claude conversations.json can be ingested before
  // its matching projects.json without violating REFERENCES projects(id).
  // dropOrphanProjectLinks() at the end of ingest cleans up any links that
  // don't ultimately resolve.
  if (!opts.readonly) {
    db.pragma("foreign_keys = OFF");
    const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
    db.exec(schema);
  }
  return db;
}

function makeWriter(db) {
  const insertSource = db.prepare(`
    INSERT INTO sources (source, filename, imported_at, schema_version, conv_count, proj_count, msg_count)
    VALUES (@source, @filename, @imported_at, @schema_version, @conv_count, @proj_count, @msg_count)
  `);
  const upsertProject = db.prepare(`
    INSERT INTO projects (id, source, source_id, name, description, system_prompt, created_at, updated_at)
    VALUES (@id, @source, @source_id, @name, @description, @system_prompt, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      source=excluded.source, source_id=excluded.source_id, name=excluded.name,
      description=excluded.description, system_prompt=excluded.system_prompt,
      created_at=excluded.created_at, updated_at=excluded.updated_at
  `);
  const upsertDocument = db.prepare(`
    INSERT INTO documents (id, project_id, name, content, created_at)
    VALUES (@id, @project_id, @name, @content, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      project_id=excluded.project_id, name=excluded.name,
      content=excluded.content, created_at=excluded.created_at
  `);
  const upsertConversation = db.prepare(`
    INSERT INTO conversations (id, source, source_id, project_id, title, created_at, updated_at, model, message_count)
    VALUES (@id, @source, @source_id, @project_id, @title, @created_at, @updated_at, @model, @message_count)
    ON CONFLICT(id) DO UPDATE SET
      source=excluded.source, source_id=excluded.source_id,
      project_id=excluded.project_id, title=excluded.title,
      created_at=excluded.created_at, updated_at=excluded.updated_at,
      model=excluded.model, message_count=excluded.message_count
  `);
  const deleteMessages = db.prepare(`DELETE FROM messages WHERE conversation_id = ?`);
  const insertMessage = db.prepare(`
    INSERT INTO messages (id, conversation_id, ord, role, content, parts_json, created_at, model)
    VALUES (@id, @conversation_id, @ord, @role, @content, @parts_json, @created_at, @model)
  `);
  const insertAttachment = db.prepare(`
    INSERT INTO attachments (message_id, name, type, size)
    VALUES (@message_id, @name, @type, @size)
  `);
  const insertFts = db.prepare(`
    INSERT INTO messages_fts (content, message_id, conversation_id)
    VALUES (?, ?, ?)
  `);
  const deleteFtsForConv = db.prepare(`
    DELETE FROM messages_fts WHERE conversation_id = ?
  `);
  const projectMissing = db.prepare(`SELECT 1 FROM projects WHERE id = ?`);
  const clearOrphanProjectLink = db.prepare(`
    UPDATE conversations SET project_id = NULL WHERE id = ? AND project_id = ?
  `);

  function writeProject(p) {
    upsertProject.run({
      id: p.id,
      source: p.source,
      source_id: p.sourceId || null,
      name: p.name || "(untitled project)",
      description: p.description || null,
      system_prompt: p.systemPrompt || null,
      created_at: p.createdAt || null,
      updated_at: p.updatedAt || null,
    });
    if (Array.isArray(p.documents)) {
      for (const d of p.documents) {
        upsertDocument.run({
          id: d.id,
          project_id: p.id,
          name: d.name || null,
          content: d.content || null,
          created_at: d.createdAt || null,
        });
      }
    }
  }

  function writeConversation(c) {
    // Keep the project_id even if the project hasn't been ingested yet — FK
    // enforcement is off during writes, and dropOrphanProjectLinks() at the
    // end of ingest will null out anything that still doesn't resolve.
    const projectId = c.projectId || null;
    upsertConversation.run({
      id: c.id,
      source: c.source,
      source_id: c.sourceId || null,
      project_id: projectId,
      title: c.title || "(untitled)",
      created_at: c.createdAt || null,
      updated_at: c.updatedAt || null,
      model: c.model || null,
      message_count: c.messageCount || (c.messages ? c.messages.length : 0),
    });
    deleteFtsForConv.run(c.id);
    deleteMessages.run(c.id);
    const messages = c.messages || [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      insertMessage.run({
        id: m.id,
        conversation_id: c.id,
        ord: i,
        role: m.role || "user",
        content: m.content || "",
        parts_json: m.parts ? JSON.stringify(m.parts) : null,
        created_at: m.createdAt || null,
        model: m.model || null,
      });
      if (m.content) insertFts.run(m.content, m.id, c.id);
      if (Array.isArray(m.attachments)) {
        for (const a of m.attachments) {
          insertAttachment.run({
            message_id: m.id,
            name: a.name || null,
            type: a.type || null,
            size: typeof a.size === "number" ? a.size : null,
          });
        }
      }
    }
  }

  function writeSourceRecord(meta) {
    insertSource.run({
      source: meta.source,
      filename: meta.filename,
      imported_at: meta.importedAt || new Date().toISOString(),
      schema_version: meta.schemaVersion || "1.0",
      conv_count: meta.convCount || 0,
      proj_count: meta.projCount || 0,
      msg_count: meta.msgCount || 0,
    });
  }

  function dropOrphanProjectLinks() {
    db.exec(`
      UPDATE conversations
      SET project_id = NULL
      WHERE project_id IS NOT NULL
        AND project_id NOT IN (SELECT id FROM projects);
    `);
  }

  return {
    writeProject,
    writeConversation,
    writeSourceRecord,
    dropOrphanProjectLinks,
    clearOrphanProjectLink,
    transaction: db.transaction.bind(db),
  };
}

module.exports = { open, makeWriter };
