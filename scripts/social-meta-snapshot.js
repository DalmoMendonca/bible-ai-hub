#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT_DIR = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(ROOT_DIR, "scripts", "snapshots", "social-meta.snapshot.json");
const PAGES = [
  "index.html",
  "ai/apps/bible-study/index.html",
  "ai/apps/sermon-preparation/index.html",
  "ai/apps/teaching-tools/index.html",
  "ai/apps/research-helper/index.html",
  "ai/apps/sermon-analyzer/index.html",
  "ai/apps/video-search/index.html"
];

function parseAttributes(tag) {
  const attrs = {};
  const regex = /([:@a-zA-Z0-9_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = regex.exec(tag);
  while (match) {
    const key = String(match[1] || "").toLowerCase();
    attrs[key] = String(match[3] !== undefined ? match[3] : match[4] || "").trim();
    match = regex.exec(tag);
  }
  return attrs;
}

function extractMeta(html) {
  const result = {};
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const attrs = parseAttributes(tag);
    if (attrs.property) {
      result[`property:${attrs.property}`] = attrs.content || "";
    }
    if (attrs.name) {
      result[`name:${attrs.name}`] = attrs.content || "";
    }
  }
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const attrs = parseAttributes(tag);
    if (String(attrs.rel || "").toLowerCase() === "canonical") {
      result.canonical = attrs.href || "";
    }
  }
  return {
    canonical: result.canonical || "",
    ogTitle: result["property:og:title"] || "",
    ogDescription: result["property:og:description"] || "",
    ogUrl: result["property:og:url"] || "",
    ogImage: result["property:og:image"] || "",
    twitterCard: result["name:twitter:card"] || "",
    twitterTitle: result["name:twitter:title"] || "",
    twitterDescription: result["name:twitter:description"] || "",
    twitterImage: result["name:twitter:image"] || ""
  };
}

function buildSnapshot() {
  const snapshot = {};
  for (const page of PAGES) {
    const filePath = path.join(ROOT_DIR, page);
    assert.ok(fs.existsSync(filePath), `${page} does not exist.`);
    const html = fs.readFileSync(filePath, "utf8");
    snapshot[page] = extractMeta(html);
  }
  return snapshot;
}

function ensureSnapshotDirectory() {
  const dir = path.dirname(SNAPSHOT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function run() {
  const shouldUpdate = process.argv.includes("--update");
  const current = buildSnapshot();
  if (shouldUpdate) {
    ensureSnapshotDirectory();
    fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(current, null, 2)}\n`, "utf8");
    console.log(`Updated snapshot: ${path.relative(ROOT_DIR, SNAPSHOT_PATH)}`);
    return;
  }
  assert.ok(fs.existsSync(SNAPSHOT_PATH), `Snapshot file missing: ${path.relative(ROOT_DIR, SNAPSHOT_PATH)}. Run with --update.`);
  const expected = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  assert.deepEqual(current, expected, "Social-meta snapshot mismatch. Run `node scripts/social-meta-snapshot.js --update` after intentional metadata changes.");
  console.log(`Social-meta snapshot check passed for ${PAGES.length} pages.`);
}

try {
  run();
} catch (error) {
  console.error(`Social-meta snapshot check failed: ${error.message}`);
  process.exitCode = 1;
}
