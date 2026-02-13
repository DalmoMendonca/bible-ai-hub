#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");

const PORT = Number(process.env.USER_FEEDBACK_PORT || 3399);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 360_000;

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
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${payload.error || "Request failed"}`);
    }
    return payload;
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
      const message = String(error && error.message || "");
      const isTransient = /\b(500|502|503|504)\b/.test(message) || /timed out|temporar|unavailable|retry/i.test(message);
      if (!isTransient || attempt >= maxAttempts) {
        break;
      }
      await delay(800 * attempt);
    }
  }
  throw lastError;
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
      const health = await fetchJson(`${BASE_URL}/api/health`);
      if (health && health.ok) {
        return health;
      }
    } catch (_) {
      // Server may still be booting.
    }
    await delay(400);
  }
  throw new Error("Server did not become healthy in time.");
}

function stageToRows(stageValue) {
  if (!stageValue) {
    return [];
  }
  if (Array.isArray(stageValue)) {
    return stageValue;
  }
  if (typeof stageValue === "object") {
    return [stageValue];
  }
  return [];
}

function extractSameChapterVerseBounds(reference) {
  const text = String(reference || "").trim();
  const match = text.match(/^([1-3]?\s?[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(\d+):(\d+)(?:-(\d+))?$/i);
  if (!match) {
    return null;
  }
  return {
    bookKey: match[1].replace(/\s+/g, " ").toLowerCase(),
    chapter: Number(match[2]),
    startVerse: Number(match[3]),
    endVerse: Number(match[4] || match[3])
  };
}

function referenceIsOutOfRange(reference, bounds) {
  const parsed = extractSameChapterVerseBounds(reference);
  if (!parsed || !bounds) {
    return false;
  }
  if (parsed.bookKey !== bounds.bookKey || parsed.chapter !== bounds.chapter) {
    return false;
  }
  return parsed.endVerse < bounds.startVerse || parsed.startVerse > bounds.endVerse;
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

async function testBibleStudyQuality(authHeaders) {
  const payload = await fetchJsonWithRetry(`${BASE_URL}/api/ai/bible-study`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      passage: {
        reference: "James 1:19-27",
        translation_name: "WEB",
        text: "So, then, my beloved brothers, let every man be swift to hear, slow to speak, and slow to anger. For the anger of man doesn't produce the righteousness of God. Therefore, putting away all filthiness and overflowing of wickedness, receive with humility the implanted word, which is able to save your souls. But be doers of the word, and not only hearers, deluding your own selves... Pure religion and undefiled before our God and Father is this: to visit the fatherless and widows in their affliction, and to keep oneself unstained by the world."
      },
      focus: "Spiritual maturity in speech, anger, and obedience",
      question: "How do I preach this passage so people move from hearing to doing?"
    })
  });

  const clear = payload && payload.clear && typeof payload.clear === "object" ? payload.clear : {};
  const stageKeys = Object.keys(clear);
  assert(stageKeys.length === 5, "Expected five CLEAR stages.");

  const fallbackPattern = /No AI findings were produced/i;
  for (const stageKey of stageKeys) {
    const rows = stageToRows(clear[stageKey]);
    assert(rows.length > 0, `Stage ${stageKey} should include at least one row.`);
    const findings = rows.flatMap((row) => Array.isArray(row.aiFindings) ? row.aiFindings : []);
    assert(findings.length > 0, `Stage ${stageKey} must include AI findings.`);
    assert(!findings.some((line) => fallbackPattern.test(String(line || ""))), `Stage ${stageKey} includes fallback markers.`);
  }

  const lens = payload && payload.passageLens && typeof payload.passageLens === "object" ? payload.passageLens : {};
  assert(String(lens.contextSummary || "").trim().length >= 24, "Context summary should be populated.");
  assert(String(lens.pastoralAim || "").trim().length >= 24, "Pastoral aim should be populated.");
}

async function testSermonAnalyzerTranscriptMode(authHeaders) {
  const payload = await fetchJsonWithRetry(`${BASE_URL}/api/ai/sermon-analyzer`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      context: "Conference Message",
      goal: "Stronger engagement and slower pacing",
      notes: "Transcript-only QA scenario",
      transcriptOverride: "Church family, today we look at Philippians 2 and the humility of Christ. We follow His example through repentance, service, and joyful obedience.",
      localAnalysis: {}
    })
  });

  const actions = payload && payload.coachingFeedback && Array.isArray(payload.coachingFeedback.priorityActions)
    ? payload.coachingFeedback.priorityActions
    : [];
  assert(actions.length > 0, "Expected priority actions in coaching feedback.");
  assert(!actions.some((item) => /\[object Object\]/i.test(String(item || ""))), "Priority actions include [object Object].");

  const pacing = payload && payload.pacingAnalysis && typeof payload.pacingAnalysis === "object" ? payload.pacingAnalysis : {};
  const vocal = payload && payload.vocalDynamics && typeof payload.vocalDynamics === "object" ? payload.vocalDynamics : {};
  assert(typeof pacing.source === "string" && pacing.source.length > 0, "Pacing should include metric source.");
  assert(typeof vocal.source === "string" && vocal.source.length > 0, "Vocal dynamics should include metric source.");

  if (vocal.source !== "audio") {
    const unavailableMetrics = [
      "avgDb",
      "peakDb",
      "dynamicRangeDb",
      "volumeStdDb",
      "pitchMeanHz",
      "pitchStdHz",
      "pitchRangeHz",
      "varietyScore",
      "volumeRangeScore",
      "pitchVariationScore",
      "monotoneRiskScore"
    ];
    for (const key of unavailableMetrics) {
      const value = vocal[key];
      assert(value === null || typeof value === "undefined", `${key} should be null when audio provenance is unavailable.`);
    }
    assert(String(vocal.sourceNote || "").trim().length > 0, "Expected explanatory source note for transcript-only vocal metrics.");
  }
}

async function testVideoSearchConfidence(authHeaders) {
  const queries = [
    "How do I counsel trauma victims with Logos workflows?",
    "quantum entanglement spreadsheet accounting in Logos 10"
  ];

  let lowConfidencePayload = null;
  for (const query of queries) {
    const payload = await fetchJsonWithRetry(`${BASE_URL}/api/ai/video-search`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        query,
        category: "all",
        difficulty: "all",
        logosVersion: "all",
        maxMinutes: 0,
        sortMode: "relevance",
        transcribeMode: "skip"
      })
    });
    const confidence = payload && payload.confidence && typeof payload.confidence === "object" ? payload.confidence : {};
    if (confidence.tier === "low") {
      lowConfidencePayload = payload;
      break;
    }
  }

  assert(lowConfidencePayload, "Expected at least one low-confidence query outcome.");
  const confidence = lowConfidencePayload.confidence;
  assert(Array.isArray(confidence.reasonCodes) && confidence.reasonCodes.length > 0, "Low-confidence payload should include reason codes.");
  assert(
    /(search confidence is low|low-confidence match:|confidence is low)/i.test(String(lowConfidencePayload.guidance || "")),
    "Guidance should include low-confidence caution prefix."
  );
}

async function testSermonPreparationBoundary(authHeaders) {
  const payload = await fetchJsonWithRetry(`${BASE_URL}/api/ai/sermon-preparation`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      passage: {
        reference: "Luke 15:11-24",
        translation_name: "WEB",
        text: "He said, 'A certain man had two sons... While he was still far off, his father saw him and was moved with compassion... Bring out the best robe and put it on him... For this my son was dead and is alive again. He was lost and is found.'"
      },
      audience: "Sunday congregation",
      minutes: 30,
      theme: "The Father's mercy toward returning sinners",
      goal: "Call listeners to repent and receive grace"
    })
  });

  const bounds = extractSameChapterVerseBounds("Luke 15:11-24");
  const outline = Array.isArray(payload.outline) ? payload.outline : [];
  assert(outline.length >= 3, "Expected sermon outline with at least three movements.");

  const outOfScopeSupportingRefs = [];
  for (const point of outline) {
    const supporting = Array.isArray(point && point.supportingReferences) ? point.supportingReferences : [];
    for (const reference of supporting) {
      if (referenceIsOutOfRange(reference, bounds)) {
        outOfScopeSupportingRefs.push(reference);
      }
    }
  }

  assert.equal(outOfScopeSupportingRefs.length, 0, `Supporting references include out-of-bound refs: ${outOfScopeSupportingRefs.join(", ")}`);
  assert(payload && payload.passageBoundary && typeof payload.passageBoundary === "object", "Expected passage boundary diagnostics payload.");
}

async function testResearchHelperObjective(authHeaders) {
  const payload = await fetchJsonWithRetry(`${BASE_URL}/api/ai/research-helper`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      sermonType: "Expository",
      targetMinutes: 35,
      revisionObjective: "exegetical_precision",
      diagnostics: {
        readability: 57,
        references: ["James 1:22"],
        estimatedMinutesAt130Wpm: 33
      },
      manuscript: "Beloved church, James calls us to be doers of the word and not hearers only. We can confess Christ while drifting into partial obedience. Today we examine what genuine faith looks like in speech, anger, mercy, and obedience."
    })
  });

  assert.equal(payload.revisionObjective, "exegetical_precision", "API should echo normalized revision objective.");
  assert(Array.isArray(payload.revisions) && payload.revisions.length >= 5, "Expected revisions list.");
  const firstRevisions = payload.revisions.slice(0, 4);
  assert(firstRevisions.every((line) => /why this helps this sermon:/i.test(String(line || ""))), "Revisions should include explicit why-this-helps rationale.");
}

async function testSermonAnalyzerFileScript() {
  await new Promise((resolve, reject) => {
    const proc = spawn("node", ["scripts/test-sermon-analyzer-file.js", "--runs", "1"], {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: "pipe"
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(`[file-test] ${text}`);
    });
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(`[file-test] ${text}`);
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`scripts/test-sermon-analyzer-file.js failed with code ${code}. stderr=${stderr || "(none)"} stdout=${stdout || "(none)"}`));
    });
  });
}

async function run() {
  const server = startServer();
  try {
    const health = await waitForHealth();
    if (!health.openaiConfigured) {
      throw new Error("OPENAI_API_KEY is not configured. Cannot run user-feedback regression.");
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

    await runStep("Bible Study quality floor", () => testBibleStudyQuality(authHeaders));
    await runStep("Sermon Analyzer transcript-mode provenance", () => testSermonAnalyzerTranscriptMode(authHeaders));
    await runStep("Video Search low-confidence behavior", () => testVideoSearchConfidence(authHeaders));
    await runStep("Sermon Preparation passage bounds", () => testSermonPreparationBoundary(authHeaders));
    await runStep("Research Helper revision objective rationale", () => testResearchHelperObjective(authHeaders));
  } finally {
    server.kill("SIGTERM");
    await delay(800);
    if (!server.killed) {
      server.kill("SIGKILL");
    }
  }

  await runStep("Sermon Analyzer file QA script (auth + upload)", () => testSermonAnalyzerFileScript());
  console.log("\nUser-feedback regression suite passed.");
}

run().catch((error) => {
  console.error(`User-feedback regression suite failed: ${error.message}`);
  process.exitCode = 1;
});
