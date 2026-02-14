const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const express = require("express");
const multer = require("multer");
const {
  VIDEO_LIBRARY,
  hydrateVideoLibrary,
  setVideoTranscript,
  setVideoTranscriptionError,
  getVideoLibraryStats,
  durationToSeconds,
  videoSearchDocument
} = require("./server/video-library");
const {
  createBibleStudyWorkflow,
  CLEAR_METHOD_STAGES,
  TEN_STEP_STUDY_METHOD
} = require("./server/bible-study-workflow");
const { createResearchHelperQualityTools } = require("./server/research-helper-quality");
const { createVideoSearchConfidenceTools } = require("./server/video-search-confidence");
const { createFeatureFlagService } = require("./server/feature-flags");
const {
  PROMPT_REGISTRY,
  setPromptOverrideResolver,
  buildBibleStudyPrompt,
  buildBibleStudyRefinementPrompt,
  buildSermonPreparationPrompt,
  buildSermonPreparationRefinementPrompt,
  buildTeachingToolsPrompt,
  buildTeachingToolsRefinementPrompt,
  buildResearchHelperPrompt,
  buildResearchHelperRevisionPrompt,
  buildVideoSearchGuidancePrompt,
  buildVideoSearchRecoveryPrompt,
  buildSermonInsightsPrompt,
  buildSermonCoachingRefinementPrompt
} = require("./server/prompts");
const {
  createPlatformStore,
  PLAN_CATALOG
} = require("./server/platform");

const ROOT_DIR = resolveRootDir();
const OPENAI_BASE_URL = "https://api.openai.com/v1";

loadEnvFile(path.join(ROOT_DIR, ".env"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";
const OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
const OPENAI_BIBLE_STUDY_MODEL = process.env.OPENAI_BIBLE_STUDY_MODEL || "gpt-4.1-nano";
const OPENAI_BIBLE_STUDY_MAX_TOKENS = Number(process.env.OPENAI_BIBLE_STUDY_MAX_TOKENS || 1800);
const OPENAI_LONG_FORM_MODEL = process.env.OPENAI_LONG_FORM_MODEL || "gpt-4.1-nano";
const OPENAI_DASHBOARD_MODEL = process.env.OPENAI_DASHBOARD_MODEL || OPENAI_CHAT_MODEL;
const OPENAI_RETRY_ATTEMPTS = Number(process.env.OPENAI_RETRY_ATTEMPTS || 4);
const OPENAI_RETRY_BASE_MS = Number(process.env.OPENAI_RETRY_BASE_MS || 650);
const PLATFORM_TRIAL_DAYS = Number(process.env.PLATFORM_TRIAL_DAYS || 14);
const API_RATE_LIMIT_PER_MINUTE = Number(process.env.API_RATE_LIMIT_PER_MINUTE || 180);
const API_ALLOWED_ORIGINS = String(process.env.API_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(?::\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^https:\/\/bible\.hiredalmo\.com$/i,
  /^https:\/\/(?:[a-z0-9-]+\.)?hiredalmo\.com$/i
];
const PORT = Number(process.env.PORT || 3000);
const PRICING_ANCHOR_URL = "/#homePricing";

function pricingAnchorUrl(feature) {
  const safeFeature = cleanString(feature);
  if (!safeFeature) {
    return PRICING_ANCHOR_URL;
  }
  return `/?feature=${encodeURIComponent(safeFeature)}#homePricing`;
}
const GOOGLE_CLIENT_ID = cleanString(process.env.GOOGLE_CLIENT_ID);
const ADMIN_DASHBOARD_PASSWORD = cleanString(process.env.ADMIN_DASHBOARD_PASSWORD);
const GA_MEASUREMENT_ID = cleanString(process.env.GA_MEASUREMENT_ID);
const FEEDBACK_EMAIL = "dalmomendonca@gmail.com";
const PROMPT_EDITOR_EMAIL = "dalmomendonca@gmail.com";
const RESEND_API_KEY = cleanString(process.env.RESEND_API_KEY);
const MAGIC_LINK_FROM_EMAIL = cleanString(process.env.MAGIC_LINK_FROM_EMAIL);
const PUBLIC_BASE_URL = cleanString(process.env.PUBLIC_BASE_URL, "https://bible.hiredalmo.com");
const platform = createPlatformStore({
  rootDir: ROOT_DIR,
  trialDays: Number.isFinite(PLATFORM_TRIAL_DAYS) ? PLATFORM_TRIAL_DAYS : 14
});
const featureFlags = createFeatureFlagService({ rootDir: ROOT_DIR });
const EVENT_TAXONOMY_PATH = path.join(ROOT_DIR, "server", "event-taxonomy.json");
const PROMPT_OVERRIDES_PATH = resolveWritableAppDataPath("prompt-overrides.json");
let promptOverridesState = loadPromptOverridesState();
setPromptOverrideResolver(resolvePromptOverride);
let EVENT_TAXONOMY_CACHE = null;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "6mb" }));
app.use("/api", (req, res, next) => {
  const origin = cleanString(req.headers.origin);
  const allowedOrigin = resolveAllowedOrigin(origin);
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Session-Token, X-Workspace-Id, X-Admin-Dashboard-Password");
  res.setHeader("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});
app.use("/api", attachAuthContext);
app.use("/api", (req, res, next) => {
  const key = req.auth && req.auth.user
    ? `user:${req.auth.user.id}`
    : `ip:${cleanString(req.ip || req.headers["x-forwarded-for"] || "unknown")}`;
  const rate = platform.checkRateLimit({
    key,
    limit: Math.max(30, API_RATE_LIMIT_PER_MINUTE),
    windowMs: 60 * 1000
  });

  res.setHeader("X-RateLimit-Limit", String(Math.max(30, API_RATE_LIMIT_PER_MINUTE)));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, Math.max(30, API_RATE_LIMIT_PER_MINUTE) - rate.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(rate.resetAt / 1000)));

  if (!rate.allowed) {
    platform.logAbuse({
      type: "rate_limit",
      key,
      path: req.path,
      method: req.method,
      ip: cleanString(req.ip || req.headers["x-forwarded-for"])
    });
    res.status(429).json({
      error: "Rate limit exceeded.",
      reasonCode: "rate_limited",
      retryAfterSeconds: Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))
    });
    return;
  }
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 70 * 1024 * 1024
  }
});

let videoEmbeddingCache = { key: "", vectors: [] };
const segmentEmbeddingCache = new Map();
const videoTranscriptionJobs = new Map();
const sermonAnalyzerQueue = [];
let sermonAnalyzerWorkerRunning = false;
const LEGACY_APP_SLUGS = [
  "bible-study",
  "sermon-preparation",
  "teaching-tools",
  "research-helper",
  "sermon-analyzer",
  "video-search"
];
const bibleStudyWorkflow = createBibleStudyWorkflow({
  chatJson: (payload) => chatJson({
    ...payload,
    model: OPENAI_BIBLE_STUDY_MODEL,
    maxTokens: OPENAI_BIBLE_STUDY_MAX_TOKENS
  }),
  cleanString,
  cleanArray,
  cleanObjectArray
});
// Research Helper output quality rules live in a dedicated module so prompt-flow tuning
// can evolve without expanding this API orchestration file further.
const {
  normalizeRevisionObjective,
  normalizeResearchHelperGuidanceLines,
  evaluateResearchHelperDraft
} = createResearchHelperQualityTools({
  cleanString,
  cleanArray,
  cleanObjectArray,
  clampNumber
});
// Video-search confidence is calibrated in one place to keep API, prompt guidance,
// and UI confidence badges aligned as thresholds are tuned.
const {
  assessVideoSearchConfidence,
  shouldUseLowConfidenceGuidancePrefix,
  buildLowConfidenceGuidancePrefix
} = createVideoSearchConfidenceTools({
  cleanString,
  cleanArray,
  tokenize
});

ensureVideoCatalog({ force: true, maxAgeMs: 0 });

app.post("/api/auth/signup", asyncHandler(async (req, res) => {
  const input = req.body || {};
  const result = platform.signup({
    email: cleanString(input.email),
    password: cleanString(input.password),
    name: cleanString(input.name),
    role: cleanString(input.role)
  });
  platform.trackEvent({
    name: "auth_signup_success",
    userId: result.user.id,
    workspaceId: result.workspaceId,
    properties: { method: "password" }
  });
  res.status(201).json(result);
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const input = req.body || {};
  const result = platform.login({
    email: cleanString(input.email),
    password: cleanString(input.password)
  });
  platform.trackEvent({
    name: "auth_login_success",
    userId: result.user.id,
    workspaceId: result.workspaceId,
    properties: { method: "password" }
  });
  res.json(result);
}));

app.post("/api/auth/google", asyncHandler(async (req, res) => {
  const input = req.body || {};
  const result = platform.loginGoogle({
    email: cleanString(input.email),
    name: cleanString(input.name),
    sub: cleanString(input.sub)
  });
  platform.trackEvent({
    name: "auth_login_success",
    userId: result.user.id,
    workspaceId: result.workspaceId,
    properties: { method: "google" }
  });
  res.json(result);
}));

app.get("/api/auth/google/config", (_req, res) => {
  res.json({
    enabled: Boolean(GOOGLE_CLIENT_ID),
    clientId: GOOGLE_CLIENT_ID || ""
  });
});

app.get("/api/public-config", (_req, res) => {
  res.json({
    gaMeasurementId: GA_MEASUREMENT_ID || "",
    googleSignInEnabled: Boolean(GOOGLE_CLIENT_ID)
  });
});

app.post("/api/auth/google/token", asyncHandler(async (req, res) => {
  const input = req.body || {};
  const idToken = cleanString(input.idToken);
  if (!idToken) {
    res.status(400).json({ error: "Google ID token is required." });
    return;
  }
  if (!GOOGLE_CLIENT_ID) {
    res.status(400).json({ error: "Google sign-in is not configured." });
    return;
  }
  const claims = await verifyGoogleIdToken(idToken, GOOGLE_CLIENT_ID);
  const result = platform.loginGoogle({
    email: cleanString(claims.email),
    name: cleanString(claims.name, cleanString(claims.email).split("@")[0]),
    sub: cleanString(claims.sub)
  });
  platform.trackEvent({
    name: "auth_login_success",
    userId: result.user.id,
    workspaceId: result.workspaceId,
    properties: { method: "google_oauth" }
  });
  res.json(result);
}));

app.post("/api/auth/magic-link/request", asyncHandler(async (req, res) => {
  const input = req.body || {};
  const result = platform.requestMagicLink(cleanString(input.email));
  const origin = deriveRequestOrigin(req);
  const magicLinkUrl = buildMagicLinkUrl(origin, cleanString(result.magicLinkToken));
  const mailResult = await sendMagicLinkEmail({
    toEmail: cleanString(result.email),
    magicLinkUrl,
    expiresInMinutes: Number(result.expiresInMinutes || 15)
  });
  platform.trackEvent({
    name: "auth_magic_link_requested",
    userId: "",
    workspaceId: "",
    properties: {
      email: cleanString(input.email).toLowerCase(),
      deliveryMode: mailResult.mode,
      deliverySent: mailResult.sent
    }
  });
  res.status(201).json({
    ok: true,
    email: cleanString(result.email),
    expiresInMinutes: Number(result.expiresInMinutes || 15),
    expiresAt: cleanString(result.expiresAt),
    simulated: !mailResult.sent,
    magicLinkToken: mailResult.sent ? "" : cleanString(result.magicLinkToken),
    magicLinkUrl: mailResult.sent ? "" : magicLinkUrl,
    detail: mailResult.detail
  });
}));

app.post("/api/auth/magic-link/verify", asyncHandler(async (req, res) => {
  const input = req.body || {};
  const result = platform.verifyMagicLink(cleanString(input.token));
  platform.trackEvent({
    name: "auth_login_success",
    userId: result.user.id,
    workspaceId: result.workspaceId,
    properties: { method: "magic_link" }
  });
  res.json(result);
}));

app.post("/api/auth/guest", asyncHandler(async (_req, res) => {
  let result = null;
  let attempts = 0;
  while (!result && attempts < 5) {
    attempts += 1;
    const nonce = crypto.randomBytes(6).toString("hex");
    try {
      result = platform.signup({
        email: `guest+${nonce}@local.bibleaihub`,
        password: crypto.randomBytes(12).toString("hex"),
        name: `Guest ${nonce.slice(0, 4)}`
      });
    } catch (error) {
      if (Number(error && error.status) === 409) {
        continue;
      }
      throw error;
    }
  }
  if (!result) {
    throw new Error("Unable to initialize guest session.");
  }
  platform.trackEvent({
    name: "auth_signup_success",
    userId: result.user.id,
    workspaceId: result.workspaceId,
    properties: { method: "guest" }
  });
  res.status(201).json(result);
}));

app.post("/api/auth/logout", asyncHandler(async (req, res) => {
  if (req.auth && req.auth.sessionToken) {
    platform.logout(req.auth.sessionToken);
  }
  res.json({ ok: true });
}));

app.post("/api/auth/refresh", asyncHandler(async (req, res) => {
  if (!req.auth || !req.auth.sessionToken) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const refreshed = platform.refreshSession(req.auth.sessionToken);
  res.json({
    ok: true,
    session: {
      token: refreshed.token,
      expiresAt: refreshed.expiresAt
    }
  });
}));

app.post("/api/auth/password-reset/request", asyncHandler(async (req, res) => {
  const input = req.body || {};
  const result = platform.requestPasswordReset(cleanString(input.email));
  res.json(result);
}));

app.post("/api/auth/password-reset/confirm", asyncHandler(async (req, res) => {
  const input = req.body || {};
  const result = platform.resetPassword(
    cleanString(input.token),
    cleanString(input.newPassword)
  );
  res.json(result);
}));

app.get("/api/auth/session", asyncHandler(async (req, res) => {
  if (!req.auth || !req.auth.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const credits = platform.getCreditStatus(req.auth.user.id);
  res.json({
    user: {
      ...req.auth.user,
      credits: credits.credits,
      isGuest: credits.isGuest
    },
    session: {
      token: req.auth.sessionToken,
      expiresAt: req.auth.session && req.auth.session.expiresAt
    },
    workspaces: platform.listWorkspacesForUser(req.auth.user.id),
    activeWorkspaceId: req.auth.workspaceId || platform.getPrimaryWorkspaceIdForUser(req.auth.user.id)
  });
}));

app.delete("/api/auth/account", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const result = platform.deleteAccount(req.auth.user.id);
  res.json(result);
}));

app.post("/api/auth/admin/users/:userId/disable", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const disabled = Boolean((req.body || {}).disabled !== false);
  const user = platform.adminDisableUser(req.auth.user.id, cleanString(req.params.userId), disabled);
  res.json({ user });
}));

app.get("/api/workspaces", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const rows = platform.listWorkspacesForUser(req.auth.user.id);
  res.json({
    workspaces: rows,
    activeWorkspaceId: req.auth.workspaceId || platform.getPrimaryWorkspaceIdForUser(req.auth.user.id)
  });
}));

app.post("/api/workspaces", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspace = platform.createWorkspace(req.auth.user.id, req.body || {});
  res.status(201).json({ workspace });
}));

app.post("/api/workspaces/active", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString((req.body || {}).workspaceId);
  const result = platform.setActiveWorkspace(req.auth.user.id, workspaceId);
  res.json(result);
}));

app.post("/api/workspaces/:workspaceId/members", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.params.workspaceId);
  const input = req.body || {};
  const result = platform.addWorkspaceMember(
    req.auth.user.id,
    workspaceId,
    cleanString(input.email),
    cleanString(input.role, "viewer")
  );
  res.status(201).json(result);
}));

app.patch("/api/workspaces/:workspaceId/members/:userId", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const row = platform.updateWorkspaceMemberRole(
    req.auth.user.id,
    cleanString(req.params.workspaceId),
    cleanString(req.params.userId),
    cleanString((req.body || {}).role)
  );
  res.json({ member: row });
}));

app.get("/api/billing/plans", (_req, res) => {
  res.json({ plans: PLAN_CATALOG });
});

app.post("/api/billing/checkout", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const input = req.body || {};
  const workspaceId = cleanString(input.workspaceId || req.auth.workspaceId);
  const planId = cleanString(input.planId);
  const seats = clampNumber(Number(input.seats || 1), 1, 500, 1);
  const checkout = platform.createCheckout(req.auth.user.id, workspaceId, planId, seats);
  platform.trackEvent({
    name: "subscription_paid",
    userId: req.auth.user.id,
    workspaceId,
    properties: { planId, seats }
  });
  res.json(checkout);
}));

app.post("/api/billing/portal", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString((req.body || {}).workspaceId || req.auth.workspaceId);
  const portal = platform.openBillingPortal(req.auth.user.id, workspaceId);
  res.json(portal);
}));

app.post("/api/billing/webhook", asyncHandler(async (req, res) => {
  const input = req.body || {};
  const result = platform.applyWebhook({
    id: cleanString(input.id),
    eventType: cleanString(input.eventType),
    workspaceId: cleanString(input.workspaceId),
    planId: cleanString(input.planId),
    status: cleanString(input.status),
    seats: input.seats,
    payload: input.payload || {}
  });
  res.json(result);
}));

app.get("/api/entitlements", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  const entitlements = platform.getWorkspaceEntitlements(workspaceId);
  res.json(entitlements);
}));

app.get("/api/entitlements/audit", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  platform.requireWorkspaceRole(req.auth.user.id, workspaceId, ["owner", "editor", "viewer"]);
  res.json({
    workspaceId,
    entries: platform.getEntitlementAudit(workspaceId)
  });
}));

app.post("/api/admin/entitlements/override", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const override = platform.addEntitlementOverride(req.auth.user.id, req.body || {});
  res.status(201).json({ override });
}));

app.get("/api/usage/summary", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  platform.requireWorkspaceRole(req.auth.user.id, workspaceId, ["owner", "editor", "viewer"]);
  res.json(platform.usageSummary(workspaceId));
}));

app.get("/api/usage/forecast", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  platform.requireWorkspaceRole(req.auth.user.id, workspaceId, ["owner", "editor", "viewer"]);
  res.json(platform.usageForecast(workspaceId));
}));

