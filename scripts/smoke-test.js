#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = Number(process.env.SMOKE_PORT || 3199);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 240_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${data.error || "Request failed"}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithRetry(url, options = {}, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      const isTransient =
        /\b(500|502|503|504)\b/.test(String(error.message || ""))
        || /timed out|temporar|unavailable|retry/i.test(String(error.message || ""));

      if (!isTransient || attempt >= maxAttempts) {
        break;
      }
      await delay(800 * attempt);
    }
  }

  throw lastError;
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < SERVER_START_TIMEOUT_MS) {
    try {
      const data = await fetchJson(`${BASE_URL}/api/health`);
      if (data && data.ok) {
        return data;
      }
    } catch (_) {
      // Retry until timeout.
    }
    await delay(400);
  }
  throw new Error("Server did not become healthy in time.");
}

function startServer() {
  const server = spawn("node", ["server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  server.stderr.on("data", (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  return server;
}

async function runStep(name, fn) {
  process.stdout.write(`Running ${name}... `);
  const started = Date.now();
  try {
    const result = await fn();
    const elapsedMs = Date.now() - started;
    console.log(`ok (${elapsedMs} ms)`);
    return result;
  } catch (error) {
    throw new Error(`[${name}] ${error.message}`);
  }
}

async function run() {
  const server = startServer();

  try {
    const health = await waitForHealth();
    if (!health.openaiConfigured) {
      throw new Error("OPENAI_API_KEY is not configured. Cannot run smoke tests.");
    }

    const auth = await fetchJson(`${BASE_URL}/api/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const authHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.sessionToken}`,
      "X-Session-Token": auth.sessionToken,
      "X-Workspace-Id": auth.workspaceId
    };

    const bibleStudy = await runStep("Bible Study", () => fetchJsonWithRetry(`${BASE_URL}/api/ai/bible-study`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        passage: {
          reference: "John 3:16-17",
          text: "For God so loved the world, that he gave his only Son, that whoever believes in him should not perish, but have eternal life. For God didn't send his Son into the world to judge the world, but that the world should be saved through him.",
          translation_name: "WEB"
        },
        focus: "Assurance of salvation",
        question: "How should this shape evangelism?"
      })
    }));

    const clearStages = Object.keys(bibleStudy.clear || {});
    if (clearStages.length !== 5 || !Array.isArray(bibleStudy.tenStep) || bibleStudy.tenStep.length !== 10) {
      throw new Error("Bible study response shape is invalid.");
    }

    const sermonPrep = await runStep("Sermon Preparation", () => fetchJsonWithRetry(`${BASE_URL}/api/ai/sermon-preparation`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        passage: {
          reference: "Romans 12:1-2",
          text: "I beg you therefore, brothers, by the mercies of God, to present your bodies a living sacrifice.",
          translation_name: "WEB"
        },
        audience: "Sunday congregation",
        minutes: 30,
        theme: "Renewed mind",
        goal: "Call people to daily surrender"
      })
    }));
    if (!sermonPrep.bigIdea) {
      throw new Error("Sermon preparation response missing bigIdea.");
    }

    const teachingTools = await runStep("Teaching Tools", () => fetchJsonWithRetry(`${BASE_URL}/api/ai/teaching-tools`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        sourceTitle: "Faith That Works",
        passageText: "James 2:14-17 explores faith and works.",
        audience: "Adults",
        length: 45,
        setting: "Small group",
        groupSize: 12,
        resources: "Bibles and whiteboard",
        outcome: "Move from abstract faith to concrete action",
        notes: "Mixed maturity levels"
      })
    }));
    if (!teachingTools.overview || !teachingTools.lessonPlan || !teachingTools.applicationPathways) {
      throw new Error("Teaching tools response missing core sections.");
    }

    const researchHelper = await runStep("Research Helper", () => fetchJsonWithRetry(`${BASE_URL}/api/ai/research-helper`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        sermonType: "Expository",
        targetMinutes: 35,
        diagnostics: { readability: 60 },
        manuscript: "Today we consider Ephesians 2 and salvation by grace through faith..."
      })
    }));
    if (!researchHelper.overallVerdict) {
      throw new Error("Research helper response missing overallVerdict.");
    }

    const sermonAnalyzer = await runStep("Sermon Analyzer", () => fetchJsonWithRetry(`${BASE_URL}/api/ai/sermon-analyzer`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        context: "Sunday morning",
        goal: "Improve clarity and pacing",
        notes: "Keep it engaging",
        transcriptOverride: "Church family, today we open to Philippians chapter two and see Christ's humility in action.",
        localAnalysis: JSON.stringify({
          durationSeconds: 95,
          pauses: [0.35, 0.42, 0.9]
        })
      })
    }));
    if (!sermonAnalyzer.transcript || !sermonAnalyzer.coachingFeedback) {
      throw new Error("Sermon analyzer response missing transcript or coaching feedback.");
    }

    const videoSearch = await runStep("Video Search", () => fetchJsonWithRetry(`${BASE_URL}/api/ai/video-search`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        query: "How do I do a word study in Logos?",
        category: "all",
        difficulty: "all",
        logosVersion: "all",
        maxMinutes: 0,
        sortMode: "relevance",
        transcribeMode: "skip"
      })
    }));
    if (!Array.isArray(videoSearch.results) || !videoSearch.stats) {
      throw new Error("Video search response shape is invalid.");
    }

    console.log("\nSmoke test passed:");
    console.log(`- Bible Study: ${clearStages.join(", ")}`);
    console.log(`- Sermon Prep outline points: ${Array.isArray(sermonPrep.outline) ? sermonPrep.outline.length : 0}`);
    console.log(`- Teaching Tools objectives: ${Array.isArray(teachingTools.lessonPlan.objectives) ? teachingTools.lessonPlan.objectives.length : 0}`);
    console.log(`- Research Helper scores: ${Array.isArray(researchHelper.scores) ? researchHelper.scores.length : 0}`);
    console.log(`- Sermon Analyzer transcript words: ${sermonAnalyzer.transcript.wordCount}`);
    console.log(`- Video Search results: ${videoSearch.results.length}`);
  } finally {
    server.kill("SIGTERM");
    await delay(800);
    if (!server.killed) {
      server.kill("SIGKILL");
    }
  }
}

run().catch((error) => {
  console.error(`Smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
