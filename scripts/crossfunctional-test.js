#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT = Number(process.env.CROSSFUNC_PORT || 3399);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SERVER_START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 180_000;
const ADMIN_EMAIL = "dalmomendonca@gmail.com";

const APP_SLUGS = [
  "bible-study",
  "sermon-preparation",
  "teaching-tools",
  "research-helper",
  "sermon-analyzer",
  "video-search"
];

const APP_JS = [
  "/assets/apps/bible-study.js",
  "/assets/apps/sermon-preparation.js",
  "/assets/apps/teaching-tools.js",
  "/assets/apps/research-helper.js",
  "/assets/apps/sermon-analyzer.js",
  "/assets/apps/video-search.js"
];

const BANNED_COPY = [
  "Live Tool",
  "Now Live",
  "Pricing TBD",
  "Pricing will be announced at launch"
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error) {
  const message = String(error && error.message ? error.message : "");
  return /\b(408|429|500|502|503|504)\b/.test(message)
    || /timed out|temporar|overloaded|unavailable|rate limit|fetch failed/i.test(message);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  return { response, text };
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${data.error || "Request failed"}`);
  }
  return data;
}

async function fetchJsonWithRetry(url, options = {}, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt >= maxAttempts) {
        break;
      }
      await delay(850 * attempt);
    }
  }
  throw lastError;
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
    await delay(350);
  }
  throw new Error("Server did not become healthy in time.");
}

function assertContains(text, needle, contextLabel) {
  assert.ok(
    String(text).includes(needle),
    `${contextLabel}: expected content to include "${needle}".`
  );
}

function assertNotContains(text, needle, contextLabel) {
  assert.ok(
    !String(text).includes(needle),
    `${contextLabel}: expected content to NOT include "${needle}".`
  );
}

function authHeaders(auth) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.sessionToken}`,
    "X-Session-Token": auth.sessionToken,
    "X-Workspace-Id": auth.workspaceId
  };
  if (process.env.ADMIN_DASHBOARD_PASSWORD) {
    headers["X-Admin-Dashboard-Password"] = process.env.ADMIN_DASHBOARD_PASSWORD;
  }
  return headers;
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

async function pollAnalyzerJob(jobId, headers) {
  const timeoutMs = 180_000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await fetchJson(`${BASE_URL}/api/ai/sermon-analyzer/jobs/${encodeURIComponent(jobId)}`, {
      headers
    });
    const state = String(status.status || "");
    if (state === "completed" && status.result) {
      return status.result;
    }
    if (state === "failed") {
      throw new Error(status.failureReason || "Analyzer job failed.");
    }
    await delay(1200);
  }
  throw new Error("Timed out waiting for sermon analyzer async job.");
}

