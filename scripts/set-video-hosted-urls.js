#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");

const ROOT_DIR = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT_DIR, "server", "data", "video-library-index.json");
const DEFAULT_STRIP_PREFIX = "ai/videos";

main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = cleanString(args.baseUrl, cleanString(process.env.VIDEO_PUBLIC_BASE_URL));
  const mode = cleanString(args.mode, cleanString(process.env.VIDEO_PUBLIC_PATH_MODE, "relative")).toLowerCase();
  const stripPrefix = normalizePrefix(
    cleanString(args.stripPrefix, cleanString(process.env.VIDEO_PUBLIC_STRIP_PREFIX, DEFAULT_STRIP_PREFIX))
  );
  const overwrite = Boolean(args.overwrite);
  const dryRun = Boolean(args.dryRun);

  if (!baseUrl) {
    console.error("[set-hosted-urls] Missing base URL. Use --base-url https://cdn.example.com/videos");
    process.exit(1);
  }

  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`[set-hosted-urls] Index file not found: ${INDEX_PATH}`);
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  } catch (error) {
    console.error(`[set-hosted-urls] Failed to read index file: ${cleanString(error && error.message)}`);
    process.exit(1);
  }

  const videos = Array.isArray(payload.videos) ? payload.videos : [];
  let updated = 0;

  for (const row of videos) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const existingHosted = cleanString(row.hostedUrl);
    if (existingHosted && !overwrite) {
      continue;
    }

    const relativePath = cleanString(row.relativePath);
    const fileName = cleanString(row.fileName, relativePath ? path.basename(relativePath) : "");

    const hostedUrl = buildHostedUrl({
      baseUrl,
      mode,
      stripPrefix,
      relativePath,
      fileName
    });

    if (!hostedUrl) {
      continue;
    }

    row.hostedUrl = hostedUrl;

    const existingPlayback = cleanString(row.playbackUrl);
    if (!existingPlayback || overwrite) {
      row.playbackUrl = hostedUrl;
    }

    updated += 1;
  }

  if (dryRun) {
    console.log(`[set-hosted-urls] Dry run complete. ${updated} videos would be updated.`);
    console.log(`[set-hosted-urls] mode=${mode} stripPrefix=${stripPrefix || "(none)"}`);
    return;
  }

  payload.updatedAt = new Date().toISOString();
  fs.writeFileSync(INDEX_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`[set-hosted-urls] Updated ${updated} videos.`);
  console.log(`[set-hosted-urls] mode=${mode} stripPrefix=${stripPrefix || "(none)"}`);
  console.log(`[set-hosted-urls] Wrote ${path.relative(ROOT_DIR, INDEX_PATH)}`);
}

function buildHostedUrl({ baseUrl, mode, stripPrefix, relativePath, fileName }) {
  let targetPath = "";

  if (mode === "basename") {
    targetPath = cleanString(fileName);
  } else if (mode === "none") {
    targetPath = "";
  } else {
    targetPath = toPosix(relativePath).replace(/^\/+/, "");
    if (stripPrefix) {
      const prefixLower = stripPrefix.toLowerCase();
      const targetLower = targetPath.toLowerCase();
      if (targetLower === prefixLower) {
        targetPath = "";
      } else if (targetLower.startsWith(`${prefixLower}/`)) {
        targetPath = targetPath.slice(stripPrefix.length + 1);
      }
    }
  }

  return joinUrlPath(baseUrl, targetPath);
}

function joinUrlPath(baseUrl, targetPath) {
  const cleanBase = cleanString(baseUrl).replace(/\/+$/, "");
  if (!cleanBase) {
    return "";
  }

  const normalizedTarget = toPosix(cleanString(targetPath)).replace(/^\/+/, "");
  if (!normalizedTarget) {
    return cleanBase;
  }

  const encoded = normalizedTarget
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${cleanBase}/${encoded}`;
}

function parseArgs(argv) {
  const output = {};

  for (let idx = 0; idx < argv.length; idx += 1) {
    const token = cleanString(argv[idx]);
    if (!token.startsWith("--")) {
      continue;
    }

    const eqIdx = token.indexOf("=");
    if (eqIdx > 2) {
      const key = toCamel(token.slice(2, eqIdx));
      output[key] = token.slice(eqIdx + 1);
      continue;
    }

    const key = toCamel(token.slice(2));
    const next = cleanString(argv[idx + 1]);
    if (next && !next.startsWith("--")) {
      output[key] = next;
      idx += 1;
    } else {
      output[key] = true;
    }
  }

  return output;
}

function toCamel(value) {
  return cleanString(value)
    .split("-")
    .filter(Boolean)
    .map((part, idx) => (idx === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join("");
}

function normalizePrefix(value) {
  return toPosix(cleanString(value))
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function cleanString(value, fallback = "") {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  const normalized = String(value).trim();
  return normalized || fallback;
}
