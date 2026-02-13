#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = Number(process.env.PLATFORM_SMOKE_PORT || 3299);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${data.error || "Request failed"}`);
  }
  return data;
}

function startServer() {
  return spawn("node", ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < 20000) {
    try {
      const data = await fetchJson(`${BASE_URL}/api/health`);
      if (data.ok) {
        return;
      }
    } catch (_) {
      // retry
    }
    await delay(300);
  }
  throw new Error("Server did not become healthy.");
}

async function run() {
  const server = startServer();
  server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

  try {
    await waitForHealth();
    const signup = await fetchJson(`${BASE_URL}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `platform-smoke-${Date.now()}@example.com`,
        password: "Password123!",
        name: "Platform Smoke"
      })
    });
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signup.sessionToken}`,
      "X-Session-Token": signup.sessionToken,
      "X-Workspace-Id": signup.workspaceId
    };

    await fetchJson(`${BASE_URL}/api/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "tool_start",
        source: "smoke",
        properties: { tool: "platform-smoke" }
      })
    });
    await fetchJson(`${BASE_URL}/api/billing/checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: signup.workspaceId,
        planId: "bundle-pro",
        seats: 3
      })
    });
    const entitlements = await fetchJson(`${BASE_URL}/api/entitlements?workspaceId=${encodeURIComponent(signup.workspaceId)}`, {
      headers
    });
    if (!entitlements.features || !entitlements.features["bible-study"]) {
      throw new Error("Expected bible-study entitlement after checkout.");
    }

    const project = await fetchJson(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: signup.workspaceId,
        tool: "bible-study",
        title: "Smoke Project",
        payload: { summary: "smoke" }
      })
    });
    const projectId = project && project.project ? project.project.id : "";
    if (!projectId) {
      throw new Error("Project creation failed.");
    }
    await fetchJson(`${BASE_URL}/api/projects/${encodeURIComponent(projectId)}?workspaceId=${encodeURIComponent(signup.workspaceId)}`, {
      headers
    });
    await fetchJson(`${BASE_URL}/api/projects/${encodeURIComponent(projectId)}/exports`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: signup.workspaceId,
        exportType: "smoke-export",
        metadata: { source: "platform-smoke" }
      })
    });

    const handoff = await fetchJson(`${BASE_URL}/api/handoffs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: signup.workspaceId,
        fromTool: "bible-study",
        toTool: "sermon-preparation",
        sourceProjectId: projectId,
        payload: { summary: "handoff" }
      })
    });
    if (!handoff || !handoff.handoff || !handoff.handoff.id) {
      throw new Error("Handoff creation failed.");
    }

    const path = await fetchJson(`${BASE_URL}/api/learning-paths`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: signup.workspaceId,
        title: "Smoke Path",
        items: [
          {
            order: 1,
            title: "Step 1",
            videoId: "video-1",
            timestampSeconds: 15,
            url: "https://example.com#t=15"
          }
        ]
      })
    });
    const pathId = path && path.path ? path.path.id : "";
    if (!pathId) {
      throw new Error("Learning path creation failed.");
    }
    await fetchJson(`${BASE_URL}/api/learning-paths/${encodeURIComponent(pathId)}?workspaceId=${encodeURIComponent(signup.workspaceId)}`, {
      headers
    });
    await fetchJson(`${BASE_URL}/api/learning-paths/${encodeURIComponent(pathId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        workspaceId: signup.workspaceId,
        title: "Smoke Path Updated"
      })
    });
    await fetchJson(`${BASE_URL}/api/learning-paths/${encodeURIComponent(pathId)}/share`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId: signup.workspaceId
      })
    });

    await fetchJson(`${BASE_URL}/api/lifecycle/process`, { method: "POST" });
    await fetchJson(`${BASE_URL}/api/analytics/activation?segment=all`, { headers });
    await fetchJson(`${BASE_URL}/api/analytics/cogs`, { headers });
    await fetchJson(`${BASE_URL}/api/usage/summary?workspaceId=${encodeURIComponent(signup.workspaceId)}`, { headers });
    await fetchJson(`${BASE_URL}/api/usage/forecast?workspaceId=${encodeURIComponent(signup.workspaceId)}`, { headers });
    await fetchJson(`${BASE_URL}/api/activity?workspaceId=${encodeURIComponent(signup.workspaceId)}&limit=20`, { headers });
    await fetchJson(`${BASE_URL}/api/team/dashboard?workspaceId=${encodeURIComponent(signup.workspaceId)}`, { headers });

    console.log("Platform smoke test passed.");
  } finally {
    server.kill("SIGTERM");
    await delay(500);
    if (!server.killed) {
      server.kill("SIGKILL");
    }
  }
}

run().catch((error) => {
  console.error(`Platform smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
