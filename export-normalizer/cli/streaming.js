/**
 * Streaming readers for the export shapes we support.
 *
 * All readers yield one *parsed* item at a time so the caller never holds the
 * entire export in RAM. The yauzl-based zip path opens entries on demand, and
 * stream-json's StreamArray walks a top-level JSON array element-by-element.
 */
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const yauzl = require("yauzl");
const StreamArray = require("stream-json/streamers/StreamArray");
const { chain } = require("stream-chain");
const { parser } = require("stream-json/Parser");

/**
 * Yield each item of a top-level JSON array from a file path.
 * Promise resolves when the stream finishes.
 */
async function streamJsonArrayFromFile(filePath, onItem) {
  const stream = fs.createReadStream(filePath);
  await streamJsonArrayFromStream(stream, onItem);
}

async function streamJsonArrayFromStream(readable, onItem) {
  return new Promise((resolve, reject) => {
    const pipeline = chain([readable, parser(), new StreamArray()]);
    pipeline.on("data", ({ value }) => {
      try {
        const ret = onItem(value);
        if (ret && typeof ret.then === "function") {
          // Pause until the consumer resolves.
          pipeline.pause();
          ret.then(
            () => pipeline.resume(),
            (err) => pipeline.destroy(err)
          );
        }
      } catch (err) {
        pipeline.destroy(err);
      }
    });
    pipeline.on("end", resolve);
    pipeline.on("error", reject);
  });
}

/**
 * Open a zip and call onEntry(entry, getReadStream) for each non-directory
 * entry. The callback may return a Promise; the next entry is read when it
 * resolves.
 */
function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) return reject(err);
      resolve(zip);
    });
  });
}

function listZipEntries(zip) {
  return new Promise((resolve, reject) => {
    const entries = [];
    zip.on("entry", (e) => {
      entries.push(e);
      zip.readEntry();
    });
    zip.on("end", () => resolve(entries));
    zip.on("error", reject);
    zip.readEntry();
  });
}

function readZipEntryStream(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
  });
}

async function readZipEntryToString(zip, entry) {
  const stream = await readZipEntryStream(zip, entry);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function isJsonName(name) {
  return /\.json$/i.test(name) && !/\/$/.test(name);
}

/**
 * Inspect an export source (file or directory) and return a small manifest
 * we can use to dispatch to the right adapter.
 *   { kind: 'json'|'jsonl'|'zip'|'dir', path, entries?: [{name, size}] }
 */
async function describeSource(srcPath) {
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    const entries = listFilesRecursive(srcPath);
    return { kind: "dir", path: srcPath, entries };
  }
  if (/\.zip$/i.test(srcPath)) {
    const zip = await openZip(srcPath);
    const entries = (await listZipEntries(zip)).map((e) => ({
      name: e.fileName,
      size: e.uncompressedSize,
    }));
    zip.close();
    return { kind: "zip", path: srcPath, entries };
  }
  if (/\.jsonl$/i.test(srcPath)) return { kind: "jsonl", path: srcPath };
  return { kind: "json", path: srcPath };
}

function listFilesRecursive(dir) {
  const out = [];
  function walk(d, rel) {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const r = path.posix.join(rel, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, r);
      else out.push({ name: r, size: st.size, fullPath: full });
    }
  }
  walk(dir, "");
  return out;
}

module.exports = {
  streamJsonArrayFromFile,
  streamJsonArrayFromStream,
  openZip,
  listZipEntries,
  readZipEntryStream,
  readZipEntryToString,
  isJsonName,
  describeSource,
  listFilesRecursive,
};
