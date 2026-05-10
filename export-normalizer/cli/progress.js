/**
 * Tiny stderr progress writer. Avoids pulling in a TTY library so the CLI
 * stays dependency-light. Falls back to plain logging when stderr isn't a TTY.
 */
const isTTY = process.stderr.isTTY;

function newProgress(label) {
  let count = 0;
  let lastDraw = 0;
  const start = Date.now();

  function tick(extra = {}) {
    count++;
    const now = Date.now();
    if (!isTTY) {
      if (count % 500 === 0) {
        process.stderr.write(`${label}: ${count} (${formatExtra(extra)})\n`);
      }
      return;
    }
    if (now - lastDraw < 100) return;
    lastDraw = now;
    process.stderr.write(`\r\x1b[2K${label}: ${count} ${formatExtra(extra)}`);
  }

  function done(summary) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    if (isTTY) process.stderr.write("\r\x1b[2K");
    process.stderr.write(`${label}: ${count} done in ${elapsed}s${summary ? " — " + summary : ""}\n`);
  }

  return { tick, done };
}

function formatExtra(extra) {
  const keys = Object.keys(extra);
  if (!keys.length) return "";
  return keys.map((k) => `${k}=${extra[k]}`).join(" ");
}

function info(msg) {
  process.stderr.write(`${msg}\n`);
}

function nextSteps(lines) {
  if (!lines.length) return;
  process.stderr.write(`\nNext steps:\n`);
  for (const line of lines) process.stderr.write(`  ${line}\n`);
}

module.exports = { newProgress, info, nextSteps };