app.get("/api/usage/export", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  platform.requireWorkspaceRole(req.auth.user.id, workspaceId, ["owner", "editor", "viewer"]);
  const rows = platform.getUsageForWorkspace(workspaceId);
  const header = ["id", "requestId", "workspaceId", "userId", "feature", "units", "unitType", "model", "estimatedCostUsd", "createdAt"];
  const csv = [header.join(",")]
    .concat(rows.map((row) => header.map((key) => csvEscape(row[key])).join(",")))
    .join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="usage-${workspaceId}.csv"`);
  res.status(200).send(csv);
}));

app.get("/api/activity", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  const limit = clampNumber(Number(req.query.limit || 60), 1, 300, 60);
  const activity = platform.getWorkspaceActivity({
    workspaceId,
    userId: req.auth.user.id,
    limit
  });
  res.json({
    workspaceId,
    items: activity
  });
}));

app.post("/api/events", asyncHandler(async (req, res) => {
  const input = req.body || {};
  validateTrackedEventName(cleanString(input.name));
  const workspaceId = cleanString(input.workspaceId || (req.auth && req.auth.workspaceId));
  const userId = req.auth && req.auth.user ? req.auth.user.id : "";
  const event = platform.trackEvent({
    name: cleanString(input.name),
    version: Number(input.version || 1),
    userId,
    workspaceId,
    sessionId: cleanString(req.auth && req.auth.sessionToken),
    source: cleanString(input.source || "web"),
    properties: input.properties || {}
  });
  res.status(201).json({ event });
}));

app.get("/api/events/schema", (_req, res) => {
  const schema = getEventTaxonomy();
  res.json(schema);
});

app.get("/api/analytics/activation", asyncHandler(async (req, res) => {
  if (!requireAdminDashboardAccess(req, res)) {
    return;
  }
  const dashboard = platform.getActivationDashboard({
    from: cleanString(req.query.from),
    to: cleanString(req.query.to),
    segment: cleanString(req.query.segment, "all")
  });
  res.json(dashboard);
}));

app.get("/api/analytics/cogs", asyncHandler(async (req, res) => {
  if (!requireAdminDashboardAccess(req, res)) {
    return;
  }
  const dashboard = platform.getCogsDashboard({
    from: cleanString(req.query.from),
    to: cleanString(req.query.to)
  });
  res.json(dashboard);
}));

app.get("/api/content/social-proof", (_req, res) => {
  const canonicalPath = path.join(ROOT_DIR, "server", "data", "social-proof.json");
  const writablePath = resolveWritableAppDataPath("social-proof.json");
  const payload = readJsonFile(canonicalPath, null) || readJsonFile(writablePath, {
    testimonials: [],
    caseStudies: []
  });
  const normalized = normalizeSocialProofPayload(payload, { strict: false });
  const roleOptions = buildSocialProofRoleOptions(normalized);
  res.json({
    ...normalized,
    roleOptions
  });
});

app.post("/api/content/social-proof", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const actor = platform.getUserById(req.auth.user.id);
  if (!actor || actor.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const sourcePath = resolveWritableAppDataPath("social-proof.json");
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const normalized = normalizeSocialProofPayload(payload, { strict: true });
  fs.writeFileSync(sourcePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  res.json({ ok: true });
}));

app.get("/api/product-strategy", (_req, res) => {
  const sourcePath = path.join(ROOT_DIR, "server", "data", "product-strategy.json");
  const payload = readJsonFile(sourcePath, {
    version: 1,
    effectiveDate: "",
    primaryICP: {},
    packaging: {},
    analyzerFairUsePolicy: {},
    proofContentPlan: {}
  });
  res.json(payload);
});

app.post("/api/feedback", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }

  const user = platform.getUserById(req.auth.user.id);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  if (String(cleanString(user.email)).toLowerCase().endsWith("@local.bibleaihub")) {
    res.status(403).json({
      error: "Sign in with email or Google to submit feedback.",
      reasonCode: "guest_feedback_blocked"
    });
    return;
  }

  const input = req.body && typeof req.body === "object" ? req.body : {};
  const message = cleanString(input.message);
  const pagePath = cleanString(input.pagePath, cleanString(req.path));
  const rating = clampNumber(Number(input.rating || 0), 1, 5, 0);
  const sentiment = cleanString(input.sentiment).toLowerCase();
  if (!message || message.length < 8) {
    res.status(400).json({ error: "Please share at least a short feedback message." });
    return;
  }

  const sourcePath = resolveWritableAppDataPath("feedback.json");
  const payload = readJsonFile(sourcePath, {
    inbox: [],
    testimonialQueue: []
  });
  const inbox = Array.isArray(payload.inbox) ? payload.inbox : [];
  const testimonialQueue = Array.isArray(payload.testimonialQueue) ? payload.testimonialQueue : [];
  const isPositive = rating >= 4 || sentiment === "positive";

  const row = {
    id: `feedback_${crypto.randomBytes(8).toString("hex")}`,
    createdAt: new Date().toISOString(),
    pagePath,
    message,
    rating,
    sentiment: sentiment || (isPositive ? "positive" : "neutral"),
    user: {
      id: cleanString(user.id),
      email: cleanString(user.email),
      name: cleanString(user.name),
      workspaceId: cleanString(req.auth.workspaceId)
    },
    routeTo: FEEDBACK_EMAIL
  };
  inbox.push(row);

  if (isPositive) {
    testimonialQueue.push({
      id: `tq_${crypto.randomBytes(8).toString("hex")}`,
      createdAt: row.createdAt,
      pagePath: row.pagePath,
      quote: row.message,
      role: cleanString(user.role, "Ministry Leader"),
      author: cleanString(user.name),
      email: cleanString(user.email),
      sourceFeedbackId: row.id,
      moderationStatus: "pending"
    });
  }

  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, `${JSON.stringify({ inbox, testimonialQueue }, null, 2)}\n`, "utf8");

  platform.trackEvent({
    name: "feedback_submitted",
    userId: req.auth.user.id,
    workspaceId: req.auth.workspaceId,
    properties: {
      pagePath,
      rating,
      sentiment: row.sentiment,
      queuedForTestimonial: isPositive
    }
  });

  res.status(201).json({
    ok: true,
    deliveredTo: FEEDBACK_EMAIL,
    queuedForTestimonial: isPositive
  });
}));

app.patch("/api/how-it-works/prompts/:promptId", asyncHandler(async (req, res) => {
  if (!requireAuth(req, res)) {
    return;
  }

  const actor = platform.getUserById(req.auth.user.id);
  if (!canEditPromptOverrides(actor)) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }

  const promptId = cleanString(req.params.promptId);
  if (!PROMPT_REGISTRY[promptId]) {
    res.status(404).json({ error: "Unknown prompt id." });
    return;
  }

  const input = req.body && typeof req.body === "object" ? req.body : {};
  const resetToDefault = Boolean(input.resetToDefault);
  const hasSystem = Object.prototype.hasOwnProperty.call(input, "system");
  const hasUser = Object.prototype.hasOwnProperty.call(input, "user");
  if (!resetToDefault && !hasSystem && !hasUser) {
    res.status(400).json({ error: "Provide system and/or user prompt text, or set resetToDefault." });
    return;
  }

  const existing = promptOverridesState.prompts[promptId] && typeof promptOverridesState.prompts[promptId] === "object"
    ? { ...promptOverridesState.prompts[promptId] }
    : {};

  if (resetToDefault) {
    delete promptOverridesState.prompts[promptId];
  } else {
    if (hasSystem) {
      const nextSystem = cleanString(input.system);
      if (!nextSystem) {
        res.status(400).json({ error: "System prompt text cannot be empty." });
        return;
      }
      existing.system = nextSystem;
    }
    if (hasUser) {
      const nextUser = cleanString(input.user);
      if (!nextUser) {
        res.status(400).json({ error: "User prompt text cannot be empty." });
        return;
      }
      existing.user = nextUser;
    }
    existing.updatedAt = new Date().toISOString();
    existing.updatedByUserId = cleanString(actor && actor.id);
    existing.updatedByEmail = cleanString(actor && actor.email).toLowerCase();
    promptOverridesState.prompts[promptId] = existing;
  }

  persistPromptOverrides();
  const templates = buildPromptTransparencyTemplates();
  res.json({
    ok: true,
    promptId,
    prompt: templates[promptId] || null,
    override: getPromptOverrideInfo(promptId)
  });
}));

app.get("/api/how-it-works", (req, res) => {
  const actor = req.auth && req.auth.user
    ? (platform.getUserById(req.auth.user.id) || req.auth.user)
    : null;
  res.json(buildHowItWorksPayload({ actor }));
});

app.post("/api/onboarding", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const data = platform.setOnboarding(req.auth.user.id, req.body || {});
  res.json({ onboarding: data });
}));

app.get("/api/onboarding/config", (_req, res) => {
  const sourcePath = path.join(ROOT_DIR, "server", "data", "onboarding-config.json");
  const payload = readJsonFile(sourcePath, {
    questions: [],
    defaultWorkflow: []
  });
  res.json(payload);
});

app.post("/api/onboarding/config", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const actor = platform.getUserById(req.auth.user.id);
  if (!actor || actor.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const sourcePath = path.join(ROOT_DIR, "server", "data", "onboarding-config.json");
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  fs.writeFileSync(sourcePath, `${JSON.stringify({
    questions: Array.isArray(payload.questions) ? payload.questions : [],
    defaultWorkflow: Array.isArray(payload.defaultWorkflow) ? payload.defaultWorkflow : []
  }, null, 2)}\n`, "utf8");
  res.json({ ok: true });
}));

app.get("/api/user/settings", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const user = platform.getUserById(req.auth.user.id);
  res.json({
    emailPrefs: (user && user.emailPrefs) || { lifecycle: true },
    personalization: {
      optOut: Boolean(user && user.personalizationOptOut)
    },
    studyPreferences: {
      theologicalProfile: cleanString(user && user.studyPreferences && user.studyPreferences.theologicalProfile, "text-centered")
    }
  });
}));

app.patch("/api/user/settings", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const user = platform.getUserById(req.auth.user.id);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const input = req.body || {};
  if (input.emailPrefs && typeof input.emailPrefs === "object") {
    user.emailPrefs = {
      ...(user.emailPrefs || { lifecycle: true }),
      lifecycle: input.emailPrefs.lifecycle !== false
    };
  }
  if (input.personalization && typeof input.personalization === "object") {
    user.personalizationOptOut = Boolean(input.personalization.optOut);
  }
  if (input.studyPreferences && typeof input.studyPreferences === "object") {
    const theologicalProfile = cleanString(input.studyPreferences.theologicalProfile, "text-centered");
    user.studyPreferences = {
      ...(user.studyPreferences || {}),
      theologicalProfile
    };
  }
  user.updatedAt = new Date().toISOString();
  platform.persist();
  res.json({
    ok: true,
    emailPrefs: user.emailPrefs,
    personalization: { optOut: Boolean(user.personalizationOptOut) },
    studyPreferences: {
      theologicalProfile: cleanString(user.studyPreferences && user.studyPreferences.theologicalProfile, "text-centered")
    }
  });
}));

app.post("/api/lifecycle/process", asyncHandler(async (req, res) => {
  const notes = platform.processTrialLifecycle();
  res.json({ ok: true, reminders: notes.length });
}));

app.post("/api/coach/drills/complete", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const input = req.body || {};
  const drill = {
    drillId: cleanString(input.drillId),
    date: cleanString(input.date, new Date().toISOString().slice(0, 10)),
    completed: input.completed !== false
  };
  platform.trackEvent({
    name: "coach_drill_completed",
    userId: req.auth.user.id,
    workspaceId: req.auth.workspaceId,
    source: "api",
    properties: drill
  });
  res.json({ ok: true, drill });
}));

app.get("/api/notifications", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const unreadOnly = String(req.query.unread || "").toLowerCase() === "true";
  res.json({
    notifications: platform.listNotifications(req.auth.user.id, unreadOnly)
  });
}));

app.post("/api/notifications/:notificationId/read", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const row = platform.markNotificationRead(req.auth.user.id, cleanString(req.params.notificationId));
  res.json({ notification: row });
}));

app.get("/api/projects", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  const rows = platform.listProjects({
    workspaceId,
    userId: req.auth.user.id,
    q: cleanString(req.query.q),
    sort: cleanString(req.query.sort, "updated_desc")
  });
  res.json({ projects: rows });
}));

app.get("/api/projects/:projectId", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  const project = platform.getProject({
    workspaceId,
    userId: req.auth.user.id,
    projectId: cleanString(req.params.projectId)
  });
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  res.json({ project });
}));

app.post("/api/projects", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const input = req.body || {};
  const workspaceId = cleanString(input.workspaceId || req.auth.workspaceId);
  const project = platform.saveProject({
    workspaceId,
    userId: req.auth.user.id,
    tool: cleanString(input.tool),
    title: cleanString(input.title),
    payload: input.payload || {},
    sourceProjectId: cleanString(input.sourceProjectId)
  });
  res.status(201).json({ project });
}));

app.post("/api/projects/:projectId/exports", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const input = req.body || {};
  const workspaceId = cleanString(input.workspaceId || req.auth.workspaceId);
  const entry = platform.appendProjectExport({
    workspaceId,
    userId: req.auth.user.id,
    projectId: cleanString(req.params.projectId),
    exportType: cleanString(input.exportType),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  });
  res.status(201).json({ export: entry });
}));

app.patch("/api/projects/:projectId", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const input = req.body || {};
  const project = platform.updateProject({
    workspaceId: cleanString(input.workspaceId || req.auth.workspaceId),
    userId: req.auth.user.id,
    projectId: cleanString(req.params.projectId),
    title: cleanString(input.title),
    payload: input.payload || null
  });
  res.json({ project });
}));

app.delete("/api/projects/:projectId", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  const removed = platform.deleteProject({
    workspaceId,
    userId: req.auth.user.id,
    projectId: cleanString(req.params.projectId)
  });
  res.json({ removed });
}));

app.post("/api/handoffs", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const input = req.body || {};
  const workspaceId = cleanString(input.workspaceId || req.auth.workspaceId);
  const handoff = platform.createHandoff({
    workspaceId,
    userId: req.auth.user.id,
    fromTool: cleanString(input.fromTool),
    toTool: cleanString(input.toTool),
    payload: input.payload || {},
    sourceProjectId: cleanString(input.sourceProjectId)
  });
  res.status(201).json({ handoff });
}));

app.get("/api/handoffs/:handoffId", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  const handoff = platform.getHandoff({
    workspaceId,
    userId: req.auth.user.id,
    handoffId: cleanString(req.params.handoffId)
  });
  if (!handoff) {
    res.status(404).json({ error: "Handoff not found." });
    return;
  }
  res.json({ handoff });
}));

app.post("/api/learning-paths", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const input = req.body || {};
  const workspaceId = cleanString(input.workspaceId || req.auth.workspaceId);
  const pathRow = platform.createLearningPath({
    workspaceId,
    userId: req.auth.user.id,
    title: cleanString(input.title),
    items: input.items || []
  });
  res.status(201).json({ path: pathRow });
}));

app.get("/api/learning-paths", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  res.json({
    paths: platform.listLearningPaths({
      workspaceId,
      userId: req.auth.user.id
    })
  });
}));

app.get("/api/learning-paths/:pathId", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  const pathRow = platform.getLearningPath({
    workspaceId,
    userId: req.auth.user.id,
    pathId: cleanString(req.params.pathId)
  });
  if (!pathRow) {
    res.status(404).json({ error: "Learning path not found." });
    return;
  }
  res.json({ path: pathRow });
}));

app.patch("/api/learning-paths/:pathId", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const input = req.body || {};
  const workspaceId = cleanString(input.workspaceId || req.auth.workspaceId);
  const pathRow = platform.updateLearningPath({
    workspaceId,
    userId: req.auth.user.id,
    pathId: cleanString(req.params.pathId),
    patch: input
  });
  res.json({ path: pathRow });
}));

app.delete("/api/learning-paths/:pathId", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  const removed = platform.deleteLearningPath({
    workspaceId,
    userId: req.auth.user.id,
    pathId: cleanString(req.params.pathId)
  });
  res.json({ removed });
}));

app.post("/api/learning-paths/:pathId/share", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString((req.body || {}).workspaceId || req.auth.workspaceId);
  const share = platform.shareLearningPath({
    workspaceId,
    userId: req.auth.user.id,
    pathId: cleanString(req.params.pathId)
  });
  res.json({ share });
}));

app.post("/api/series", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const input = req.body || {};
  const workspaceId = cleanString(input.workspaceId || req.auth.workspaceId);
  const row = platform.createSeries({
    workspaceId,
    userId: req.auth.user.id,
    title: cleanString(input.title),
    startDate: cleanString(input.startDate),
    endDate: cleanString(input.endDate),
    ownerId: cleanString(input.ownerId),
    weeks: Array.isArray(input.weeks) ? input.weeks : []
  });
  res.status(201).json({ series: row });
}));

app.get("/api/series", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  const rows = platform.listSeries({
    workspaceId,
    userId: req.auth.user.id
  });
  res.json({ series: rows });
}));

app.patch("/api/series/:seriesId", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString((req.body || {}).workspaceId || req.auth.workspaceId);
  const row = platform.updateSeries({
    workspaceId,
    userId: req.auth.user.id,
    seriesId: cleanString(req.params.seriesId),
    patch: req.body || {}
  });
  res.json({ series: row });
}));

app.post("/api/video-governance", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const input = req.body || {};
  const videoIds = Array.isArray(input.videoIds) && input.videoIds.length
    ? input.videoIds
    : [input.videoId];
  const rows = videoIds
    .map((videoId) => cleanString(videoId))
    .filter(Boolean)
    .map((videoId) => platform.upsertVideoGovernance(req.auth.user.id, {
      videoId,
      tier: cleanString(input.tier),
      requiredPlans: input.requiredPlans
    }));
  res.status(201).json({
    videoGovernance: rows,
    updated: rows.length
  });
}));

app.get("/api/team/dashboard", asyncHandler(async (req, res) => {
  if (!requireAdminDashboardAccess(req, res)) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  res.json(platform.getTeamDashboard(workspaceId, req.auth.user.id));
}));

app.post("/api/team/seats", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const input = req.body || {};
  const workspaceId = cleanString(input.workspaceId || req.auth.workspaceId);
  const seats = clampNumber(Number(input.seats || 1), 1, 500, 1);
  res.json(platform.updateSeatCount(req.auth.user.id, workspaceId, seats));
}));

app.get("/api/team/invites", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  platform.requireWorkspaceRole(req.auth.user.id, workspaceId, ["owner", "editor", "viewer"]);
  const invites = platform.state.teamInvites
    .filter((invite) => invite.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  res.json({ invites });
}));

app.post("/api/team/invites/:inviteId/accept", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const accepted = platform.acceptInvite(req.auth.user.id, cleanString(req.params.inviteId));
  res.json({ accepted });
}));

app.post("/api/team/app-access", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const input = req.body || {};
  const workspaceId = cleanString(input.workspaceId || req.auth.workspaceId);
  const role = cleanString(input.role, "viewer");
  const tools = Array.isArray(input.tools) ? input.tools : [];
  const matrix = platform.setWorkspaceAppAccess(req.auth.user.id, workspaceId, role, tools);
  res.json({ appAccess: matrix });
}));

app.get("/api/health", (_req, res) => {
  ensureVideoCatalog();
  const stats = getVideoLibraryStats();
  res.json({
    ok: true,
    openaiConfigured: Boolean(OPENAI_API_KEY),
    googleConfigured: Boolean(GOOGLE_CLIENT_ID),
    analyticsConfigured: Boolean(GA_MEASUREMENT_ID),
    chatModel: OPENAI_CHAT_MODEL,
    dashboardModel: OPENAI_DASHBOARD_MODEL,
    embedModel: OPENAI_EMBED_MODEL,
    transcribeModel: OPENAI_TRANSCRIBE_MODEL,
    users: platform.state.users.length,
    workspaces: platform.state.workspaces.length,
    catalogSize: stats.totalVideos,
    transcribedVideos: stats.transcribedVideos,
    pendingVideos: stats.pendingVideos
  });
});

app.get("/api/feature-flags", (req, res) => {
  const evaluated = featureFlags.evaluateAll(buildFeatureFlagContext(req));
  res.json(evaluated);
});

app.get("/api/video-library/status", asyncHandler(async (req, res) => {
  const force = String(req.query.refresh || "").toLowerCase() === "true";
  ensureVideoCatalog({ force });
  const stats = getVideoLibraryStats();

  res.json({
    stats,
    videos: VIDEO_LIBRARY.map((video) => {
      const playbackBaseUrl = resolveVideoPlaybackBaseUrl(video);
      const videoAccess = req.auth && req.auth.workspaceId
        ? platform.canAccessVideo(req.auth.workspaceId, video.id)
        : { allowed: true, tier: "free" };
      return {
        id: video.id,
        title: video.title,
        category: video.category,
        topic: video.topic,
        difficulty: video.difficulty,
        logosVersion: video.logosVersion,
        duration: video.duration,
        durationSeconds: video.durationSeconds,
        transcriptStatus: video.transcriptStatus,
        transcriptionUpdatedAt: video.transcriptionUpdatedAt,
        tags: video.tags,
        sourceAvailable: video.sourceAvailable !== false,
        hostedUrl: cleanString(video.hostedUrl),
        accessTier: videoAccess.tier,
        accessAllowed: videoAccess.allowed,
        accessReasonCode: cleanString(videoAccess.reasonCode),
        playbackUrl: playbackBaseUrl,
        url: buildTimestampedPlaybackUrl(playbackBaseUrl, 0)
      };
    })
  });
}));

app.post("/api/video-library/ingest-next", requireOpenAIKey, asyncHandler(async (req, res) => {
  const input = req.body || {};
  const maxVideos = clampNumber(Number(input.maxVideos || 1), 1, 4, 1);
  const dryRun = Boolean(input.dryRun);
  ensureVideoCatalog({ force: Boolean(input.refreshCatalog), maxAgeMs: 0 });

  const pending = VIDEO_LIBRARY
    .filter((video) => video.transcriptStatus !== "ready")
    .filter((video) => video.sourceAvailable !== false)
    .sort((a, b) => Number(a.durationSeconds || 0) - Number(b.durationSeconds || 0));
  const unavailable = VIDEO_LIBRARY
    .filter((video) => video.transcriptStatus !== "ready")
    .filter((video) => video.sourceAvailable === false)
    .map((video) => ({
      id: video.id,
      title: video.title,
      reason: "Source file is not available on this server instance."
    }));

  if (!pending.length) {
    res.json({
      ok: true,
      message: unavailable.length
        ? "No locally available pending videos. Run ingestion on the machine that has source video files."
        : "No pending videos for ingestion.",
      processed: [],
      failed: [],
      unavailable,
      stats: getVideoLibraryStats()
    });
    return;
  }

  const targets = pending.slice(0, maxVideos);
  if (dryRun) {
    res.json({
      ok: true,
      dryRun: true,
      targets: targets.map((video) => ({
        id: video.id,
        title: video.title,
        duration: video.duration
      })),
      unavailable,
      stats: getVideoLibraryStats()
    });
    return;
  }

  const processed = [];
  const failed = [];

  for (const video of targets) {
    try {
      await ensureVideoTranscriptReady(video.id);
      processed.push({
        id: video.id,
        title: video.title,
        duration: video.duration
      });
    } catch (error) {
      failed.push({
        id: video.id,
        title: video.title,
        error: cleanString(error && error.message, "Transcription failed")
      });
    }
  }

  ensureVideoCatalog({ force: true, maxAgeMs: 0 });
  res.json({
    ok: failed.length === 0,
    processed,
    failed,
    unavailable,
    stats: getVideoLibraryStats()
  });
}));

app.post("/api/ai/bible-study", requireOpenAIKey, requireFeatureAccess("bible-study"), enforceQuota("bible-study"), asyncHandler(async (req, res) => {
  const input = req.body || {};
  const passage = input.passage || {};

  const reference = cleanString(passage.reference || input.reference, "Unknown reference");
  const text = cleanString(passage.text || input.text);
  const focus = cleanString(input.focus);
  const question = cleanString(input.question);
  const theologicalProfile = cleanString(input.theologicalProfile, "text-centered");
  const translation = cleanString(passage.translation_name, "WEB");

  if (!text) {
    res.status(400).json({ error: "Passage text is required." });
    return;
  }

  const profileDirective = theologicalProfile && theologicalProfile !== "text-centered"
    ? `Theological profile: ${theologicalProfile}. Keep charity, textual fidelity, and clear caveats where traditions differ.`
    : "";
  const response = await bibleStudyWorkflow.generateStudy({
    passage: {
      reference,
      text,
      translation
    },
    focus: [focus, profileDirective].filter(Boolean).join("\n"),
    question
  });
  const responseWithEvidence = attachBibleStudyEvidence(response, {
    primaryReference: reference,
    passageText: text,
    theologicalProfile
  });
  recordFeatureUsage(req, "bible-study", {
    unitType: "generation",
    units: 1,
    model: OPENAI_BIBLE_STUDY_MODEL,
    estimatedCostUsd: 0.01
  });
  res.json(responseWithEvidence);
}));

app.post("/api/ai/sermon-preparation", requireOpenAIKey, requireFeatureAccess("sermon-preparation"), enforceQuota("sermon-preparation"), asyncHandler(async (req, res) => {
  const input = req.body || {};
  const passage = input.passage || {};

  const reference = cleanString(passage.reference || input.reference, "Unknown reference");
  const text = cleanString(passage.text || input.text);
  const audience = cleanString(input.audience, "Sunday congregation");
  const minutes = clampNumber(Number(input.minutes || 30), 8, 90, 30);
  const theme = cleanString(input.theme);
  const goal = cleanString(input.goal);
  const styleMode = cleanString(input.styleMode || "expository").toLowerCase();
  const tightenWeakSections = Boolean(input.tightenWeakSections);
  const seriesContext = input.seriesContext && typeof input.seriesContext === "object"
    ? input.seriesContext
    : {};
  const styleDirective = buildStyleDirective(styleMode);
  const continuityDirective = buildSeriesContinuityDirective(seriesContext);
  const augmentedGoal = [goal, styleDirective, continuityDirective].filter(Boolean).join("\n");
  const passageBounds = parsePrimaryPassageBounds(reference);
  const passageBoundaryDiagnostics = {
    enabled: Boolean(passageBounds),
    reference,
    warnings: [],
    inScopeReferences: [],
    outOfScopeReferences: [],
    unknownFormatReferences: []
  };

  const sermonPlanPrompt = buildSermonPreparationPrompt({
    passage: { reference, text },
    audience,
    minutes,
    theme,
    goal: augmentedGoal,
    passageBounds: passageBounds || null
  });
  let ai = await chatJson({
    ...sermonPlanPrompt,
    temperature: 0.4
  });
  const prepQuality = evaluateSermonPreparationDraft(ai, minutes);

  if (prepQuality.shouldRefine) {
    try {
      const sermonRefinerPrompt = buildSermonPreparationRefinementPrompt({
        passage: { reference, text },
        audience,
        minutes,
        theme,
        goal: augmentedGoal,
        draft: ai,
        qualitySignals: prepQuality.signals
      });
      const refined = await chatJson({
        ...sermonRefinerPrompt,
        temperature: 0.24
      });
      if (refined && typeof refined === "object" && Object.keys(refined).length) {
        ai = refined;
      }
    } catch (_) {
      // Keep first-pass draft if optional refinement fails.
    }
  }

  const outline = cleanObjectArray(ai.outline, 4)
    .map((item) => {
      const heading = cleanString(item.heading);
      const referenceAudit = enforceSupportingReferenceBounds(
        cleanArray(item.supportingReferences, 6),
        passageBounds
      );
      for (const inScope of referenceAudit.inScope) {
        passageBoundaryDiagnostics.inScopeReferences.push(inScope);
      }
      for (const outOfScope of referenceAudit.outOfScope) {
        passageBoundaryDiagnostics.outOfScopeReferences.push({
          reference: outOfScope.reference,
          reason: outOfScope.reason,
          heading
        });
      }
      for (const unknown of referenceAudit.unknown) {
        passageBoundaryDiagnostics.unknownFormatReferences.push({
          reference: unknown.reference,
          reason: unknown.reason,
          heading
        });
      }
      return {
        heading,
        explanation: cleanString(item.explanation),
        application: cleanString(item.application),
        supportingReferences: referenceAudit.inScope.slice(0, 4),
        contextualReferences: referenceAudit.outOfScope.map((row) => row.reference).slice(0, 3)
      };
    })
    .filter((item) => item.heading || item.explanation || item.application);

  if (passageBounds && passageBoundaryDiagnostics.outOfScopeReferences.length) {
    passageBoundaryDiagnostics.warnings.push("Some supporting references were outside the requested passage span and moved to contextual notes.");
  }
  if (passageBounds && passageBoundaryDiagnostics.unknownFormatReferences.length) {
    passageBoundaryDiagnostics.warnings.push("Some references could not be parsed for strict boundary checks; review them manually.");
  }

  const timingPlan = cleanObjectArray(ai.timingPlan, 6)
    .map((item) => ({
      segment: cleanString(item.segment),
      minutes: clampNumber(Number(item.minutes), 1, 90, null),
      purpose: cleanString(item.purpose)
    }))
    .filter((item) => item.segment);

  const preachabilityScore = computePreachabilityScore({
    minutes,
    outline,
    transitions: cleanArray(ai.transitions, 8),
    applications: cleanArray(ai.applications, 8),
    illustrations: cleanArray(ai.illustrations, 8),
    timingPlan
  });
  let tighteningPass = {
    applied: false,
    before: [],
    after: [],
    notes: []
  };

  if (tightenWeakSections && preachabilityScore.overall < 8.5) {
    try {
      const tightenPrompt = buildSermonPreparationRefinementPrompt({
        passage: { reference, text },
        audience,
        minutes,
        theme,
        goal: augmentedGoal,
        draft: ai,
        qualitySignals: preachabilityScore.rubric
          .filter((row) => row.score < 8)
          .map((row) => `${row.dimension} needs tightening. ${row.rationale}`)
      });
      const tightened = await chatJson({
        ...tightenPrompt,
        temperature: 0.18
      });
      const tightenedOutline = cleanObjectArray(tightened.outline, 4)
        .map((item) => {
          const referenceAudit = enforceSupportingReferenceBounds(
            cleanArray(item.supportingReferences, 6),
            passageBounds
          );
          return {
            heading: cleanString(item.heading),
            explanation: cleanString(item.explanation),
            application: cleanString(item.application),
            supportingReferences: referenceAudit.inScope.slice(0, 4),
            contextualReferences: referenceAudit.outOfScope.map((row) => row.reference).slice(0, 3)
          };
        })
        .filter((item) => item.heading || item.explanation || item.application);
      if (tightenedOutline.length) {
        tighteningPass = {
          applied: true,
          before: outline.map((item) => item.heading),
          after: tightenedOutline.map((item) => item.heading),
          notes: cleanArray(tightened.transitions, 6)
        };
      }
    } catch (_) {
      // Optional tightening pass; keep baseline result if it fails.
    }
  }

  recordFeatureUsage(req, "sermon-preparation", {
    unitType: "generation",
    units: 1,
    model: OPENAI_CHAT_MODEL,
    estimatedCostUsd: 0.03
  });
  res.json({
    styleMode,
    continuityMemory: summarizeSeriesMemory(seriesContext),
    preachabilityScore,
    tighteningPass,
    bigIdea: cleanString(ai.bigIdea),
    titleOptions: cleanArray(ai.titleOptions, 5),
    outline,
    transitions: cleanArray(ai.transitions, 6),
    applications: cleanArray(ai.applications, 6),
    illustrations: cleanArray(ai.illustrations, 6),
    timingPlan,
    passageBoundary: passageBoundaryDiagnostics
  });
}));

app.post("/api/ai/teaching-tools", requireOpenAIKey, requireFeatureAccess("teaching-tools"), enforceQuota("teaching-tools"), asyncHandler(async (req, res) => {
  const input = req.body || {};

  const sourceTitle = cleanString(input.sourceTitle, "Bible Lesson");
  const passageText = cleanString(input.passageText);
  const audience = cleanString(input.audience, "Adults");
  const requestedAudiences = cleanArray(input.audiences, 3)
    .map((value) => cleanString(value))
    .filter(Boolean);
  const length = clampNumber(Number(input.length || 45), 15, 120, 45);
  const setting = cleanString(input.setting, "Small group");
  const groupSize = clampNumber(Number(input.groupSize || 12), 1, 300, 12);
  const resources = cleanString(input.resources);
  const outcome = cleanString(input.outcome);
  const notes = cleanString(input.notes);
  const audiences = requestedAudiences.length
    ? requestedAudiences
    : [audience];

  async function generateKitForAudience(audienceValue) {
    const teachingKitPrompt = buildTeachingToolsPrompt({
      sourceTitle,
      passageText,
      audience: audienceValue,
      setting,
      groupSize,
      resources,
      length,
      outcome,
      notes
    });
    let ai = await chatJson({
      ...teachingKitPrompt,
      temperature: 0.35,
      model: OPENAI_LONG_FORM_MODEL,
      maxTokens: 1700
    });
    const teachingQuality = evaluateTeachingKitDraft(ai, length);

    if (teachingQuality.shouldRefine) {
      try {
        const teachingRefinerPrompt = buildTeachingToolsRefinementPrompt({
          sourceTitle,
          passageText,
          audience: audienceValue,
          setting,
          groupSize,
          resources,
          length,
          outcome,
          notes,
          draft: ai,
          qualitySignals: teachingQuality.signals
        });
        const refined = await chatJson({
          ...teachingRefinerPrompt,
          temperature: 0.22,
          model: OPENAI_LONG_FORM_MODEL,
          maxTokens: 1800
        });
        if (refined && typeof refined === "object" && Object.keys(refined).length) {
          ai = refined;
        }
      } catch (_) {
        // Keep first-pass draft if optional refinement fails.
      }
    }

    const lessonPlanRaw = ai.lessonPlan && typeof ai.lessonPlan === "object" ? ai.lessonPlan : {};
    const ageRaw = ai.ageAppropriateContent && typeof ai.ageAppropriateContent === "object"
      ? ai.ageAppropriateContent
      : {};
    const dqRaw = ai.discussionQuestions && typeof ai.discussionQuestions === "object"
      ? ai.discussionQuestions
      : {};
    const appRaw = ai.applicationPathways && typeof ai.applicationPathways === "object"
      ? ai.applicationPathways
      : {};

    const sessionTimeline = cleanObjectArray(lessonPlanRaw.sessionTimeline, 8)
      .map((row) => ({
        segment: cleanString(row.segment),
        minutes: clampNumber(Number(row.minutes), 1, 120, null),
        plan: cleanString(row.plan)
      }))
      .filter((row) => row.segment || row.plan);

    const illustrationIdeas = cleanObjectArray(ai.illustrationIdeas, 6)
      .map((row) => ({
        title: cleanString(row.title),
        description: cleanString(row.description),
        connection: cleanString(row.connection)
      }))
      .filter((row) => row.title || row.description);

    return {
      audience: audienceValue,
      overview: cleanString(ai.overview),
      centralTruth: cleanString(ai.centralTruth),
      lessonPlan: {
        title: cleanString(lessonPlanRaw.title),
        keyVerse: cleanString(lessonPlanRaw.keyVerse),
        objectives: cleanArray(lessonPlanRaw.objectives, 7),
        sessionTimeline
      },
      ageAppropriateContent: {
        chosenAudienceExplanation: cleanString(ageRaw.chosenAudienceExplanation),
        simplifiedExplanation: cleanString(ageRaw.simplifiedExplanation),
        vocabularyToExplain: cleanArray(ageRaw.vocabularyToExplain, 8),
        differentiationTips: cleanArray(ageRaw.differentiationTips, 8)
      },
      discussionQuestions: {
        icebreakers: cleanArray(dqRaw.icebreakers, 5),
        observation: cleanArray(dqRaw.observation, 5),
        interpretation: cleanArray(dqRaw.interpretation, 5),
        application: cleanArray(dqRaw.application, 5),
        challenge: cleanArray(dqRaw.challenge, 5)
      },
      illustrationIdeas,
      applicationPathways: {
        personal: cleanArray(appRaw.personal, 6),
        family: cleanArray(appRaw.family, 6),
        church: cleanArray(appRaw.church, 6),
        mission: cleanArray(appRaw.mission, 6)
      },
      visualsAndMedia: cleanArray(ai.visualsAndMedia, 8),
      printableHandout: cleanArray(ai.printableHandout, 10),
      leaderCoaching: cleanArray(ai.leaderCoaching, 8),
      closingPrayerPrompt: cleanString(ai.closingPrayerPrompt),
      takeHomeChallenge: cleanString(ai.takeHomeChallenge),
      exports: {
        markdown: buildTeachingKitMarkdown(sourceTitle, audienceValue, ai),
        handouts: {
          leader: buildTeachingHandout(ai, "leader"),
          student: buildTeachingHandout(ai, "student"),
          parent: buildTeachingHandout(ai, "parent")
        },
        slideOutline: buildSlideOutline(ai)
      }
    };
  }

  const generatedKits = [];
  for (const audienceValue of audiences) {
    generatedKits.push(await generateKitForAudience(audienceValue));
  }
  const primary = generatedKits[0] || {};
  const multiAudienceKits = {};
  for (const kit of generatedKits) {
    multiAudienceKits[kit.audience] = kit;
  }

  recordFeatureUsage(req, "teaching-tools", {
    unitType: "kit",
    units: Math.max(1, generatedKits.length),
    model: OPENAI_LONG_FORM_MODEL,
    estimatedCostUsd: Number((0.045 * Math.max(1, generatedKits.length)).toFixed(4))
  });

  res.json({
    ...primary,
    multiAudience: generatedKits.length > 1,
    selectedAudiences: generatedKits.map((row) => row.audience),
    comparisonSummary: generatedKits.length > 1
      ? generatedKits.map((row) => ({
        audience: row.audience,
        objectiveCount: cleanArray(row.lessonPlan && row.lessonPlan.objectives, 10).length,
        discussionQuestionCount: Object.values(row.discussionQuestions || {})
          .reduce((sum, list) => sum + cleanArray(list, 20).length, 0)
      }))
      : [],
    multiAudienceKits: generatedKits.length > 1 ? multiAudienceKits : {}
  });
}));

app.post("/api/ai/research-helper", requireOpenAIKey, requireFeatureAccess("research-helper"), enforceQuota("research-helper"), asyncHandler(async (req, res) => {
  const input = req.body || {};
  const manuscript = cleanString(input.manuscript);
  const revisionObjective = normalizeRevisionObjective(input.revisionObjective);

  if (!manuscript) {
    res.status(400).json({ error: "Sermon manuscript is required." });
    return;
  }

  const researchPrompt = buildResearchHelperPrompt({
    sermonType: cleanString(input.sermonType, "Expository"),
    targetMinutes: clampNumber(Number(input.targetMinutes || 35), 8, 90, 35),
    revisionObjective,
    diagnostics: input.diagnostics || {},
    manuscript
  });
  let ai = await chatJson({
    ...researchPrompt,
    temperature: 0.35
  });
  const baselineScores = cleanObjectArray(ai.scores, 8)
    .map((row) => ({
      label: cleanString(row.label),
      score: clampNumber(Number(row.score), 0, 10, 0),
      rationale: cleanString(row.rationale)
    }))
    .filter((row) => row.label);
  const baselineRevisions = normalizeResearchHelperGuidanceLines(ai.revisions, {
    objective: revisionObjective,
    max: 14,
    type: "revision"
  });
  const baselineTighten = normalizeResearchHelperGuidanceLines(ai.tightenLines, {
    objective: revisionObjective,
    max: 10,
    type: "tighten"
  });
  const revisionQuality = evaluateResearchHelperDraft({
    ...ai,
    revisions: baselineRevisions,
    tightenLines: baselineTighten
  }, baselineScores, revisionObjective);

  if (revisionQuality.shouldRefine) {
    try {
      const revisionPrompt = buildResearchHelperRevisionPrompt({
        sermonType: cleanString(input.sermonType, "Expository"),
        targetMinutes: clampNumber(Number(input.targetMinutes || 35), 8, 90, 35),
        revisionObjective,
        diagnostics: input.diagnostics || {},
        manuscriptExcerpt: manuscript.slice(0, 12000),
        baseline: {
          overallVerdict: cleanString(ai.overallVerdict),
          scores: baselineScores,
          strengths: cleanArray(ai.strengths, 8),
          gaps: cleanArray(ai.gaps, 9),
          revisions: baselineRevisions.slice(0, 10),
          tightenLines: baselineTighten.slice(0, 7)
        },
        qualitySignals: revisionQuality.signals
      });
      const revisionPack = await chatJson({
        ...revisionPrompt,
        temperature: 0.22,
        model: OPENAI_LONG_FORM_MODEL,
        maxTokens: 1200
      });
      const improvedRevisions = normalizeResearchHelperGuidanceLines(revisionPack.revisions, {
        objective: revisionObjective,
        max: 10,
        type: "revision"
      });
      const improvedTighten = normalizeResearchHelperGuidanceLines(revisionPack.tightenLines, {
        objective: revisionObjective,
        max: 7,
        type: "tighten"
      });
      const currentRevisions = normalizeResearchHelperGuidanceLines(ai.revisions, {
        objective: revisionObjective,
        max: 10,
        type: "revision"
      });
      const currentTighten = normalizeResearchHelperGuidanceLines(ai.tightenLines, {
        objective: revisionObjective,
        max: 7,
        type: "tighten"
      });

      if (improvedRevisions.length >= currentRevisions.length && improvedRevisions.length) {
        ai = { ...ai, revisions: improvedRevisions };
      }
      if (improvedTighten.length >= currentTighten.length && improvedTighten.length) {
        ai = { ...ai, tightenLines: improvedTighten };
      }
      if (!cleanString(ai.overallVerdict)) {
        ai = { ...ai, overallVerdict: cleanString(revisionPack.coachingSummary) };
      }
    } catch (_) {
      // Keep first-pass editorial report if optional refinement fails.
    }
  }

  const scores = cleanObjectArray(ai.scores, 6)
    .map((row) => ({
      label: cleanString(row.label),
      score: clampNumber(Number(row.score), 0, 10, 0),
      rationale: cleanString(row.rationale)
    }))
    .filter((row) => row.label);
  const trendPayload = buildEvaluationTrendPayload(req, scores, manuscript);
  const revisionDelta = trendPayload.delta;
  const normalizedRevisions = normalizeResearchHelperGuidanceLines(ai.revisions, {
    objective: revisionObjective,
    max: 12,
    type: "revision"
  });
  const normalizedTightenLines = normalizeResearchHelperGuidanceLines(ai.tightenLines, {
    objective: revisionObjective,
    max: 8,
    type: "tighten"
  });

  recordFeatureUsage(req, "research-helper", {
    unitType: "evaluation",
    units: 1,
    model: OPENAI_CHAT_MODEL,
    estimatedCostUsd: 0.028
  });
  platform.trackEvent({
    name: "sermon_evaluation_result",
    userId: req.auth.user.id,
    workspaceId: req.auth.workspaceId,
    source: "api",
    properties: trendPayload.eventProperties
  });
  res.json({
    overallVerdict: cleanString(ai.overallVerdict),
    scores,
    strengths: cleanArray(ai.strengths, 6),
    gaps: cleanArray(ai.gaps, 7),
    revisionObjective,
    revisions: normalizedRevisions.slice(0, 8),
    tightenLines: normalizedTightenLines.slice(0, 4),
    trends: trendPayload.trends,
    revisionDelta
  });
}));

app.post("/api/ai/sermon-analyzer", requireOpenAIKey, requireFeatureAccess("sermon-analyzer"), enforceQuota("sermon-analyzer", (req) => estimateAnalyzerMinutes(req)), upload.single("audio"), asyncHandler(async (req, res) => {
  const asyncMode = String((req.body && req.body.asyncMode) || req.query.asyncMode || "").toLowerCase() === "true";

  if (asyncMode) {
    const payload = {
      context: cleanString(req.body && req.body.context, "General sermon context"),
      goal: cleanString(req.body && req.body.goal),
      notes: cleanString(req.body && req.body.notes),
      transcriptOverride: cleanString(req.body && req.body.transcriptOverride),
      localAnalysis: safeJsonParse(req.body && req.body.localAnalysis, {}),
      file: req.file
        ? {
          originalname: cleanString(req.file.originalname),
          mimetype: cleanString(req.file.mimetype),
          bufferBase64: req.file.buffer.toString("base64")
        }
        : null
    };
    if (!payload.file && !payload.transcriptOverride) {
      res.status(400).json({ error: "Upload audio (or provide transcript override) to run sermon analyzer." });
      return;
    }

    const job = platform.createAnalyzerJob({
      workspaceId: req.auth.workspaceId,
      userId: req.auth.user.id,
      payload
    });
    queueSermonAnalyzerJob(job.id);
    res.status(202).json({
      ok: true,
      mode: "async",
      jobId: job.id,
      status: job.status,
      statusUrl: `/api/ai/sermon-analyzer/jobs/${encodeURIComponent(job.id)}`
    });
    return;
  }

  const report = await generateSermonAnalyzerReport({
    file: req.file || null,
    context: cleanString(req.body && req.body.context, "General sermon context"),
    goal: cleanString(req.body && req.body.goal),
    notes: cleanString(req.body && req.body.notes),
    transcriptOverride: cleanString(req.body && req.body.transcriptOverride),
    localAnalysis: safeJsonParse(req.body && req.body.localAnalysis, {})
  });
  const enrichedReport = enrichSermonAnalyzerReportWithCoaching(report, {
    workspaceId: req.auth.workspaceId,
    userId: req.auth.user.id
  });
  recordFeatureUsage(req, "sermon-analyzer", {
    unitType: "audio_minute",
    units: Math.max(1, Math.ceil(Number((enrichedReport.meta.durationSeconds || 60)) / 60)),
    model: OPENAI_TRANSCRIBE_MODEL,
    estimatedCostUsd: Number((Math.max(1, Math.ceil(Number((enrichedReport.meta.durationSeconds || 60)) / 60)) * 0.03).toFixed(4))
  });
  res.json(enrichedReport);
}));

app.get("/api/ai/sermon-analyzer/jobs/:jobId", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const job = platform.getAnalyzerJob(cleanString(req.params.jobId), req.auth.user.id);
  if (!job) {
    res.status(404).json({ error: "Analyzer job not found." });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    retries: job.retries,
    failureReason: cleanString(job.failureReason),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    result: job.status === "completed" ? job.result : null
  });
}));

app.post("/api/ai/sermon-analyzer/jobs/:jobId/retry", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const job = platform.getAnalyzerJob(cleanString(req.params.jobId), req.auth.user.id);
  if (!job) {
    res.status(404).json({ error: "Analyzer job not found." });
    return;
  }
  if (job.status === "processing" || job.status === "queued") {
    res.json({ ok: true, jobId: job.id, status: job.status });
    return;
  }
  platform.updateAnalyzerJob(job.id, {
    status: "queued",
    failureReason: "",
    retries: Number(job.retries || 0) + 1
  });
  queueSermonAnalyzerJob(job.id);
  res.json({ ok: true, jobId: job.id, status: "queued" });
}));

app.post("/api/ai/sermon-analyzer/jobs/:jobId/cancel", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const job = platform.getAnalyzerJob(cleanString(req.params.jobId), req.auth.user.id);
  if (!job) {
    res.status(404).json({ error: "Analyzer job not found." });
    return;
  }
  if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
    res.json({ ok: true, jobId: job.id, status: job.status });
    return;
  }
  for (let idx = sermonAnalyzerQueue.length - 1; idx >= 0; idx -= 1) {
    if (cleanString(sermonAnalyzerQueue[idx]) === cleanString(job.id)) {
      sermonAnalyzerQueue.splice(idx, 1);
    }
  }
  platform.updateAnalyzerJob(job.id, {
    status: "canceled",
    failureReason: "Canceled by user."
  });
  platform.trackEvent({
    name: "mxp_analyzer_job_canceled",
    userId: req.auth.user.id,
    workspaceId: req.auth.workspaceId,
    source: "api",
    properties: {
      jobId: job.id
    }
  });
  res.json({ ok: true, jobId: job.id, status: "canceled" });
}));

app.get("/api/ai/sermon-analyzer/queue-status", asyncHandler(async (req, res) => {
  requireAuth(req, res);
  if (res.headersSent) {
    return;
  }
  const workspaceId = cleanString(req.query.workspaceId || req.auth.workspaceId);
  platform.requireWorkspaceRole(req.auth.user.id, workspaceId, ["owner", "editor", "viewer"]);
  const jobs = platform.state.analyzerJobs.filter((job) => job.workspaceId === workspaceId);
  res.json({
    queueDepth: sermonAnalyzerQueue.length,
    workerRunning: sermonAnalyzerWorkerRunning,
    jobs: jobs.slice(-20).map((job) => ({
      id: job.id,
      status: job.status,
      retries: job.retries,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      failureReason: cleanString(job.failureReason)
    }))
  });
}));

app.post("/api/ai/video-search", requireOpenAIKey, requireFeatureAccess("video-search"), enforceQuota("video-search"), asyncHandler(async (req, res) => {
  const input = req.body || {};
  const query = cleanString(input.query);
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const category = cleanString(input.category || filters.category, "all");
  const difficulty = cleanString(input.difficulty || filters.difficulty, "all");
  const logosVersion = cleanString(input.logosVersion || filters.logosVersion, "all");
  const maxMinutes = clampNumber(Number(input.maxMinutes || filters.maxMinutes || 0), 0, 600, 0);
  const sortMode = cleanString(input.sortMode, "relevance");
  const forceRefresh = Boolean(input.refreshCatalog);
  const autoTranscribe = input.autoTranscribe !== false;
  const requestedMode = cleanString(input.transcribeMode);
  const transcribeMode = requestedMode === "force"
    ? "force"
    : (!autoTranscribe || requestedMode === "skip" || requestedMode === "off")
      ? "skip"
      : "auto";
  const autoTranscribeMaxMinutes = clampNumber(
    Number(input.autoTranscribeMaxMinutes || 35),
    5,
    240,
    35
  );
  const maxAutoTranscribeVideos = clampNumber(
    Number(input.maxAutoTranscribeVideos || (transcribeMode === "force" ? 2 : 1)),
    1,
    4,
    transcribeMode === "force" ? 2 : 1
  );

  if (!query) {
    res.status(400).json({ error: "Enter a search query." });
    return;
  }

  ensureVideoCatalog({ force: forceRefresh });

  const filterSet = { category, difficulty, logosVersion, maxMinutes };
  let filteredRows = applyVideoFilters(VIDEO_LIBRARY, filterSet);
  const preStats = getVideoLibraryStats();
  if (!filteredRows.length) {
    res.json({
      results: [],
      relatedContent: [],
      guidance: "No videos are available for the current filter combination.",
      suggestedQueries: [],
      stats: preStats,
      ingestion: {
        mode: transcribeMode,
        attempted: [],
        completed: [],
        failed: []
      }
    });
    return;
  }

  const ingestion = await transcribeMissingVideosForSearch(filteredRows, {
    mode: transcribeMode,
    autoTranscribeMaxMinutes,
    maxAutoTranscribeVideos
  });

  ensureVideoCatalog({ force: ingestion.completed.length > 0, maxAgeMs: 0 });
  filteredRows = applyVideoFilters(VIDEO_LIBRARY, filterSet);
  if (!filteredRows.length) {
    res.json({
      results: [],
      relatedContent: [],
      guidance: "Filters currently exclude every discovered video.",
      suggestedQueries: [],
      stats: getVideoLibraryStats(),
      ingestion
    });
    return;
  }

  let queryEmbedding = [];
  let corpusEmbeddings = [];
  let semanticSearchEnabled = true;

  try {
    queryEmbedding = await fetchEmbeddings([query]).then((data) => data[0]);
    corpusEmbeddings = await ensureVideoEmbeddings();
  } catch (_) {
    semanticSearchEnabled = false;
  }

  const catalogIndex = new Map(VIDEO_LIBRARY.map((video, idx) => [video.id, idx]));
  const queryTerms = tokenize(query);

  const scored = filteredRows
    .map((video) => {
      const idx = catalogIndex.get(video.id);
      const semantic = semanticSearchEnabled
        ? Math.max(0, cosineSimilarity(queryEmbedding, corpusEmbeddings[idx] || []))
        : 0;
      const lexical = lexicalScoreVideo(video, queryTerms);
      const transcriptBoost = video.transcriptStatus === "ready" ? 0.06 : -0.02;
      const score = semanticSearchEnabled
        ? semantic * 0.76 + lexical * 0.2 + transcriptBoost
        : lexical * 0.88 + (transcriptBoost * 0.5);

      return {
        ...video,
        score,
        semantic,
        lexical
      };
    })
    .filter((row) => row.score > 0.01);

  let sorted = scored;
  if (sortMode === "duration") {
    sorted = [...sorted].sort((a, b) => Number(a.durationSeconds || 0) - Number(b.durationSeconds || 0));
  } else if (sortMode === "title") {
    sorted = [...sorted].sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortMode === "newest") {
    sorted = [...sorted].sort((a, b) => Number(b.fileMtimeMs || 0) - Number(a.fileMtimeMs || 0));
  } else {
    sorted = [...sorted].sort((a, b) => b.score - a.score);
  }

  const topRows = sorted.slice(0, 8);
  const chunkCandidates = topRows.flatMap((video) => buildVideoSearchChunks(video, 26)
    .map((chunk) => ({ ...chunk, video })));
  let chunkEmbeddings = [];
  let chunkSemanticEnabled = semanticSearchEnabled;
  if (chunkSemanticEnabled && chunkCandidates.length) {
    try {
      chunkEmbeddings = await ensureChunkEmbeddings(chunkCandidates);
    } catch (_) {
      chunkSemanticEnabled = false;
    }
  }

  const scoredChunks = chunkCandidates
    .map((chunk, idx) => {
      const semantic = chunkSemanticEnabled
        ? Math.max(0, cosineSimilarity(queryEmbedding, chunkEmbeddings[idx] || []))
        : 0;
      const lexical = lexicalScoreText(chunk.text, queryTerms);
      const chunkScore = chunkSemanticEnabled
        ? semantic * 0.8 + lexical * 0.2
        : lexical;
      const score = (chunk.video.score * 0.3) + (chunkScore * 0.7);

      return {
        ...chunk,
        score,
        chunkScore,
        semantic,
        lexical
      };
    })
    .sort((a, b) => b.score - a.score);

  const videoHitCounter = new Map();
  const results = [];

  for (const row of scoredChunks) {
    const currentCount = Number(videoHitCounter.get(row.video.id) || 0);
    if (currentCount >= 3) {
      continue;
    }

    videoHitCounter.set(row.video.id, currentCount + 1);
    const playbackBaseUrl = resolveVideoPlaybackBaseUrl(row.video);
    const videoAccess = platform.canAccessVideo(req.auth.workspaceId, row.video.id);
    const canPlay = videoAccess.allowed;
    results.push({
      id: `${row.video.id}:${Math.floor(row.start)}`,
      videoId: row.video.id,
      title: row.video.title,
      category: row.video.category,
      topic: row.video.topic,
      difficulty: row.video.difficulty,
      logosVersion: row.video.logosVersion,
      duration: row.video.duration,
      durationSeconds: row.video.durationSeconds,
      transcriptStatus: row.video.transcriptStatus,
      timestamp: formatMediaTimestamp(row.start),
      timestampSeconds: Number(row.start.toFixed(2)),
      endTimestamp: formatMediaTimestamp(row.end),
      endSeconds: Number(row.end.toFixed(2)),
      snippet: cleanString(row.text).slice(0, 420),
      tags: row.video.tags,
      playbackUrl: playbackBaseUrl,
      hostedUrl: cleanString(row.video.hostedUrl),
      sourceAvailable: row.video.sourceAvailable !== false,
      accessTier: videoAccess.tier,
      locked: !canPlay,
      accessReasonCode: cleanString(videoAccess.reasonCode),
      url: canPlay ? buildTimestampedPlaybackUrl(playbackBaseUrl, row.start) : pricingAnchorUrl("premium-video"),
      why: cleanString(buildMatchReason(row, queryTerms)),
      score: Number((row.score * 100).toFixed(2))
    });

    if (results.length >= 12) {
      break;
    }
  }

  if (!results.length) {
    for (const video of topRows) {
      const playbackBaseUrl = resolveVideoPlaybackBaseUrl(video);
      const videoAccess = platform.canAccessVideo(req.auth.workspaceId, video.id);
      const canPlay = videoAccess.allowed;
      results.push({
        id: `${video.id}:0`,
        videoId: video.id,
        title: video.title,
        category: video.category,
        topic: video.topic,
        difficulty: video.difficulty,
        logosVersion: video.logosVersion,
        duration: video.duration,
        durationSeconds: video.durationSeconds,
        transcriptStatus: video.transcriptStatus,
        timestamp: "0:00",
        timestampSeconds: 0,
        endTimestamp: formatMediaTimestamp(Math.min(60, Number(video.durationSeconds || 0))),
        endSeconds: Math.min(60, Number(video.durationSeconds || 0)),
        snippet: cleanString(video.transcriptText || videoSearchDocument(video)).slice(0, 320),
        tags: video.tags,
        playbackUrl: playbackBaseUrl,
        hostedUrl: cleanString(video.hostedUrl),
        sourceAvailable: video.sourceAvailable !== false,
        accessTier: videoAccess.tier,
        locked: !canPlay,
        accessReasonCode: cleanString(videoAccess.reasonCode),
        url: canPlay ? buildTimestampedPlaybackUrl(playbackBaseUrl, 0) : pricingAnchorUrl("premium-video"),
        why: "Matched by title/tags metadata while transcript indexing is still in progress.",
        score: Number((video.score * 100).toFixed(2))
      });
      if (results.length >= 10) {
        break;
      }
    }
  }

  let recovery = {
    diagnosis: "",
    altQueries: [],
    expansionTerms: [],
    strategy: ""
  };

  if (results.length < 3) {
    try {
      const recoveryPrompt = buildVideoSearchRecoveryPrompt({
        query,
        filters: filterSet,
        currentResultCount: results.length,
        topMetadata: topRows.slice(0, 6).map((row) => ({
          title: row.title,
          category: row.category,
          topic: row.topic,
          difficulty: row.difficulty,
          logosVersion: row.logosVersion
        }))
      });
      const recoveryAi = await chatJson({
        ...recoveryPrompt,
        temperature: 0.22
      });
      recovery = {
        diagnosis: cleanString(recoveryAi.diagnosis),
        altQueries: cleanArray(recoveryAi.altQueries, 6),
        expansionTerms: cleanArray(recoveryAi.expansionTerms, 12),
        strategy: cleanString(recoveryAi.strategy)
      };

      const recoveredRows = buildRecoveryResultsFromAltQueries({
        videos: sorted,
        altQueries: recovery.altQueries,
        existingResults: results
      });
      for (const recoveredRow of recoveredRows) {
        results.push(recoveredRow);
        if (results.length >= 12) {
          break;
        }
      }
    } catch (_) {
      recovery = {
        diagnosis: "",
        altQueries: [],
        expansionTerms: [],
        strategy: ""
      };
    }
  }

  const relatedContent = buildRelatedContent(sorted, topRows.map((row) => row.id), queryTerms);
  const searchConfidence = assessVideoSearchConfidence({
    query,
    queryTerms,
    results,
    topRows,
    stats: getVideoLibraryStats(),
    semanticEnabled: chunkSemanticEnabled
  });

  let guidanceText = "";
  let suggestedQueries = [];

  try {
    const guidancePrompt = buildVideoSearchGuidancePrompt({
      query,
      confidence: searchConfidence,
      topMatches: results.slice(0, 6).map((row) => ({
        title: row.title,
        timestamp: row.timestamp,
        category: row.category,
        topic: row.topic,
        difficulty: row.difficulty
      }))
    });
    const guidance = await chatJson({
      ...guidancePrompt,
      temperature: 0.35
    });

    guidanceText = cleanString(guidance.guidance);
    suggestedQueries = cleanArray(guidance.suggestedQueries, 6);
  } catch (_) {
    guidanceText = "";
    suggestedQueries = [];
  }

  if (!guidanceText) {
    guidanceText = buildGuidanceFallback(query, results);
  }
  if (shouldUseLowConfidenceGuidancePrefix(searchConfidence)) {
    guidanceText = buildLowConfidenceGuidancePrefix(searchConfidence, guidanceText);
  }
  if (!suggestedQueries.length) {
    suggestedQueries = buildSuggestedQueriesFallback(query, results);
  }
  if (recovery.altQueries.length) {
    suggestedQueries = Array.from(new Set([
      ...suggestedQueries,
      ...recovery.altQueries
    ])).slice(0, 6);
  }
  if (recovery.strategy && results.length < 5) {
    guidanceText = cleanString(`${guidanceText} ${recovery.strategy}`.trim());
  }

  const personalization = buildVideoPersonalization(req.auth && req.auth.user ? req.auth.user.id : "", query, sorted);
  if (!personalization.optOut && personalization.suggestedQueries.length) {
    suggestedQueries = Array.from(new Set([
      ...suggestedQueries,
      ...personalization.suggestedQueries
    ])).slice(0, 6);
  }
  const personalizedRelated = !personalization.optOut
    ? personalization.relatedContent
    : [];
  const mergedRelated = Array.from(new Map(
    [...relatedContent, ...personalizedRelated]
      .map((item) => [`${cleanString(item.id)}:${cleanString(item.url)}`, item])
  ).values()).slice(0, 8);

  const rankingMode = chunkSemanticEnabled ? "semantic+lexical" : "lexical-fallback";
  recordFeatureUsage(req, "video-search", {
    unitType: "search",
    units: 1,
    model: OPENAI_EMBED_MODEL,
    estimatedCostUsd: 0.004
  });
  res.json({
    stats: getVideoLibraryStats(),
    ingestion,
    filters: filterSet,
    rankingMode,
    confidence: searchConfidence,
    results,
    relatedContent: mergedRelated,
    guidance: guidanceText,
    suggestedQueries,
    recovery,
    personalization: {
      enabled: !personalization.optOut,
      optOut: personalization.optOut
    }
  });
}));

for (const slug of LEGACY_APP_SLUGS) {
  app.get(`/ai/${slug}`, (_req, res) => {
    res.redirect(302, `/ai/apps/${slug}/`);
  });
  app.get(`/ai/${slug}/`, (_req, res) => {
    res.redirect(302, `/ai/apps/${slug}/`);
  });
}

app.get("/ai", (_req, res) => {
  res.redirect(301, "/");
});
app.get("/ai/", (_req, res) => {
  res.redirect(301, "/");
});
app.get("/index.html", (_req, res) => {
  res.redirect(301, "/");
});
app.get("/ai/index.html", (_req, res) => {
  res.redirect(301, "/");
});
app.get("/pricing", (_req, res) => {
  res.redirect(301, PRICING_ANCHOR_URL);
});
app.get("/pricing/", (_req, res) => {
  res.redirect(301, PRICING_ANCHOR_URL);
});
app.get("/ai/apps/:slug/index.html", (req, res) => {
  const slug = cleanString(req.params && req.params.slug);
  if (!slug) {
    res.redirect(301, "/");
    return;
  }
  res.redirect(301, `/ai/apps/${encodeURIComponent(slug)}/`);
});
app.get("/ai/apps/:slug", (req, res, next) => {
  if (String(req.path || "").endsWith("/")) {
    next();
    return;
  }
  const slug = cleanString(req.params && req.params.slug);
  if (!slug) {
    res.redirect(301, "/");
    return;
  }
  res.redirect(301, `/ai/apps/${encodeURIComponent(slug)}/`);
});

app.use(express.static(ROOT_DIR));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Route not found." });
    return;
  }

  res.status(404).sendFile(path.join(ROOT_DIR, "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    const status = OPENAI_API_KEY ? "configured" : "missing";
    console.log(`Bible AI Hub server running on http://localhost:${PORT}`);
    console.log(`OpenAI key status: ${status}`);
  });
}

