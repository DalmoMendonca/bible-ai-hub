#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.DATA_QUALITY_PORT || 3477);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 240_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  await delay(700);
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
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${payload.error || "request failed"}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT_MS) {
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

function usageRuns(summary, feature) {
  const totals = summary && summary.totals && typeof summary.totals === "object" ? summary.totals : {};
  const row = totals[feature] || {};
  return Number(row.runs || 0);
}

function cogsRuns(cogs, feature) {
  const rows = Array.isArray(cogs && cogs.features) ? cogs.features : [];
  const row = rows.find((item) => String(item.feature || "") === feature) || {};
  return Number(row.runs || 0);
}

async function run() {
  const server = startServer();
  try {
    const health = await waitForHealth();
    assert.ok(health.openaiConfigured, "OPENAI_API_KEY must be configured for data-quality reconciliation.");

    const auth = await fetchJson(`${BASE_URL}/api/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const headers = authHeaders(auth);
    const workspaceId = encodeURIComponent(auth.workspaceId);

    const baselineUsage = await fetchJson(`${BASE_URL}/api/usage/summary?workspaceId=${workspaceId}`, { headers });
    const baselineCogs = await fetchJson(`${BASE_URL}/api/analytics/cogs`, { headers });
    const baselineActivation = await fetchJson(`${BASE_URL}/api/analytics/activation?segment=all`, { headers });
    const baselineSuccesses = Number(baselineActivation && baselineActivation.funnel && baselineActivation.funnel.success || 0);

    await fetchJson(`${BASE_URL}/api/ai/research-helper`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sermonType: "Expository",
        targetMinutes: 30,
        manuscript: "Today we preach James 1 and move from hearing to doing the word with humble obedience.",
        diagnostics: {
          readability: 62,
          references: ["James 1:22"]
        },
        revisionObjective: "clarity"
      })
    });

    await fetchJson(`${BASE_URL}/api/ai/video-search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: "How do I run a Bible word study in Logos?",
        category: "all",
        difficulty: "all",
        logosVersion: "all",
        maxMinutes: 0,
        sortMode: "relevance",
        transcribeMode: "skip"
      })
    });

    const afterUsage = await fetchJson(`${BASE_URL}/api/usage/summary?workspaceId=${workspaceId}`, { headers });
    const afterCogs = await fetchJson(`${BASE_URL}/api/analytics/cogs`, { headers });
    const afterActivation = await fetchJson(`${BASE_URL}/api/analytics/activation?segment=all`, { headers });
    const afterSuccesses = Number(afterActivation && afterActivation.funnel && afterActivation.funnel.success || 0);

    assert.ok(
      usageRuns(afterUsage, "research-helper") >= usageRuns(baselineUsage, "research-helper") + 1,
      "Usage summary should increment research-helper runs."
    );
    assert.ok(
      usageRuns(afterUsage, "video-search") >= usageRuns(baselineUsage, "video-search") + 1,
      "Usage summary should increment video-search runs."
    );

    assert.ok(
      cogsRuns(afterCogs, "research-helper") >= cogsRuns(baselineCogs, "research-helper") + 1,
      "COGS dashboard should reconcile research-helper run increments."
    );
    assert.ok(
      cogsRuns(afterCogs, "video-search") >= cogsRuns(baselineCogs, "video-search") + 1,
      "COGS dashboard should reconcile video-search run increments."
    );

    assert.ok(
      afterSuccesses >= baselineSuccesses + 2,
      "Activation funnel success count should reflect generation_success events."
    );

    console.log("Data-quality reconciliation passed.");
  } finally {
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(`Data-quality reconciliation failed: ${error.message}`);
  process.exitCode = 1;
});
