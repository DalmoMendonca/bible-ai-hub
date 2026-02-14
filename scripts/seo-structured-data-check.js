#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT_DIR = path.resolve(__dirname, "..");
const CORE_PAGES = [
  { file: "index.html", requiredTypes: ["Organization", "WebSite", "FAQPage"] },
  { file: "ai/apps/bible-study/index.html", requiredTypes: ["WebApplication", "FAQPage"] },
  { file: "ai/apps/sermon-preparation/index.html", requiredTypes: ["WebApplication", "FAQPage"] },
  { file: "ai/apps/teaching-tools/index.html", requiredTypes: ["WebApplication", "FAQPage"] },
  { file: "ai/apps/research-helper/index.html", requiredTypes: ["WebApplication", "FAQPage"] },
  { file: "ai/apps/sermon-analyzer/index.html", requiredTypes: ["WebApplication", "FAQPage"] },
  { file: "ai/apps/video-search/index.html", requiredTypes: ["WebApplication", "FAQPage"] }
];

const REQUIRED_SOCIAL_META = [
  ["property", "og:title"],
  ["property", "og:description"],
  ["property", "og:url"],
  ["property", "og:image"],
  ["name", "twitter:card"],
  ["name", "twitter:title"],
  ["name", "twitter:description"],
  ["name", "twitter:image"]
];

function parseAttributes(tag) {
  const attrs = {};
  const pattern = /([:@a-zA-Z0-9_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(tag);
  while (match) {
    const key = String(match[1] || "").trim().toLowerCase();
    const value = match[3] !== undefined ? match[3] : match[4];
    attrs[key] = String(value || "").trim();
    match = pattern.exec(tag);
  }
  return attrs;
}

function collectMetaMap(html) {
  const map = new Map();
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = parseAttributes(tag);
    const content = attrs.content || "";
    if (!content) {
      continue;
    }
    if (attrs.property) {
      map.set(`property:${attrs.property}`, content);
    }
    if (attrs.name) {
      map.set(`name:${attrs.name}`, content);
    }
  }
  return map;
}

function getCanonicalHref(html) {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of links) {
    const attrs = parseAttributes(tag);
    if (String(attrs.rel || "").toLowerCase() !== "canonical") {
      continue;
    }
    return String(attrs.href || "").trim();
  }
  return "";
}

function extractJsonLdBlocks(html) {
  const blocks = [];
  const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = regex.exec(html);
  while (match) {
    const raw = String(match[1] || "").trim();
    if (raw) {
      try {
        blocks.push(JSON.parse(raw));
      } catch (error) {
        throw new Error(`Invalid JSON-LD block: ${error.message}`);
      }
    }
    match = regex.exec(html);
  }
  return blocks;
}

function collectTypes(value, output = new Set()) {
  if (!value) {
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTypes(item, output);
    }
    return output;
  }
  if (typeof value !== "object") {
    return output;
  }
  const rawType = value["@type"];
  if (typeof rawType === "string" && rawType.trim()) {
    output.add(rawType.trim());
  } else if (Array.isArray(rawType)) {
    for (const row of rawType) {
      if (typeof row === "string" && row.trim()) {
        output.add(row.trim());
      }
    }
  }
  for (const child of Object.values(value)) {
    collectTypes(child, output);
  }
  return output;
}

function validatePage(page) {
  const filePath = path.join(ROOT_DIR, page.file);
  assert.ok(fs.existsSync(filePath), `${page.file} does not exist.`);
  const html = fs.readFileSync(filePath, "utf8");

  const canonical = getCanonicalHref(html);
  assert.ok(canonical, `${page.file} missing canonical link.`);
  assert.ok(/^https:\/\/bible\.hiredalmo\.com\//.test(canonical), `${page.file} has non-canonical href: ${canonical}`);

  const metaMap = collectMetaMap(html);
  for (const [attrType, key] of REQUIRED_SOCIAL_META) {
    const value = metaMap.get(`${attrType}:${key}`);
    assert.ok(value, `${page.file} missing ${attrType}="${key}".`);
  }

  const jsonLdBlocks = extractJsonLdBlocks(html);
  assert.ok(jsonLdBlocks.length > 0, `${page.file} missing JSON-LD blocks.`);
  const types = collectTypes(jsonLdBlocks);
  for (const typeName of page.requiredTypes) {
    assert.ok(types.has(typeName), `${page.file} missing JSON-LD type "${typeName}".`);
  }
}

function run() {
  for (const page of CORE_PAGES) {
    validatePage(page);
  }
  console.log(`SEO structured-data check passed for ${CORE_PAGES.length} pages.`);
}

try {
  run();
} catch (error) {
  console.error(`SEO structured-data check failed: ${error.message}`);
  process.exitCode = 1;
}