function resolveRootDir() {
  const candidates = [
    __dirname,
    process.cwd(),
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "..", ".."),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "..", "..")
  ];
  const seen = new Set();

  for (const rawCandidate of candidates) {
    const candidate = path.resolve(rawCandidate);
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    const hasAppShell = fs.existsSync(path.join(candidate, "index.html"))
      && fs.existsSync(path.join(candidate, "ai", "apps"));
    const hasVideoIndex = fs.existsSync(path.join(candidate, "server", "data", "video-library-index.json"));
    if (hasAppShell || hasVideoIndex) {
      return candidate;
    }
  }

  return __dirname;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

module.exports = {
  app
};

function requireOpenAIKey(_req, res, next) {
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: "OPENAI_API_KEY is missing in .env" });
    return;
  }

  next();
}

function resolveAllowedOrigin(origin) {
  const safeOrigin = cleanString(origin);
  if (!safeOrigin) {
    return "";
  }
  if (!API_ALLOWED_ORIGINS.length) {
    return DEFAULT_ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(safeOrigin))
      ? safeOrigin
      : "";
  }
  if (API_ALLOWED_ORIGINS.includes("*")) {
    return safeOrigin;
  }
  if (API_ALLOWED_ORIGINS.includes(safeOrigin)) {
    return safeOrigin;
  }
  return "";
}

