# chat-archive

A local-first tool that normalizes exports from **six** major LLMs into a
single, predictable schema:

- ChatGPT (OpenAI)
- Claude (Anthropic)
- Gemini (Google Takeout)
- Grok (xAI)
- Mistral (Le Chat)
- DeepSeek

You can use it three ways:

1. **Browser UI** — drop one or more export files and browse them. No upload.
2. **CLI** — `chat-archive ingest` stores everything in a local SQLite database
   (handles multi-GB exports without loading them into memory) and can search
   with FTS5, filter by project, and export to JSON / CSV / Markdown.
3. **Both** — run `chat-archive serve` and the browser UI auto-loads from the
   SQLite store.

Nothing is ever uploaded.

## Quick start

### Browser only (small exports)

```bash
# from the repo root
python3 -m http.server 8000 --directory export-normalizer
# open http://localhost:8000 and drop your export
```

You can also just open `export-normalizer/index.html` directly in a browser.

### CLI (recommended for large exports)

```bash
cd export-normalizer
npm install                          # one-time: better-sqlite3, stream-json, yauzl
node cli/index.js doctor             # verify the toolchain

# Ingest one or more exports into a SQLite store. Source is auto-detected
# from filenames + first-conversation shape; pass --source to force.
node cli/index.js ingest \
  ~/Downloads/chatgpt-export.zip \
  ~/Downloads/claude-export.zip \
  ~/Downloads/gemini-takeout.zip \
  --db ./store.db

# What's in there?
node cli/index.js projects --db ./store.db

# Full-text search across all messages, optionally scoped to a project.
node cli/index.js search "migration" --db ./store.db --project "Migration Project"

# Export everything as a Markdown folder tree (drop into Drive Desktop /
# OneDrive sync to back it up to the cloud).
node cli/index.js export --db ./store.db --format md --out ./out

# Or scoped to one project / one source.
node cli/index.js export --db ./store.db --format md --out ./out \
  --project "Migration Project"
node cli/index.js export --db ./store.db --format json --out ./out --source claude

# Browse from a browser, backed by the SQLite store.
node cli/index.js serve --db ./store.db --port 8000
# open http://localhost:8000
# open http://localhost:8000?project=Migration%20Project   # scoped view
```

If you run the CLI often, link it onto your PATH:

```bash
npm link               # then `chat-archive ingest ...` works anywhere
```

## What you can do (view, export, search — by project)

The three top-level operations all support a `--project` filter (matched by
id, exact name, or unique substring):

| What            | CLI                                                         |
| --------------- | ----------------------------------------------------------- |
| **View**        | `chat-archive serve --db ./store.db` then open the URL with `?project=<name>` |
| **Export JSON** | `chat-archive export --db ... --format json --out ./out --project "<name>"` |
| **Export MD**   | `chat-archive export --db ... --format md   --out ./out --project "<name>"` |
| **Search**      | `chat-archive search --db ... "term" --project "<name>"`     |

`--source <chatgpt\|claude\|gemini\|grok\|mistral\|deepseek>` is supported
on the same commands and stacks with `--project`.

## Where the files live

```
export-normalizer/
├── index.html          # browser UI (auto-loads from /api/normalized.json under serve)
├── normalizer.js       # parsing + adapters for all 6 providers (UMD; browser + Node)
├── package.json        # CLI deps + bin
├── cli/
│   ├── index.js        # subcommand dispatcher
│   ├── ingest.js       # streaming ingest (yauzl + stream-json)
│   ├── projects.js     # list projects with conv counts
│   ├── search.js       # FTS5 search, project/source-scoped
│   ├── export.js       # writes JSON / CSV / Markdown
│   ├── serve.js        # static + JSON server backing the browser UI
│   ├── doctor.js       # env + DB sanity check
│   ├── streaming.js    # zip + JSON-array streaming helpers
│   └── progress.js     # stderr progress + next-step guidance
├── db/
│   ├── schema.sql      # canonical SQLite schema (mirrors the JSON shape)
│   └── store.js        # better-sqlite3 wrapper with prepared upserts
├── exporters/
│   ├── json.js         # SQLite → v1 normalized JSON (round-trip equal)
│   ├── markdown.js     # SQLite → out/<source>/<project>/<slug>.md
│   └── csv.js          # SQLite → conversations.csv + messages.csv
├── fixtures/           # one minimal export per provider; used by test.js
└── test.js             # 17-test stdlib runner (run: `node test.js`)
```

