#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("../server");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_PORT = Number(process.env.SERMON_TEST_PORT || 3211);
const args = process.argv.slice(2);

function getArg(name, fallback) {
  const idx = args.findIndex((arg) => arg === name);
  if (idx < 0 || idx + 1 >= args.length) {
    return fallback;
  }
  return args[idx + 1];
}

function resolveAudioFile(inputPath) {
  if (inputPath) {
    const absolute = path.resolve(ROOT_DIR, inputPath);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Audio file not found: ${absolute}`);
    }
    return absolute;
  }

  const videoDir = path.join(ROOT_DIR, "ai", "videos");
  const candidates = fs.readdirSync(videoDir)
    .filter((name) => /\.(mp3|wav|m4a|flac)$/i.test(name))
    .sort();

  if (!candidates.length) {
    throw new Error("No audio files found in ai/videos.");
  }

  return path.join(videoDir, candidates[0]);
}

function mimeTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".flac") return "audio/flac";
  return "audio/mpeg";
}

async function run() {
  const runs = Math.max(1, Number(getArg("--runs", "2")) || 2);
  const requestedFile = getArg("--file", "");
  const audioPath = resolveAudioFile(requestedFile);
  const audioBuffer = fs.readFileSync(audioPath);
  const fileName = path.basename(audioPath);

  const server = await new Promise((resolve) => {
    const instance = app.listen(DEFAULT_PORT, () => resolve(instance));
  });

  const baseUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
  const outcomes = [];

  try {
    const authResponse = await fetch(`${baseUrl}/api/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const authPayload = await authResponse.json().catch(() => ({}));
    if (!authResponse.ok || !authPayload.sessionToken || !authPayload.workspaceId) {
      throw new Error(`Unable to create guest auth session (${authResponse.status}).`);
    }
    const authHeaders = {
      Authorization: `Bearer ${authPayload.sessionToken}`,
      "X-Session-Token": authPayload.sessionToken,
      "X-Workspace-Id": authPayload.workspaceId
    };

    for (let i = 1; i <= runs; i += 1) {
      const started = Date.now();
      const form = new FormData();
      form.append("audio", new Blob([audioBuffer], { type: mimeTypeForFile(audioPath) }), fileName);
      form.append("context", "Conference Message");
      form.append("goal", "Improve clarity and pacing");
      form.append("notes", "Regression test run");
      form.append("transcriptOverride", "");
      form.append("localAnalysis", "{}");

      const response = await fetch(`${baseUrl}/api/ai/sermon-analyzer`, {
        method: "POST",
        headers: authHeaders,
        body: form
      });
      const payload = await response.json().catch(() => ({}));
      const elapsedMs = Date.now() - started;

      if (!response.ok) {
        throw new Error(`Run ${i} failed (${response.status}): ${payload.error || "Unknown error"}`);
      }

      const transcriptWordCount = Number(payload && payload.transcript && payload.transcript.wordCount || 0);
      const pipelineAgents = Array.isArray(payload && payload.orchestration) ? payload.orchestration.length : 0;
      if (!transcriptWordCount || !pipelineAgents) {
        throw new Error(`Run ${i} returned incomplete payload.`);
      }

      outcomes.push({
        run: i,
        elapsedMs,
        transcriptWordCount,
        pipelineAgents
      });
      console.log(`Run ${i}/${runs}: ok in ${elapsedMs}ms (words=${transcriptWordCount}, agents=${pipelineAgents})`);
    }

    const avgMs = Math.round(outcomes.reduce((sum, row) => sum + row.elapsedMs, 0) / outcomes.length);
    console.log(`\nSermon analyzer file test passed (${runs} runs, avg ${avgMs}ms).`);
    console.log(`Audio file: ${audioPath}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(`Sermon analyzer file test failed: ${error.message}`);
  process.exitCode = 1;
});
