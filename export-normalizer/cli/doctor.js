/**
 * `chat-archive doctor [--db ./store.db]` — environment + DB sanity check.
 */
const fs = require("fs");
const path = require("path");
const Progress = require("./progress.js");

function doctor(args) {
  const { db: dbPath } = args;
  let ok = true;

  console.log("chat-archive doctor");
  console.log(`  node    ${process.version}`);

  for (const dep of ["better-sqlite3", "stream-json", "yauzl", "stream-chain"]) {
    try {
      const pkg = require(path.join(__dirname, "..", "node_modules", dep, "package.json"));
      console.log(`  ${dep}  ${pkg.version}`);
    } catch (e) {
      console.log(`  ${dep}  MISSING (run: npm install in export-normalizer/)`);
      ok = false;
    }
  }

  if (dbPath) {
    if (!fs.existsSync(dbPath)) {
      console.log(`  db      ${dbPath}  MISSING`);
      ok = false;
    } else {
      const Database = require("better-sqlite3");
      const db = new Database(dbPath, { readonly: true });
      const integrity = db.prepare("PRAGMA integrity_check").get();
      console.log(`  db      ${dbPath}  ${integrity.integrity_check}`);
      const counts = db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM sources)       AS sources,
             (SELECT COUNT(*) FROM projects)      AS projects,
             (SELECT COUNT(*) FROM conversations) AS conversations,
             (SELECT COUNT(*) FROM messages)      AS messages`
        )
        .get();
      console.log(
        `          ${counts.sources} sources, ${counts.projects} projects, ${counts.conversations} convs, ${counts.messages} msgs`
      );
      db.close();
    }
  }

  if (!ok) {
    Progress.info("\nFix the items marked MISSING above, then rerun.");
    process.exit(1);
  }
  Progress.info("\nAll checks passed.");
}

module.exports = { doctor };