## What it accepts

| Provider | Container         | Important file(s)                 | Source flag |
| -------- | ----------------- | --------------------------------- | ----------- |
| ChatGPT  | `.zip`            | `conversations.json`              | `chatgpt`   |
| Claude   | `.zip`            | `conversations.json`, `projects.json` | `claude` |
| Gemini   | Takeout `.zip`    | `Gemini Apps/.../*.json`          | `gemini`    |
| Grok     | `.zip` or `.json` | `conversations.json`              | `grok`      |
| Mistral  | `.zip` or `.json` | `conversations.json`              | `mistral`   |
| DeepSeek | `.zip` or `.json` | `conversations.json`              | `deepseek`  |

Auto-detection examines filenames first, then peeks at the first conversation
to disambiguate. If you have an unusual export shape, force it with `--source`.

## Normalized schema (v1)

```jsonc
{
  "schemaVersion": "1.0",
  "generatedAt": "ISO timestamp",
  "sources": [{ "source": "chatgpt|claude|gemini|grok|mistral|deepseek",
                "filename": "...", "counts": {...} }],
  "projects": [
    {
      "id":           "claude-proj:<uuid>",  // stable, namespaced
      "source":       "chatgpt|claude|...",
      "sourceId":     "<original id>",
      "name":         "Project name",
      "description":  "...",
      "systemPrompt": "...",                 // Claude prompt_template
      "createdAt":    "ISO|null",
      "updatedAt":    "ISO|null",
      "documents":    [{ "id", "name", "content", "createdAt" }]
    }
  ],
  "conversations": [
    {
      "id":           "claude-conv:<uuid> | cgpt-conv:<id> | gem-conv:<id> | ...",
      "source":       "...",
      "sourceId":     "<original id>",
      "projectId":    "<project id>|null",
      "title":        "...",
      "createdAt":    "ISO|null",
      "updatedAt":    "ISO|null",
      "model":        "gpt-4o | gemini-1.5-pro | null",
      "messageCount": 12,
      "messages": [
        {
          "id":          "...",
          "role":        "user|assistant|system|tool",
          "content":     "plain-text body",
          "parts":       [{ "type": "text|image|code|tool_use|tool_result", ... }],
          "createdAt":   "ISO|null",
          "model":       "...",
          "attachments": [{ "name", "type", "size" }]
        }
      ]
    }
  ]
}
```

The SQLite store at `--db <path>` mirrors this 1:1 (one row per project /
conversation / message / attachment, plus a contentless FTS5 index over
`messages.content` for fast search).

## Notes on the per-provider mappings

- **ChatGPT** stores conversations as a tree (`mapping`) with sibling branches
  for retries. The normalizer follows the active branch from `current_node` to
  the root, dropping empty system stubs. Custom GPTs (`gizmo_id`) are
  synthesized as projects so you don't lose that grouping.
- **Claude** stores conversations as a linear list (`chat_messages`); messages
  are sorted by `index`, then `created_at`. Project membership comes from
  `project_uuid` on the conversation, joined to entries in `projects.json`.
- **Gemini** Takeout uses one JSON file per conversation under
  `Gemini Apps/...` (or `My Activity/Gemini/...` in older exports). The `model`
  role is mapped to `assistant`.
- **Grok / Mistral / DeepSeek** ship `conversations.json` as an array of
  `{id, title, messages:[{role, content, created_at}]}` with minor field-name
  variation. They share one parameterized normalizer.
- IDs are namespaced (`cgpt-conv:`, `claude-proj:`, `gem-msg:`, etc.) so
  combined exports never collide across sources. Message ids are also
  scoped by conversation id to keep them unique when flattened to the
  `messages` table.

## Tests

```bash
node export-normalizer/test.js
```

17 tests covering all six adapters, the SQLite store, the JSON / Markdown
exporters, project-scoped queries, and an end-to-end CLI smoke test
(`node cli/index.js ingest ... && export ... && search ...`). The first
8 tests use only Node stdlib; SQLite-backed tests require `npm install`.

## Roadmap

- **v1.5**: `chat-archive push --to drive` — direct Google Drive uploader
  with an interactive OAuth wizard. Until then, drop the Markdown tree from
  `chat-archive export --format md` into Drive Desktop or OneDrive sync to
  back it up to the cloud.
- **v2**: OneDrive uploader; Meta AI and Character.AI adapters.
- **v3**: Perplexity adapter (citation arrays in `parts`).