function parseSessionToken(req) {
  const authHeader = cleanString(req.headers && req.headers.authorization);
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return cleanString(authHeader.slice(7));
  }
  return cleanString(req.headers && req.headers["x-session-token"]);
}

function attachAuthContext(req, _res, next) {
  const sessionToken = parseSessionToken(req);
  const auth = platform.resolveAuth(sessionToken);
  const headerWorkspace = cleanString(req.headers && req.headers["x-workspace-id"]);
  const workspaceId = cleanString(
    headerWorkspace
      || (auth.user && auth.user.activeWorkspaceId)
      || (auth.user && platform.getPrimaryWorkspaceIdForUser(auth.user.id))
  );

  req.auth = {
    user: auth.user || null,
    session: auth.session || null,
    sessionToken,
    workspaceId
  };
  next();
}

function requireAuth(req, res) {
  if (!req.auth || !req.auth.user) {
    res.status(401).json({
      error: "Authentication required.",
      reasonCode: "unauthenticated"
    });
    return false;
  }
  if (!req.auth.workspaceId) {
    res.status(400).json({
      error: "No active workspace selected.",
      reasonCode: "workspace_required"
    });
    return false;
  }
  return true;
}

function requireAdminDashboardAccess(req, res) {
  if (!requireAuth(req, res)) {
    return false;
  }
  const actor = platform.getUserById(req.auth.user.id);
  if (!actor || cleanString(actor.role).toLowerCase() !== "admin") {
    res.status(403).json({
      error: "Admin access required.",
      reasonCode: "admin_required"
    });
    return false;
  }
  if (!ADMIN_DASHBOARD_PASSWORD) {
    return true;
  }
  const provided = cleanString(req.headers && req.headers["x-admin-dashboard-password"]);
  if (!provided || provided !== ADMIN_DASHBOARD_PASSWORD) {
    res.status(403).json({
      error: "Invalid admin dashboard password.",
      reasonCode: "admin_password_required"
    });
    return false;
  }
  return true;
}

function requireFeatureAccess(feature) {
  return (req, res, next) => {
    if (!requireAuth(req, res)) {
      return;
    }
    if (!platform.roleToolAccessAllowed(req.auth.user.id, req.auth.workspaceId, feature)) {
      res.status(403).json({
        error: "Your workspace role is not allowed to use this tool.",
        reasonCode: "role_not_allowed",
        feature
      });
      return;
    }
    const entitlements = platform.getWorkspaceEntitlements(req.auth.workspaceId);
    if (!entitlements.features[feature]) {
      const upgradePlans = PLAN_CATALOG
        .filter((plan) => plan.features && plan.features[feature])
        .map((plan) => plan.id);
      res.status(403).json({
        error: "Your current plan does not include this feature.",
        reasonCode: "feature_not_in_plan",
        feature,
        upgrade: {
          cta: "Upgrade to access this feature",
          url: pricingAnchorUrl(feature),
          plans: upgradePlans
        }
      });
      return;
    }
    req.entitlements = entitlements;
    next();
  };
}

function enforceQuota(feature, unitsResolver) {
  return (req, res, next) => {
    if (!requireAuth(req, res)) {
      return;
    }
    const unitsRequested = typeof unitsResolver === "function"
      ? Math.max(1, Number(unitsResolver(req) || 1))
      : 1;
    const quota = platform.checkQuota(req.auth.workspaceId, feature, unitsRequested);
    if (!quota.allowed) {
      const overagePolicy = quota && quota.overagePolicy && typeof quota.overagePolicy === "object"
        ? quota.overagePolicy
        : {};
      res.status(403).json({
        error: cleanString(overagePolicy.message, "Usage limit reached for this plan."),
        reasonCode: quota.reasonCode || "quota_exceeded",
        feature,
        resetAt: quota.resetAt,
        overagePolicy,
        usage: {
          used: quota.used || 0,
          requested: quota.requested || unitsRequested,
          limit: quota.limit || 0
        },
        upgrade: {
          cta: "Upgrade your plan to continue",
          url: pricingAnchorUrl(feature),
          plans: quota.upgradePlans || []
        }
      });
      return;
    }

    const credits = platform.checkCredits(req.auth.user.id, 1);
    if (!credits.allowed) {
      res.status(403).json({
        error: "You are out of generation credits. Sign in or upgrade to continue.",
        reasonCode: "credits_exhausted",
        feature,
        credits: {
          remaining: credits.remaining,
          requested: credits.requested,
          unlimited: credits.unlimited
        },
        upgrade: {
          cta: "View plans",
          url: PRICING_ANCHOR_URL
        }
      });
      return;
    }

    req.quota = quota;
    req.credits = credits;
    next();
  };
}

function estimateAnalyzerMinutes(req) {
  const body = req.body || {};
  const localAnalysis = safeJsonParse(body.localAnalysis, {});
  const durationSeconds = Number(localAnalysis.durationSeconds || 0);
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return Math.max(1, Math.ceil(durationSeconds / 60));
  }
  return 1;
}

function recordFeatureUsage(req, feature, row = {}) {
  if (!req.auth || !req.auth.user || !req.auth.workspaceId) {
    return;
  }
  const requestId = createRequestId(req, feature);
  platform.recordUsage({
    requestId,
    workspaceId: req.auth.workspaceId,
    userId: req.auth.user.id,
    feature,
    units: Number(row.units || 1),
    unitType: cleanString(row.unitType, "generation"),
    model: cleanString(row.model),
    estimatedCostUsd: Number(row.estimatedCostUsd || 0),
    metadata: row.metadata || {}
  });
  platform.trackEvent({
    name: "generation_success",
    userId: req.auth.user.id,
    workspaceId: req.auth.workspaceId,
    source: "api",
    properties: {
      feature,
      model: cleanString(row.model),
      units: Number(row.units || 1)
    }
  });
  try {
    platform.consumeCredits(req.auth.user.id, 1);
    const updated = platform.getUserById(req.auth.user.id);
    if (updated && req.auth && req.auth.user) {
      req.auth.user.credits = Number.isFinite(Number(updated.credits)) ? Number(updated.credits) : null;
      req.auth.user.isGuest = cleanString(updated.email).toLowerCase().endsWith("@local.bibleaihub");
    }
  } catch (_) {
    // Credit consumption failures should not break successful generations.
  }
}

function createRequestId(req, feature) {
  const source = [
    cleanString(req.auth && req.auth.user && req.auth.user.id),
    cleanString(feature),
    cleanString(req.path),
    cleanString(req.method),
    String(Date.now()),
    crypto.randomBytes(4).toString("hex")
  ].join(":");
  return `req_${crypto.createHash("sha1").update(source).digest("hex").slice(0, 20)}`;
}

function csvEscape(value) {
  const text = cleanString(value);
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function queueSermonAnalyzerJob(jobId) {
  sermonAnalyzerQueue.push(jobId);
  void runSermonAnalyzerWorker();
}

async function runSermonAnalyzerWorker() {
  if (sermonAnalyzerWorkerRunning) {
    return;
  }
  sermonAnalyzerWorkerRunning = true;
  try {
    while (sermonAnalyzerQueue.length) {
      const jobId = sermonAnalyzerQueue.shift();
      if (!jobId) {
        continue;
      }
      const job = platform.state.analyzerJobs.find((row) => row.id === jobId) || null;
      if (!job || (job.status === "completed")) {
        continue;
      }
      try {
        platform.updateAnalyzerJob(job.id, {
          status: "processing",
          startedAt: new Date().toISOString()
        });
        const file = job.payload && job.payload.file
          ? {
            originalname: cleanString(job.payload.file.originalname),
            mimetype: cleanString(job.payload.file.mimetype),
            buffer: Buffer.from(cleanString(job.payload.file.bufferBase64), "base64")
          }
          : null;
        const report = await generateSermonAnalyzerReport({
          file,
          context: cleanString(job.payload && job.payload.context, "General sermon context"),
          goal: cleanString(job.payload && job.payload.goal),
          notes: cleanString(job.payload && job.payload.notes),
          transcriptOverride: cleanString(job.payload && job.payload.transcriptOverride),
          localAnalysis: (job.payload && job.payload.localAnalysis) || {}
        });
        const enrichedReport = enrichSermonAnalyzerReportWithCoaching(report, {
          workspaceId: cleanString(job.workspaceId),
          userId: cleanString(job.userId)
        });
        platform.recordUsage({
          workspaceId: cleanString(job.workspaceId),
          userId: cleanString(job.userId),
          feature: "sermon-analyzer",
          units: Math.max(1, Math.ceil(Number((enrichedReport.meta.durationSeconds || 60)) / 60)),
          unitType: "audio_minute",
          model: OPENAI_TRANSCRIBE_MODEL,
          estimatedCostUsd: Number((Math.max(1, Math.ceil(Number((enrichedReport.meta.durationSeconds || 60)) / 60)) * 0.03).toFixed(4))
        });
        platform.updateAnalyzerJob(job.id, {
          status: "completed",
          result: enrichedReport,
          failureReason: "",
          completedAt: new Date().toISOString()
        });
      } catch (error) {
        const retries = Number(job.retries || 0);
        const maxRetries = 3;
        if (retries < maxRetries) {
          platform.updateAnalyzerJob(job.id, {
            status: "queued",
            retries: retries + 1,
            failureReason: cleanString(error && error.message)
          });
          sermonAnalyzerQueue.push(job.id);
        } else {
          platform.updateAnalyzerJob(job.id, {
            status: "failed",
            failureReason: cleanString(error && error.message, "Analyzer job failed."),
            completedAt: new Date().toISOString()
          });
        }
      }
    }
  } finally {
    sermonAnalyzerWorkerRunning = false;
  }
}

async function generateSermonAnalyzerReport({ file, context, goal, notes, transcriptOverride, localAnalysis }) {
  const orchestration = [];
  const startedAt = Date.now();
  if (!file && !transcriptOverride) {
    const error = new Error("Upload audio (or provide transcript override) to run sermon analyzer.");
    error.status = 400;
    throw error;
  }

  let transcript;
  const transcriptionStart = Date.now();
  try {
    if (file) {
      transcript = await transcriptionAgent(file);
      let transcriptionStatus = "completed";
      let transcriptionNote = `Model: ${OPENAI_TRANSCRIBE_MODEL}`;
      if (!cleanString(transcript.text) && transcriptOverride) {
        transcript = transcriptFromManualText(transcriptOverride, Number(localAnalysis.durationSeconds || transcript.durationSeconds || 0));
        transcriptionStatus = "degraded";
        transcriptionNote = "Transcription returned empty text, switched to manual transcript override";
      }
      orchestration.push({
        agent: "transcription_agent",
        status: transcriptionStatus,
        durationMs: Date.now() - transcriptionStart,
        note: transcriptionNote
      });
    } else {
      transcript = transcriptFromManualText(transcriptOverride, Number(localAnalysis.durationSeconds || 0));
      orchestration.push({
        agent: "transcription_agent",
        status: "completed",
        durationMs: Date.now() - transcriptionStart,
        note: "Used manual transcript override"
      });
    }
  } catch (error) {
    if (transcriptOverride) {
      transcript = transcriptFromManualText(transcriptOverride, Number(localAnalysis.durationSeconds || 0));
      orchestration.push({
        agent: "transcription_agent",
        status: "degraded",
        durationMs: Date.now() - transcriptionStart,
        note: `Transcription failed, used manual transcript (${cleanString(error.message)})`
      });
    } else {
      throw error;
    }
  }

  const metricProvenance = resolveAnalyzerMetricProvenance({
    file,
    transcript,
    localAnalysis
  });
  const pacingAnalysis = computePacingAnalysis(transcript, localAnalysis, metricProvenance);
  const vocalDynamics = computeVocalDynamics(localAnalysis, metricProvenance);
  const insights = await sermonInsightsAgent({
    context,
    goal,
    notes,
    transcript,
    pacingAnalysis,
    vocalDynamics,
    localAnalysis,
    metricProvenance
  });
  orchestration.push({
    agent: "insights_agent",
    status: "completed",
    durationMs: insights.durationMs,
    note: "Generated emotional arc, content analysis, and coaching feedback"
  });

  return {
    meta: {
      fileName: file ? cleanString(file.originalname) : "manual-transcript",
      durationSeconds: Number((transcript.durationSeconds || 0).toFixed(2)),
      transcriptionModel: OPENAI_TRANSCRIBE_MODEL,
      generatedAt: new Date().toISOString(),
      totalPipelineMs: Date.now() - startedAt,
      metricProvenance
    },
    orchestration,
    transcript: {
      text: cleanString(transcript.text),
      language: cleanString(transcript.language, "unknown"),
      wordCount: tokenize(transcript.text).length,
      segments: transcript.segments
    },
    emotionalArc: {
      points: insights.emotionArc.points,
      summary: cleanString(insights.emotionArc.summary)
    },
    pacingAnalysis,
    vocalDynamics,
    contentAnalysis: insights.contentAnalysis.report,
    coachingFeedback: insights.coaching.report
  };
}

function attachBibleStudyEvidence(response, context = {}) {
  const source = response && typeof response === "object" ? response : {};
  const primaryReference = cleanString(context.primaryReference, "Unknown reference");
  const profile = cleanString(context.theologicalProfile, "text-centered");
  const clear = source.clear && typeof source.clear === "object" ? source.clear : {};
  const withEvidence = {};

  for (const [key, value] of Object.entries(clear)) {
    const stage = value && typeof value === "object" ? value : {};
    const references = findScriptureReferences([
      ...(Array.isArray(stage.aiFindings) ? stage.aiFindings : []),
      ...(Array.isArray(stage.actions) ? stage.actions : []),
      cleanString(stage.stageSummary)
    ].join(" ")).slice(0, 8);
    const citations = Array.from(new Set([primaryReference, ...references])).slice(0, 8).map((reference) => ({
      reference,
      source: reference === primaryReference ? "primary-passage" : "cross-reference"
    }));
    const confidence = inferConfidenceFromStage(stage);
    withEvidence[key] = {
      ...stage,
      evidence: {
        confidence: confidence.level,
        rationale: confidence.rationale,
        citations
      }
    };
  }

  return {
    ...source,
    theologicalProfile: profile,
    clear: withEvidence,
    evidencePanel: {
      exportReady: true,
      notes: [
        "Citations are generated from explicit references in the output and the primary passage.",
        "Confidence labels are heuristic and should be validated through direct textual study."
      ]
    },
    exportPack: {
      markdown: buildBibleStudyMarkdownExport({
        reference: primaryReference,
        profile,
        payload: {
          ...source,
          clear: withEvidence
        }
      }),
      html: buildBibleStudyHtmlExport({
        reference: primaryReference,
        profile,
        payload: {
          ...source,
          clear: withEvidence
        }
      }),
      docText: buildBibleStudyDocTextExport({
        reference: primaryReference,
        profile,
        payload: {
          ...source,
          clear: withEvidence
        }
      }),
      generatedAt: new Date().toISOString()
    }
  };
}

function inferConfidenceFromStage(stage) {
  const signals = {
    findings: cleanArray(stage.aiFindings, 10).length,
    checks: cleanArray(stage.qualityChecks, 10).length,
    cautions: cleanArray(stage.cautions, 10).length
  };
  const score = signals.findings + signals.checks + signals.cautions;
  if (score >= 10) {
    return { level: "high", rationale: "Rich findings, checks, and cautions were generated for this stage." };
  }
  if (score >= 6) {
    return { level: "medium", rationale: "Stage includes usable guidance, but some claims may need tighter verification." };
  }
  return { level: "low", rationale: "Stage output is sparse and should be validated with additional sources." };
}

function buildBibleStudyMarkdownExport({ reference, profile, payload }) {
  const lines = [
    `# Bible Study Pack: ${reference}`,
    "",
    `- Theological profile: ${profile}`,
    `- Generated: ${new Date().toISOString()}`,
    "",
    `## Summary`,
    cleanString(payload && payload.summary, "No summary provided."),
    ""
  ];
  const clear = payload && payload.clear && typeof payload.clear === "object" ? payload.clear : {};
  for (const [key, stage] of Object.entries(clear)) {
    const label = cleanString(stage && stage.label, key);
    lines.push(`## ${label}`);
    lines.push(cleanString(stage && stage.stageSummary, "No stage summary provided."));
    const evidence = stage && stage.evidence && typeof stage.evidence === "object" ? stage.evidence : {};
    lines.push(`- Confidence: ${cleanString(evidence.confidence, "unknown")}`);
    const citations = Array.isArray(evidence.citations) ? evidence.citations : [];
    if (citations.length) {
      lines.push(`- Citations: ${citations.map((row) => cleanString(row.reference)).join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildBibleStudyDocTextExport({ reference, profile, payload }) {
  return [
    `Bible Study Pack: ${reference}`,
    `Theological Profile: ${profile}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    `Summary`,
    cleanString(payload && payload.summary, "No summary provided."),
    "",
    `CLEAR Stages`,
    ...Object.entries(payload && payload.clear && typeof payload.clear === "object" ? payload.clear : {})
      .flatMap(([key, stage]) => [
        `${cleanString(stage && stage.label, key)}: ${cleanString(stage && stage.stageSummary, "No summary.")}`,
        `Confidence: ${cleanString(stage && stage.evidence && stage.evidence.confidence, "unknown")}`,
        `Citations: ${(Array.isArray(stage && stage.evidence && stage.evidence.citations) ? stage.evidence.citations : []).map((row) => cleanString(row.reference)).join(", ")}`,
        ""
      ])
  ].join("\n");
}

function buildBibleStudyHtmlExport({ reference, profile, payload }) {
  const escape = (value) => escapeHtml(value);
  const clear = payload && payload.clear && typeof payload.clear === "object" ? payload.clear : {};
  return [
    "<!doctype html>",
    "<html lang=\"en\"><head><meta charset=\"utf-8\" />",
    `<title>${escape(`Bible Study Pack: ${reference}`)}</title>`,
    "<style>body{font-family:Arial,sans-serif;line-height:1.5;padding:24px;color:#10243a}h1,h2{color:#16385d}section{margin-bottom:20px}small{color:#5b738c}</style>",
    "</head><body>",
    `<h1>${escape(`Bible Study Pack: ${reference}`)}</h1>`,
    `<p><strong>Theological Profile:</strong> ${escape(profile)}</p>`,
    `<p><small>Generated ${escape(new Date().toISOString())}</small></p>`,
    "<section>",
    "<h2>Summary</h2>",
    `<p>${escape(cleanString(payload && payload.summary, "No summary provided."))}</p>`,
    "</section>",
    ...Object.entries(clear).map(([key, stage]) => `
      <section>
        <h2>${escape(cleanString(stage && stage.label, key))}</h2>
        <p>${escape(cleanString(stage && stage.stageSummary, "No summary provided."))}</p>
        <p><strong>Confidence:</strong> ${escape(cleanString(stage && stage.evidence && stage.evidence.confidence, "unknown"))}</p>
        <p><strong>Citations:</strong> ${escape((Array.isArray(stage && stage.evidence && stage.evidence.citations) ? stage.evidence.citations : []).map((row) => cleanString(row.reference)).join(", "))}</p>
      </section>
    `),
    "</body></html>"
  ].join("");
}

function buildStyleDirective(styleMode) {
  const safe = cleanString(styleMode, "expository").toLowerCase();
  if (safe === "narrative") {
    return "Style mode: narrative. Use scene progression, conflict/resolution flow, and story coherence.";
  }
  if (safe === "topical") {
    return "Style mode: topical. Keep points tightly tied to the passage while synthesizing key supporting texts.";
  }
  return "Style mode: expository. Let the passage structure govern the sermon movement.";
}

function buildSeriesContinuityDirective(seriesContext) {
  if (!seriesContext || typeof seriesContext !== "object") {
    return "";
  }
  const title = cleanString(seriesContext.title);
  const week = cleanString(seriesContext.week);
  const priorThemes = cleanArray(seriesContext.priorThemes, 6);
  if (!title && !week && !priorThemes.length) {
    return "";
  }
  return `Series continuity: ${[
    title ? `series title "${title}"` : "",
    week ? `week ${week}` : "",
    priorThemes.length ? `prior themes: ${priorThemes.join("; ")}` : ""
  ].filter(Boolean).join(", ")}.`;
}

function summarizeSeriesMemory(seriesContext) {
  if (!seriesContext || typeof seriesContext !== "object") {
    return { enabled: false, summary: "" };
  }
  const summary = [
    cleanString(seriesContext.title) ? `Series: ${cleanString(seriesContext.title)}` : "",
    cleanString(seriesContext.week) ? `Week: ${cleanString(seriesContext.week)}` : "",
    cleanArray(seriesContext.priorThemes, 6).length ? `Prior themes: ${cleanArray(seriesContext.priorThemes, 6).join(", ")}` : ""
  ].filter(Boolean).join(" | ");
  return {
    enabled: Boolean(summary),
    summary
  };
}

function computePreachabilityScore({ minutes, outline, transitions, applications, illustrations, timingPlan }) {
  const totalPlannedMinutes = (Array.isArray(timingPlan) ? timingPlan : [])
    .reduce((sum, row) => sum + Number(row.minutes || 0), 0);
  const structure = clampNumber((Array.isArray(outline) ? outline.length : 0) * 2.2, 0, 10, 0);
  const transitionScore = clampNumber((Array.isArray(transitions) ? transitions.length : 0) * 1.8, 0, 10, 0);
  const applicationScore = clampNumber((Array.isArray(applications) ? applications.length : 0) * 1.8, 0, 10, 0);
  const illustrationScore = clampNumber((Array.isArray(illustrations) ? illustrations.length : 0) * 1.8, 0, 10, 0);
  const timingVariance = Math.abs(Number(minutes || 0) - totalPlannedMinutes);
  const timingScore = clampNumber(10 - (timingVariance * 0.4), 0, 10, 0);
  const weighted = (
    (structure * 0.24)
    + (transitionScore * 0.16)
    + (applicationScore * 0.24)
    + (illustrationScore * 0.16)
    + (timingScore * 0.2)
  );
  return {
    overall: Number(weighted.toFixed(2)),
    rubric: [
      { dimension: "Structure", score: Number(structure.toFixed(2)), rationale: "Counts coherent movement and explanatory depth." },
      { dimension: "Transitions", score: Number(transitionScore.toFixed(2)), rationale: "Measures movement continuity across sections." },
      { dimension: "Application", score: Number(applicationScore.toFixed(2)), rationale: "Measures concrete congregational response pathways." },
      { dimension: "Illustration", score: Number(illustrationScore.toFixed(2)), rationale: "Measures imagination and listener connection points." },
      { dimension: "Timing", score: Number(timingScore.toFixed(2)), rationale: "Measures fit between target length and segment plan." }
    ]
  };
}

function buildTeachingKitMarkdown(sourceTitle, audience, ai) {
  return [
    `# Teaching Kit: ${sourceTitle}`,
    "",
    `Audience: ${audience}`,
    "",
    `## Overview`,
    cleanString(ai && ai.overview, "No overview provided."),
    "",
    `## Central Truth`,
    cleanString(ai && ai.centralTruth, "No central truth provided."),
    "",
    `## Objectives`,
    ...cleanArray(ai && ai.lessonPlan && ai.lessonPlan.objectives, 8).map((item) => `- ${item}`)
  ].join("\n");
}

function buildTeachingHandout(ai, variant) {
  const objectives = cleanArray(ai && ai.lessonPlan && ai.lessonPlan.objectives, 6);
  const keyVerse = cleanString(ai && ai.lessonPlan && ai.lessonPlan.keyVerse);
  const challenge = cleanString(ai && ai.takeHomeChallenge);
  const prefix = variant === "leader"
    ? "Facilitator notes:"
    : variant === "parent"
      ? "Family follow-up:"
      : "Student handout:";
  return [
    prefix,
    keyVerse ? `Key verse: ${keyVerse}` : "",
    ...objectives.map((item, idx) => `${idx + 1}. ${item}`),
    challenge ? `Challenge: ${challenge}` : ""
  ].filter(Boolean).join("\n");
}

function buildSlideOutline(ai) {
  const timeline = cleanObjectArray(ai && ai.lessonPlan && ai.lessonPlan.sessionTimeline, 12)
    .map((row) => ({
      title: cleanString(row.segment, "Segment"),
      subtitle: cleanString(row.plan),
      minutes: Number(row.minutes || 0)
    }));
  return {
    title: cleanString(ai && ai.lessonPlan && ai.lessonPlan.title, "Lesson Deck"),
    slides: timeline
  };
}

function buildEvaluationTrendPayload(req, scores, manuscript) {
  const workspaceId = req.auth.workspaceId;
  const currentAverage = average(scores.map((row) => Number(row.score || 0)));
  const history = platform.state.events
    .filter((event) => event.name === "sermon_evaluation_result" && event.workspaceId === workspaceId)
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0))
    .slice(-10);
  const pastAverages = history.map((event) => Number(event.properties && event.properties.averageScore || 0));
  const previousAverage = pastAverages.length ? pastAverages[pastAverages.length - 1] : 0;
  const deltaScore = Number((currentAverage - previousAverage).toFixed(2));
  return {
    trends: {
      window: 10,
      averageScore: Number(currentAverage.toFixed(2)),
      previousAverage: Number(previousAverage.toFixed(2)),
      delta: deltaScore,
      series: [...pastAverages.slice(-9), Number(currentAverage.toFixed(2))]
    },
    delta: {
      scoreDelta: deltaScore,
      manuscriptLengthDelta: Number((String(manuscript || "").length - Number((history[history.length - 1] && history[history.length - 1].properties && history[history.length - 1].properties.manuscriptLength) || 0)).toFixed(0))
    },
    eventProperties: {
      averageScore: Number(currentAverage.toFixed(2)),
      manuscriptLength: String(manuscript || "").length,
      scoreLabels: scores.map((row) => row.label),
      scoreValues: scores.map((row) => Number(row.score || 0))
    }
  };
}

function enrichSermonAnalyzerReportWithCoaching(report, context) {
  const base = report && typeof report === "object" ? report : {};
  const pacing = base.pacingAnalysis && typeof base.pacingAnalysis === "object" ? base.pacingAnalysis : {};
  const dynamics = base.vocalDynamics && typeof base.vocalDynamics === "object" ? base.vocalDynamics : {};
  const priorJobs = platform.state.analyzerJobs
    .filter((job) => job.workspaceId === context.workspaceId && job.userId === context.userId && job.status === "completed" && job.result)
    .sort((a, b) => Date.parse(b.completedAt || 0) - Date.parse(a.completedAt || 0));
  const previous = priorJobs[0] ? priorJobs[0].result : null;
  const drills = buildCoachingDrills(pacing, dynamics);
  return {
    ...base,
    coachMode: {
      planDays: 7,
      drills
    },
    comparativeAnalytics: previous
      ? {
        pacingDeltaWpm: Number((Number(pacing.avgWpm || 0) - Number(previous.pacingAnalysis && previous.pacingAnalysis.avgWpm || 0)).toFixed(2)),
        vocalVarietyDelta: Number((Number(dynamics.varietyScore || 0) - Number(previous.vocalDynamics && previous.vocalDynamics.varietyScore || 0)).toFixed(2)),
        clarityDelta: Number((Number((base.contentAnalysis && base.contentAnalysis.gospelClarityScore) || 0) - Number((previous.contentAnalysis && previous.contentAnalysis.gospelClarityScore) || 0)).toFixed(2))
      }
      : {
        pacingDeltaWpm: 0,
        vocalVarietyDelta: 0,
        clarityDelta: 0
      }
  };
}

function buildCoachingDrills(pacing, dynamics) {
  const avgWpm = Number(pacing && pacing.avgWpm || 120);
  return [
    {
      day: 1,
      focus: "Pacing discipline",
      target: "Run a 5-minute segment at target tempo with intentional pauses.",
      metric: `Target WPM band around ${Math.max(100, Math.round(avgWpm - 8))}-${Math.round(avgWpm + 8)}`
    },
    {
      day: 2,
      focus: "Vocal dynamics",
      target: "Practice a paragraph with deliberate contrast in volume and pitch.",
      metric: `Increase variety score beyond ${Math.max(6, Number((Number(dynamics.varietyScore || 6) + 0.5).toFixed(1)))}`
    },
    {
      day: 3,
      focus: "Illustration clarity",
      target: "Rehearse transitions into and out of one illustration.",
      metric: "Record and verify no abrupt transitions."
    },
    {
      day: 4,
      focus: "Scripture emphasis",
      target: "Read key verses with slower cadence and emphasis markers.",
      metric: "At least 3 explicit emphasis moments."
    },
    {
      day: 5,
      focus: "Application urgency",
      target: "Deliver call-to-response section in under 3 minutes.",
      metric: "One specific action call for listeners."
    },
    {
      day: 6,
      focus: "Full run-through",
      target: "Run a 12-minute rehearsal with no notes.",
      metric: "Sustain pacing and vocal variety without drop-off."
    },
    {
      day: 7,
      focus: "Review and compare",
      target: "Record final drill and compare with Day 1 baseline.",
      metric: "Visible improvement in pacing and dynamics."
    }
  ];
}

function buildVideoPersonalization(userId, query, sortedRows) {
  const user = userId ? platform.getUserById(userId) : null;
  const optOut = Boolean(user && user.personalizationOptOut);
  if (!user || optOut) {
    return {
      optOut,
      suggestedQueries: [],
      relatedContent: []
    };
  }
  const history = platform.state.events
    .filter((event) => event.userId === userId)
    .filter((event) => event.name === "generation_success" || event.name === "tool_start")
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .slice(0, 30);
  const recentTerms = tokenize(history.map((event) => cleanString(event.properties && event.properties.feature)).join(" "));
  const queryTerms = tokenize(query);
  const suggestedQueries = Array.from(new Set([
    ...queryTerms.map((term) => `${term} walkthrough`),
    ...recentTerms.slice(0, 3).map((term) => `best ${term} workflow`)
  ])).filter(Boolean).slice(0, 4);
  const relatedContent = (Array.isArray(sortedRows) ? sortedRows : [])
    .filter((row) => recentTerms.some((term) => cleanString(row.topic).toLowerCase().includes(term)))
    .slice(0, 3)
    .map((row) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      duration: row.duration,
      url: buildTimestampedPlaybackUrl(resolveVideoPlaybackBaseUrl(row), 0)
    }));
  return {
    optOut,
    suggestedQueries,
    relatedContent
  };
}

