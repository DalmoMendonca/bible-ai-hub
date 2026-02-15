#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = Number(process.env.AUTH_REGRESSION_PORT || 3499);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROOT_DIR = path.resolve(__dirname, "..");
const ADMIN_EMAIL = "dalmomendonca@gmail.com";
const SERVER_START_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 20_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { raw: text };
      }
    }
    return { response, data, text };
  } finally {
    clearTimeout(timeout);
  }
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

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < SERVER_START_TIMEOUT_MS) {
    try {
      const { response, data } = await fetchJson(`${BASE_URL}/api/health`);
      if (response.ok && data && data.ok) {
        return;
      }
    } catch (_) {
      // Server may still be booting.
    }
    await delay(300);
  }
  throw new Error("Server did not become healthy in time.");
}

function buildAuthHeaders(authPayload) {
  return {
    Authorization: `Bearer ${authPayload.sessionToken}`,
    "X-Session-Token": authPayload.sessionToken,
    "X-Workspace-Id": authPayload.workspaceId
  };
}

async function runStep(name, fn) {
  process.stdout.write(`Running ${name}... `);
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`ok (${Date.now() - started} ms)`);
    return result;
  } catch (error) {
    throw new Error(`[${name}] ${error.message}`);
  }
}

async function run() {
  const server = startServer();
  try {
    await waitForHealth();

    await runStep("Session endpoint requires auth", async () => {
      const { response, data } = await fetchJson(`${BASE_URL}/api/auth/session`);
      assert.equal(response.status, 401, "Unauthenticated session should return 401.");
      assert.match(String(data.error || ""), /Authentication required/i);
    });

    const guestAuth = await runStep("Guest auth bootstrap", async () => {
      const { response, data, text } = await fetchJson(`${BASE_URL}/api/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (response.status !== 201) {
        throw new Error(`Expected 201, got ${response.status}. Body: ${text}`);
      }
      assert.ok(data.sessionToken, "Guest auth should return sessionToken.");
      assert.ok(data.workspaceId, "Guest auth should return workspaceId.");
      return data;
    });

    await runStep("Authenticated session works after guest bootstrap", async () => {
      const { response, data } = await fetchJson(`${BASE_URL}/api/auth/session`, {
        headers: buildAuthHeaders(guestAuth)
      });
      assert.equal(response.status, 200, "Authenticated session should return 200.");
      assert.ok(data.user && data.user.id, "Session response should include user.");
      assert.equal(data.session && data.session.token, guestAuth.sessionToken, "Session token should match guest token.");
    });

    await runStep("How-it-works is readable for guests", async () => {
      const { response, data } = await fetchJson(`${BASE_URL}/api/how-it-works`, {
        headers: buildAuthHeaders(guestAuth)
      });
      assert.equal(response.status, 200, "How-it-works should return 200 for guest sessions.");
      assert.ok(Array.isArray(data.apps) && data.apps.length > 0, "How-it-works should include app map.");
      assert.equal(Boolean(data.viewer && data.viewer.canEditPrompts), false, "Guests should not be able to edit prompts.");
    });

    const adminAuth = await runStep("Admin auth bootstrap", async () => {
      const { response, data, text } = await fetchJson(`${BASE_URL}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: ADMIN_EMAIL,
          name: "Auth Regression Admin",
          sub: `auth-regression-${Date.now()}`
        })
      });
      if (!response.ok) {
        throw new Error(`Expected 2xx, got ${response.status}. Body: ${text}`);
      }
      assert.ok(data.sessionToken, "Admin auth should return sessionToken.");
      assert.ok(data.workspaceId, "Admin auth should return workspaceId.");
      return data;
    });

    await runStep("Session ignores stale workspace headers", async () => {
      const staleWorkspaceId = "ws_missing_or_stale";
      const { response, data, text } = await fetchJson(`${BASE_URL}/api/auth/session`, {
        headers: {
          ...buildAuthHeaders(adminAuth),
          "X-Workspace-Id": staleWorkspaceId
        }
      });
      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}. Body: ${text}`);
      }
      assert.notEqual(data.activeWorkspaceId, staleWorkspaceId, "Session should not keep a workspace the user cannot access.");
      assert.ok(data.activeWorkspaceId, "Session should resolve an accessible workspace.");
    });

    await runStep("Project saves ignore stale workspace IDs from payload", async () => {
      const staleWorkspaceId = "ws_stale_nonmember";
      const { response, data, text } = await fetchJson(`${BASE_URL}/api/projects`, {
        method: "POST",
        headers: {
          ...buildAuthHeaders(adminAuth),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspaceId: staleWorkspaceId,
          tool: "sermon-preparation",
          title: "Workspace Fallback Regression",
          payload: { ok: true }
        })
      });
      if (response.status !== 201) {
        throw new Error(`Expected 201, got ${response.status}. Body: ${text}`);
      }
      const project = data && data.project ? data.project : null;
      assert.ok(project && project.id, "Project response should include an id.");
      assert.ok(project && project.workspaceId, "Project response should include workspaceId.");
      assert.notEqual(project.workspaceId, staleWorkspaceId, "Project save should not honor inaccessible workspace IDs.");
    });

    await runStep("Viewer role can save and update own project", async () => {
      const workspaceId = String(adminAuth && adminAuth.workspaceId || "").trim();
      assert.ok(workspaceId, "Admin workspace is required.");

      const viewerEmail = `viewer-${Date.now()}@example.com`;
      const viewerAuthResponse = await fetchJson(`${BASE_URL}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: viewerEmail,
          name: "Viewer Regression",
          sub: `viewer-regression-${Date.now()}`
        })
      });
      if (!viewerAuthResponse.response.ok) {
        throw new Error(`Viewer bootstrap failed: ${viewerAuthResponse.response.status} ${viewerAuthResponse.text}`);
      }
      const viewerAuth = viewerAuthResponse.data || {};
      assert.ok(viewerAuth.sessionToken, "Viewer auth should return a session token.");

      const seatResponse = await fetchJson(`${BASE_URL}/api/team/seats`, {
        method: "POST",
        headers: {
          ...buildAuthHeaders(adminAuth),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspaceId,
          seats: 2
        })
      });
      if (!seatResponse.response.ok) {
        throw new Error(`Seat update failed: ${seatResponse.response.status} ${seatResponse.text}`);
      }

      const inviteResponse = await fetchJson(`${BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/members`, {
        method: "POST",
        headers: {
          ...buildAuthHeaders(adminAuth),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: viewerEmail,
          role: "viewer"
        })
      });
      if (inviteResponse.response.status !== 201) {
        throw new Error(`Add member failed: ${inviteResponse.response.status} ${inviteResponse.text}`);
      }

      const activeWorkspaceResponse = await fetchJson(`${BASE_URL}/api/workspaces/active`, {
        method: "POST",
        headers: {
          ...buildAuthHeaders(viewerAuth),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspaceId
        })
      });
      if (!activeWorkspaceResponse.response.ok) {
        throw new Error(`Set active workspace failed: ${activeWorkspaceResponse.response.status} ${activeWorkspaceResponse.text}`);
      }

      const createResponse = await fetchJson(`${BASE_URL}/api/projects`, {
        method: "POST",
        headers: {
          ...buildAuthHeaders(viewerAuth),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspaceId,
          tool: "teaching-tools",
          title: "Viewer Owned Project",
          payload: { generated: true }
        })
      });
      if (createResponse.response.status !== 201) {
        throw new Error(`Viewer project create failed: ${createResponse.response.status} ${createResponse.text}`);
      }
      const project = createResponse.data && createResponse.data.project ? createResponse.data.project : null;
      assert.ok(project && project.id, "Viewer-owned project should include an id.");
      const projectId = String(project && project.id || "").trim();

      const updateResponse = await fetchJson(`${BASE_URL}/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: {
          ...buildAuthHeaders(viewerAuth),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspaceId,
          title: "Viewer Owned Project Updated",
          payload: { generated: true, revised: true }
        })
      });
      if (!updateResponse.response.ok) {
        throw new Error(`Viewer project update failed: ${updateResponse.response.status} ${updateResponse.text}`);
      }
    });

    await runStep("How-it-works marks admin as editable", async () => {
      const { response, data } = await fetchJson(`${BASE_URL}/api/how-it-works`, {
        headers: buildAuthHeaders(adminAuth)
      });
      assert.equal(response.status, 200, "How-it-works should return 200 for admin sessions.");
      assert.equal(Boolean(data.viewer && data.viewer.canEditPrompts), true, "Admin should be able to edit prompts.");
    });

    console.log("Auth regression test passed.");
  } finally {
    server.kill("SIGTERM");
    await delay(400);
    if (!server.killed) {
      server.kill("SIGKILL");
    }
  }
}

run().catch((error) => {
  console.error(`Auth regression test failed: ${error.message}`);
  process.exitCode = 1;
});
