#!/usr/bin/env node

const process = require("node:process");
const { app } = require("../server");

const args = parseArgs(process.argv.slice(2));
const batchSize = clampNumber(Number(args.batchSize || 1), 1, 4, 1);
const maxRounds = clampNumber(Number(args.maxRounds || 500), 1, 200000, 500);
const dryRun = Boolean(args.dryRun);
const desiredPort = clampNumber(Number(args.port || 0), 0, 65535, 0);

main().catch((error) => {
  const message = cleanString(error && error.message, "Unexpected error");
  console.error(`[video-ingest] ${message}`);
  process.exitCode = 1;
});

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[video-ingest] OPENAI_API_KEY is not set. Add it to .env before running ingestion.");
  }

  const server = await startServer(desiredPort);
  const address = server.address();
  const port = address && typeof address === "object" ? Number(address.port) : desiredPort;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`[video-ingest] Running against ${baseUrl}`);
  console.log(`[video-ingest] batchSize=${batchSize} maxRounds=${maxRounds} dryRun=${dryRun}`);

  try {
    let round = 0;
    let exitedByLimit = true;

    while (round < maxRounds) {
      round += 1;

      const status = await requestJson(`${baseUrl}/api/video-library/status?refresh=true`);
      const videos = Array.isArray(status.videos) ? status.videos : [];
      const stats = status && typeof status.stats === "object" ? status.stats : {};

      const pendingLocal = videos
        .filter((video) => cleanString(video.transcriptStatus) !== "ready")
        .filter((video) => video.sourceAvailable !== false);
      const pendingUnavailable = videos
        .filter((video) => cleanString(video.transcriptStatus) !== "ready")
        .filter((video) => video.sourceAvailable === false);

      console.log(
        `[video-ingest] Round ${round}: total=${Number(stats.totalVideos || videos.length)} ready=${Number(stats.transcribedVideos || 0)} localPending=${pendingLocal.length} unavailable=${pendingUnavailable.length}`
      );

      if (!pendingLocal.length) {
        if (pendingUnavailable.length) {
          console.log("[video-ingest] No local pending videos remain. Some videos are index-only and require hosted playback URLs.");
        } else {
          console.log("[video-ingest] Ingestion complete. No pending local videos remain.");
        }
        exitedByLimit = false;
        break;
      }

      const ingest = await requestJson(`${baseUrl}/api/video-library/ingest-next`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          maxVideos: batchSize,
          refreshCatalog: true,
          dryRun
        })
      });

      const processed = Array.isArray(ingest.processed) ? ingest.processed : [];
      const failed = Array.isArray(ingest.failed) ? ingest.failed : [];
      const unavailable = Array.isArray(ingest.unavailable) ? ingest.unavailable : [];
      const targets = Array.isArray(ingest.targets) ? ingest.targets : [];

      if (dryRun) {
        if (targets.length) {
          console.log(`[video-ingest] Dry-run targets: ${targets.map((row) => cleanString(row.title)).filter(Boolean).join(", ")}`);
        } else {
          console.log("[video-ingest] Dry-run found no local pending targets.");
        }
        exitedByLimit = false;
        break;
      }

      if (processed.length) {
        console.log(`[video-ingest] Processed: ${processed.map((row) => cleanString(row.title)).filter(Boolean).join(", ")}`);
      }
      if (failed.length) {
        console.log(`[video-ingest] Failed: ${failed.map((row) => `${cleanString(row.title)} (${cleanString(row.error)})`).join(" | ")}`);
      }
      if (unavailable.length) {
        console.log(`[video-ingest] Unavailable on this server: ${unavailable.map((row) => cleanString(row.title)).filter(Boolean).join(", ")}`);
      }

      if (!processed.length && !failed.length) {
        console.log("[video-ingest] No work processed in this round. Stopping.");
        exitedByLimit = false;
        break;
      }
    }

    if (exitedByLimit && round >= maxRounds) {
      console.log(`[video-ingest] Reached max rounds (${maxRounds}). Run again to continue.`);
    }

    console.log("[video-ingest] Done. Index file: server/data/video-library-index.json");
  } finally {
    await closeServer(server);
  }
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (_) {
    throw new Error(`Failed to reach local API at ${url}`);
  }

  let data = {};
  try {
    data = await response.json();
  } catch (_) {
    data = {};
  }

  if (!response.ok) {
    const message = cleanString(data.error, `Request failed (${response.status})`);
    throw new Error(message);
  }

  return data;
}

function parseArgs(argv) {
  const output = {};

  for (let idx = 0; idx < argv.length; idx += 1) {
    const token = String(argv[idx] || "");
    if (!token.startsWith("--")) {
      continue;
    }

    const eqIdx = token.indexOf("=");
    if (eqIdx > 2) {
      const key = toCamelCase(token.slice(2, eqIdx));
      const value = token.slice(eqIdx + 1);
      output[key] = parseArgValue(value);
      continue;
    }

    const key = toCamelCase(token.slice(2));
    const next = String(argv[idx + 1] || "");
    if (next && !next.startsWith("--")) {
      output[key] = parseArgValue(next);
      idx += 1;
    } else {
      output[key] = true;
    }
  }

  return output;
}

function parseArgValue(value) {
  const clean = cleanString(value);
  if (!clean) {
    return "";
  }

  if (clean.toLowerCase() === "true") {
    return true;
  }
  if (clean.toLowerCase() === "false") {
    return false;
  }

  const asNumber = Number(clean);
  if (Number.isFinite(asNumber) && String(asNumber) === clean) {
    return asNumber;
  }

  return clean;
}

function toCamelCase(value) {
  return cleanString(value)
    .split("-")
    .filter(Boolean)
    .map((part, idx) => (idx === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join("");
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
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
