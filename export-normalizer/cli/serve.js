/**
 * `chat-archive serve --db ./store.db [--port 8000]`
 *
 * Tiny static + JSON server. Hosts the existing browser UI (index.html +
 * normalizer.js) and exposes /api/normalized.json so the page can render
 * the SQLite-backed archive without re-uploading anything.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const Store = require("../db/store.js");
const { buildJson } = require("../exporters/json.js");
const { resolveProjectId } = require("./search.js");
const Progress = require("./progress.js");

const ROOT = path.resolve(__dirname, "..");

function serve(args) {
  const { db: dbPath, port = 8000 } = args;
  if (!dbPath) throw new Error("--db <path> is required");
  if (!fs.existsSync(dbPath)) throw new Error(`No database at ${dbPath}`);

  const db = Store.open(dbPath, { readonly: true });

  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, `http://${req.headers.host}`);
      if (u.pathname === "/api/normalized.json") return handleApi(db, u, res);
      if (u.pathname === "/api/projects") return handleProjects(db, u, res);
      return handleStatic(u, res);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`server error: ${err.message}`);
    }
  });

  server.listen(Number(port), () => {
    Progress.info(`chat-archive serving ${dbPath} at http://localhost:${port}`);
    Progress.nextSteps([
      `open http://localhost:${port}                            # browse all conversations`,
      `open http://localhost:${port}/?project=<id-or-name>      # scoped to one project`,
      `Ctrl-C to stop`,
    ]);
  });

  process.on("SIGINT", () => {
    Progress.info("\nshutting down");
    server.close();
    db.close();
    process.exit(0);
  });
}

function handleApi(db, u, res) {
  const project = u.searchParams.get("project");
  const source = u.searchParams.get("source");
  const since = u.searchParams.get("since");
  let projectId = null;
  if (project) {
    projectId = resolveProjectId(db, project);
    if (!projectId) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `no project matches ${project}` }));
      return;
    }
  }
  const doc = buildJson(db, { projectId, source, since });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(doc));
}

function handleProjects(db, u, res) {
  const rows = db
    .prepare(
      `SELECT p.id, p.source, p.name, p.description,
              (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id) AS conv_count
       FROM projects p ORDER BY p.source, p.name`
    )
    .all();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ projects: rows }));
}

function handleStatic(u, res) {
  let p = u.pathname === "/" ? "/index.html" : u.pathname;
  // Naive path traversal guard.
  if (p.includes("..")) {
    res.writeHead(400);
    res.end("bad path");
    return;
  }
  const candidates = [
    path.join(ROOT, p),
    path.join(ROOT, "cli", p),
    path.join(ROOT, "node_modules", p),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "content-type": mime(file) });
      fs.createReadStream(file).pipe(res);
      return;
    }
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

function mime(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

module.exports = { serve };
