#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.LOAD_TEST_PORT || 3499);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 240_000;
const ANALYZER_CONCURRENCY = Math.max(2, Number(process.env.LOAD_ANALYZER_CONCURRENCY || 3));
const VIDEO_CONCURRENCY = Math.max(3, Number(process.env.LOAD_VIDEO_CONCURRENCY || 6));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, pct) {
  const rows = [...values].sort((a, b) => a - b);
  if (!rows.length) {
    return 0;
  }
  const index = Math.min(rows.length - 1, Math.max(0, Math.ceil((pct / 100) * rows.length) - 1));
  return rows[index];
}

function startServer() {
  const server = spawn("node", ["server.js"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(PORT)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  return server;
}

async function stopServer(server) {
  if (!server || server.killed) {
    return;
  }
  server.kill("SIGTERM");
  await delay(800);
  if (!server.killed) {
    server.kill("SIGKILL");
  }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${data.error || "request failed"}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < START_TIMEOUT_MS) {
    try {
      const payload = await fetchJson(`${BASE_URL}/api/health`);
      if (payload && payload.ok) {
        return payload;
      }
    } catch (_) {
      // Retry while booting.
    }
    await delay(350);
  }
  throw new Error("Server did not become healthy in time.");
}

function authHeaders(auth) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.sessionToken}`,
    "X-Session-Token": auth.sessionToken,
    "X-Workspace-Id": auth.workspaceId
  };
}

async function runTimed(label, fn) {
  const started = Date.now();
  await fn();
  return Date.now() - started;
}

async function run() {
  const server = startServer();
  try {
    const health = await waitForHealth();
    assert.ok(health.openaiConfigured, "OPENAI_API_KEY must be configured for load regression.");

    const auth = await fetchJson(`${BASE_URL}/api/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const headers = authHeaders(auth);

    const analyzerJobs = Array.from({ length: ANALYZER_CONCURRENCY }).map((_, index) => runTimed(`analyzer-${index + 1}`, async () => {
      const payload = await fetchJson(`${BASE_URL}/api/ai/sermon-analyzer`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          context: "Load regression",
          goal: "Maintain reliable coaching outputs under concurrent traffic",
          notes: `Run ${index + 1}`,
          transcriptOverride: "Church family, we return to Philippians 2 and the humility of Christ. Let the mind of Christ shape our speech, service, and obedience this week.",
          localAnalysis: {
            durationSeconds: 180
          }
        })
      });
      const actions = payload && payload.coachingFeedback && Array.isArray(payload.coachingFeedback.priorityActions)
        ? payload.coachingFeedback.priorityActions
        : [];
      assert.ok(actions.length > 0, "Analyzer response must include coaching priority actions.");
    }));

    const videoQueries = [
      "How do I run a Bible word study?",
      "How do I build a sermon workflow in Logos 10?",
      "Best way to organize notes in Logos?",
      "How to use passage guide effectively?",
      "How to find cross references quickly?",
      "How to prep a lesson from one passage?"
    ];
    const videoJobs = Array.from({ length: VIDEO_CONCURRENCY }).map((_, index) => runTimed(`video-${index + 1}`, async () => {
      const payload = await fetchJson(`${BASE_URL}/api/ai/video-search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: videoQueries[index % videoQueries.length],
          category: "all",
          difficulty: "all",
          logosVersion: "all",
          maxMinutes: 0,
          sortMode: "relevance",
          transcribeMode: "skip"
        })
      });
      assert.ok(Array.isArray(payload.results), "Video-search load response should include results array.");
    }));

    const analyzerDurations = await Promise.all(analyzerJobs);
    const videoDurations = await Promise.all(videoJobs);

    const analyzerP95 = percentile(analyzerDurations, 95);
    const videoP95 = percentile(videoDurations, 95);

    assert.ok(analyzerP95 <= 180_000, `Analyzer p95 latency too high: ${analyzerP95}ms`);
    assert.ok(videoP95 <= 60_000, `Video-search p95 latency too high: ${videoP95}ms`);

    console.log("Load regression passed.");
    console.log(`- Analyzer concurrency: ${ANALYZER_CONCURRENCY}, p95=${analyzerP95}ms`);
    console.log(`- Video-search concurrency: ${VIDEO_CONCURRENCY}, p95=${videoP95}ms`);
  } finally {
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(`Load regression failed: ${error.message}`);
  process.exitCode = 1;
});