async function run() {
  const server = startServer();
  try {
    const health = await runStep("Health", waitForHealth);
    if (!health.openaiConfigured) {
      throw new Error("OPENAI_API_KEY is missing; crossfunctional suite requires real AI calls.");
    }

    await runStep("Primary Routes", async () => {
      const home = await fetchText(`${BASE_URL}/`);
      assert.equal(home.response.status, 200);
      assertContains(home.response.headers.get("content-type") || "", "text/html", "home route");
      assertContains(home.text, "Bible AI Hub", "home route");
      assertContains(home.text, "Made with", "home route");
      assertNotContains(home.text, "announcement-bar", "home route");
      for (const phrase of BANNED_COPY) {
        assertNotContains(home.text, phrase, "home route");
      }

      const aiRedirect = await fetchWithTimeout(`${BASE_URL}/ai`, { redirect: "manual" });
      assert.equal(aiRedirect.status, 301);
      assert.equal(aiRedirect.headers.get("location"), "/");

      const legacyRedirect = await fetchWithTimeout(`${BASE_URL}/ai/bible-study`, { redirect: "manual" });
      assert.equal(legacyRedirect.status, 302);
      assert.equal(legacyRedirect.headers.get("location"), "/ai/apps/bible-study/");
    });

    await runStep("App Shell Pages", async () => {
      for (const slug of APP_SLUGS) {
        const pagePath = `/ai/apps/${slug}/`;
        let page;
        try {
          page = await fetchText(`${BASE_URL}${pagePath}`);
        } catch (error) {
          throw new Error(`${pagePath} fetch failed: ${error.message}`);
        }
        const { response, text } = page;
        assert.equal(response.status, 200, `${pagePath} should return 200`);
        assertContains(response.headers.get("content-type") || "", "text/html", pagePath);
        assertContains(text, `<a class="brand" href="/">Bible AI Hub</a>`, pagePath);
        assertContains(text, "Made with", pagePath);
        for (const phrase of BANNED_COPY) {
          assertNotContains(text, phrase, pagePath);
        }
      }

      const teachingPage = await fetchText(`${BASE_URL}/ai/apps/teaching-tools/`);
      assertContains(teachingPage.text, "teaching-feature-grid", "teaching-tools page");
      assertContains(teachingPage.text, 'id="teachCopy" type="button" class="btn secondary hidden"', "teaching-tools page");
      assertContains(teachingPage.text, 'id="teachPrint" type="button" class="btn secondary hidden"', "teaching-tools page");
    });

    await runStep("Shared Assets", async () => {
      const styles = await fetchText(`${BASE_URL}/assets/styles.css`);
      assert.equal(styles.response.status, 200);
      assertContains(styles.text, ".hero-icon {", "styles");
      assertContains(styles.text, "max-width: 32px;", "styles");
      assertContains(styles.text, ".tool-card svg {", "styles");
      assertContains(styles.text, "max-width: 30px;", "styles");

      const shared = await fetchText(`${BASE_URL}/assets/shared.js`);
      assert.equal(shared.response.status, 200);
      assertContains(shared.text, "window.AIBible", "shared.js");

      for (const jsPath of APP_JS) {
        const jsFile = await fetchText(`${BASE_URL}${jsPath}`);
        assert.equal(jsFile.response.status, 200, `${jsPath} should be available`);
        assertContains(jsFile.response.headers.get("content-type") || "", "javascript", jsPath);
      }
    });

    const auth = await runStep("Auth Guest Session", () => fetchJson(`${BASE_URL}/api/auth/guest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }));
    assert.ok(auth && auth.sessionToken, "Guest auth should return sessionToken.");
    assert.ok(auth.workspaceId, "Guest auth should return workspaceId.");
    const headers = authHeaders(auth);
    const adminAuth = await runStep("Auth Admin Session", () => fetchJson(`${BASE_URL}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        name: "Crossfunctional Admin",
        sub: `crossfunctional-${Date.now()}`
      })
    }));
    const adminHeaders = authHeaders(adminAuth);

    await runStep("Platform Crossflow APIs", async () => {
      const workspaceId = String(auth.workspaceId);
      const workspacePayload = await fetchJson(`${BASE_URL}/api/workspaces`, { headers });
      assert.ok(Array.isArray(workspacePayload.workspaces), "workspaces should be array");

      const plans = await fetchJson(`${BASE_URL}/api/billing/plans`, { headers });
      assert.ok(Array.isArray(plans.plans), "billing plans should be array");

      const project = await fetchJson(`${BASE_URL}/api/projects`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          workspaceId,
          tool: "bible-study",
          title: `Crossfunctional Project ${Date.now()}`,
          payload: {
            source: "crossfunctional-test"
          }
        })
      });
      const projectId = project && project.project && project.project.id;
      assert.ok(projectId, "project id should exist");

      await fetchJson(`${BASE_URL}/api/projects/${encodeURIComponent(projectId)}?workspaceId=${encodeURIComponent(workspaceId)}`, {
        headers
      });

      const handoff = await fetchJson(`${BASE_URL}/api/handoffs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          workspaceId,
          fromTool: "bible-study",
          toTool: "sermon-preparation",
          sourceProjectId: projectId,
          payload: { summary: "handoff from crossfunctional test" }
        })
      });
      assert.ok(handoff && handoff.handoff && handoff.handoff.id, "handoff id should exist");

      const pathPayload = await fetchJson(`${BASE_URL}/api/learning-paths`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          workspaceId,
          title: `Crossfunctional Path ${Date.now()}`,
          items: [
            {
              order: 1,
              title: "Foundational Step",
              videoId: "video-1",
              timestampSeconds: 12,
              url: "https://example.com/watch?v=video-1#t=12"
            }
          ]
        })
      });
      const pathId = pathPayload && pathPayload.path && pathPayload.path.id;
      assert.ok(pathId, "learning path id should exist");

      const sharedPath = await fetchJson(`${BASE_URL}/api/learning-paths/${encodeURIComponent(pathId)}/share`, {
        method: "POST",
        headers,
        body: JSON.stringify({ workspaceId })
      });
      assert.ok(
        sharedPath && sharedPath.share && sharedPath.share.id && sharedPath.share.shareUrl,
        "learning path share payload should exist"
      );

      await fetchJson(`${BASE_URL}/api/usage/summary?workspaceId=${encodeURIComponent(workspaceId)}`, { headers });
      await fetchJson(`${BASE_URL}/api/usage/forecast?workspaceId=${encodeURIComponent(workspaceId)}`, { headers });
      await fetchJson(`${BASE_URL}/api/activity?workspaceId=${encodeURIComponent(workspaceId)}&limit=10`, { headers });
      await fetchJson(`${BASE_URL}/api/team/dashboard?workspaceId=${encodeURIComponent(adminAuth.workspaceId)}`, { headers: adminHeaders });
      await fetchJson(`${BASE_URL}/api/analytics/activation?segment=all`, { headers: adminHeaders });
      await fetchJson(`${BASE_URL}/api/analytics/cogs`, { headers: adminHeaders });
      await fetchJson(`${BASE_URL}/api/content/social-proof`, { headers });
      const flags = await fetchJson(`${BASE_URL}/api/feature-flags`, { headers });
      assert.ok(flags && flags.flags && typeof flags.flags === "object", "feature flags payload should include flags map");
      assert.ok(flags.flags.social_proof_role_filters, "feature flags should include social_proof_role_filters");
      await fetchJson(`${BASE_URL}/api/video-library/status`, { headers });
    });

    await runStep("Bible Study API", async () => {
      const response = await fetchJsonWithRetry(`${BASE_URL}/api/ai/bible-study`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          passage: {
            reference: "John 3:16-17",
            text: "For God so loved the world, that he gave his only Son, that whoever believes in him should not perish, but have eternal life. For God didn't send his Son into the world to judge the world, but that the world should be saved through him.",
            translation_name: "WEB"
          },
          focus: "God's mission in the gospel",
          question: "How does this passage shape evangelism and assurance?",
          theologicalProfile: "text-centered"
        })
      }, 4);
      assert.ok(response && response.clear && Object.keys(response.clear).length === 5, "CLEAR output should have 5 stages");
      assert.ok(Array.isArray(response.tenStep) && response.tenStep.length === 10, "tenStep output should have 10 stages");
    });

    await runStep("Sermon Preparation API", async () => {
      const response = await fetchJsonWithRetry(`${BASE_URL}/api/ai/sermon-preparation`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          passage: {
            reference: "Romans 12:1-2",
            text: "I urge you therefore, brothers, by the mercies of God, to present your bodies a living sacrifice, holy, acceptable to God.",
            translation_name: "WEB"
          },
          audience: "Sunday congregation",
          minutes: 30,
          theme: "Renewed mind",
          goal: "Move hearers to daily surrender"
        })
      }, 4);
      assert.ok(response.bigIdea, "sermon preparation should return bigIdea");
      assert.ok(Array.isArray(response.outline) && response.outline.length >= 2, "sermon preparation should return outline");
    });

    await runStep("Teaching Tools API (Topic Input)", async () => {
      const response = await fetchJsonWithRetry(`${BASE_URL}/api/ai/teaching-tools`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          sourceTitle: "The parable of the sower",
          passageText: "",
          audience: "Kids (7-11)",
          length: 45,
          setting: "Sunday School",
          groupSize: 12,
          resources: "whiteboard, projector",
          outcome: "Learners identify what good soil responses look like.",
          notes: "mixed maturity"
        })
      }, 4);
      assert.ok(response.overview, "teaching tools should return overview");
      assert.ok(response.lessonPlan && Array.isArray(response.lessonPlan.objectives), "teaching tools should return lessonPlan.objectives");
      assert.ok(response.exports && response.exports.markdown, "teaching tools should return export markdown");
    });

    await runStep("Research Helper API", async () => {
      const response = await fetchJsonWithRetry(`${BASE_URL}/api/ai/research-helper`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          sermonType: "Expository",
          targetMinutes: 35,
          diagnostics: { readability: 61, clarity: 7.1 },
          manuscript: "Today we consider Ephesians 2 and salvation by grace through faith, not as works, so that no one can boast."
        })
      }, 4);
      assert.ok(response.overallVerdict, "research helper should return overallVerdict");
      assert.ok(Array.isArray(response.scores) && response.scores.length >= 3, "research helper should return scores");
    });

    await runStep("Sermon Analyzer API (Async)", async () => {
      const kickoff = await fetchJsonWithRetry(`${BASE_URL}/api/ai/sermon-analyzer`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          asyncMode: true,
          context: "Sunday morning message",
          goal: "Improve pacing and clarity",
          notes: "Focus on transitions",
          transcriptOverride: "Church family, today we open Philippians chapter two and see the humility of Christ, then we respond with joyful obedience.",
          localAnalysis: {
            durationSeconds: 96,
            pauseMoments: [{ start: 13.4, end: 14.1, duration: 0.7 }]
          }
        })
      }, 4);

      if (String(kickoff.mode) === "async" && kickoff.jobId) {
        const queue = await fetchJson(`${BASE_URL}/api/ai/sermon-analyzer/queue-status?workspaceId=${encodeURIComponent(auth.workspaceId)}`, {
          headers
        });
        assert.ok(typeof queue.queueDepth === "number", "queue status should include queueDepth");
        const result = await pollAnalyzerJob(kickoff.jobId, headers);
        assert.ok(result && result.transcript && result.transcript.text, "sermon analyzer async result should include transcript");
        assert.ok(result.coachingFeedback, "sermon analyzer async result should include coaching feedback");
      } else {
        assert.ok(kickoff.transcript && kickoff.coachingFeedback, "sermon analyzer sync fallback should include required sections");
      }
    });

    await runStep("Video Search API", async () => {
      const response = await fetchJsonWithRetry(`${BASE_URL}/api/ai/video-search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: "How do I create a Bible word study in Logos?",
          category: "all",
          difficulty: "all",
          logosVersion: "all",
          maxMinutes: 0,
          sortMode: "relevance",
          transcribeMode: "skip"
        })
      }, 4);
      assert.ok(Array.isArray(response.results), "video search should return results array");
      assert.ok(response.stats && typeof response.stats === "object", "video search should return stats");
      assert.ok(Array.isArray(response.suggestedQueries), "video search should return suggestedQueries");
    });

    console.log("\nCrossfunctional suite passed.");
    console.log(`- Pages covered: ${APP_SLUGS.length + 1}`);
    console.log(`- AI apps covered: ${APP_SLUGS.length}`);
    console.log("- Platform flows covered: auth/workspaces/billing/projects/handoffs/learning paths/usage/team/analytics");
  } finally {
    await stopServer(server);
  }
}

run().catch((error) => {
  console.error(`Crossfunctional suite failed: ${error.message}`);
  process.exitCode = 1;
});