function average(values) {
  const rows = Array.isArray(values) ? values.filter((value) => Number.isFinite(Number(value))) : [];
  if (!rows.length) {
    return 0;
  }
  return rows.reduce((sum, value) => sum + Number(value), 0) / rows.length;
}

function resolveWritableAppDataPath(fileName) {
  const safeName = cleanString(fileName);
  const preferredPath = path.join(ROOT_DIR, "server", "data", safeName);
  const preferredDir = path.dirname(preferredPath);
  try {
    fs.mkdirSync(preferredDir, { recursive: true });
    fs.accessSync(preferredDir, fs.constants.W_OK);
    return preferredPath;
  } catch (_) {
    const fallbackDir = path.join(os.tmpdir(), "bible-ai-hub", "server", "data");
    fs.mkdirSync(fallbackDir, { recursive: true });
    return path.join(fallbackDir, safeName);
  }
}

function readJsonFile(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function normalizePromptOverrideEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const normalized = {};
  if (typeof entry.system === "string") {
    const system = cleanString(entry.system);
    if (system) {
      normalized.system = system;
    }
  }
  if (typeof entry.user === "string") {
    const user = cleanString(entry.user);
    if (user) {
      normalized.user = user;
    }
  }
  if (!normalized.system && !normalized.user) {
    return null;
  }
  normalized.updatedAt = cleanString(entry.updatedAt);
  normalized.updatedByUserId = cleanString(entry.updatedByUserId);
  normalized.updatedByEmail = cleanString(entry.updatedByEmail).toLowerCase();
  return normalized;
}

function normalizePromptOverridesState(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const promptsRaw = source.prompts && typeof source.prompts === "object" ? source.prompts : {};
  const prompts = {};

  for (const [promptId, entry] of Object.entries(promptsRaw)) {
    if (!PROMPT_REGISTRY[promptId]) {
      continue;
    }
    const normalizedEntry = normalizePromptOverrideEntry(entry);
    if (normalizedEntry) {
      prompts[promptId] = normalizedEntry;
    }
  }

  return {
    version: 1,
    updatedAt: cleanString(source.updatedAt),
    prompts
  };
}

function loadPromptOverridesState() {
  const payload = readJsonFile(PROMPT_OVERRIDES_PATH, {
    version: 1,
    updatedAt: "",
    prompts: {}
  });
  return normalizePromptOverridesState(payload);
}

function persistPromptOverrides() {
  promptOverridesState = normalizePromptOverridesState({
    ...(promptOverridesState && typeof promptOverridesState === "object" ? promptOverridesState : {}),
    updatedAt: new Date().toISOString(),
    prompts: promptOverridesState && promptOverridesState.prompts
  });
  fs.writeFileSync(PROMPT_OVERRIDES_PATH, `${JSON.stringify(promptOverridesState, null, 2)}\n`, "utf8");
  return promptOverridesState;
}

function canEditPromptOverrides(actor) {
  const email = cleanString(actor && actor.email).toLowerCase();
  return cleanString(actor && actor.role).toLowerCase() === "admin"
    || email === cleanString(PROMPT_EDITOR_EMAIL).toLowerCase();
}

function resolvePromptOverride(promptId, builtPrompt) {
  const safePromptId = cleanString(promptId);
  const base = builtPrompt && typeof builtPrompt === "object"
    ? builtPrompt
    : {};
  const entry = promptOverridesState && promptOverridesState.prompts
    ? promptOverridesState.prompts[safePromptId]
    : null;
  if (!entry || typeof entry !== "object") {
    return base;
  }
  return {
    ...base,
    system: cleanString(entry.system, cleanString(base.system)),
    user: cleanString(entry.user, cleanString(base.user))
  };
}

function getPromptOverrideInfo(promptId) {
  const safePromptId = cleanString(promptId);
  const entry = promptOverridesState && promptOverridesState.prompts
    ? promptOverridesState.prompts[safePromptId]
    : null;
  if (!entry || typeof entry !== "object") {
    return {
      active: false,
      updatedAt: "",
      updatedByEmail: ""
    };
  }
  return {
    active: true,
    updatedAt: cleanString(entry.updatedAt),
    updatedByEmail: cleanString(entry.updatedByEmail),
    updatedByUserId: cleanString(entry.updatedByUserId)
  };
}

function buildHowItWorksPayload(options = {}) {
  const actor = options && options.actor && typeof options.actor === "object"
    ? options.actor
    : null;
  const canEdit = canEditPromptOverrides(actor);
  const promptTemplates = buildPromptTransparencyTemplates();
  return {
    generatedAt: new Date().toISOString(),
    viewer: {
      email: cleanString(actor && actor.email).toLowerCase(),
      role: cleanString(actor && actor.role),
      canEditPrompts: canEdit
    },
    modelDefaults: {
      primaryChatModel: OPENAI_CHAT_MODEL,
      longFormModel: OPENAI_LONG_FORM_MODEL,
      bibleStudyModel: OPENAI_BIBLE_STUDY_MODEL,
      embeddingModel: OPENAI_EMBED_MODEL,
      transcriptionModel: OPENAI_TRANSCRIBE_MODEL
    },
    apps: [
      {
        slug: "bible-study",
        name: "Bible Study Chat",
        endpoint: "POST /api/ai/bible-study",
        calls: [
          { type: "passage", endpoint: "GET https://bible-api.com/{reference}?translation=web", optional: true, role: "Client passage fetch when the input is a Bible reference." },
          { type: "prompt", promptId: "bible-study.package", optional: false, role: "Primary generation of CLEAR + 10-step package." },
          { type: "prompt", promptId: "bible-study.refiner", optional: true, role: "Quality-gated refinement pass when first draft is weak." }
        ],
        outputUsage: [
          "CLEAR cards and step-by-step workflow are rendered in the app UI.",
          "10-step study method sections are persisted when a project is saved.",
          "Study output can be handed off to Sermon Preparation."
        ]
      },
      {
        slug: "sermon-preparation",
        name: "Sermon Preparation",
        endpoint: "POST /api/ai/sermon-preparation",
        calls: [
          { type: "passage", endpoint: "GET https://bible-api.com/{reference}?translation=web", optional: true, role: "Client-side passage text retrieval." },
          { type: "prompt", promptId: "sermon-preparation.plan", optional: false, role: "Primary sermon plan generation." },
          { type: "prompt", promptId: "sermon-preparation.refiner", optional: true, role: "Refines weak sections and optional tightening pass." }
        ],
        outputUsage: [
          "Big idea, outline, transitions, and timing are displayed for sermon drafting.",
          "Boundary diagnostics are used to flag out-of-scope supporting references.",
          "Plans can be saved and handed off to Sermon Evaluation."
        ]
      },
      {
        slug: "teaching-tools",
        name: "Teaching Tools",
        endpoint: "POST /api/ai/teaching-tools",
        calls: [
          { type: "passage", endpoint: "GET https://bible-api.com/{reference}?translation=web", optional: true, role: "Only used when input is a passage reference." },
          { type: "prompt", promptId: "teaching-tools.kit", optional: false, role: "Primary lesson kit generation per selected audience." },
          { type: "prompt", promptId: "teaching-tools.refiner", optional: true, role: "Refinement pass for timeline/question/application quality." }
        ],
        outputUsage: [
          "Renders full lesson kit cards: objectives, timeline, discussion, illustration, application.",
          "Export payloads generate handouts and slide outlines.",
          "If multi-audience mode is selected, comparison cards are generated."
        ]
      },
      {
        slug: "research-helper",
        name: "Sermon Evaluation",
        endpoint: "POST /api/ai/research-helper",
        calls: [
          { type: "prompt", promptId: "research-helper.evaluation", optional: false, role: "Primary manuscript evaluation and scoring." },
          { type: "prompt", promptId: "research-helper.revision-pack", optional: true, role: "High-impact revision pack when baseline coaching is weak." }
        ],
        outputUsage: [
          "Renders verdict, scorecards, strengths, gaps, revisions, and tighten-lines.",
          "Trend data is charted and can be exported to CSV after generation.",
          "Evaluations can be saved for later revision cycles."
        ]
      },
      {
        slug: "sermon-analyzer",
        name: "Sermon Analyzer",
        endpoint: "POST /api/ai/sermon-analyzer",
        calls: [
          { type: "audio", endpoint: "POST /v1/audio/transcriptions", optional: true, role: "Transcribes uploaded audio when transcript override is not used." },
          { type: "prompt", promptId: "sermon-analyzer.insights", optional: false, role: "Primary multi-signal synthesis (emotion/content/coaching)." },
          { type: "prompt", promptId: "sermon-analyzer.coaching-refiner", optional: true, role: "Refines coaching when actionability is weak." }
        ],
        outputUsage: [
          "Renders transcript table, pacing/vocal/emotional analytics, and coaching cards.",
          "Drill actions are saved through coach drill completion API.",
          "Report text can be copied/saved once generation is complete."
        ]
      },
      {
        slug: "video-search",
        name: "Video Search",
        endpoint: "POST /api/ai/video-search",
        calls: [
          { type: "embedding", endpoint: "POST /v1/embeddings", optional: false, role: "Embeds query and transcript chunks for semantic ranking." },
          { type: "audio", endpoint: "POST /v1/audio/transcriptions", optional: true, role: "Optional ingestion/transcription for videos missing transcripts." },
          { type: "prompt", promptId: "video-search.recovery", optional: true, role: "Recovery strategy prompt when result set is sparse." },
          { type: "prompt", promptId: "video-search.guidance", optional: false, role: "Generates watch-order guidance and suggested follow-up queries." }
        ],
        outputUsage: [
          "Search results include timestamped snippets and direct playback URLs.",
          "Confidence tier influences caution text and recommendation style.",
          "Related content and suggested queries power iterative search."
        ]
      }
    ].map((app) => ({
      ...app,
      promptCalls: app.calls
        .filter((call) => call.type === "prompt")
        .map((call) => ({
          ...call,
          prompt: promptTemplates[call.promptId] || null
        }))
    })),
    promptRegistry: Object.values(PROMPT_REGISTRY).map((prompt) => ({
      id: cleanString(prompt && prompt.id),
      version: cleanString(prompt && prompt.version),
      task: cleanString(prompt && prompt.task)
    }))
  };
}

function buildPromptTransparencyTemplates() {
  const clearDefinitions = CLEAR_METHOD_STAGES.map((stage) => ({
    key: cleanString(stage.key),
    code: cleanString(stage.code),
    label: cleanString(stage.label),
    definition: cleanString(stage.definition)
  }));
  const tenStepMethod = TEN_STEP_STUDY_METHOD.map((step) => ({
    stepNumber: Number(step.stepNumber),
    stepName: cleanString(step.stepName)
  }));

  const sampleBuilders = {
    "bible-study.package": buildBibleStudyPrompt({
      passage: {
        reference: "James 1:19-27",
        text: "Be swift to hear, slow to speak, and slow to anger...",
        translation: "WEB"
      },
      focus: "Faith that obeys",
      question: "How does this passage move listeners from hearing to doing?",
      clearDefinitions,
      tenStepMethod
    }),
    "bible-study.refiner": buildBibleStudyRefinementPrompt({
      passage: {
        reference: "James 1:19-27",
        text: "Be swift to hear, slow to speak, and slow to anger...",
        translation: "WEB"
      },
      focus: "Faith that obeys",
      question: "How does this passage move listeners from hearing to doing?",
      clearDefinitions,
      tenStepMethod,
      draft: {
        summary: "Short draft summary."
      },
      qualitySignals: ["Summary is too thin.", "CLEAR findings are sparse."]
    }),
    "sermon-preparation.plan": buildSermonPreparationPrompt({
      passage: {
        reference: "Romans 12:1-2",
        text: "Present your bodies a living sacrifice...",
        translation_name: "WEB"
      },
      audience: "Sunday congregation",
      minutes: 30,
      theme: "Renewed mind",
      goal: "Move hearers to daily surrender",
      passageBounds: {
        book: "Romans",
        chapter: 12,
        startVerse: 1,
        endVerse: 2
      }
    }),
    "sermon-preparation.refiner": buildSermonPreparationRefinementPrompt({
      passage: {
        reference: "Romans 12:1-2",
        text: "Present your bodies a living sacrifice...",
        translation_name: "WEB"
      },
      audience: "Sunday congregation",
      minutes: 30,
      theme: "Renewed mind",
      goal: "Move hearers to daily surrender",
      draft: {
        bigIdea: "Draft big idea"
      },
      qualitySignals: ["Outline depth is weak.", "Applications are generic."]
    }),
    "teaching-tools.kit": buildTeachingToolsPrompt({
      sourceTitle: "Parable of the Sower",
      passageText: "Matthew 13 focuses on hearing and receiving the word.",
      audience: "Kids (7-11)",
      setting: "Sunday School",
      groupSize: 12,
      resources: "whiteboard, printed handouts",
      length: 45,
      outcome: "Children identify what good soil responses look like.",
      notes: "Mixed maturity levels"
    }),
    "teaching-tools.refiner": buildTeachingToolsRefinementPrompt({
      sourceTitle: "Parable of the Sower",
      passageText: "Matthew 13 focuses on hearing and receiving the word.",
      audience: "Kids (7-11)",
      setting: "Sunday School",
      groupSize: 12,
      resources: "whiteboard, printed handouts",
      length: 45,
      outcome: "Children identify what good soil responses look like.",
      notes: "Mixed maturity levels",
      draft: {
        overview: "Draft overview"
      },
      qualitySignals: ["Timeline realism is weak.", "Discussion depth is thin."]
    }),
    "research-helper.evaluation": buildResearchHelperPrompt({
      sermonType: "Expository",
      targetMinutes: 35,
      revisionObjective: "clarity",
      diagnostics: {
        readability: 58.4,
        sentenceCount: 76
      },
      manuscript: "Today we open James 1 and examine obedience as living faith..."
    }),
    "research-helper.revision-pack": buildResearchHelperRevisionPrompt({
      sermonType: "Expository",
      targetMinutes: 35,
      revisionObjective: "clarity",
      diagnostics: {
        readability: 58.4,
        sentenceCount: 76
      },
      manuscriptExcerpt: "Today we open James 1 and examine obedience as living faith...",
      baseline: {
        overallVerdict: "Draft verdict",
        scores: [
          { label: "Clarity", score: 6.4, rationale: "Transitions are abrupt." }
        ],
        strengths: ["Strong pastoral warmth."],
        gaps: ["Main argument turns are compressed."],
        revisions: ["Clarify movement transitions."],
        tightenLines: ["Shorten sentence chains."]
      },
      qualitySignals: ["Revision rationale is thin."]
    }),
    "video-search.guidance": buildVideoSearchGuidancePrompt({
      query: "How do I run a word study in Logos?",
      confidence: {
        tier: "medium",
        reasonCodes: ["semantic_partial"],
        score: 68
      },
      topMatches: [
        { title: "Word Study Basics", timestamp: "03:12", category: "Bible Study", topic: "Word Study", difficulty: "Beginner" },
        { title: "Advanced Lemma Search", timestamp: "14:05", category: "Bible Study", topic: "Original Languages", difficulty: "Intermediate" }
      ]
    }),
    "video-search.recovery": buildVideoSearchRecoveryPrompt({
      query: "How do I learn Greek morphology quickly?",
      filters: {
        category: "all",
        difficulty: "all",
        logosVersion: "all"
      },
      currentResultCount: 1,
      topMetadata: [
        { title: "Original Language Workflow", category: "Bible Study", topic: "Greek", difficulty: "Intermediate", logosVersion: "10" }
      ]
    }),
    "sermon-analyzer.insights": buildSermonInsightsPrompt({
      context: "Sunday Main Service",
      goal: "Improve pacing and response clarity",
      notes: "Need stronger transitions.",
      transcriptWordCount: 2150,
      transcriptExcerpt: "Church family, today we look at Philippians 2 and the humility of Christ...",
      transcriptBuckets: [
        { bucketId: 1, start: 0, end: 180, text: "Opening movement..." },
        { bucketId: 2, start: 180, end: 360, text: "Second movement..." }
      ],
      regexReferences: ["Philippians 2:1-11"],
      pacingAnalysis: {
        avgWpm: 151,
        targetBandWpm: "120-150",
        fastSections: [{ start: 300, end: 360, wpm: 174 }],
        slowSections: [{ start: 90, end: 120, wpm: 108 }],
        pauseCount: 26,
        pauseTimeSec: 48.2,
        rhythmScore: 6.7
      },
      vocalDynamics: {
        avgDb: -20.4,
        peakDb: -4.2,
        dynamicRangeDb: 9.4,
        pitchStdHz: 28.1,
        pitchRangeHz: 116.3,
        varietyScore: 71,
        monotoneRiskScore: 34,
        monotoneSections: [{ start: 640, end: 690, duration: 50 }]
      },
      metricProvenance: {
        pacing: { source: "audio" },
        vocalDynamics: { source: "audio" }
      }
    }),
    "sermon-analyzer.coaching-refiner": buildSermonCoachingRefinementPrompt({
      context: "Sunday Main Service",
      goal: "Improve pacing and response clarity",
      notes: "Need stronger transitions.",
      transcriptWordCount: 2150,
      transcriptExcerpt: "Church family, today we look at Philippians 2 and the humility of Christ...",
      pacingAnalysis: {
        avgWpm: 151,
        targetBandWpm: "120-150",
        fastSections: [{ start: 300, end: 360, wpm: 174 }],
        slowSections: [{ start: 90, end: 120, wpm: 108 }],
        pauseCount: 26,
        pauseTimeSec: 48.2,
        rhythmScore: 6.7
      },
      vocalDynamics: {
        avgDb: -20.4,
        peakDb: -4.2,
        dynamicRangeDb: 9.4,
        pitchStdHz: 28.1,
        pitchRangeHz: 116.3,
        varietyScore: 71,
        monotoneRiskScore: 34,
        monotoneSections: [{ start: 640, end: 690, duration: 50 }]
      },
      baseline: {
        emotionalArcSummary: "Draft emotional summary",
        contentAnalysis: {
          summary: "Draft content analysis",
          keyThemes: ["Humility", "Service"],
          structureMovements: ["Christ's humility", "Believer response"],
          callsToAction: ["Repent", "Serve"]
        },
        coachingFeedback: {
          executiveSummary: "Draft coaching summary"
        }
      },
      qualitySignals: ["Priority actions are too generic."]
    })
  };

  const output = {};
  for (const [promptId, builtPrompt] of Object.entries(sampleBuilders)) {
    output[promptId] = buildPromptTemplateEntry(promptId, builtPrompt);
  }
  return output;
}

