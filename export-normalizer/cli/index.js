#!/usr/bin/env node
/**
 * chat-archive CLI dispatcher.
 *
 * Subcommands:
 *   ingest <export...> --db ./store.db [--source auto|chatgpt|claude|gemini|grok|mistral|deepseek]
 *   projects --db ./store.db [--source X]
 *   search   --db ./store.db "query" [--project X] [--source Y] [--limit N]
 *   export   --db ./store.db --format json|csv|md --out ./out [--project X] [--source Y] [--since YYYY-MM-DD]
 *   serve    --db ./store.db [--port 8000]
 *   doctor   [--db ./store.db]
 */
const { ingest } = require("./ingest.js");
const { listProjects } = require("./projects.js");
const { search } = require("./search.js");
const { exportCmd } = require("./export.js");
const { serve } = require("./serve.js");
const { doctor } = require("./doctor.js");

const HELP = `chat-archive — local-first multi-LLM export normalizer

USAGE
  chat-archive <command> [options]

COMMANDS
  ingest <file|dir>...   Import an export into a SQLite store
                         e.g. chat-archive ingest chatgpt-export.zip --db ./store.db

  projects               List projects across all sources (with conv counts)
                         e.g. chat-archive projects --db ./store.db

  search "query"         FTS5 search across all messages
                         e.g. chat-archive search --db ./store.db "migration" --project "Migration Project"

  export                 Write JSON / CSV / Markdown tree out of the store
                         e.g. chat-archive export --db ./store.db --format md --out ./out

  serve                  Host the browser UI + a JSON slice of the store
                         e.g. chat-archive serve --db ./store.db --port 8000

  doctor                 Verify deps + (optionally) DB integrity
                         e.g. chat-archive doctor --db ./store.db

OPTIONS COMMON TO MOST COMMANDS
  --db <path>            Path to the SQLite store (default: ./store.db where applicable)
  --source <name>        Filter or force a source: chatgpt|claude|gemini|grok|mistral|deepseek
  --project <id|name>    Scope to one project (id, exact name, or unique substring)

Run a command with no args for next-step hints.
`;

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    process.stdout.write(HELP);
    return;
  }

  // Common: positional inputs after the command name.
  args.inputs = args._.slice(1);

  try {
    if (cmd === "ingest") return await ingest(args);
    if (cmd === "projects") return listProjects(args);
    if (cmd === "search") {
      args.query = args.inputs[0];
      return search(args);
    }
    if (cmd === "export") return exportCmd(args);
    if (cmd === "serve") return serve(args);
    if (cmd === "doctor") return doctor(args);
    process.stderr.write(`unknown command: ${cmd}\n${HELP}`);
    process.exit(2);
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main, parseArgs };
