#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".netlify",
  "netlify"
]);

function walk(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      walk(path.join(dir, entry.name), files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.endsWith(".js")) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function checkFile(filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    cwd: ROOT_DIR,
    encoding: "utf8"
  });
  return {
    ok: result.status === 0,
    stderr: String(result.stderr || "").trim(),
    filePath
  };
}

function run() {
  const jsFiles = walk(ROOT_DIR)
    .map((filePath) => path.relative(ROOT_DIR, filePath))
    .sort((a, b) => a.localeCompare(b));

  if (!jsFiles.length) {
    console.log("No JS files found for syntax check.");
    return;
  }

  const failures = [];
  for (const relPath of jsFiles) {
    const filePath = path.join(ROOT_DIR, relPath);
    const result = checkFile(filePath);
    if (!result.ok) {
      failures.push(result);
    }
  }

  if (failures.length) {
    console.error(`Syntax check failed for ${failures.length} file(s):`);
    for (const row of failures) {
      console.error(`- ${row.filePath}`);
      if (row.stderr) {
        console.error(row.stderr);
      }
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Syntax check passed for ${jsFiles.length} JavaScript files.`);
}

run();

