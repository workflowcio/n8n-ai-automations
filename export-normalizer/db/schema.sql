-- chat-archive canonical store
-- Mirrors the v1 JSON schema 1:1 so a JSON export is just SELECT json_object(...).

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
-- FK enforcement is set per-connection in db/store.js. We deliberately leave
-- it OFF during writes so that conversations can reference a project that
-- arrives in a later ingest pass; dropOrphanProjectLinks() handles cleanup.

CREATE TABLE IF NOT EXISTS sources (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL,
  filename        TEXT NOT NULL,
  imported_at     TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  conv_count      INTEGER NOT NULL DEFAULT 0,
  proj_count      INTEGER NOT NULL DEFAULT 0,
  msg_count       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,
  source         TEXT NOT NULL,
  source_id      TEXT,
  name           TEXT NOT NULL,
  description    TEXT,
  system_prompt  TEXT,
  created_at     TEXT,
  updated_at     TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT,
  content     TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);

CREATE TABLE IF NOT EXISTS conversations (
  id             TEXT PRIMARY KEY,
  source         TEXT NOT NULL,
  source_id      TEXT,
  project_id     TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  created_at     TEXT,
  updated_at     TEXT,
  model          TEXT,
  message_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conv_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conv_source  ON conversations(source);
CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ord             INTEGER NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  parts_json      TEXT,
  created_at      TEXT,
  model           TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, ord);

CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  name        TEXT,
  type        TEXT,
  size        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_att_msg ON attachments(message_id);

-- FTS5 contentless table over messages.content for fast search.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  message_id UNINDEXED,
  conversation_id UNINDEXED,
  tokenize = 'porter unicode61'
);
