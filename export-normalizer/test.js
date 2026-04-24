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