function buildPromptTemplateEntry(promptId, builtPrompt) {
  const meta = PROMPT_REGISTRY[promptId] || {};
  const outputSchema = meta && meta.outputSchema && typeof meta.outputSchema === "object"
    ? meta.outputSchema
    : {};
  const override = getPromptOverrideInfo(promptId);
  return {
    id: cleanString(promptId),
    version: cleanString(meta.version),
    task: cleanString(meta.task),
    system: cleanString(builtPrompt && builtPrompt.system),
    user: cleanString(builtPrompt && builtPrompt.user),
    responseShape: outputSchema,
    responseExample: buildSchemaExample(outputSchema),
    override
  };
}

function buildSchemaExample(schema) {
  if (Array.isArray(schema)) {
    if (!schema.length) {
      return [];
    }
    return [buildSchemaExample(schema[0])];
  }
  if (!schema || typeof schema !== "object") {
    const token = cleanString(schema).toLowerCase();
    if (token === "string") {
      return "example text";
    }
    if (token === "number") {
      return 0;
    }
    if (token === "boolean") {
      return true;
    }
    if (/^\d+$/.test(token)) {
      return Number(token);
    }
    if (token.includes("|")) {
      return cleanString(token.split("|")[0]);
    }
    return cleanString(schema);
  }

  const output = {};
  for (const [key, value] of Object.entries(schema)) {
    output[key] = buildSchemaExample(value);
  }
  return output;
}

function buildFeatureFlagContext(req) {
  const user = req && req.auth && req.auth.user ? req.auth.user : null;
  const workspaceId = cleanString(req && req.auth && req.auth.workspaceId);
  const ip = cleanString(req && (req.ip || req.headers && req.headers["x-forwarded-for"]));
  return {
    userId: cleanString(user && user.id),
    workspaceId,
    role: cleanString(user && user.role),
    email: cleanString(user && user.email).toLowerCase(),
    ip,
    sessionToken: parseSessionToken(req),
    cohortSeed: cleanString(
      user && user.id,
      workspaceId || ip || "anonymous"
    )
  };
}

function createBadRequestError(message) {
  const error = new Error(cleanString(message, "Invalid request payload."));
  error.status = 400;
  return error;
}

function normalizeSocialProofPayload(value, { strict = false } = {}) {
  const payload = value && typeof value === "object" ? value : {};
  const testimonials = cleanObjectArray(payload.testimonials, 80)
    .map((row, index) => normalizeTestimonialRow(row, { strict, index }))
    .filter(Boolean);
  const caseStudies = cleanObjectArray(payload.caseStudies, 80)
    .map((row, index) => normalizeCaseStudyRow(row, { strict, index }))
    .filter(Boolean);

  if (strict && !testimonials.length && !caseStudies.length) {
    throw createBadRequestError("Provide at least one testimonial or case study.");
  }

  return {
    testimonials,
    caseStudies
  };
}

function normalizeSocialProofRoleLabel(value) {
  const raw = cleanString(value).toLowerCase();
  if (!raw) {
    return "";
  }
  if (raw.includes("pastor")) {
    return "Pastor";
  }
  if (raw.includes("teacher")) {
    return "Teacher";
  }
  if (raw.includes("team") || raw.includes("staff") || raw.includes("lead")) {
    return "Team Lead";
  }
  return cleanString(value);
}

function normalizeSocialProofAttribution(value, { strict = false, label = "entry" } = {}) {
  const attribution = value && typeof value === "object" ? value : {};
  const source = cleanString(attribution.source);
  const sourceUrl = cleanString(attribution.sourceUrl);
  const verifiedAt = normalizeIsoDate(cleanString(attribution.verifiedAt));

  if (strict) {
    if (!source) {
      throw createBadRequestError(`${label} attribution.source is required.`);
    }
    if (!sourceUrl) {
      throw createBadRequestError(`${label} attribution.sourceUrl is required.`);
    }
    if (!verifiedAt) {
      throw createBadRequestError(`${label} attribution.verifiedAt must be a valid date.`);
    }
  }

  return {
    source: source || "Internal customer interview",
    sourceUrl: sourceUrl || "https://hiredalmo.com/",
    verifiedAt: verifiedAt || new Date().toISOString().slice(0, 10)
  };
}

function normalizeIsoDate(value) {
  const safe = cleanString(value);
  if (!safe) {
    return "";
  }
  const parsed = Date.parse(safe);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeTestimonialRow(value, { strict = false, index = 0 } = {}) {
  const row = value && typeof value === "object" ? value : {};
  const role = normalizeSocialProofRoleLabel(row.role);
  const quote = cleanString(row.quote);
  const outcome = cleanString(row.outcome);
  const attribution = normalizeSocialProofAttribution(row.attribution, {
    strict,
    label: `testimonial[${index}]`
  });

  if (strict) {
    if (!role) {
      throw createBadRequestError(`testimonial[${index}].role is required.`);
    }
    if (!quote || quote.length < 20) {
      throw createBadRequestError(`testimonial[${index}].quote must be at least 20 characters.`);
    }
    if (!outcome) {
      throw createBadRequestError(`testimonial[${index}].outcome is required.`);
    }
  }

  if (!role && !quote && !outcome) {
    return null;
  }

  return {
    role: role || "Pastor",
    quote,
    outcome,
    attribution
  };
}

function normalizeCaseStudyRow(value, { strict = false, index = 0 } = {}) {
  const row = value && typeof value === "object" ? value : {};
  const role = normalizeSocialProofRoleLabel(row.role);
  const title = cleanString(row.title);
  const summary = cleanString(row.summary);
  const attribution = normalizeSocialProofAttribution(row.attribution, {
    strict,
    label: `caseStudies[${index}]`
  });

  if (strict) {
    if (!role) {
      throw createBadRequestError(`caseStudies[${index}].role is required.`);
    }
    if (!title) {
      throw createBadRequestError(`caseStudies[${index}].title is required.`);
    }
    if (!summary || summary.length < 20) {
      throw createBadRequestError(`caseStudies[${index}].summary must be at least 20 characters.`);
    }
  }

  if (!role && !title && !summary) {
    return null;
  }

  return {
    role: role || "Pastor",
    title,
    summary,
    attribution
  };
}

function buildSocialProofRoleOptions(payload) {
  const normalized = payload && typeof payload === "object" ? payload : {};
  const roles = new Set();

  for (const row of cleanObjectArray(normalized.testimonials, 120)) {
    const role = normalizeSocialProofRoleLabel(row.role);
    if (role) {
      roles.add(role);
    }
  }
  for (const row of cleanObjectArray(normalized.caseStudies, 120)) {
    const role = normalizeSocialProofRoleLabel(row.role);
    if (role) {
      roles.add(role);
    }
  }

  const preferredOrder = ["Pastor", "Teacher", "Team Lead"];
  const sorted = Array.from(roles).sort((a, b) => {
    const aRank = preferredOrder.indexOf(a);
    const bRank = preferredOrder.indexOf(b);
    if (aRank >= 0 && bRank >= 0) {
      return aRank - bRank;
    }
    if (aRank >= 0) {
      return -1;
    }
    if (bRank >= 0) {
      return 1;
    }
    return a.localeCompare(b);
  });

  return sorted.length ? sorted : preferredOrder;
}

function getEventTaxonomy() {
  if (EVENT_TAXONOMY_CACHE && Array.isArray(EVENT_TAXONOMY_CACHE.events)) {
    return EVENT_TAXONOMY_CACHE;
  }
  EVENT_TAXONOMY_CACHE = readJsonFile(EVENT_TAXONOMY_PATH, {
    version: 1,
    events: [],
    requiredFields: ["name", "source", "properties"]
  });
  if (!Array.isArray(EVENT_TAXONOMY_CACHE.events)) {
    EVENT_TAXONOMY_CACHE.events = [];
  }
  return EVENT_TAXONOMY_CACHE;
}

function validateTrackedEventName(name) {
  const cleanName = cleanString(name);
  if (!cleanName) {
    return;
  }
  const taxonomy = getEventTaxonomy();
  const known = new Set((taxonomy.events || []).map((item) => cleanString(item)).filter(Boolean));
  if (!known.size) {
    return;
  }
  if (known.has(cleanName) || cleanName.startsWith("mxp_")) {
    return;
  }
  const error = new Error(`Event '${cleanName}' is not in taxonomy.`);
  error.status = 400;
  throw error;
}

function findScriptureReferences(text) {
  const pattern = /\b(?:[1-3]\s*)?[A-Z][a-z]+\s+\d{1,3}(?::\d{1,3}(?:-\d{1,3})?)?/g;
  return cleanArray(String(text || "").match(pattern) || [], 30);
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      const message = cleanString(error && error.message, "Unexpected server error");
      const status = error && error.status ? error.status : 500;
      if (req && req.path && req.path.startsWith("/api/ai/") && req.auth && req.auth.user) {
        try {
          platform.trackEvent({
            name: "generation_failure",
            userId: req.auth.user.id,
            workspaceId: req.auth.workspaceId,
            source: "api",
            properties: {
              path: req.path,
              status,
              message
            }
          });
        } catch (_) {
          // Event failures should never block API responses.
        }
      }
      res.status(status).json({ error: message });
    });
  };
}

async function chatJson({ system, user, temperature = 0.3, model = OPENAI_CHAT_MODEL, maxTokens = 0 }) {
  const payload = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature,
    response_format: { type: "json_object" }
  };
  if (Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0) {
    payload.max_tokens = Math.floor(Number(maxTokens));
  }

  const data = await openAIRequest("/chat/completions", payload);
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "{}";

  return parseJsonObject(content);
}

async function fetchEmbeddings(texts) {
  const payload = {
    model: OPENAI_EMBED_MODEL,
    input: texts
  };

  const data = await openAIRequest("/embeddings", payload);
  return Array.isArray(data.data) ? data.data.map((item) => item.embedding || []) : [];
}

async function fetchEmbeddingsInBatches(texts, batchSize = 64) {
  const rows = Array.isArray(texts) ? texts : [];
  if (!rows.length) {
    return [];
  }

  const output = [];
  for (let idx = 0; idx < rows.length; idx += batchSize) {
    const batch = rows.slice(idx, idx + batchSize);
    const vectors = await fetchEmbeddings(batch);
    for (const vector of vectors) {
      output.push(vector || []);
    }
  }

  return output;
}

function buildCatalogCacheKey(rows) {
  return `${OPENAI_EMBED_MODEL}|${rows
    .map((row) => [
      cleanString(row.id),
      Number(row.fileMtimeMs || 0),
      cleanString(row.transcriptionUpdatedAt),
      cleanString(row.transcriptStatus)
    ].join(":"))
    .join("|")}`;
}

function ensureVideoCatalog(options = {}) {
  const before = buildCatalogCacheKey(VIDEO_LIBRARY);
  hydrateVideoLibrary(ROOT_DIR, options);
  const after = buildCatalogCacheKey(VIDEO_LIBRARY);

  if (before !== after) {
    videoEmbeddingCache = { key: "", vectors: [] };
    segmentEmbeddingCache.clear();
  }

  return VIDEO_LIBRARY;
}

async function ensureVideoEmbeddings() {
  ensureVideoCatalog();
  const key = buildCatalogCacheKey(VIDEO_LIBRARY);

  if (
    videoEmbeddingCache.key === key
    && Array.isArray(videoEmbeddingCache.vectors)
    && videoEmbeddingCache.vectors.length === VIDEO_LIBRARY.length
  ) {
    return videoEmbeddingCache.vectors;
  }

  const docs = VIDEO_LIBRARY.map((video) => videoSearchDocument(video));
  const vectors = await fetchEmbeddingsInBatches(docs, 48);
  videoEmbeddingCache = { key, vectors };
  return vectors;
}

function applyVideoFilters(videos, filters) {
  const category = cleanString(filters.category, "all").toLowerCase();
  const difficulty = cleanString(filters.difficulty, "all").toLowerCase();
  const logosVersion = cleanString(filters.logosVersion, "all").toLowerCase();
  const maxMinutes = Number(filters.maxMinutes || 0);

  return videos.filter((video) => {
    if (category !== "all" && cleanString(video.category).toLowerCase() !== category) {
      return false;
    }
    if (difficulty !== "all" && cleanString(video.difficulty).toLowerCase() !== difficulty) {
      return false;
    }
    if (logosVersion !== "all" && cleanString(video.logosVersion).toLowerCase() !== logosVersion) {
      return false;
    }
    if (maxMinutes > 0) {
      const minutes = Number(video.durationSeconds || durationToSeconds(video.duration || 0)) / 60;
      if (minutes > maxMinutes) {
        return false;
      }
    }
    return true;
  });
}

async function transcribeMissingVideosForSearch(videos, options) {
  const mode = cleanString(options.mode, "auto");
  const autoTranscribeMaxMinutes = Number(options.autoTranscribeMaxMinutes || 35);
  const maxAutoTranscribeVideos = Number(options.maxAutoTranscribeVideos || 1);
  const pending = videos
    .filter((video) => video.transcriptStatus !== "ready")
    .filter((video) => video.sourceAvailable !== false);
  const unavailable = videos
    .filter((video) => video.transcriptStatus !== "ready")
    .filter((video) => video.sourceAvailable === false)
    .map((video) => ({
      id: video.id,
      title: video.title,
      reason: "Source video unavailable on this server."
    }));
  const attempted = [];
  const completed = [];
  const failed = [];

  if (!pending.length || mode === "skip") {
    return {
      mode,
      attempted,
      completed,
      failed,
      unavailable
    };
  }

  const sortedPending = [...pending].sort((a, b) => Number(a.durationSeconds || 0) - Number(b.durationSeconds || 0));
  let candidates = [];

  if (mode === "force") {
    candidates = sortedPending.slice(0, maxAutoTranscribeVideos);
  } else {
    const shortOnly = sortedPending.filter((video) => (Number(video.durationSeconds || 0) / 60) <= autoTranscribeMaxMinutes);
    candidates = shortOnly.slice(0, Math.max(1, maxAutoTranscribeVideos));
  }

  for (const video of candidates) {
    attempted.push({
      id: video.id,
      title: video.title,
      duration: video.duration
    });

    try {
      await ensureVideoTranscriptReady(video.id);
      completed.push({
        id: video.id,
        title: video.title
      });
    } catch (error) {
      failed.push({
        id: video.id,
        title: video.title,
        error: cleanString(error && error.message, "Transcription failed")
      });
    }
  }

  return {
    mode,
    attempted,
    completed,
    failed,
    unavailable
  };
}

async function ensureVideoTranscriptReady(videoId) {
  const id = cleanString(videoId);
  ensureVideoCatalog();
  const row = VIDEO_LIBRARY.find((video) => cleanString(video.id) === id);
  if (!row) {
    throw new Error("Video not found in library.");
  }

  if (row.transcriptStatus === "ready" && cleanString(row.transcriptText)) {
    return row;
  }

  if (row.sourceAvailable === false) {
    throw new Error("Video source is not available on this server. Run local ingestion before deployment.");
  }

  if (videoTranscriptionJobs.has(id)) {
    return videoTranscriptionJobs.get(id);
  }

  const job = (async () => {
    try {
      const transcript = await transcribeVideoFile(row);
      const updated = setVideoTranscript(id, transcript, ROOT_DIR);
      videoEmbeddingCache = { key: "", vectors: [] };
      segmentEmbeddingCache.clear();
      return updated || row;
    } catch (error) {
      setVideoTranscriptionError(id, cleanString(error && error.message, "Transcription failed"), ROOT_DIR);
      throw error;
    }
  })();

  videoTranscriptionJobs.set(id, job);
  try {
    return await job;
  } finally {
    videoTranscriptionJobs.delete(id);
  }
}

