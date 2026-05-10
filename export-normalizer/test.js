/**
 * Tiny test runner for normalizer.js. Run with:  node export-normalizer/test.js
 *
 * Uses only Node stdlib (no test framework) so contributors don't need npm
 * install. Each test is one function and assertions throw via assert.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");

const Normalizer = require("./normalizer.js");

const fixturesDir = path.join(__dirname, "fixtures");
const readFixture = (name) => fs.readFileSync(path.join(fixturesDir, name), "utf8");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("ChatGPT: walks the active branch and skips empty system stub", () => {
  const result = Normalizer.normalizeJSON(readFixture("chatgpt-conversations.json"), "chatgpt-conversations.json");
  assert.equal(result.source, "chatgpt");
  assert.equal(result.conversations.length, 2);

  const conv = result.conversations[0];
  assert.equal(conv.title, "Greeting and capitals");
  assert.equal(conv.messageCount, 4, "should follow current_node branch and skip empty system");
  const roles = conv.messages.map((m) => m.role);
  assert.deepEqual(roles, ["user", "assistant", "user", "assistant"]);
  assert.equal(conv.messages[2].content, "What is the capital of France?");
  assert.equal(conv.model, "gpt-4o");
  // The "Never mind" alternate branch should NOT appear.
  assert.ok(!conv.messages.some((m) => m.content === "Never mind"), "alt branch must be excluded");
});

test("ChatGPT: synthesizes a project for gizmo conversations", () => {
  const result = Normalizer.normalizeJSON(readFixture("chatgpt-conversations.json"), "chatgpt-conversations.json");
  assert.equal(result.projects.length, 1);
  const proj = result.projects[0];
  assert.equal(proj.sourceId, "g-abc123");
  assert.equal(proj.name, "Macro Runner");

  const linked = result.conversations.find((c) => c.sourceId === "cgpt-conv-2");
  assert.equal(linked.projectId, proj.id);
});

test("Claude: parses conversations and links project_uuid", () => {
  const result = Normalizer.normalizeJSON(readFixture("claude-conversations.json"), "claude-conversations.json");
  assert.equal(result.source, "claude");
  assert.equal(result.conversations.length, 2);

  const c1 = result.conversations.find((c) => c.sourceId === "claude-conv-1");
  assert.equal(c1.title, "Project planning chat");
  assert.equal(c1.messages.length, 2);
  assert.equal(c1.messages[0].role, "user");
  assert.equal(c1.messages[0].attachments[0].name, "spec.pdf");
  assert.equal(c1.messages[0].attachments[0].size, 12345);
  // Content blocks should be preferred over the empty top-level text field.
  assert.match(c1.messages[1].content, /3-step plan/);
  assert.equal(c1.projectId, "claude-proj:claude-proj-1");

  const c2 = result.conversations.find((c) => c.sourceId === "claude-conv-2");
  assert.equal(c2.projectId, null);
});

test("Claude: parses projects, prompt template, and docs", () => {
  const result = Normalizer.normalizeJSON(readFixture("claude-projects.json"), "claude-projects.json");
  assert.equal(result.projects.length, 1);
  const p = result.projects[0];
  assert.equal(p.name, "Migration Project");
  assert.match(p.systemPrompt, /senior staff engineer/);
  assert.equal(p.documents.length, 1);
  assert.equal(p.documents[0].name, "runbook.md");
  assert.match(p.documents[0].content, /Snapshot DB/);
});

test("combine(): merges results and resolves cross-file project links", () => {
  const cgpt = Normalizer.normalizeJSON(readFixture("chatgpt-conversations.json"), "chatgpt.json");
  const claudeConvs = Normalizer.normalizeJSON(readFixture("claude-conversations.json"), "claude-conv.json");
  const claudeProjs = Normalizer.normalizeJSON(readFixture("claude-projects.json"), "claude-proj.json");

  const combined = Normalizer.combine([cgpt, claudeConvs, claudeProjs]);
  assert.equal(combined.schemaVersion, "1.0");
  assert.equal(combined.conversations.length, cgpt.conversations.length + claudeConvs.conversations.length);
  assert.equal(combined.projects.length, cgpt.projects.length + claudeProjs.projects.length);

  // Claude conv should keep its project link now that the project is present.
  const c1 = combined.conversations.find((c) => c.sourceId === "claude-conv-1");
  assert.equal(c1.projectId, "claude-proj:claude-proj-1");
  const proj = combined.projects.find((p) => p.id === c1.projectId);
  assert.ok(proj, "combined doc must contain the linked project");
});

test("combine(): drops dangling projectId references when project is missing", () => {
  const claudeConvs = Normalizer.normalizeJSON(readFixture("claude-conversations.json"), "claude-conv.json");
  const combined = Normalizer.combine([claudeConvs]);
  const c1 = combined.conversations.find((c) => c.sourceId === "claude-conv-1");
  assert.equal(c1.projectId, null, "missing project must be cleared, not left dangling");
});

test("normalizeBundle: distinguishes Claude vs ChatGPT zips by content shape", () => {
  const claudeBundle = {
    "conversations.json": readFixture("claude-conversations.json"),
    "projects.json": readFixture("claude-projects.json"),
    "users.json": "{}",
  };
  const claudeResult = Normalizer.normalizeBundle(claudeBundle, "claude.zip");
  assert.equal(claudeResult.source, "claude");
  assert.equal(claudeResult.conversations.length, 2);
  assert.equal(claudeResult.projects.length, 1);

  const cgptBundle = {
    "conversations.json": readFixture("chatgpt-conversations.json"),
    "user.json": "{}",
    "message_feedback.json": "[]",
  };
  const cgptResult = Normalizer.normalizeBundle(cgptBundle, "chatgpt.zip");
  assert.equal(cgptResult.source, "chatgpt");
  assert.equal(cgptResult.conversations.length, 2);
});

test("detectFormat: recognizes shapes", () => {
  assert.equal(Normalizer.detectFormat([{ mapping: {}, conversation_id: "x" }]), "chatgpt");
  assert.equal(Normalizer.detectFormat([{ uuid: "x", chat_messages: [] }]), "claude-conversations");
  assert.equal(Normalizer.detectFormat([{ uuid: "x", prompt_template: "" }]), "claude-projects");
  assert.equal(Normalizer.detectFormat({ foo: 1 }), "unknown");
  assert.equal(Normalizer.detectFormat([{ turns: [] }]), "gemini");
  assert.equal(Normalizer.detectFormat([{ _source: "grok", messages: [] }]), "grok");
  assert.equal(Normalizer.detectFormat([{ _source: "mistral", messages: [] }]), "mistral");
  assert.equal(Normalizer.detectFormat([{ _source: "deepseek", messages: [] }]), "deepseek");
});

test("Gemini: normalizes turns with role mapping (model -> assistant)", () => {
  const result = Normalizer.normalizeJSON(
    readFixture("gemini-conversations.json"),
    "gemini-conversations.json"
  );
  assert.equal(result.source, "gemini");
  assert.equal(result.conversations.length, 2);
  const c1 = result.conversations[0];
  assert.equal(c1.title, "Travel ideas");
  assert.equal(c1.messageCount, 2);
  assert.deepEqual(c1.messages.map((m) => m.role), ["user", "assistant"]);
  assert.match(c1.messages[1].content, /cherry-blossom/);
});

test("Grok: normalizes generic-linear shape", () => {
  const result = Normalizer.normalizeJSON(
    readFixture("grok-conversations.json"),
    "grok-conversations.json"
  );
  assert.equal(result.source, "grok");
  const c = result.conversations[0];
  assert.equal(c.title, "Rocket launch schedule");
  assert.deepEqual(c.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(c.model, "grok-2");
});

test("Mistral: handles array-of-blocks content", () => {
  const result = Normalizer.normalizeJSON(
    readFixture("mistral-conversations.json"),
    "mistral-conversations.json"
  );
  assert.equal(result.source, "mistral");
  const c = result.conversations[0];
  assert.match(c.messages[1].content, /Group by responsibility/);
  assert.equal(c.messages[1].parts[0].type, "text");
});

test("DeepSeek: handles plain string content", () => {
  const result = Normalizer.normalizeJSON(
    readFixture("deepseek-conversations.json"),
    "deepseek-conversations.json"
  );
  assert.equal(result.source, "deepseek");
  const c = result.conversations[0];
  assert.match(c.messages[1].content, /min-heap/);
});

// ---------- SQLite store + exporters ----------

const os = require("os");
const Store = require("./db/store.js");
const { buildJson } = require("./exporters/json.js");
const { buildMarkdownTree } = require("./exporters/markdown.js");
const { resolveProjectId } = require("./cli/search.js");

function withTempDb(fn) {
  const dbPath = path.join(os.tmpdir(), `chat-archive-test-${process.pid}-${Date.now()}.db`);
  try {
    return fn(dbPath);
  } finally {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    for (const ext of ["-wal", "-shm"]) {
      const p = dbPath + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
}

function ingestNormalized(writer, normResult) {
  const txn = writer.transaction(() => {
    for (const p of normResult.projects) writer.writeProject(p);
    for (const c of normResult.conversations) writer.writeConversation(c);
  });
  txn();
  writer.dropOrphanProjectLinks();
}

test("SQLite: writes Claude projects + convs, FTS finds messages", () => {
  withTempDb((dbPath) => {
    const db = Store.open(dbPath);
    const writer = Store.makeWriter(db);

    const projects = Normalizer.normalizeJSON(
      readFixture("claude-projects.json"),
      "claude-projects.json"
    );
    const convs = Normalizer.normalizeJSON(
      readFixture("claude-conversations.json"),
      "claude-conversations.json"
    );
    ingestNormalized(writer, projects);
    ingestNormalized(writer, convs);

    const counts = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM projects) AS p,
          (SELECT COUNT(*) FROM conversations) AS c,
          (SELECT COUNT(*) FROM messages) AS m`
      )
      .get();
    assert.equal(counts.p, 1);
    assert.equal(counts.c, 2);
    assert.equal(counts.m, 4);

    const hits = db
      .prepare(
        `SELECT m.content FROM messages_fts JOIN messages m ON m.id = messages_fts.message_id
         WHERE messages_fts MATCH ?`
      )
      .all("migration");
    assert.ok(hits.length >= 1, "FTS should find 'migration'");

    db.close();
  });
});

test("SQLite: project-scoped search filters by project_id", () => {
  withTempDb((dbPath) => {
    const db = Store.open(dbPath);
    const writer = Store.makeWriter(db);
    ingestNormalized(
      writer,
      Normalizer.normalizeJSON(readFixture("claude-projects.json"), "p.json")
    );
    ingestNormalized(
      writer,
      Normalizer.normalizeJSON(readFixture("claude-conversations.json"), "c.json")
    );

    const projectId = resolveProjectId(db, "Migration Project");
    assert.ok(projectId, "should resolve project by name");

    const inProj = db
      .prepare(
        `SELECT m.content FROM messages_fts
         JOIN messages m ON m.id = messages_fts.message_id
         JOIN conversations c ON c.id = m.conversation_id
         WHERE messages_fts MATCH ? AND c.project_id = ?`
      )
      .all("migration", projectId);
    const outOfProj = db
      .prepare(
        `SELECT m.content FROM messages_fts
         JOIN messages m ON m.id = messages_fts.message_id
         JOIN conversations c ON c.id = m.conversation_id
         WHERE messages_fts MATCH ? AND (c.project_id IS NULL OR c.project_id != ?)`
      )
      .all("migration", projectId);
    assert.ok(inProj.length >= 1);
    assert.equal(outOfProj.length, 0, "non-project hits should be empty for this fixture");

    db.close();
  });
});

test("SQLite -> JSON round-trip: matches in-memory normalizer for ChatGPT+Claude", () => {
  withTempDb((dbPath) => {
    const db = Store.open(dbPath);
    const writer = Store.makeWriter(db);

    const cgpt = Normalizer.normalizeJSON(readFixture("chatgpt-conversations.json"), "cgpt.json");
    const claudeProjs = Normalizer.normalizeJSON(readFixture("claude-projects.json"), "p.json");
    const claudeConvs = Normalizer.normalizeJSON(readFixture("claude-conversations.json"), "c.json");
    ingestNormalized(writer, cgpt);
    ingestNormalized(writer, claudeProjs);
    ingestNormalized(writer, claudeConvs);

    const fromDb = buildJson(db);
    const inMem = Normalizer.combine([cgpt, claudeProjs, claudeConvs]);

    // Same projects (by id), same conversations (by id), same message counts.
    const dbProjIds = fromDb.projects.map((p) => p.id).sort();
    const memProjIds = inMem.projects.map((p) => p.id).sort();
    assert.deepEqual(dbProjIds, memProjIds);

    const dbConvs = fromDb.conversations.map((c) => ({
      id: c.id,
      title: c.title,
      project: c.projectId,
      msgs: c.messages.length,
    })).sort((a, b) => a.id.localeCompare(b.id));
    const memConvs = inMem.conversations.map((c) => ({
      id: c.id,
      title: c.title,
      project: c.projectId,
      msgs: c.messages.length,
    })).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(dbConvs, memConvs);

    // Spot-check message content survives unchanged.
    const dbConv = fromDb.conversations.find((c) => c.sourceId === "claude-conv-1");
    const memConv = inMem.conversations.find((c) => c.sourceId === "claude-conv-1");
    assert.equal(dbConv.messages[0].content, memConv.messages[0].content);

    db.close();
  });
});

test("Markdown exporter: --project filter emits only that project's tree", () => {
  withTempDb((dbPath) => {
    const db = Store.open(dbPath);
    const writer = Store.makeWriter(db);
    ingestNormalized(
      writer,
      Normalizer.normalizeJSON(readFixture("claude-projects.json"), "p.json")
    );
    ingestNormalized(
      writer,
      Normalizer.normalizeJSON(readFixture("claude-conversations.json"), "c.json")
    );

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ca-md-"));
    try {
      const projectId = resolveProjectId(db, "Migration Project");
      const res = buildMarkdownTree(db, outDir, { projectId });
      assert.equal(res.written, 1, "only the in-project conversation should be written");
      const projDir = path.join(outDir, "claude", "migration-project");
      const files = fs.readdirSync(projDir);
      assert.equal(files.length, 1);
      const md = fs.readFileSync(path.join(projDir, files[0]), "utf8");
      assert.match(md, /^---/);
      assert.match(md, /project: Migration Project/);
      assert.match(md, /## user/);
      assert.match(md, /## assistant/);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
    db.close();
  });
});

test("CLI smoke: ingest fixture + export json + search returns hit", () => {
  withTempDb((dbPath) => {
    const { spawnSync } = require("child_process");
    const cli = path.join(__dirname, "cli", "index.js");
    const fixture = path.join(__dirname, "fixtures", "claude-conversations.json");

    let r = spawnSync(process.execPath, [cli, "ingest", fixture, "--db", dbPath, "--source", "claude"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, `ingest failed: ${r.stderr}`);
    assert.match(r.stderr + r.stdout, /Imported \d+ conversations/);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ca-cli-"));
    try {
      r = spawnSync(
        process.execPath,
        [cli, "export", "--db", dbPath, "--format", "json", "--out", outDir],
        { encoding: "utf8" }
      );
      assert.equal(r.status, 0, `export failed: ${r.stderr}`);
      const json = JSON.parse(fs.readFileSync(path.join(outDir, "normalized.json"), "utf8"));
      assert.equal(json.conversations.length, 2);

      r = spawnSync(
        process.execPath,
        [cli, "search", "migration", "--db", dbPath],
        { encoding: "utf8" }
      );
      assert.equal(r.status, 0, `search failed: ${r.stderr}`);
      assert.match(r.stdout, /match/);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});

// ---------- run ----------
let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`  PASS  ${t.name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${t.name}\n        ${err.message}`);
    if (err.stack) console.error(err.stack.split("\n").slice(1, 4).join("\n"));
    failed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
