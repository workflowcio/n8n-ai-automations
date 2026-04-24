# Export Normalizer

A small web app that takes ChatGPT and Claude data exports and normalizes them
into a single, predictable JSON schema with **projects → conversations → messages**.

Everything runs in your browser. Nothing is uploaded.

## Run it

```bash
# from the repo root
python3 -m http.server 8000 --directory export-normalizer
# then open http://localhost:8000
```

You can also just open `export-normalizer/index.html` directly in a browser.

## What it accepts

- **ChatGPT** export `.zip` (download from *Settings → Data Controls → Export*)
  or its raw `conversations.json`.
- **Claude** export `.zip` (download from *Settings → Account → Export data*)
  or its raw `conversations.json` / `projects.json`.

Drop one or more files; the app auto-detects the format and merges everything
into one normalized document. You can then browse projects and conversations
in the UI or click **Download normalized.json**.

## Normalized schema

```jsonc
{
  "schemaVersion": "1.0",
  "generatedAt": "ISO timestamp",
  "sources": [{ "source": "chatgpt|claude", "filename": "...", "counts": {...} }],
  "projects": [
    {
      "id":           "claude-proj:<uuid>",   // stable, namespaced
      "source":       "chatgpt|claude",
      "sourceId":     "<original id>",
      "name":         "Project name",
      "description":  "...",
      "systemPrompt": "...",                  // Claude prompt_template
      "createdAt":    "ISO|null",
      "updatedAt":    "ISO|null",
      "documents":    [{ "id", "name", "content", "createdAt" }]
    }
  ],
  "conversations": [
    {
      "id":         "claude-conv:<uuid> | cgpt-conv:<id>",
      "source":     "chatgpt|claude",
      "sourceId":   "<original id>",
      "projectId":  "<project id>|null",
      "title":      "...",
      "createdAt":  "ISO|null",
      "updatedAt":  "ISO|null",
      "model":      "gpt-4o | null",
      "messageCount": 12,
      "messages": [
        {
          "id":          "...",
          "role":        "user|assistant|system|tool",
          "content":     "plain-text body",
          "parts":       [{ "type": "text|image|code|tool_use|tool_result", ... }],
          "createdAt":   "ISO|null",
          "model":       "gpt-4o | null",
          "attachments": [{ "name", "type", "size" }]
        }
      ]
    }
  ]
}
```

### Notes on the mapping

- **ChatGPT** stores conversations as a tree (`mapping`) with sibling branches
  for retries. The normalizer follows the active branch from `current_node` to
  the root, dropping empty system stubs. Custom GPTs (`gizmo_id`) are
  synthesized as projects so you don't lose that grouping.
- **Claude** stores conversations as a linear list (`chat_messages`); messages
  are sorted by `index`, then `created_at`. Project membership comes from
  `project_uuid` on the conversation, joined to entries in `projects.json`.
  If a conversation references a project that wasn't included in the export,
  its `projectId` is cleared rather than left dangling.
- IDs are namespaced (`cgpt-conv:`, `claude-proj:`, etc.) so combined exports
  never collide across sources.

## Tests

```bash
node export-normalizer/test.js
```

Pure Node, no dependencies. Fixtures live in `export-normalizer/fixtures/`.

## Files

| File              | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `index.html`      | UI: drag-and-drop, browse, download                    |
| `normalizer.js`   | Format detection + ChatGPT/Claude parsing + combine    |
| `test.js`         | Node test runner (stdlib only)                         |
| `fixtures/`       | Minimal example exports used by tests and as samples   |