async function transcribeVideoFile(video) {
  const absolutePath = path.join(ROOT_DIR, cleanString(video.relativePath));
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Video file does not exist: ${absolutePath}`);
  }

  const probedDuration = probeDurationSeconds(absolutePath);
  const durationSeconds = Math.max(Number(video.durationSeconds || 0), probedDuration || 0);
  const chunkSeconds = clampNumber(Number(process.env.VIDEO_TRANSCRIBE_CHUNK_SECONDS || 540), 120, 1200, 540);
  const chunkCount = Math.max(1, Math.ceil(Math.max(durationSeconds, 1) / chunkSeconds));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-bible-transcribe-"));

  let language = "unknown";
  const textParts = [];
  const mergedSegments = [];

  try {
    for (let idx = 0; idx < chunkCount; idx += 1) {
      const chunkStart = idx * chunkSeconds;
      const chunkDuration = Math.max(1, Math.min(chunkSeconds, Math.max(durationSeconds - chunkStart, 1)));
      const chunkFileName = `chunk-${String(idx + 1).padStart(3, "0")}.mp3`;
      const chunkFilePath = path.join(workDir, chunkFileName);

      extractAudioChunkToMp3(absolutePath, chunkFilePath, chunkStart, chunkDuration, 32);

      const bytes = fs.statSync(chunkFilePath).size;
      const maxBytes = 24 * 1024 * 1024;
      if (bytes > maxBytes) {
        extractAudioChunkToMp3(absolutePath, chunkFilePath, chunkStart, chunkDuration, 16);
      }

      const chunkBuffer = fs.readFileSync(chunkFilePath);
      const transcript = await transcriptionAgent({
        buffer: chunkBuffer,
        mimetype: "audio/mpeg",
        originalname: `${cleanString(video.id, "video")}-${idx + 1}.mp3`
      });

      if (cleanString(transcript.language) && cleanString(transcript.language) !== "unknown") {
        language = cleanString(transcript.language);
      }
      if (cleanString(transcript.text)) {
        textParts.push(cleanString(transcript.text));
      }

      const safeSegments = Array.isArray(transcript.segments) ? transcript.segments : [];
      for (const segment of safeSegments) {
        const start = Number(segment.start || 0) + chunkStart;
        const end = Number(segment.end || segment.start || 0) + chunkStart;
        const text = cleanString(segment.text);
        if (!text) {
          continue;
        }
        mergedSegments.push({
          start: Number(start.toFixed(2)),
          end: Number(Math.max(end, start).toFixed(2)),
          text
        });
      }
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const text = cleanString(textParts.join(" ").replace(/\s+/g, " "));
  return {
    text,
    segments: mergedSegments,
    language,
    durationSeconds
  };
}

function extractAudioChunkToMp3(inputPath, outputPath, startSeconds, durationSeconds, bitrateKbps) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    Number(startSeconds || 0).toFixed(2),
    "-t",
    Number(durationSeconds || 1).toFixed(2),
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    `${Math.max(8, Number(bitrateKbps || 32))}k`,
    outputPath
  ];

  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    const reason = cleanString(result.stderr || result.stdout, "ffmpeg failed");
    throw new Error(`Audio extraction failed: ${reason}`);
  }
}

function probeDurationSeconds(filePath) {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    return 0;
  }
  const parsed = Number(cleanString(result.stdout));
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : 0;
}

function buildVideoSearchChunks(video, maxChunksPerVideo = 24) {
  const segments = Array.isArray(video.transcriptSegments) ? video.transcriptSegments : [];
  if (!segments.length) {
    return [{
      key: buildChunkKey(video.id, 0, Math.min(60, Number(video.durationSeconds || 0)), videoSearchDocument(video)),
      start: 0,
      end: Math.min(60, Number(video.durationSeconds || 0)),
      text: videoSearchDocument(video)
    }];
  }

  const chunks = [];
  let currentText = [];
  let chunkStart = Number(segments[0].start || 0);
  let chunkEnd = chunkStart;
  let wordCount = 0;
  let charCount = 0;

  const flush = () => {
    if (!currentText.length) {
      return;
    }
    const text = cleanString(currentText.join(" "));
    chunks.push({
      key: buildChunkKey(video.id, chunkStart, chunkEnd, text),
      start: Number(chunkStart.toFixed(2)),
      end: Number(Math.max(chunkEnd, chunkStart).toFixed(2)),
      text
    });
    currentText = [];
    wordCount = 0;
    charCount = 0;
  };

  for (const segment of segments) {
    const text = cleanString(segment.text);
    if (!text) {
      continue;
    }
    const start = Number(segment.start || 0);
    const end = Number(segment.end || start);
    const span = Math.max(0, end - chunkStart);
    const segmentWords = tokenize(text).length;
    const segmentChars = text.length;
    const overSize = span >= 55 || (wordCount + segmentWords) >= 165 || (charCount + segmentChars) >= 750;

    if (currentText.length && overSize) {
      flush();
      chunkStart = start;
    }

    currentText.push(text);
    chunkEnd = end;
    wordCount += segmentWords;
    charCount += segmentChars;
  }
  flush();

  return chunks.slice(0, maxChunksPerVideo);
}

function buildChunkKey(videoId, start, end, text) {
  const hash = crypto
    .createHash("sha1")
    .update(`${cleanString(videoId)}|${Number(start || 0).toFixed(2)}|${Number(end || 0).toFixed(2)}|${cleanString(text).slice(0, 700)}`)
    .digest("hex")
    .slice(0, 18);
  return `${OPENAI_EMBED_MODEL}:${hash}`;
}

async function ensureChunkEmbeddings(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return [];
  }

  const missing = [];
  const missingKeys = [];

  for (const chunk of chunks) {
    const key = cleanString(chunk.key);
    if (!key || segmentEmbeddingCache.has(key)) {
      continue;
    }
    missing.push(cleanString(chunk.text));
    missingKeys.push(key);
  }

  if (missing.length) {
    const vectors = await fetchEmbeddingsInBatches(missing, 64);
    for (let i = 0; i < missingKeys.length; i += 1) {
      segmentEmbeddingCache.set(missingKeys[i], vectors[i] || []);
    }
  }

  return chunks.map((chunk) => segmentEmbeddingCache.get(cleanString(chunk.key)) || []);
}

function safeJsonParse(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

async function transcriptionAgent(file) {
  const data = await openAIMultipartRequest("/audio/transcriptions", () => buildTranscriptionFormData(file));
  const text = cleanString(data.text);
  const segments = normalizeTranscriptionSegments(data.segments, text);
  const durationFromSegments = segments.length ? Number(segments[segments.length - 1].end || 0) : 0;

  return {
    text,
    segments,
    language: cleanString(data.language, "unknown"),
    durationSeconds: Number(data.duration || durationFromSegments || 0)
  };
}

function buildTranscriptionFormData(file) {
  const form = new FormData();
  const mimeType = cleanString(file && file.mimetype, "audio/mpeg");
  const fileName = cleanString(file && file.originalname, "sermon-audio");
  const blob = new Blob([file && file.buffer ? file.buffer : Buffer.alloc(0)], { type: mimeType });

  form.append("file", blob, fileName);
  form.append("model", OPENAI_TRANSCRIBE_MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  return form;
}

function transcriptFromManualText(text, durationSeconds) {
  const cleanText = cleanString(text);
  const sentenceParts = cleanText
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const segmentCount = Math.max(sentenceParts.length, 1);
  const totalDuration = Math.max(Number(durationSeconds) || segmentCount * 8, segmentCount * 5);
  const perSegment = totalDuration / segmentCount;

  const segments = sentenceParts.map((segmentText, idx) => ({
    start: Number((idx * perSegment).toFixed(2)),
    end: Number(((idx + 1) * perSegment).toFixed(2)),
    text: cleanString(segmentText)
  }));

  return {
    text: cleanText,
    segments,
    language: "manual",
    durationSeconds: totalDuration
  };
}

function normalizeTranscriptionSegments(rawSegments, fallbackText) {
  const segments = cleanObjectArray(rawSegments, 500)
    .map((segment) => ({
      start: Number(segment.start || 0),
      end: Number(segment.end || 0),
      text: cleanString(segment.text)
    }))
    .filter((segment) => segment.text);

  if (segments.length) {
    return segments;
  }

  const text = cleanString(fallbackText);
  if (!text) {
    return [];
  }

  return [{ start: 0, end: 10, text }];
}

function detectScriptureReferences(text) {
  const pattern = /\b(?:[1-3]\s*)?[A-Z][a-z]+\s+\d{1,3}(?::\d{1,3}(?:-\d{1,3})?)?/g;
  const matches = cleanString(text).match(pattern) || [];
  return Array.from(new Set(matches)).slice(0, 50);
}

function normalizeBookKey(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrimaryPassageBounds(reference) {
  const raw = cleanString(reference);
  if (!raw) {
    return null;
  }

  const match = raw.match(/^(.+?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*-\s*(\d{1,3}))?)?$/i);
  if (!match) {
    return null;
  }

  const book = cleanString(match[1]);
  const chapter = Number(match[2]);
  const verseStart = Number(match[3] || 0);
  const verseEnd = Number(match[4] || verseStart || 0);

  if (!book || !Number.isFinite(chapter)) {
    return null;
  }

  return {
    book,
    bookKey: normalizeBookKey(book),
    chapter,
    hasVerseRange: verseStart > 0,
    verseStart: verseStart > 0 ? Math.min(verseStart, verseEnd || verseStart) : null,
    verseEnd: verseStart > 0 ? Math.max(verseStart, verseEnd || verseStart) : null
  };
}

function parseScriptureReferenceParts(reference) {
  const raw = cleanString(reference);
  const match = raw.match(/^(.+?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*-\s*(\d{1,3}))?)?$/i);
  if (!match) {
    return null;
  }

  const book = cleanString(match[1]);
  const chapter = Number(match[2]);
  const verseStart = Number(match[3] || 0);
  const verseEnd = Number(match[4] || verseStart || 0);

  if (!book || !Number.isFinite(chapter)) {
    return null;
  }

  return {
    reference: raw,
    book,
    bookKey: normalizeBookKey(book),
    chapter,
    hasVerseRange: verseStart > 0,
    verseStart: verseStart > 0 ? Math.min(verseStart, verseEnd || verseStart) : null,
    verseEnd: verseStart > 0 ? Math.max(verseStart, verseEnd || verseStart) : null
  };
}

function enforceSupportingReferenceBounds(references, passageBounds) {
  const rows = cleanArray(references, 12);
  if (!passageBounds) {
    return {
      inScope: rows,
      outOfScope: [],
      unknown: []
    };
  }

  const inScope = [];
  const outOfScope = [];
  const unknown = [];

  for (const reference of rows) {
    const parsed = parseScriptureReferenceParts(reference);
    if (!parsed) {
      unknown.push({
        reference,
        reason: "Could not parse reference format."
      });
      inScope.push(reference);
      continue;
    }

    if (parsed.bookKey !== passageBounds.bookKey) {
      outOfScope.push({
        reference,
        reason: "Different biblical book than requested passage."
      });
      continue;
    }
    if (parsed.chapter !== passageBounds.chapter) {
      outOfScope.push({
        reference,
        reason: "Different chapter than requested passage."
      });
      continue;
    }
    if (!passageBounds.hasVerseRange) {
      inScope.push(reference);
      continue;
    }
    if (!parsed.hasVerseRange) {
      unknown.push({
        reference,
        reason: "Chapter-level reference provided; cannot confirm verse-range containment."
      });
      inScope.push(reference);
      continue;
    }

    const overlap = !(parsed.verseEnd < passageBounds.verseStart || parsed.verseStart > passageBounds.verseEnd);
    if (!overlap) {
      outOfScope.push({
        reference,
        reason: `Outside requested verse span ${passageBounds.book} ${passageBounds.chapter}:${passageBounds.verseStart}-${passageBounds.verseEnd}.`
      });
      continue;
    }
    inScope.push(reference);
  }

  return {
    inScope: Array.from(new Set(inScope)),
    outOfScope,
    unknown
  };
}

function computePacingAnalysis(transcript, localAnalysis, metricProvenance) {
  const transcriptText = cleanString(transcript.text);
  const segments = cleanObjectArray(transcript.segments, 600);
  const durationSeconds = Math.max(Number(transcript.durationSeconds || 0), 1);
  const wordCount = tokenize(transcriptText).length;
  const avgWpm = Number(((wordCount / durationSeconds) * 60).toFixed(1));

  const sectionWpm = segments.slice(0, 120).map((segment) => {
    const start = Number(segment.start || 0);
    const end = Number(segment.end || start + 1);
    const span = Math.max(end - start, 0.8);
    const words = tokenize(segment.text).length;
    const wpm = Number(((words / span) * 60).toFixed(1));
    return {
      start,
      end,
      wpm,
      textSample: cleanString(segment.text).slice(0, 120)
    };
  });

  const fastSections = sectionWpm.filter((section) => section.wpm >= 172).slice(0, 12);
  const slowSections = sectionWpm.filter((section) => section.wpm <= 103).slice(0, 12);
  const pauses = cleanObjectArray(localAnalysis.pauseMoments, 300);
  const pauseTimeSec = pauses.reduce((sum, pause) => sum + Number(pause.duration || 0), 0);
  const pauseRatio = pauseTimeSec / durationSeconds;

  const paceCloseness = Math.max(0, 1 - Math.abs(avgWpm - 130) / 85);
  const pauseBalance = Math.max(0, 1 - Math.abs(pauseRatio - 0.17) / 0.2);
  const rhythmScore = Number((Math.max(0, Math.min(1, (paceCloseness * 0.7) + (pauseBalance * 0.3))) * 100).toFixed(1));

  return {
    source: cleanString(metricProvenance && metricProvenance.pacing && metricProvenance.pacing.source, "transcript_estimate"),
    sourceNote: cleanString(metricProvenance && metricProvenance.pacing && metricProvenance.pacing.note),
    avgWpm,
    targetBandWpm: "120-150",
    sectionWpm,
    fastSections,
    slowSections,
    pauseCount: pauses.length,
    pauseTimeSec: Number(pauseTimeSec.toFixed(1)),
    rhythmScore
  };
}

function computeVocalDynamics(localAnalysis, metricProvenance) {
  const acoustic = localAnalysis && typeof localAnalysis.acoustic === "object" ? localAnalysis.acoustic : {};
  const pitch = localAnalysis && typeof localAnalysis.pitch === "object" ? localAnalysis.pitch : {};
  const monotoneSections = cleanObjectArray(localAnalysis.monotoneSections, 40)
    .map((section) => ({
      start: Number(section.start || 0),
      end: Number(section.end || 0),
      duration: Number(section.duration || 0)
    }))
    .filter((section) => section.duration > 0);

  const hasAcousticSignal = [acoustic.avgDb, acoustic.peakDb, acoustic.dynamicRangeDb, acoustic.volumeStdDb]
    .some((value) => Number.isFinite(Number(value)) && Number(value) !== 0);
  const hasPitchSignal = [pitch.meanHz, pitch.stdHz, pitch.rangeHz, pitch.varietyScore]
    .some((value) => Number.isFinite(Number(value)) && Number(value) !== 0);
  const hasVocalSignal = hasAcousticSignal || hasPitchSignal || monotoneSections.length > 0;
  const source = cleanString(metricProvenance && metricProvenance.vocalDynamics && metricProvenance.vocalDynamics.source, "unavailable");
  const sourceNote = cleanString(metricProvenance && metricProvenance.vocalDynamics && metricProvenance.vocalDynamics.note);

  if (!hasVocalSignal) {
    return {
      source,
      sourceNote,
      avgDb: null,
      peakDb: null,
      silenceRatio: null,
      dynamicRangeDb: null,
      volumeStdDb: null,
      pitchMeanHz: null,
      pitchStdHz: null,
      pitchRangeHz: null,
      varietyScore: null,
      volumeRangeScore: null,
      pitchVariationScore: null,
      monotoneRiskScore: null,
      monotoneSections: []
    };
  }

  const dynamicRangeDb = Number(acoustic.dynamicRangeDb || 0);
  const pitchStdHz = Number(pitch.stdHz || 0);
  const pitchRangeHz = Number(pitch.rangeHz || 0);
  const varietyScore = Number(pitch.varietyScore || 0);

  const volumeRangeScore = Number((Math.max(0, Math.min(1, dynamicRangeDb / 12)) * 100).toFixed(1));
  const pitchVariationScore = Number((Math.max(0, Math.min(1, pitchStdHz / 45)) * 100).toFixed(1));
  const monotoneRiskScore = Number((Math.max(0, Math.min(1, monotoneSections.length / 8)) * 100).toFixed(1));

  return {
    source,
    sourceNote,
    avgDb: Number(acoustic.avgDb || 0),
    peakDb: Number(acoustic.peakDb || 0),
    silenceRatio: Number(acoustic.silenceRatio || 0),
    dynamicRangeDb,
    volumeStdDb: Number(acoustic.volumeStdDb || 0),
    pitchMeanHz: Number(pitch.meanHz || 0),
    pitchStdHz,
    pitchRangeHz,
    varietyScore,
    volumeRangeScore,
    pitchVariationScore,
    monotoneRiskScore,
    monotoneSections
  };
}

function resolveAnalyzerMetricProvenance({ file, transcript, localAnalysis }) {
  const hasAudioFile = Boolean(file);
  const transcriptText = cleanString(transcript && transcript.text);
  const hasTranscript = Boolean(transcriptText);
  const pauses = cleanObjectArray(localAnalysis && localAnalysis.pauseMoments, 400);
  const acoustic = localAnalysis && typeof localAnalysis.acoustic === "object" ? localAnalysis.acoustic : {};
  const pitch = localAnalysis && typeof localAnalysis.pitch === "object" ? localAnalysis.pitch : {};

  const hasAcousticSignal = [acoustic.avgDb, acoustic.peakDb, acoustic.dynamicRangeDb, acoustic.volumeStdDb]
    .some((value) => Number.isFinite(Number(value)) && Number(value) !== 0);
  const hasPitchSignal = [pitch.meanHz, pitch.stdHz, pitch.rangeHz, pitch.varietyScore]
    .some((value) => Number.isFinite(Number(value)) && Number(value) !== 0);

  const pacingSource = hasTranscript
    ? (hasAudioFile ? "audio" : "transcript_estimate")
    : "unavailable";
  const vocalSource = (hasAcousticSignal || hasPitchSignal)
    ? "audio"
    : hasAudioFile
      ? "unavailable"
      : "unavailable";

  return {
    pacing: {
      source: pacingSource,
      note: hasAudioFile
        ? "Pacing derived from transcript segmentation of uploaded audio."
        : "Pacing estimated from transcript text and timing buckets; treat as directional."
    },
    vocalDynamics: {
      source: vocalSource,
      note: (hasAcousticSignal || hasPitchSignal)
        ? "Vocal metrics derived from local acoustic analysis."
        : hasAudioFile
          ? "No reliable acoustic metrics were available from the uploaded file."
          : "No uploaded audio waveform was provided, so acoustic vocal metrics are unavailable."
    },
    pauseSignals: {
      source: pauses.length ? "audio_or_local_analysis" : "unavailable",
      count: pauses.length
    }
  };
}

function bucketTranscriptSegments(segments, maxBuckets = 12) {
  const safeSegments = cleanObjectArray(segments, 500).filter((segment) => cleanString(segment.text));
  if (!safeSegments.length) {
    return [];
  }

  const bucketSize = Math.max(1, Math.ceil(safeSegments.length / maxBuckets));
  const buckets = [];

  for (let i = 0; i < safeSegments.length; i += bucketSize) {
    const chunk = safeSegments.slice(i, i + bucketSize);
    const text = chunk.map((segment) => cleanString(segment.text)).join(" ");
    buckets.push({
      id: buckets.length + 1,
      start: Number(chunk[0].start || 0),
      end: Number(chunk[chunk.length - 1].end || chunk[0].end || chunk[0].start || 0),
      text: cleanString(text).slice(0, 900)
    });
  }

  return buckets;
}

async function sermonInsightsAgent(input) {
  const started = Date.now();
  const transcriptText = cleanString(input && input.transcript && input.transcript.text);
  const buckets = bucketTranscriptSegments(input && input.transcript ? input.transcript.segments : [], 12);
  const regexReferences = detectScriptureReferences(transcriptText);
  const transcriptWordCount = tokenize(transcriptText).length;
  const emotionalFallback = buildEmotionArcFallback(buckets);
  const pacingForPrompt = {
    avgWpm: Number(input && input.pacingAnalysis && input.pacingAnalysis.avgWpm || 0),
    targetBandWpm: cleanString(input && input.pacingAnalysis && input.pacingAnalysis.targetBandWpm, "120-150"),
    fastSections: cleanObjectArray(input && input.pacingAnalysis && input.pacingAnalysis.fastSections, 8),
    slowSections: cleanObjectArray(input && input.pacingAnalysis && input.pacingAnalysis.slowSections, 8),
    pauseCount: Number(input && input.pacingAnalysis && input.pacingAnalysis.pauseCount || 0),
    pauseTimeSec: Number(input && input.pacingAnalysis && input.pacingAnalysis.pauseTimeSec || 0),
    rhythmScore: Number(input && input.pacingAnalysis && input.pacingAnalysis.rhythmScore || 0)
  };
  const vocalForPrompt = {
    avgDb: Number(input && input.vocalDynamics && input.vocalDynamics.avgDb || 0),
    peakDb: Number(input && input.vocalDynamics && input.vocalDynamics.peakDb || 0),
    dynamicRangeDb: Number(input && input.vocalDynamics && input.vocalDynamics.dynamicRangeDb || 0),
    pitchStdHz: Number(input && input.vocalDynamics && input.vocalDynamics.pitchStdHz || 0),
    pitchRangeHz: Number(input && input.vocalDynamics && input.vocalDynamics.pitchRangeHz || 0),
    varietyScore: Number(input && input.vocalDynamics && input.vocalDynamics.varietyScore || 0),
    monotoneRiskScore: Number(input && input.vocalDynamics && input.vocalDynamics.monotoneRiskScore || 0),
    monotoneSections: cleanObjectArray(input && input.vocalDynamics && input.vocalDynamics.monotoneSections, 10)
  };

  const insightsPrompt = buildSermonInsightsPrompt({
    context: cleanString(input.context),
    goal: cleanString(input.goal),
    notes: cleanString(input.notes),
    transcriptWordCount,
    transcriptExcerpt: transcriptText.slice(0, 9000),
    transcriptBuckets: buckets,
    regexReferences,
    pacingAnalysis: pacingForPrompt,
    vocalDynamics: vocalForPrompt,
    metricProvenance: input && input.metricProvenance ? input.metricProvenance : {}
  });
  let ai = await chatJson({
    ...insightsPrompt,
    temperature: 0.28,
    model: OPENAI_LONG_FORM_MODEL,
    maxTokens: 1600
  });
  const coachingQuality = evaluateSermonCoachingDraft(ai);

  if (coachingQuality.shouldRefine) {
    try {
      const refinerPrompt = buildSermonCoachingRefinementPrompt({
        context: cleanString(input.context),
        goal: cleanString(input.goal),
        notes: cleanString(input.notes),
        transcriptWordCount,
        transcriptExcerpt: transcriptText.slice(0, 7000),
        pacingAnalysis: pacingForPrompt,
        vocalDynamics: vocalForPrompt,
        baseline: {
          emotionalArcSummary: cleanString(ai && ai.emotionalArc && ai.emotionalArc.summary),
          contentAnalysis: ai && ai.contentAnalysis && typeof ai.contentAnalysis === "object"
            ? {
                summary: cleanString(ai.contentAnalysis.summary),
                keyThemes: cleanArray(ai.contentAnalysis.keyThemes, 10),
                structureMovements: cleanArray(ai.contentAnalysis.structureMovements, 10),
                callsToAction: cleanArray(ai.contentAnalysis.callsToAction, 10)
              }
            : {},
          coachingFeedback: ai && ai.coachingFeedback && typeof ai.coachingFeedback === "object"
            ? ai.coachingFeedback
            : {}
        },
        qualitySignals: coachingQuality.signals
      });
      const refined = await chatJson({
        ...refinerPrompt,
        temperature: 0.18,
        model: OPENAI_LONG_FORM_MODEL,
        maxTokens: 900
      });
      if (
        refined
        && typeof refined === "object"
        && refined.coachingFeedback
        && typeof refined.coachingFeedback === "object"
      ) {
        ai = { ...ai, coachingFeedback: refined.coachingFeedback };
      }
    } catch (_) {
      // Keep first-pass coaching feedback if optional refinement fails.
    }
  }

  const emotionRaw = ai && ai.emotionalArc && typeof ai.emotionalArc === "object" ? ai.emotionalArc : {};
  const contentRaw = ai && ai.contentAnalysis && typeof ai.contentAnalysis === "object" ? ai.contentAnalysis : {};
  const coachingRaw = ai && ai.coachingFeedback && typeof ai.coachingFeedback === "object" ? ai.coachingFeedback : {};
  const pointRows = cleanObjectArray(emotionRaw.arc, 20);
  const points = buckets.length
    ? buckets.map((bucket, idx) => {
      const row = pointRows.find((item) => Number(item.bucketId) === bucket.id) || pointRows[idx] || {};
      return {
        bucketId: bucket.id,
        start: bucket.start,
        end: bucket.end,
        timeSec: Number(((bucket.start + bucket.end) / 2).toFixed(2)),
        label: cleanString(row.label, "Neutral"),
        intensity: clampNumber(Number(row.intensity), 0, 100, 50),
        valence: clampNumber(Number(row.valence), -100, 100, 0),
        note: cleanString(row.note)
      };
    })
    : emotionalFallback.points;
  const mergedReferences = Array.from(new Set([
    ...regexReferences,
    ...cleanArray(contentRaw.scriptureReferences, 30)
  ])).slice(0, 30);

  const coachingReport = ensureAnalyzerCoachingReport({
    executiveSummary: cleanString(coachingRaw.executiveSummary),
    strengths: cleanArray(coachingRaw.strengths, 8),
    risks: cleanArray(coachingRaw.risks, 8),
    priorityActions: normalizeCoachingListItems(coachingRaw.priorityActions, 8),
    practiceDrills: normalizeCoachingListItems(coachingRaw.practiceDrills, 10),
    nextWeekPlan: cleanArray(coachingRaw.nextWeekPlan, 10)
  }, {
    context: cleanString(input.context),
    goal: cleanString(input.goal),
    transcriptWordCount,
    pacingAnalysis: pacingForPrompt,
    vocalDynamics: vocalForPrompt
  });

  return {
    durationMs: Date.now() - started,
    emotionArc: {
      points,
      summary: cleanString(emotionRaw.summary, emotionalFallback.summary)
    },
    contentAnalysis: {
      report: {
        summary: cleanString(contentRaw.summary),
        scriptureReferences: mergedReferences,
        keyThemes: cleanArray(contentRaw.keyThemes, 10),
        structureMovements: cleanArray(contentRaw.structureMovements, 10),
        illustrationTracking: cleanArray(contentRaw.illustrationTracking, 10),
        callsToAction: cleanArray(contentRaw.callsToAction, 10),
        gospelClarityScore: clampNumber(Number(contentRaw.gospelClarityScore), 0, 100, 0)
      }
    },
    coaching: {
      report: coachingReport
    }
  };
}

function buildEmotionArcFallback(buckets) {
  const points = (Array.isArray(buckets) ? buckets : []).map((bucket) => ({
    bucketId: bucket.id,
    start: bucket.start,
    end: bucket.end,
    timeSec: Number(((Number(bucket.start || 0) + Number(bucket.end || bucket.start || 0)) / 2).toFixed(2)),
    label: "Neutral",
    intensity: 50,
    valence: 0,
    note: ""
  }));

  return {
    points,
    summary: points.length ? "Balanced delivery arc detected across the message." : "No emotional arc points detected."
  };
}

function evaluateSermonPreparationDraft(rawDraft, requestedMinutes) {
  const draft = rawDraft && typeof rawDraft === "object" ? rawDraft : {};
  const signals = [];
  const bigIdea = cleanString(draft.bigIdea);
  const titleOptions = cleanArray(draft.titleOptions, 8);
  const outline = cleanObjectArray(draft.outline, 8);
  const transitions = cleanArray(draft.transitions, 8);
  const applications = cleanArray(draft.applications, 10);
  const illustrations = cleanArray(draft.illustrations, 10);
  const timingPlan = cleanObjectArray(draft.timingPlan, 10);

  if (bigIdea.length < 26) {
    signals.push("Big idea is too short or unclear.");
  }
  if (titleOptions.length < 3) {
    signals.push("Not enough title options.");
  }
  if (outline.length < 3) {
    signals.push("Outline is too thin; expected at least three clear movements.");
  }

  const thinOutlineRows = outline.filter((item) => {
    const references = cleanArray(item.supportingReferences, 6);
    return !cleanString(item.heading) || !cleanString(item.explanation) || !cleanString(item.application) || references.length < 1;
  });
  if (thinOutlineRows.length >= 1) {
    signals.push("One or more outline points are missing explanation, application, or support.");
  }

  if (transitions.length < 2) {
    signals.push("Transitions need stronger connective language.");
  }
  if (applications.length < 4) {
    signals.push("Applications are underdeveloped.");
  }
  if (illustrations.length < 2) {
    signals.push("Illustration ideas are too sparse.");
  }
  if (timingPlan.length < 3) {
    signals.push("Timing plan is incomplete.");
  } else {
    const totalPlannedMinutes = timingPlan.reduce((sum, row) => {
      const minutes = clampNumber(Number(row.minutes), 0, 120, 0);
      return sum + minutes;
    }, 0);
    const targetMinutes = clampNumber(Number(requestedMinutes), 8, 90, 30);
    const diff = Math.abs(totalPlannedMinutes - targetMinutes);
    if (totalPlannedMinutes <= 0 || diff > Math.max(7, targetMinutes * 0.35)) {
      signals.push("Timing plan does not align with requested sermon length.");
    }
  }

  return {
    shouldRefine: signals.length > 0,
    signals
  };
}

function evaluateTeachingKitDraft(rawDraft, requestedLength) {
  const draft = rawDraft && typeof rawDraft === "object" ? rawDraft : {};
  const signals = [];
  const overview = cleanString(draft.overview);
  const centralTruth = cleanString(draft.centralTruth);
  const lessonPlan = draft.lessonPlan && typeof draft.lessonPlan === "object" ? draft.lessonPlan : {};
  const sessionTimeline = cleanObjectArray(lessonPlan.sessionTimeline, 10);
  const objectives = cleanArray(lessonPlan.objectives, 10);
  const discussion = draft.discussionQuestions && typeof draft.discussionQuestions === "object"
    ? draft.discussionQuestions
    : {};
  const illustrationIdeas = cleanObjectArray(draft.illustrationIdeas, 10);
  const visualsAndMedia = cleanArray(draft.visualsAndMedia, 12);
  const leaderCoaching = cleanArray(draft.leaderCoaching, 12);
  const applicationPathways = draft.applicationPathways && typeof draft.applicationPathways === "object"
    ? draft.applicationPathways
    : {};
  const printableHandout = cleanArray(draft.printableHandout, 12);

  if (overview.length < 45) {
    signals.push("Overview is too shallow.");
  }
  if (centralTruth.length < 18) {
    signals.push("Central truth statement is too thin.");
  }
  if (objectives.length < 4) {
    signals.push("Learning objectives are missing depth.");
  }
  if (sessionTimeline.length < 5) {
    signals.push("Session timeline is incomplete.");
  } else {
    const targetLength = clampNumber(Number(requestedLength), 15, 120, 45);
    const totalTimelineMinutes = sessionTimeline.reduce((sum, row) => {
      const minutes = clampNumber(Number(row.minutes), 0, 180, 0);
      return sum + minutes;
    }, 0);
    const diff = Math.abs(totalTimelineMinutes - targetLength);
    if (totalTimelineMinutes <= 0 || diff > Math.max(10, targetLength * 0.35)) {
      signals.push("Timeline minutes do not align with requested class length.");
    }

    const thinTimelineRows = sessionTimeline.filter((row) => !cleanString(row.segment) || !cleanString(row.plan));
    if (thinTimelineRows.length >= 1) {
      signals.push("One or more timeline rows are missing clear segment or plan details.");
    }
  }

  const questionBuckets = [
    cleanArray(discussion.icebreakers, 6),
    cleanArray(discussion.observation, 6),
    cleanArray(discussion.interpretation, 6),
    cleanArray(discussion.application, 6),
    cleanArray(discussion.challenge, 6)
  ];
  const sparseBuckets = questionBuckets.filter((bucket) => bucket.length < 2).length;
  if (sparseBuckets >= 2) {
    signals.push("Discussion questions need broader coverage.");
  }

  if (illustrationIdeas.length < 3) {
    signals.push("Illustration section needs more concrete ideas.");
  }
  if (visualsAndMedia.length < 3) {
    signals.push("Visual/media recommendations are too sparse.");
  }
  if (cleanArray(applicationPathways.personal, 8).length < 2 || cleanArray(applicationPathways.mission, 8).length < 2) {
    signals.push("Application pathways are unbalanced.");
  }
  if (printableHandout.length < 5) {
    signals.push("Printable handout is too short.");
  }
  if (leaderCoaching.length < 4) {
    signals.push("Leader coaching guidance is too thin.");
  }

  return {
    shouldRefine: signals.length > 0,
    signals
  };
}

function normalizeCoachingListItems(value, max = 8) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return cleanString(item);
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return "";
      }
      const action = cleanString(item.action || item.title || item.target || item.focus);
      const rationale = cleanString(item.rationale || item.why);
      const metric = cleanString(item.metric || item.measure);
      const priority = cleanString(item.priority);
      const pieces = [];
      if (action) {
        pieces.push(action);
      }
      if (rationale) {
        pieces.push(`Why: ${rationale}`);
      }
      if (metric) {
        pieces.push(`Metric: ${metric}`);
      }
      if (priority) {
        pieces.push(`Priority: ${priority}`);
      }
      return cleanString(pieces.join(" | "));
    })
    .filter(Boolean)
    .slice(0, max);
}

function mergeUniqueLines(lines, max = 8) {
  const unique = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    const line = cleanString(raw);
    if (!line) {
      continue;
    }
    if (unique.includes(line)) {
      continue;
    }
    unique.push(line);
    if (unique.length >= max) {
      break;
    }
  }
  return unique;
}

function buildAnalyzerFallbackActionList(context, kind = "priority") {
  const goal = cleanString(context && context.goal, "clarity and faithful delivery");
  const transcriptWordCount = Number(context && context.transcriptWordCount || 0);
  const pacingWpm = Number(context && context.pacingAnalysis && context.pacingAnalysis.wpm || 0);
  const monotoneRisk = Number(context && context.vocalDynamics && context.vocalDynamics.monotoneRiskScore || 0);
  const likelyFast = pacingWpm >= 155;

  if (kind === "drill") {
    return [
      likelyFast
        ? `Run a 5-minute segment at 132-142 wpm with a timer; repeat 3 rounds and keep each round within 10 words of target pace.`
        : `Run a 5-minute segment at 128-140 wpm with a timer; repeat 3 rounds and keep transitions crisp.`,
      `Practice three transition sentences out loud, pausing 0.7-1.2 seconds before each main movement.`,
      monotoneRisk >= 55
        ? `Do two 4-minute vocal-contrast drills: mark one hope phrase and one warning phrase per movement and deliver them with clear volume/pitch contrast.`
        : `Do two 4-minute emphasis drills: mark one key phrase per movement and emphasize it with intentional pause plus vocal lift.`,
      `Record a 90-second opening, then replay once and rewrite one sentence for clearer gospel focus tied to ${goal}.`,
      transcriptWordCount >= 900
        ? `Trim one paragraph per movement to reduce total manuscript length by at least 8%, then rehearse the tighter version once.`
        : `Add one concrete illustration and one concrete application sentence per movement, then rehearse once without notes.`
    ];
  }

  return [
    likelyFast
      ? `Slow average pace from ~${Math.round(pacingWpm)} wpm toward 130-145 wpm by inserting intentional pauses at transitions and after key claims.`
      : `Maintain a steady 125-145 wpm pace and add intentional pauses so listeners can process key claims.`,
    `Strengthen transitions: write one bridge sentence between each movement so the message flow is explicit and not abrupt.`,
    monotoneRisk >= 55
      ? `Reduce monotone risk by varying tone and volume in each movement, especially at warnings, promises, and calls to response.`
      : `Increase vocal variety around key text phrases so emphasis matches theological weight.`,
    `Clarify the response moment: end with one concrete call to action listeners can complete within 24 hours.`,
    `Align the opening and conclusion around the same burden sentence to reinforce ${goal}.`
  ];
}

function buildAnalyzerFallbackNextWeekPlan(context) {
  const goal = cleanString(context && context.goal, "clarity and faithful delivery");
  return [
    `Day 1: Review transcript and mark 3 places where the argument became hard to follow; rewrite those transitions.`,
    `Day 2: Rehearse opening + first movement for 10 minutes with a pace target and pause markers.`,
    `Day 3: Run one vocal-contrast drill (warnings vs promises) and re-record a 3-minute segment.`,
    `Day 4: Tighten one section by removing repeated sentences that do not serve ${goal}.`,
    `Day 5: Perform a full run-through and note one measurable improvement to carry into next sermon week.`
  ];
}

function ensureAnalyzerCoachingReport(report, context = {}) {
  const normalized = report && typeof report === "object" ? report : {};
  const contextLabel = cleanString(context.context, "this preaching context");
  const goal = cleanString(context.goal, "clarity and faithful delivery");

  const fallbackActions = buildAnalyzerFallbackActionList(context, "priority");
  const fallbackDrills = buildAnalyzerFallbackActionList(context, "drill");
  const fallbackWeekPlan = buildAnalyzerFallbackNextWeekPlan(context);

  normalized.priorityActions = mergeUniqueLines([
    ...cleanArray(normalized.priorityActions, 12),
    ...fallbackActions
  ], 8);
  normalized.practiceDrills = mergeUniqueLines([
    ...cleanArray(normalized.practiceDrills, 14),
    ...fallbackDrills
  ], 10);
  normalized.nextWeekPlan = mergeUniqueLines([
    ...cleanArray(normalized.nextWeekPlan, 14),
    ...fallbackWeekPlan
  ], 10);

  normalized.strengths = mergeUniqueLines([
    ...cleanArray(normalized.strengths, 8),
    "Clear scriptural focus can be heard in major movement transitions.",
    "Message burden is present and can be sharpened with pacing discipline.",
    "The sermon already carries practical application momentum."
  ], 8).slice(0, 6);

  normalized.risks = mergeUniqueLines([
    ...cleanArray(normalized.risks, 8),
    "Fast transitions can reduce listener comprehension in dense sections.",
    "Key applications can blur together without clear movement markers.",
    "Calls to response may feel generic if not tied to one concrete next step."
  ], 8).slice(0, 6);

  if (!cleanString(normalized.executiveSummary)) {
    normalized.executiveSummary = `Primary coaching focus for ${contextLabel}: improve ${goal} through clearer transitions, measurable pacing discipline, and concrete response language.`;
  }

  // Hard floor so downstream UX/tests never receive empty action arrays.
  if (!normalized.priorityActions.length) {
    normalized.priorityActions = fallbackActions.slice(0, 5);
  }
  if (!normalized.practiceDrills.length) {
    normalized.practiceDrills = fallbackDrills.slice(0, 5);
  }
  if (!normalized.nextWeekPlan.length) {
    normalized.nextWeekPlan = fallbackWeekPlan.slice(0, 5);
  }

  return {
    executiveSummary: cleanString(normalized.executiveSummary),
    strengths: cleanArray(normalized.strengths, 8),
    risks: cleanArray(normalized.risks, 8),
    priorityActions: cleanArray(normalized.priorityActions, 8),
    practiceDrills: cleanArray(normalized.practiceDrills, 10),
    nextWeekPlan: cleanArray(normalized.nextWeekPlan, 10)
  };
}

function evaluateSermonCoachingDraft(rawDraft) {
  const draft = rawDraft && typeof rawDraft === "object" ? rawDraft : {};
  const coaching = draft.coachingFeedback && typeof draft.coachingFeedback === "object"
    ? draft.coachingFeedback
    : {};
  const signals = [];
  const executiveSummary = cleanString(coaching.executiveSummary);
  const strengths = cleanArray(coaching.strengths, 12);
  const risks = cleanArray(coaching.risks, 12);
  const priorityActions = normalizeCoachingListItems(coaching.priorityActions, 12);
  const practiceDrills = normalizeCoachingListItems(coaching.practiceDrills, 12);
  const nextWeekPlan = cleanArray(coaching.nextWeekPlan, 12);
  const weakActionRows = priorityActions.filter((line) => line.split(" ").length < 5);
  const weakDrills = practiceDrills.filter((line) => !/\b(min|minute|repeat|set|timer|times?)\b/i.test(line));

  if (executiveSummary.length < 42) {
    signals.push("Executive coaching summary is too thin.");
  }
  if (strengths.length < 4) {
    signals.push("Strength feedback coverage is limited.");
  }
  if (risks.length < 4) {
    signals.push("Risk analysis is underdeveloped.");
  }
  if (priorityActions.length < 5 || weakActionRows.length >= 2) {
    signals.push("Priority actions need stronger specificity.");
  }
  if (practiceDrills.length < 5 || weakDrills.length >= 2) {
    signals.push("Practice drills need measurable repetition details.");
  }
  if (nextWeekPlan.length < 5) {
    signals.push("Next-week plan is incomplete.");
  }

  return {
    shouldRefine: signals.length > 0,
    signals
  };
}

async function openAIRequest(endpoint, body) {
  return openAIRequestWithRetry(endpoint, async () => {
    const response = await fetch(`${OPENAI_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    return parseOpenAIResponse(response, "OpenAI request failed");
  });
}

