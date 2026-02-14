#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.SECURITY_TEST_PORT || 3488);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const START_TIMEOUT_MS = 30_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startServer() {
  const server = spawn("node", ["server.js"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      API_RATE_LIMIT_PER_MINUTE: "30"
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

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload && payload.ok) {
        return;
      }
    } catch (_) {
      // Retry while server is booting.
    }
    await delay(300);
  }
  throw new Error("Server did not become healthy in time.");
}

async function run() {
  const server = startServer();
  try {
    await waitForHealth();

    const disallowedOriginResponse = await fetch(`${BASE_URL}/api/health`, {
      headers: {
        Origin: "https://evil.example.com"
      }
    });
    assert.equal(disallowedOriginResponse.headers.get("access-control-allow-origin"), null, "Disallowed origin should not be echoed in CORS headers.");

    const allowedOriginResponse = await fetch(`${BASE_URL}/api/health`, {
      headers: {
        Origin: "https://bible.hiredalmo.com"
      }
    });
    assert.equal(allowedOriginResponse.headers.get("access-control-allow-origin"), "https://bible.hiredalmo.com", "Allowed origin should be echoed in CORS headers.");

    const preflight = await fetch(`${BASE_URL}/api/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://bible.hiredalmo.com",
        "Access-Control-Request-Method": "GET"
      }
    });
    assert.equal(preflight.status, 204, "CORS preflight should return 204.");

    const unauthenticatedPremium = await fetch(`${BASE_URL}/api/ai/sermon-preparation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        passage: {
          reference: "Romans 12:1-2",
          text: "Present your bodies as a living sacrifice.",
          translation_name: "WEB"
        },
        audience: "Sunday congregation",
        minutes: 30,
        theme: "Renewed mind",
        goal: "Faithful obedience"
      })
    });
    assert.equal(unauthenticatedPremium.status, 401, "Premium endpoint should reject unauthenticated calls.");

    const badTokenPremium = await fetch(`${BASE_URL}/api/ai/sermon-preparation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer not-a-real-session"
      },
      body: JSON.stringify({
        passage: {
          reference: "Romans 12:1-2",
          text: "Present your bodies as a living sacrifice.",
          translation_name: "WEB"
        },
        audience: "Sunday congregation",
        minutes: 30,
        theme: "Renewed mind",
        goal: "Faithful obedience"
      })
    });
    assert.equal(badTokenPremium.status, 401, "Malformed/bad session token should be rejected.");

    let gotRateLimit = false;
    for (let i = 0; i < 45; i += 1) {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.status === 429) {
        gotRateLimit = true;
        break;
      }
    }
    assert.ok(gotRateLimit, "Rate limiter should return 429 under sustained burst requests.");

    console.log("Security regression passed.");
  } finally {
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(`Security regression failed: ${error.message}`);
  process.exitCode = 1;
});

