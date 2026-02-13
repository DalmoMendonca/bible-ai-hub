"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

const STAGES = new Set(["off", "internal", "partial", "ga"]);

function createFeatureFlagService({ rootDir } = {}) {
  const defaultPayload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    internalDomains: ["hiredalmo.com"],
    flags: []
  };
  const preferredPath = path.join(rootDir || process.cwd(), "server", "data", "feature-flags.json");
  const filePath = resolveWritableFeatureFlagPath(preferredPath, defaultPayload);

  let cachedPayload = null;
  let cachedMtimeMs = 0;

  function loadConfig() {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (_) {
      return {
        version: 1,
        updatedAt: "",
        internalDomains: ["hiredalmo.com"],
        flags: []
      };
    }

    if (cachedPayload && stat.mtimeMs === cachedMtimeMs) {
      return cachedPayload;
    }

    let parsed = {};
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (_) {
      parsed = {};
    }

    const normalized = {
      version: Number(parsed.version || 1),
      updatedAt: cleanString(parsed.updatedAt),
      internalDomains: normalizeDomainList(parsed.internalDomains),
      flags: normalizeFlags(parsed.flags)
    };

    cachedPayload = normalized;
    cachedMtimeMs = stat.mtimeMs;
    return normalized;
  }

  function evaluateAll(contextInput = {}) {
    const config = loadConfig();
    const context = normalizeContext(contextInput, config);
    const flags = {};
    for (const flag of config.flags) {
      flags[flag.key] = evaluateFlag(flag, context);
    }
    return {
      version: config.version,
      updatedAt: config.updatedAt,
      context: {
        userId: context.userId,
        workspaceId: context.workspaceId,
        role: context.role,
        isInternal: context.isInternal,
        bucket: context.bucket
      },
      flags
    };
  }

  function isEnabled(flagKey, contextInput = {}) {
    const key = cleanString(flagKey);
    if (!key) {
      return false;
    }
    const result = evaluateAll(contextInput);
    return Boolean(result.flags[key] && result.flags[key].enabled);
  }

  return {
    filePath,
    loadConfig,
    evaluateAll,
    isEnabled
  };
}

function evaluateFlag(flag, context) {
  const stage = cleanStage(flag.stage);
  const rolloutPercent = clampNumber(Number(flag.rolloutPercent || 0), 0, 100, 0);
  const allowUsers = normalizeStringList(flag.allowUsers);
  const allowWorkspaces = normalizeStringList(flag.allowWorkspaces);

  const inAllowList = Boolean(
    (context.userId && allowUsers.includes(context.userId))
    || (context.workspaceId && allowWorkspaces.includes(context.workspaceId))
    || (context.email && allowUsers.includes(context.email))
  );

  let enabled = false;
  if (stage === "ga") {
    enabled = true;
  } else if (stage === "internal") {
    enabled = context.isInternal || inAllowList;
  } else if (stage === "partial") {
    enabled = context.isInternal || inAllowList || context.bucket < rolloutPercent;
  }

  return {
    key: flag.key,
    description: flag.description,
    stage,
    rolloutPercent,
    enabled,
    matchedRule: inAllowList ? "allow_list" : context.isInternal ? "internal" : stage === "partial" ? "percentage_rollout" : stage
  };
}

function normalizeContext(contextInput = {}, config = {}) {
  const userId = cleanString(contextInput.userId);
  const workspaceId = cleanString(contextInput.workspaceId);
  const role = cleanString(contextInput.role);
  const email = cleanString(contextInput.email).toLowerCase();
  const ip = cleanString(contextInput.ip);
  const sessionToken = cleanString(contextInput.sessionToken);
  const cohortSeed = cleanString(
    contextInput.cohortSeed,
    [userId, workspaceId, email, sessionToken, ip].find(Boolean) || "anonymous"
  );
  const internalDomains = normalizeDomainList(config.internalDomains);
  const emailDomain = email.includes("@") ? email.slice(email.lastIndexOf("@") + 1) : "";
  const isInternal = internalDomains.includes(emailDomain);
  const bucket = hashToBucket(cohortSeed);

  return {
    userId,
    workspaceId,
    role,
    email,
    ip,
    sessionToken,
    cohortSeed,
    bucket,
    isInternal
  };
}

function normalizeFlags(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((row) => normalizeFlag(row))
    .filter((row) => Boolean(row.key));
}

function normalizeFlag(flag = {}) {
  return {
    key: cleanString(flag.key),
    description: cleanString(flag.description),
    stage: cleanStage(flag.stage),
    rolloutPercent: clampNumber(Number(flag.rolloutPercent || 0), 0, 100, 0),
    allowUsers: normalizeStringList(flag.allowUsers),
    allowWorkspaces: normalizeStringList(flag.allowWorkspaces)
  };
}

function cleanStage(value) {
  const stage = cleanString(value, "off").toLowerCase();
  return STAGES.has(stage) ? stage : "off";
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => cleanString(item))
    .filter(Boolean);
}

function normalizeDomainList(value) {
  const rows = normalizeStringList(value)
    .map((domain) => domain.toLowerCase().replace(/^@+/, ""));
  return rows.length ? rows : ["hiredalmo.com"];
}

function hashToBucket(value) {
  const seed = cleanString(value, "anonymous");
  const digest = crypto.createHash("sha256").update(seed).digest("hex");
  const head = Number.parseInt(digest.slice(0, 8), 16);
  if (!Number.isFinite(head)) {
    return 0;
  }
  return Math.abs(head % 100);
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function cleanString(value, fallback = "") {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  const asText = String(value).trim();
  return asText || fallback;
}

function ensureFile(filePath, defaultPayload) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${JSON.stringify(defaultPayload, null, 2)}\n`, "utf8");
  }
}

function resolveWritableFeatureFlagPath(preferredPath, defaultPayload) {
  const preferredExists = fs.existsSync(preferredPath);
  if (preferredExists) {
    return preferredPath;
  }

  try {
    ensureFile(preferredPath, defaultPayload);
    return preferredPath;
  } catch (_) {
    const fallbackPath = path.join(os.tmpdir(), "bible-ai-hub", "server", "data", "feature-flags.json");
    ensureFile(fallbackPath, defaultPayload);
    return fallbackPath;
  }
}

module.exports = {
  createFeatureFlagService
};