async function verifyGoogleIdToken(idToken, expectedAudience) {
  const token = cleanString(idToken);
  if (!token) {
    throw new Error("Google token is required.");
  }
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(cleanString(payload.error_description, "Google token verification failed."));
  }
  const audience = cleanString(payload.aud);
  if (!audience || audience !== cleanString(expectedAudience)) {
    throw new Error("Google token audience mismatch.");
  }
  if (cleanString(payload.email_verified).toLowerCase() !== "true") {
    throw new Error("Google account email is not verified.");
  }
  const email = cleanString(payload.email).toLowerCase();
  if (!email) {
    throw new Error("Google token did not include an email.");
  }
  return {
    email,
    name: cleanString(payload.name, cleanString(payload.given_name)),
    sub: cleanString(payload.sub)
  };
}

function deriveRequestOrigin(req) {
  const configured = cleanString(PUBLIC_BASE_URL).replace(/\/+$/, "");
  if (configured && /^https?:\/\//i.test(configured)) {
    return configured;
  }

  const forwardedProto = cleanString(req && req.headers && req.headers["x-forwarded-proto"], "");
  const forwardedHost = cleanString(req && req.headers && req.headers["x-forwarded-host"], "");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, "");
  }

  const protocol = cleanString(req && req.protocol, "http");
  const host = cleanString(req && req.get && req.get("host"), "localhost:3000");
  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function buildMagicLinkUrl(origin, token) {
  const safeOrigin = cleanString(origin, "https://bible.hiredalmo.com").replace(/\/+$/, "");
  const safeToken = cleanString(token);
  if (!safeToken) {
    return `${safeOrigin}/`;
  }
  return `${safeOrigin}/?magicLinkToken=${encodeURIComponent(safeToken)}`;
}

async function sendMagicLinkEmail({ toEmail, magicLinkUrl, expiresInMinutes }) {
  const recipient = cleanString(toEmail).toLowerCase();
  if (!recipient || !recipient.includes("@")) {
    return {
      sent: false,
      mode: "invalid-recipient",
      detail: "A valid email is required for magic-link delivery."
    };
  }

  if (!RESEND_API_KEY || !MAGIC_LINK_FROM_EMAIL) {
    return {
      sent: false,
      mode: "simulated",
      detail: "Email delivery is not configured yet; token-based sign-in is enabled for now."
    };
  }

  const minutes = clampNumber(Number(expiresInMinutes || 15), 1, 60, 15);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: MAGIC_LINK_FROM_EMAIL,
      to: [recipient],
      subject: "Your Bible AI Hub magic sign-in link",
      text: `Use this sign-in link within ${minutes} minutes:\n\n${magicLinkUrl}`,
      html: `<p>Use this sign-in link within <strong>${minutes} minutes</strong>:</p><p><a href="${escapeHtml(magicLinkUrl)}">${escapeHtml(magicLinkUrl)}</a></p>`
    })
  });

  if (!response.ok) {
    let payload = {};
    try {
      payload = await response.json();
    } catch (_) {
      payload = {};
    }
    return {
      sent: false,
      mode: "resend-error",
      detail: cleanString(payload && payload.message, `Email delivery failed (HTTP ${response.status}).`)
    };
  }

  return {
    sent: true,
    mode: "resend",
    detail: "Check your inbox for your sign-in link."
  };
}

async function openAIMultipartRequest(endpoint, formDataOrFactory) {
  return openAIRequestWithRetry(endpoint, async () => {
    const requestBody = typeof formDataOrFactory === "function"
      ? formDataOrFactory()
      : formDataOrFactory;

    const response = await fetch(`${OPENAI_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: requestBody
    });

    return parseOpenAIResponse(response, "OpenAI multipart request failed");
  });
}

async function openAIRequestWithRetry(endpoint, requestFn) {
  const maxAttempts = clampNumber(
    Number(OPENAI_RETRY_ATTEMPTS),
    1,
    8,
    4
  );
  const baseDelayMs = clampNumber(
    Number(OPENAI_RETRY_BASE_MS),
    100,
    10000,
    650
  );

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = normalizeOpenAINetworkError(error, endpoint);
      if (!isRetryableOpenAIError(lastError) || attempt >= maxAttempts) {
        break;
      }

      const jitterMs = Math.floor(Math.random() * 120);
      const delayMs = Math.min(8000, baseDelayMs * (2 ** (attempt - 1))) + jitterMs;
      await sleep(delayMs);
    }
  }

  throw lastError || new Error(`OpenAI request failed for ${endpoint}`);
}

async function parseOpenAIResponse(response, fallbackPrefix) {
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(
      (data && data.error && data.error.message)
      || `${fallbackPrefix} with status ${response.status}`
    );
    err.status = response.status;
    throw err;
  }

  return data;
}

function normalizeOpenAINetworkError(error, endpoint) {
  if (!error) {
    const unknown = new Error(`OpenAI request failed for ${endpoint}`);
    unknown.code = "UNKNOWN";
    return unknown;
  }

  const code = cleanString(
    (error && error.code)
    || (error && error.cause && error.cause.code)
  );
  if (code && !error.code) {
    error.code = code;
  }

  if (!cleanString(error.message)) {
    error.message = `OpenAI request failed for ${endpoint}`;
  }

  return error;
}

function isRetryableOpenAIError(error) {
  const status = Number(error && error.status);
  if (status === 408 || status === 409 || status === 429) {
    return true;
  }
  if (Number.isFinite(status) && status >= 500) {
    return true;
  }

  const code = cleanString(
    (error && error.code)
    || (error && error.cause && error.cause.code)
  ).toUpperCase();
  if (["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) {
    return true;
  }

  const message = cleanString(error && error.message).toLowerCase();
  return (
    message.includes("fetch failed")
    || message.includes("socket hang up")
    || message.includes("timed out")
    || message.includes("temporar")
    || message.includes("rate limit")
    || message.includes("try again")
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJsonObject(text) {
  if (typeof text !== "string") {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return {};
    }

    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return {};
    }
  }
}

function cleanString(value, fallback = "") {
  if (typeof value === "string") {
    const trimmed = sanitizeBrandingText(value).trim();
    return trimmed || fallback;
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return sanitizeBrandingText(String(value)).trim() || fallback;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeBrandingText(value) {
  return String(value || "")
    .replace(/learnlogos\.com/gi, "Bible AI Hub")
    .replace(/\blearnlogos\b/gi, "Bible AI Hub");
}

function cleanArray(value, max = 6) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => cleanString(item))
    .filter(Boolean)
    .slice(0, max);
}

function cleanObjectArray(value, max = 6) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, max);
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function tokenize(text) {
  return cleanString(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function lexicalScoreVideo(video, terms) {
  if (!terms.length) {
    return 0;
  }

  const title = cleanString(video.title).toLowerCase();
  const body = cleanString(video.transcriptText).toLowerCase();
  const tags = cleanArray(video.tags, 40).join(" ").toLowerCase();
  const category = cleanString(video.category).toLowerCase();
  const topic = cleanString(video.topic).toLowerCase();
  const difficulty = cleanString(video.difficulty).toLowerCase();
  const logosVersion = cleanString(video.logosVersion).toLowerCase();

  let score = 0;

  for (const term of terms) {
    if (title.includes(term)) score += 1.1;
    if (tags.includes(term)) score += 0.85;
    if (topic.includes(term)) score += 0.8;
    if (category.includes(term)) score += 0.55;
    if (body.includes(term)) score += 0.4;
    if (difficulty.includes(term)) score += 0.3;
    if (logosVersion.includes(term)) score += 0.35;
  }

  return Math.min(1, score / Math.max(1, terms.length * 2.45));
}

function lexicalScoreText(text, terms) {
  if (!terms.length) {
    return 0;
  }

  const lower = cleanString(text).toLowerCase();
  if (!lower) {
    return 0;
  }

  let matches = 0;
  for (const term of terms) {
    if (lower.includes(term)) {
      matches += 1;
    }
  }

  return Math.min(1, matches / Math.max(1, terms.length));
}

function resolveVideoPlaybackBaseUrl(video) {
  if (!video || typeof video !== "object") {
    return "";
  }

  return cleanString(video.hostedUrl)
    || cleanString(video.playbackUrl)
    || cleanString(video.publicUrl);
}

function buildTimestampedPlaybackUrl(baseUrl, seconds) {
  const cleanBase = cleanString(baseUrl);
  if (!cleanBase) {
    return "";
  }

  const startSeconds = Math.max(0, Math.floor(Number(seconds || 0)));
  if (/youtu\.be\/|youtube\.com\//i.test(cleanBase)) {
    return appendOrReplaceQueryParam(cleanBase, "t", `${startSeconds}s`);
  }

  if (/vimeo\.com\//i.test(cleanBase)) {
    return appendOrReplaceHashParam(cleanBase, "t", `${startSeconds}s`);
  }

  return appendOrReplaceHashParam(cleanBase, "t", String(startSeconds));
}

function appendOrReplaceQueryParam(urlValue, key, value) {
  const cleanUrl = cleanString(urlValue);
  if (!cleanUrl) {
    return "";
  }

  const hashIdx = cleanUrl.indexOf("#");
  const hash = hashIdx >= 0 ? cleanUrl.slice(hashIdx) : "";
  const base = hashIdx >= 0 ? cleanUrl.slice(0, hashIdx) : cleanUrl;
  const separator = base.includes("?") ? "&" : "?";
  const pattern = new RegExp(`([?&])${key}=[^&#]*`, "i");
  const nextBase = pattern.test(base)
    ? base.replace(pattern, `$1${key}=${encodeURIComponent(value)}`)
    : `${base}${separator}${key}=${encodeURIComponent(value)}`;

  return `${nextBase}${hash}`;
}

function appendOrReplaceHashParam(urlValue, key, value) {
  const cleanUrl = cleanString(urlValue);
  if (!cleanUrl) {
    return "";
  }

  const hashIdx = cleanUrl.indexOf("#");
  const base = hashIdx >= 0 ? cleanUrl.slice(0, hashIdx) : cleanUrl;
  const rawHash = hashIdx >= 0 ? cleanUrl.slice(hashIdx + 1) : "";

  if (!rawHash) {
    return `${base}#${key}=${encodeURIComponent(value)}`;
  }

  const hashParams = new URLSearchParams(rawHash);
  hashParams.set(key, value);
  return `${base}#${hashParams.toString()}`;
}

function buildRelatedContent(scoredRows, excludeIds, queryTerms) {
  const excluded = new Set(excludeIds || []);
  const rows = Array.isArray(scoredRows) ? scoredRows : [];
  const related = [];

  for (const row of rows) {
    if (excluded.has(row.id)) {
      continue;
    }

    const tagText = cleanArray(row.tags, 12).join(" ").toLowerCase();
    const overlap = queryTerms.filter((term) => tagText.includes(term)).length;
    const score = (Number(row.score || 0) * 0.8) + (overlap * 0.06);
    const playbackBaseUrl = resolveVideoPlaybackBaseUrl(row);

    related.push({
      id: row.id,
      title: row.title,
      category: row.category,
      topic: row.topic,
      duration: row.duration,
      difficulty: row.difficulty,
      logosVersion: row.logosVersion,
      score: Number((score * 100).toFixed(2)),
      playbackUrl: playbackBaseUrl,
      hostedUrl: cleanString(row.hostedUrl),
      sourceAvailable: row.sourceAvailable !== false,
      url: buildTimestampedPlaybackUrl(playbackBaseUrl, 0),
      tags: row.tags
    });

    if (related.length >= 6) {
      break;
    }
  }

  return related;
}

function formatMediaTimestamp(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  const rounded = Math.floor(safe);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = Math.floor(rounded % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function buildMatchReason(row, queryTerms) {
  const reasons = [];
  if (row.semantic >= 0.65) {
    reasons.push("strong semantic match");
  }
  if (row.lexical >= 0.5) {
    reasons.push("direct keyword overlap");
  }
  if (queryTerms.some((term) => cleanString(row.video && row.video.topic).toLowerCase().includes(term))) {
    reasons.push("topic alignment");
  }
  if (!reasons.length) {
    reasons.push("contextual relevance");
  }
  return reasons.join(", ");
}

function buildGuidanceFallback(query, results) {
  const top = Array.isArray(results) ? results.slice(0, 3) : [];
  if (!top.length) {
    return `No strong matches yet for "${query}". Try broadening your terms and enabling auto-transcription.`;
  }

  const steps = top
    .map((item, idx) => `${idx + 1}) ${item.title} at ${item.timestamp}`)
    .join("  ");
  return `Start with these timestamped clips: ${steps}`;
}

function buildSuggestedQueriesFallback(query, results) {
  const cleanQuery = cleanString(query);
  const suggestions = new Set();
  if (cleanQuery) {
    suggestions.add(`${cleanQuery} walkthrough`);
    suggestions.add(`${cleanQuery} step by step`);
  }

  for (const row of (results || []).slice(0, 4)) {
    const topic = cleanString(row.topic);
    const category = cleanString(row.category);
    if (topic) suggestions.add(`${topic} in Logos`);
    if (category) suggestions.add(`${category} workflow`);
  }

  return Array.from(suggestions).slice(0, 6);
}

function buildRecoveryResultsFromAltQueries({ videos, altQueries, existingResults }) {
  const rows = Array.isArray(videos) ? videos : [];
  const queries = cleanArray(altQueries, 6);
  const existingVideoIds = new Set(
    (Array.isArray(existingResults) ? existingResults : [])
      .map((row) => cleanString(row.videoId))
      .filter(Boolean)
  );
  const recovered = [];

  for (const query of queries) {
    const terms = tokenize(query);
    if (!terms.length) {
      continue;
    }

    const candidate = rows
      .map((video) => ({
        video,
        lexical: lexicalScoreVideo(video, terms)
      }))
      .sort((a, b) => b.lexical - a.lexical)
      .find((row) => row.lexical >= 0.16 && !existingVideoIds.has(cleanString(row.video.id)));

    if (!candidate) {
      continue;
    }

    const video = candidate.video;
    const playbackBaseUrl = resolveVideoPlaybackBaseUrl(video);
    existingVideoIds.add(cleanString(video.id));
    recovered.push({
      id: `${video.id}:recovery:${recovered.length + 1}`,
      videoId: video.id,
      title: video.title,
      category: video.category,
      topic: video.topic,
      difficulty: video.difficulty,
      logosVersion: video.logosVersion,
      duration: video.duration,
      durationSeconds: video.durationSeconds,
      transcriptStatus: video.transcriptStatus,
      timestamp: "0:00",
      timestampSeconds: 0,
      endTimestamp: formatMediaTimestamp(Math.min(60, Number(video.durationSeconds || 0))),
      endSeconds: Math.min(60, Number(video.durationSeconds || 0)),
      snippet: cleanString(video.transcriptText || videoSearchDocument(video)).slice(0, 320),
      tags: video.tags,
      playbackUrl: playbackBaseUrl,
      hostedUrl: cleanString(video.hostedUrl),
      sourceAvailable: video.sourceAvailable !== false,
      url: buildTimestampedPlaybackUrl(playbackBaseUrl, 0),
      why: `Recovery pass matched alternate query: ${query}`,
      score: Number((candidate.lexical * 100).toFixed(2))
    });

    if (recovered.length >= 4) {
      break;
    }
  }

  return recovered;
}

function cosineSimilarity(vectorA, vectorB) {
  if (!Array.isArray(vectorA) || !Array.isArray(vectorB) || !vectorA.length || !vectorB.length) {
    return 0;
  }

  const length = Math.min(vectorA.length, vectorB.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < length; i += 1) {
    const a = Number(vectorA[i]) || 0;
    const b = Number(vectorB[i]) || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }

  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
