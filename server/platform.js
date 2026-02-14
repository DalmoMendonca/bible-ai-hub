"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const TRIAL_DAYS_DEFAULT = 14;
const ADMIN_EMAIL = "dalmomendonca@gmail.com";
const GUEST_EMAIL_DOMAIN = "@local.bibleaihub";
const GUEST_DEFAULT_CREDITS = 10;
const ADMIN_DEFAULT_CREDITS = 10_000;
const DEFAULT_OVERAGE_POLICY = Object.freeze({
  mode: "hard_cap",
  resetCadence: "monthly",
  message: "Usage limits reset monthly. Upgrade your plan to continue immediately after reaching your cap."
});
const ANALYZER_OVERAGE_POLICY = Object.freeze({
  mode: "hard_cap",
  resetCadence: "monthly",
  message: "Sermon Analyzer minutes are capped monthly to protect reliability and compute quality. Upgrade for a higher cap."
});

const PLAN_CATALOG = [
  {
    id: "free",
    name: "Free",
    priceUsdMonthly: 0,
    features: {
      "video-search": true
    },
    limits: {
      teachingKitsPerMonth: 2,
      sermonAnalyzerMinutesPerMonth: 0,
      sermonEvaluationRunsPerMonth: 3
    },
    seatLimit: 1,
    overagePolicy: {
      default: DEFAULT_OVERAGE_POLICY,
      "sermon-analyzer": ANALYZER_OVERAGE_POLICY
    }
  },
  {
    id: "bible-study-pro",
    name: "Bible Study Pro",
    priceUsdMonthly: 15,
    features: {
      "bible-study": true
    },
    limits: {
      bibleStudyRunsPerMonth: 200
    },
    seatLimit: 1,
    overagePolicy: {
      default: DEFAULT_OVERAGE_POLICY
    }
  },
  {
    id: "sermon-preparation-pro",
    name: "Sermon Preparation Pro",
    priceUsdMonthly: 15,
    features: {
      "sermon-preparation": true
    },
    limits: {
      sermonPrepRunsPerMonth: 200
    },
    seatLimit: 1,
    overagePolicy: {
      default: DEFAULT_OVERAGE_POLICY
    }
  },
  {
    id: "teaching-tools-credits",
    name: "Teaching Tools Credits",
    priceUsdMonthly: 5,
    features: {
      "teaching-tools": true
    },
    limits: {
      teachingKitsPerMonth: 10
    },
    seatLimit: 1,
    overagePolicy: {
      default: DEFAULT_OVERAGE_POLICY
    }
  },
  {
    id: "teaching-tools-unlimited",
    name: "Teaching Tools Unlimited",
    priceUsdMonthly: 15,
    features: {
      "teaching-tools": true
    },
    limits: {
      teachingKitsPerMonth: null
    },
    seatLimit: 1,
    overagePolicy: {
      default: DEFAULT_OVERAGE_POLICY
    }
  },
  {
    id: "sermon-evaluation-pro",
    name: "Sermon Evaluation Pro",
    priceUsdMonthly: 15,
    features: {
      "research-helper": true
    },
    limits: {
      sermonEvaluationRunsPerMonth: null
    },
    seatLimit: 1,
    overagePolicy: {
      default: DEFAULT_OVERAGE_POLICY
    }
  },
  {
    id: "sermon-analyzer-pro",
    name: "Sermon Analyzer Pro",
    priceUsdMonthly: 89,
    features: {
      "sermon-analyzer": true
    },
    limits: {
      sermonAnalyzerMinutesPerMonth: 600
    },
    seatLimit: 1,
    overagePolicy: {
      default: DEFAULT_OVERAGE_POLICY,
      "sermon-analyzer": ANALYZER_OVERAGE_POLICY
    }
  },
  {
    id: "bundle-pro",
    name: "Bible AI Hub Bundle",
    priceUsdMonthly: 129,
    features: {
      "bible-study": true,
      "sermon-preparation": true,
      "teaching-tools": true,
      "research-helper": true,
      "sermon-analyzer": true,
      "video-search": true,
      "premium-video": true,
      "team-plan": true
    },
    limits: {
      teachingKitsPerMonth: null,
      sermonAnalyzerMinutesPerMonth: 300,
      sermonEvaluationRunsPerMonth: null,
      bibleStudyRunsPerMonth: null,
      sermonPrepRunsPerMonth: null
    },
    seatLimit: 5,
    overagePolicy: {
      default: DEFAULT_OVERAGE_POLICY,
      "sermon-analyzer": ANALYZER_OVERAGE_POLICY
    }
  },
  {
    id: "team-growth",
    name: "Team Growth",
    priceUsdMonthly: 249,
    features: {
      "bible-study": true,
      "sermon-preparation": true,
      "teaching-tools": true,
      "research-helper": true,
      "sermon-analyzer": true,
      "video-search": true,
      "premium-video": true,
      "team-plan": true
    },
    limits: {
      teachingKitsPerMonth: null,
      sermonAnalyzerMinutesPerMonth: 1800,
      sermonEvaluationRunsPerMonth: null,
      bibleStudyRunsPerMonth: null,
      sermonPrepRunsPerMonth: null
    },
    seatLimit: 25,
    overagePolicy: {
      default: DEFAULT_OVERAGE_POLICY,
      "sermon-analyzer": ANALYZER_OVERAGE_POLICY
    }
  }
];

const PLAN_MAP = new Map(PLAN_CATALOG.map((row) => [row.id, row]));

const FEATURE_LIMIT_KEYS = {
  "bible-study": "bibleStudyRunsPerMonth",
  "sermon-preparation": "sermonPrepRunsPerMonth",
  "teaching-tools": "teachingKitsPerMonth",
  "research-helper": "sermonEvaluationRunsPerMonth",
  "sermon-analyzer": "sermonAnalyzerMinutesPerMonth",
  "video-search": null
};

function createPlatformStore({ rootDir, trialDays = TRIAL_DAYS_DEFAULT } = {}) {
  const preferredDataPath = path.join(rootDir || process.cwd(), "server", "data", "platform-state.json");
  const dataPath = resolveWritableDataPath(preferredDataPath);
  ensureDir(path.dirname(dataPath));

  const state = loadState(dataPath);
  let hydrationMutations = false;
  for (const user of ensureArray(state.users)) {
    if (applyAccountDefaults(user)) {
      hydrationMutations = true;
    }
  }
  if (hydrationMutations) {
    fs.writeFileSync(dataPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
  const rateLimiter = new Map();

  function persist() {
    fs.writeFileSync(dataPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function getUserById(userId) {
    return state.users.find((row) => row.id === userId) || null;
  }

  function getWorkspaceById(workspaceId) {
    return state.workspaces.find((row) => row.id === workspaceId) || null;
  }

  function getSession(token) {
    const session = state.sessions.find((row) => row.token === token) || null;
    if (!session) {
      return null;
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      state.sessions = state.sessions.filter((row) => row.token !== token);
      persist();
      return null;
    }
    return session;
  }

  function getPrimaryWorkspaceIdForUser(userId) {
    const user = getUserById(userId);
    if (!user) {
      return "";
    }
    if (user.activeWorkspaceId && getWorkspaceById(user.activeWorkspaceId)) {
      return user.activeWorkspaceId;
    }
    const membership = state.workspaces.find((workspace) =>
      Array.isArray(workspace.members) && workspace.members.some((member) => member.userId === userId)
    );
    return membership ? membership.id : "";
  }

  function createPersonalWorkspace(user) {
    const workspaceId = createId("ws");
    const now = nowIso();
    state.workspaces.push({
      id: workspaceId,
      name: `${user.name || user.email}'s Workspace`,
      type: "personal",
      ownerId: user.id,
      createdAt: now,
      updatedAt: now,
      members: [{ userId: user.id, role: "owner", addedAt: now }]
    });
    user.activeWorkspaceId = workspaceId;
    state.subscriptions.push({
      id: createId("sub"),
      workspaceId,
      userId: user.id,
      planId: "bundle-pro",
      status: "trialing",
      trialStartedAt: now,
      trialEndsAt: new Date(Date.now() + (trialDays * 24 * 60 * 60 * 1000)).toISOString(),
      currentPeriodStart: now,
      currentPeriodEnd: new Date(Date.now() + MONTH_MS).toISOString(),
      seats: 1,
      source: "system-trial",
      createdAt: now,
      updatedAt: now
    });
  }

  function createSession(userId) {
    const now = Date.now();
    const session = {
      token: createToken(),
      userId,
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString()
    };
    state.sessions.push(session);
    persist();
    return session;
  }

  function sanitizeUser(user) {
    if (!user) {
      return null;
    }
    const credits = Number.isFinite(Number(user.credits)) ? Number(user.credits) : null;
    const safeEmail = normalizeEmail(user.email);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      credits,
      isGuest: isGuestEmail(safeEmail),
      disabled: Boolean(user.disabled),
      deletedAt: user.deletedAt || null,
      activeWorkspaceId: user.activeWorkspaceId || "",
      onboarding: user.onboarding || null,
      emailPrefs: user.emailPrefs || { lifecycle: true },
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  function signup({ email, password, name, role }) {
    const safeEmail = normalizeEmail(email);
    if (!safeEmail) {
      throw createError(400, "Email is required.");
    }
    if (!password || String(password).length < 8) {
      throw createError(400, "Password must be at least 8 characters.");
    }
    const exists = state.users.some((row) => row.email === safeEmail && !row.deletedAt);
    if (exists) {
      throw createError(409, "An account with this email already exists.");
    }
    const now = nowIso();
    const normalizedRole = (role === "admin" || isAdminEmail(safeEmail)) ? "admin" : "user";
    const user = {
      id: createId("usr"),
      email: safeEmail,
      name: cleanString(name, safeEmail.split("@")[0]),
      role: normalizedRole,
      credits: defaultCreditsForEmail(safeEmail),
      passwordHash: hashPassword(password),
      googleSub: "",
      disabled: false,
      deletedAt: null,
      activeWorkspaceId: "",
      onboarding: null,
      emailPrefs: { lifecycle: true },
      createdAt: now,
      updatedAt: now
    };
    applyAccountDefaults(user);
    state.users.push(user);
    createPersonalWorkspace(user);
    persist();
    const session = createSession(user.id);
    return {
      user: sanitizeUser(user),
      sessionToken: session.token,
      workspaceId: user.activeWorkspaceId
    };
  }

  function login({ email, password }) {
    const safeEmail = normalizeEmail(email);
    const user = state.users.find((row) => row.email === safeEmail && !row.deletedAt) || null;
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw createError(401, "Invalid email or password.");
    }
    if (user.disabled) {
      throw createError(403, "Account is disabled. Contact support.");
    }
    if (applyAccountDefaults(user)) {
      persist();
    }
    const session = createSession(user.id);
    return {
      user: sanitizeUser(user),
      sessionToken: session.token,
      workspaceId: getPrimaryWorkspaceIdForUser(user.id)
    };
  }

  function loginGoogle({ email, name, sub }) {
    const safeEmail = normalizeEmail(email);
    if (!safeEmail) {
      throw createError(400, "Google email is required.");
    }
    let user = state.users.find((row) => row.email === safeEmail && !row.deletedAt) || null;
    const now = nowIso();
    if (!user) {
      const normalizedRole = isAdminEmail(safeEmail) ? "admin" : "user";
      user = {
        id: createId("usr"),
        email: safeEmail,
        name: cleanString(name, safeEmail.split("@")[0]),
        role: normalizedRole,
        credits: defaultCreditsForEmail(safeEmail),
        passwordHash: "",
        googleSub: cleanString(sub),
        disabled: false,
        deletedAt: null,
        activeWorkspaceId: "",
        onboarding: null,
        emailPrefs: { lifecycle: true },
        createdAt: now,
        updatedAt: now
      };
      applyAccountDefaults(user);
      state.users.push(user);
      createPersonalWorkspace(user);
      persist();
    } else {
      const didMutateDefaults = applyAccountDefaults(user);
      user.googleSub = cleanString(sub, user.googleSub);
      user.updatedAt = now;
      if (didMutateDefaults || cleanString(sub)) {
        persist();
      }
    }
    const session = createSession(user.id);
    return {
      user: sanitizeUser(user),
      sessionToken: session.token,
      workspaceId: getPrimaryWorkspaceIdForUser(user.id)
    };
  }

  function logout(sessionToken) {
    if (!sessionToken) {
      return false;
    }
    const before = state.sessions.length;
    state.sessions = state.sessions.filter((row) => row.token !== sessionToken);
    if (before !== state.sessions.length) {
      persist();
      return true;
    }
    return false;
  }

  function refreshSession(sessionToken) {
    const session = getSession(sessionToken);
    if (!session) {
      throw createError(401, "Session not found.");
    }
    session.lastSeenAt = nowIso();
    session.expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    persist();
    return session;
  }

  function requestPasswordReset(email) {
    const safeEmail = normalizeEmail(email);
    const user = state.users.find((row) => row.email === safeEmail && !row.deletedAt) || null;
    if (!user) {
      return { ok: true };
    }
    const token = createToken();
    state.passwordResets.push({
      token,
      userId: user.id,
      email: safeEmail,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString(),
      usedAt: null
    });
    state.notifications.push({
      id: createId("note"),
      userId: user.id,
      type: "password-reset",
      title: "Password reset requested",
      body: "Use the provided token in the reset form. This is a local dev simulation.",
      cta: "",
      createdAt: nowIso(),
      readAt: null,
      payload: { resetToken: token }
    });
    persist();
    return { ok: true, resetToken: token };
  }

  function resetPassword(token, newPassword) {
    if (!newPassword || String(newPassword).length < 8) {
      throw createError(400, "New password must be at least 8 characters.");
    }
    const row = state.passwordResets.find((item) => item.token === token && !item.usedAt) || null;
    if (!row || Date.parse(row.expiresAt) <= Date.now()) {
      throw createError(400, "Reset token is invalid or expired.");
    }
    const user = getUserById(row.userId);
    if (!user) {
      throw createError(404, "User not found.");
    }
    user.passwordHash = hashPassword(newPassword);
    user.updatedAt = nowIso();
    row.usedAt = nowIso();
    persist();
    return { ok: true };
  }

  function deleteAccount(userId) {
    const user = getUserById(userId);
    if (!user) {
      throw createError(404, "User not found.");
    }
    const now = nowIso();
    user.deletedAt = now;
    user.disabled = true;
    user.email = `${user.id}@deleted.local`;
    user.name = "Deleted User";
    user.passwordHash = "";
    user.googleSub = "";
    user.updatedAt = now;
    state.sessions = state.sessions.filter((row) => row.userId !== userId);
    persist();
    return { ok: true };
  }

  function adminDisableUser(adminId, userId, disabled = true) {
    const admin = getUserById(adminId);
    if (!admin || admin.role !== "admin") {
      throw createError(403, "Admin access required.");
    }
    const user = getUserById(userId);
    if (!user) {
      throw createError(404, "User not found.");
    }
    user.disabled = Boolean(disabled);
    user.updatedAt = nowIso();
    if (user.disabled) {
      state.sessions = state.sessions.filter((row) => row.userId !== user.id);
    }
    persist();
    return sanitizeUser(user);
  }

  function resolveAuth(sessionToken) {
    const session = getSession(sessionToken);
    if (!session) {
      return { user: null, session: null };
    }
    const user = getUserById(session.userId);
    if (!user || user.deletedAt || user.disabled) {
      return { user: null, session: null };
    }
    session.lastSeenAt = nowIso();
    persist();
    return {
      user: sanitizeUser(user),
      session
    };
  }

  function requestMagicLink(email) {
    const safeEmail = normalizeEmail(email);
    if (!safeEmail) {
      throw createError(400, "Email is required.");
    }
    let user = state.users.find((row) => row.email === safeEmail && !row.deletedAt) || null;
    const now = nowIso();
    if (!user) {
      user = {
        id: createId("usr"),
        email: safeEmail,
        name: cleanString(safeEmail.split("@")[0]),
        role: isAdminEmail(safeEmail) ? "admin" : "user",
        credits: defaultCreditsForEmail(safeEmail),
        passwordHash: "",
        googleSub: "",
        disabled: false,
        deletedAt: null,
        activeWorkspaceId: "",
        onboarding: null,
        emailPrefs: { lifecycle: true },
        createdAt: now,
        updatedAt: now
      };
      applyAccountDefaults(user);
      state.users.push(user);
      createPersonalWorkspace(user);
    } else {
      if (user.disabled) {
        throw createError(403, "Account is disabled. Contact support.");
      }
      if (applyAccountDefaults(user)) {
        user.updatedAt = nowIso();
      }
    }

    const token = createToken();
    state.magicLinks.push({
      id: createId("mlink"),
      token,
      userId: user.id,
      email: safeEmail,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString(),
      usedAt: null
    });
    persist();

    return {
      ok: true,
      email: safeEmail,
      expiresInMinutes: Math.round(MAGIC_LINK_TTL_MS / 60000),
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString(),
      simulated: true,
      magicLinkToken: token
    };
  }

  function verifyMagicLink(token) {
    const safeToken = cleanString(token);
    if (!safeToken) {
      throw createError(400, "Magic link token is required.");
    }
    const link = state.magicLinks.find((row) => row.token === safeToken && !row.usedAt) || null;
    if (!link || Date.parse(link.expiresAt) <= Date.now()) {
      throw createError(400, "Magic link is invalid or expired.");
    }
    const user = getUserById(link.userId);
    if (!user || user.deletedAt || user.disabled) {
      throw createError(404, "User not found.");
    }
    const changed = applyAccountDefaults(user);
    link.usedAt = nowIso();
    if (changed) {
      user.updatedAt = nowIso();
    }
    persist();
    const session = createSession(user.id);
    return {
      user: sanitizeUser(user),
      sessionToken: session.token,
      workspaceId: getPrimaryWorkspaceIdForUser(user.id)
    };
  }

  function getCreditStatus(userId) {
    const user = getUserById(userId);
    if (!user || user.deletedAt) {
      throw createError(404, "User not found.");
    }
    const credits = Number.isFinite(Number(user.credits)) ? Number(user.credits) : null;
    return {
      credits,
      unlimited: credits === null,
      isGuest: isGuestEmail(normalizeEmail(user.email))
    };
  }

  function checkCredits(userId, requestedUnits = 1) {
    const user = getUserById(userId);
    if (!user || user.deletedAt) {
      throw createError(404, "User not found.");
    }
    const requested = Math.max(1, Number(requestedUnits || 1));
    const credits = Number.isFinite(Number(user.credits)) ? Number(user.credits) : null;
    if (credits === null) {
      return {
        allowed: true,
        unlimited: true,
        remaining: null,
        requested
      };
    }
    return {
      allowed: credits >= requested,
      unlimited: false,
      remaining: credits,
      requested
    };
  }

  function consumeCredits(userId, units = 1) {
    const user = getUserById(userId);
    if (!user || user.deletedAt) {
      throw createError(404, "User not found.");
    }
    const requested = Math.max(1, Number(units || 1));
    const credits = Number.isFinite(Number(user.credits)) ? Number(user.credits) : null;
    if (credits === null) {
      return {
        consumed: 0,
        remaining: null,
        unlimited: true
      };
    }
    if (credits < requested) {
      throw createError(403, "Insufficient credits.", {
        reasonCode: "credits_exhausted",
        creditsRemaining: credits,
        creditsRequested: requested
      });
    }
    user.credits = Math.max(0, credits - requested);
    user.updatedAt = nowIso();
    persist();
    return {
      consumed: requested,
      remaining: user.credits,
      unlimited: false
    };
  }

  function listWorkspacesForUser(userId) {
    return state.workspaces
      .filter((workspace) => workspace.members.some((member) => member.userId === userId))
      .map((workspace) => {
        const role = (workspace.members.find((member) => member.userId === userId) || {}).role || "viewer";
        return {
          id: workspace.id,
          name: workspace.name,
          type: workspace.type,
          ownerId: workspace.ownerId,
          role,
          memberCount: workspace.members.length,
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt
        };
      });
  }

  function getWorkspaceRole(userId, workspaceId) {
    const workspace = getWorkspaceById(workspaceId);
    if (!workspace) {
      return "";
    }
    const member = workspace.members.find((row) => row.userId === userId) || null;
    return member ? member.role : "";
  }

  function requireWorkspaceRole(userId, workspaceId, allowedRoles = []) {
    const role = getWorkspaceRole(userId, workspaceId);
    if (!role || (allowedRoles.length && !allowedRoles.includes(role))) {
      throw createError(403, "You do not have permission for this workspace.");
    }
    return role;
  }

  function setActiveWorkspace(userId, workspaceId) {
    const user = getUserById(userId);
    if (!user) {
      throw createError(404, "User not found.");
    }
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
    user.activeWorkspaceId = workspaceId;
    user.updatedAt = nowIso();
    persist();
    return { workspaceId };
  }

  function createWorkspace(ownerId, payload = {}) {
    const owner = getUserById(ownerId);
    if (!owner) {
      throw createError(404, "Owner not found.");
    }
    const now = nowIso();
    const workspace = {
      id: createId("ws"),
      name: cleanString(payload.name, "New Workspace"),
      type: cleanString(payload.type, "team") === "team" ? "team" : "personal",
      ownerId,
      createdAt: now,
      updatedAt: now,
      members: [{ userId: ownerId, role: "owner", addedAt: now }]
    };
    state.workspaces.push(workspace);
    state.subscriptions.push({
      id: createId("sub"),
      workspaceId: workspace.id,
      userId: ownerId,
      planId: "free",
      status: "active",
      trialStartedAt: "",
      trialEndsAt: "",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(Date.now() + MONTH_MS).toISOString(),
      seats: 1,
      source: "system-free",
      createdAt: now,
      updatedAt: now
    });
    owner.activeWorkspaceId = workspace.id;
    owner.updatedAt = now;
    persist();
    return workspace;
  }

  function addWorkspaceMember(actorId, workspaceId, email, role = "viewer") {
    requireWorkspaceRole(actorId, workspaceId, ["owner"]);
    const workspace = getWorkspaceById(workspaceId);
    if (!workspace) {
      throw createError(404, "Workspace not found.");
    }
    const user = state.users.find((row) => row.email === normalizeEmail(email) && !row.deletedAt) || null;
    if (!user) {
      const invite = {
        id: createId("invite"),
        workspaceId,
        email: normalizeEmail(email),
        role: normalizeRole(role),
        invitedBy: actorId,
        status: "pending",
        createdAt: nowIso()
      };
      state.teamInvites.push(invite);
      persist();
      return { invite };
    }
    const exists = workspace.members.find((member) => member.userId === user.id);
    if (exists) {
      exists.role = normalizeRole(role);
      workspace.updatedAt = nowIso();
      persist();
      return { member: exists };
    }
    const seatStats = getSeatStats(workspaceId);
    if (seatStats.remaining <= 0) {
      throw createError(409, "No seats remaining. Increase seat count before inviting.");
    }
    workspace.members.push({ userId: user.id, role: normalizeRole(role), addedAt: nowIso() });
    workspace.updatedAt = nowIso();
    persist();
    return { member: workspace.members[workspace.members.length - 1] };
  }

  function updateWorkspaceMemberRole(actorId, workspaceId, memberUserId, role) {
    requireWorkspaceRole(actorId, workspaceId, ["owner"]);
    const workspace = getWorkspaceById(workspaceId);
    if (!workspace) {
      throw createError(404, "Workspace not found.");
    }
    const member = workspace.members.find((row) => row.userId === memberUserId) || null;
    if (!member) {
      throw createError(404, "Member not found.");
    }
    member.role = normalizeRole(role);
    workspace.updatedAt = nowIso();
    persist();
    return member;
  }

  function acceptInvite(userId, inviteId) {
    const invite = state.teamInvites.find((row) => row.id === inviteId && row.status === "pending") || null;
    if (!invite) {
      throw createError(404, "Invite not found.");
    }
    const user = getUserById(userId);
    if (!user || user.deletedAt) {
      throw createError(404, "User not found.");
    }
    if (normalizeEmail(invite.email) !== normalizeEmail(user.email)) {
      throw createError(403, "Invite email does not match this account.");
    }
    const workspace = getWorkspaceById(invite.workspaceId);
    if (!workspace) {
      throw createError(404, "Workspace not found.");
    }
    const seatStats = getSeatStats(workspace.id);
    if (seatStats.remaining <= 0) {
      throw createError(409, "No seats remaining for this workspace.");
    }
    const exists = workspace.members.some((member) => member.userId === user.id);
    if (!exists) {
      workspace.members.push({
        userId: user.id,
        role: normalizeRole(invite.role),
        addedAt: nowIso()
      });
    }
    invite.status = "accepted";
    invite.acceptedBy = user.id;
    invite.acceptedAt = nowIso();
    workspace.updatedAt = nowIso();
    persist();
    return { workspaceId: workspace.id, role: normalizeRole(invite.role) };
  }

  function setWorkspaceAppAccess(actorId, workspaceId, role, tools) {
    requireWorkspaceRole(actorId, workspaceId, ["owner"]);
    const workspace = getWorkspaceById(workspaceId);
    if (!workspace) {
      throw createError(404, "Workspace not found.");
    }
    workspace.appAccess = workspace.appAccess && typeof workspace.appAccess === "object" ? workspace.appAccess : {};
    workspace.appAccess[normalizeRole(role)] = ensureArray(tools).map((tool) => cleanString(tool)).filter(Boolean);
    workspace.updatedAt = nowIso();
    persist();
    return workspace.appAccess;
  }

  function roleToolAccessAllowed(userId, workspaceId, feature) {
    const workspace = getWorkspaceById(workspaceId);
    if (!workspace) {
      return false;
    }
    const role = getWorkspaceRole(userId, workspaceId);
    if (!role) {
      return false;
    }
    const matrix = workspace.appAccess && typeof workspace.appAccess === "object" ? workspace.appAccess : {};
    const allowedForRole = ensureArray(matrix[role]);
    if (!allowedForRole.length) {
      return true;
    }
    return allowedForRole.includes(feature);
  }

  function getActiveSubscription(workspaceId) {
    const now = Date.now();
    const candidates = state.subscriptions
      .filter((row) => row.workspaceId === workspaceId)
      .filter((row) => ["active", "trialing", "past_due", "grace"].includes(row.status))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
    for (const subscription of candidates) {
      const periodEnd = Date.parse(subscription.currentPeriodEnd || 0);
      if (!periodEnd || periodEnd >= now || subscription.status === "trialing") {
        return subscription;
      }
    }
    return candidates[0] || null;
  }

  function getPlanForWorkspace(workspaceId) {
    const subscription = getActiveSubscription(workspaceId);
    if (!subscription) {
      return PLAN_MAP.get("free");
    }
    if (subscription.status === "trialing") {
      return PLAN_MAP.get("bundle-pro");
    }
    return PLAN_MAP.get(subscription.planId) || PLAN_MAP.get("free");
  }

  function createCheckout(actorId, workspaceId, planId, seats = 1) {
    requireWorkspaceRole(actorId, workspaceId, ["owner"]);
    const plan = PLAN_MAP.get(planId);
    if (!plan) {
      throw createError(404, "Plan not found.");
    }
    const now = nowIso();
    state.subscriptions.push({
      id: createId("sub"),
      workspaceId,
      userId: actorId,
      planId: plan.id,
      status: "active",
      trialStartedAt: "",
      trialEndsAt: "",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(Date.now() + MONTH_MS).toISOString(),
      seats: Math.max(1, Math.floor(Number(seats || 1))),
      source: "checkout",
      createdAt: now,
      updatedAt: now
    });
    state.entitlementsAudit.push({
      id: createId("audit"),
      workspaceId,
      event: "checkout_completed",
      source: "checkout",
      detail: `Activated plan ${plan.id}`,
      createdAt: now
    });
    persist();
    return {
      checkoutUrl: `/billing/checkout/success?workspace=${encodeURIComponent(workspaceId)}&plan=${encodeURIComponent(plan.id)}`,
      plan
    };
  }

  function openBillingPortal(actorId, workspaceId) {
    requireWorkspaceRole(actorId, workspaceId, ["owner"]);
    return {
      portalUrl: `/billing/portal?workspace=${encodeURIComponent(workspaceId)}`
    };
  }

  function applyWebhook({ id, eventType, workspaceId, planId, status, seats, payload }) {
    const webhookId = cleanString(id, createId("wh"));
    const already = state.webhookEvents.find((row) => row.id === webhookId);
    if (already) {
      return { idempotent: true, event: already };
    }
    const now = nowIso();
    const event = {
      id: webhookId,
      eventType: cleanString(eventType, "subscription.updated"),
      workspaceId: cleanString(workspaceId),
      planId: cleanString(planId),
      status: cleanString(status, "active"),
      payload: payload || {},
      createdAt: now,
      processedAt: null,
      processStatus: "pending"
    };
    state.webhookEvents.push(event);
    try {
      if (event.workspaceId) {
        const subscription = getActiveSubscription(event.workspaceId);
        if (subscription) {
          if (event.planId && PLAN_MAP.has(event.planId)) {
            subscription.planId = event.planId;
          }
          if (event.status) {
            subscription.status = event.status;
          }
          if (Number.isFinite(Number(seats))) {
            subscription.seats = Math.max(1, Math.floor(Number(seats)));
          }
          subscription.updatedAt = now;
        }
      }
      event.processStatus = "processed";
      event.processedAt = now;
      state.entitlementsAudit.push({
        id: createId("audit"),
        workspaceId: event.workspaceId,
        event: event.eventType,
        source: "webhook",
        detail: `Webhook applied with status ${event.status || "n/a"}`,
        createdAt: now
      });
      persist();
      return { idempotent: false, event };
    } catch (error) {
      event.processStatus = "failed";
      event.processedAt = now;
      event.error = String(error && error.message || "Webhook processing failed");
      persist();
      throw error;
    }
  }

  function getWorkspaceEntitlements(workspaceId) {
    const plan = getPlanForWorkspace(workspaceId);
    const subscription = getActiveSubscription(workspaceId);
    const features = { ...plan.features };
    const limits = { ...plan.limits };
    const overagePolicy = normalizeOveragePolicy(plan.overagePolicy);
    const now = Date.now();
    const overrides = state.entitlementOverrides.filter((row) =>
      row.workspaceId === workspaceId
      && (!row.expiresAt || Date.parse(row.expiresAt) > now)
    );
    for (const override of overrides) {
      if (override.type === "feature") {
        features[override.key] = Boolean(override.value);
      } else if (override.type === "limit") {
        limits[override.key] = override.value;
      }
    }
    return {
      workspaceId,
      planId: plan.id,
      planName: plan.name,
      subscriptionStatus: subscription ? subscription.status : "none",
      features,
      limits,
      overagePolicy,
      overrides
    };
  }

  function addEntitlementOverride(actorId, payload = {}) {
    const actor = getUserById(actorId);
    if (!actor || actor.role !== "admin") {
      throw createError(403, "Admin access required.");
    }
    const workspaceId = cleanString(payload.workspaceId);
    if (!workspaceId || !getWorkspaceById(workspaceId)) {
      throw createError(404, "Workspace not found.");
    }
    const record = {
      id: createId("ovr"),
      workspaceId,
      type: cleanString(payload.type, "feature"),
      key: cleanString(payload.key),
      value: payload.value,
      reason: cleanString(payload.reason),
      createdBy: actorId,
      createdAt: nowIso(),
      expiresAt: cleanString(payload.expiresAt)
    };
    state.entitlementOverrides.push(record);
    state.entitlementsAudit.push({
      id: createId("audit"),
      workspaceId,
      event: "override_created",
      source: "admin",
      detail: `${record.type}:${record.key}`,
      createdAt: nowIso()
    });
    persist();
    return record;
  }

  function getEntitlementAudit(workspaceId) {
    return state.entitlementsAudit
      .filter((row) => row.workspaceId === workspaceId)
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }

  function getUsageWindowStart() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
  }

  function getUsageForWorkspace(workspaceId, sinceIso = getUsageWindowStart()) {
    const sinceMs = Date.parse(sinceIso || 0) || 0;
    return state.usage.filter((row) => row.workspaceId === workspaceId && Date.parse(row.createdAt || 0) >= sinceMs);
  }

  function usageSummary(workspaceId) {
    const rows = getUsageForWorkspace(workspaceId);
    const totals = {};
    for (const row of rows) {
      if (!totals[row.feature]) {
        totals[row.feature] = {
          runs: 0,
          units: 0,
          estimatedCostUsd: 0
        };
      }
      totals[row.feature].runs += 1;
      totals[row.feature].units += Number(row.units || 0);
      totals[row.feature].estimatedCostUsd += Number(row.estimatedCostUsd || 0);
    }
    return {
      workspaceId,
      windowStart: getUsageWindowStart(),
      totals
    };
  }

  function usageForecast(workspaceId) {
    const summary = usageSummary(workspaceId);
    const now = Date.now();
    const windowStartMs = Date.parse(summary.windowStart || 0) || now;
    const elapsedDays = Math.max(1, Math.ceil((now - windowStartMs) / (24 * 60 * 60 * 1000)));
    const entitlements = getWorkspaceEntitlements(workspaceId);
    const forecast = Object.keys(FEATURE_LIMIT_KEYS)
      .map((feature) => {
        const limitKey = FEATURE_LIMIT_KEYS[feature];
        const featureUsage = summary.totals[feature] || { units: 0, runs: 0, estimatedCostUsd: 0 };
        const used = Number(featureUsage.units || 0);
        const projectedMonthly = Number(((used / elapsedDays) * 30).toFixed(2));
        const limit = limitKey ? entitlements.limits[limitKey] : null;
        const pctOfLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
          ? Number(((used / Number(limit)) * 100).toFixed(2))
          : null;
        const projectedPctOfLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
          ? Number(((projectedMonthly / Number(limit)) * 100).toFixed(2))
          : null;
        const risk = projectedPctOfLimit === null
          ? "none"
          : projectedPctOfLimit >= 100
            ? "high"
            : projectedPctOfLimit >= 80
              ? "medium"
              : "low";
        return {
          feature,
          used,
          limit,
          projectedMonthly,
          pctOfLimit,
          projectedPctOfLimit,
          risk
        };
      });
    return {
      workspaceId,
      windowStart: summary.windowStart,
      elapsedDays,
      forecast
    };
  }

  function getWorkspaceActivity({ workspaceId, userId, limit = 60 }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
    const maxRows = Math.max(1, Math.min(300, Number(limit || 60)));
    const activity = [];

    for (const event of ensureArray(state.events)) {
      if (cleanString(event.workspaceId) === workspaceId) {
        activity.push({
          id: cleanString(event.id),
          type: "event",
          title: cleanString(event.name),
          detail: cleanString(event.source, "web"),
          createdAt: cleanString(event.createdAt),
          userId: cleanString(event.userId),
          payload: event.properties || {}
        });
      }
    }

    for (const project of ensureArray(state.projects)) {
      if (cleanString(project.workspaceId) === workspaceId) {
        activity.push({
          id: cleanString(project.id),
          type: "project",
          title: cleanString(project.title, "Project updated"),
          detail: cleanString(project.tool),
          createdAt: cleanString(project.updatedAt || project.createdAt),
          userId: cleanString(project.createdBy),
          payload: {
            versions: Array.isArray(project.versions) ? project.versions.length : 0,
            exports: Array.isArray(project.exports) ? project.exports.length : 0
          }
        });
      }
    }

    for (const job of ensureArray(state.analyzerJobs)) {
      if (cleanString(job.workspaceId) === workspaceId) {
        activity.push({
          id: cleanString(job.id),
          type: "analyzer_job",
          title: `Analyzer ${cleanString(job.status, "unknown")}`,
          detail: cleanString(job.failureReason),
          createdAt: cleanString(job.updatedAt || job.createdAt),
          userId: cleanString(job.userId),
          payload: {
            retries: Number(job.retries || 0)
          }
        });
      }
    }

    for (const notification of ensureArray(state.notifications)) {
      const recipientWorkspace = getPrimaryWorkspaceIdForUser(cleanString(notification.userId));
      if (recipientWorkspace === workspaceId) {
        activity.push({
          id: cleanString(notification.id),
          type: "notification",
          title: cleanString(notification.title),
          detail: cleanString(notification.type),
          createdAt: cleanString(notification.createdAt),
          userId: cleanString(notification.userId),
          payload: notification.payload || {}
        });
      }
    }

    activity.sort((a, b) => Date.parse(cleanString(b.createdAt) || 0) - Date.parse(cleanString(a.createdAt) || 0));
    return activity.slice(0, maxRows);
  }

  function recordUsage(row = {}) {
    const requestId = cleanString(row.requestId);
    if (requestId && state.usage.some((item) => item.requestId === requestId)) {
      return null;
    }
    const usage = {
      id: createId("use"),
      requestId: requestId || createId("req"),
      workspaceId: cleanString(row.workspaceId),
      userId: cleanString(row.userId),
      feature: cleanString(row.feature),
      units: Number(row.units || 1),
      unitType: cleanString(row.unitType, "generation"),
      model: cleanString(row.model),
      estimatedCostUsd: Number(row.estimatedCostUsd || 0),
      metadata: row.metadata || {},
      createdAt: nowIso()
    };
    state.usage.push(usage);
    persist();
    return usage;
  }

  function checkQuota(workspaceId, feature, unitsRequested = 1) {
    const entitlements = getWorkspaceEntitlements(workspaceId);
    const featureOveragePolicy = resolveFeatureOveragePolicy(entitlements.overagePolicy, feature);
    const limitKey = FEATURE_LIMIT_KEYS[feature];
    if (!entitlements.features[feature]) {
      return {
        allowed: false,
        reasonCode: "feature_not_in_plan",
        resetAt: getUsageWindowStart(),
        upgradePlans: PLAN_CATALOG.filter((plan) => plan.features[feature]).map((plan) => plan.id),
        overagePolicy: featureOveragePolicy
      };
    }
    if (!limitKey) {
      return {
        allowed: true,
        reasonCode: "ok",
        resetAt: getUsageWindowStart(),
        usage: usageSummary(workspaceId),
        overagePolicy: featureOveragePolicy
      };
    }
    const limitValue = entitlements.limits[limitKey];
    if (limitValue === null || limitValue === undefined) {
      return {
        allowed: true,
        reasonCode: "ok",
        resetAt: getUsageWindowStart(),
        usage: usageSummary(workspaceId),
        overagePolicy: featureOveragePolicy
      };
    }
    const summary = usageSummary(workspaceId);
    const used = (summary.totals[feature] && summary.totals[feature].units) || 0;
    const requested = Math.max(0, Number(unitsRequested || 0));
    const allowed = (used + requested) <= Number(limitValue);
    return {
      allowed,
      reasonCode: allowed ? "ok" : "quota_exceeded",
      used,
      requested,
      limit: Number(limitValue),
      resetAt: getUsageWindowStart(),
      upgradePlans: PLAN_CATALOG.filter((plan) => plan.features[feature]).map((plan) => plan.id),
      usage: summary,
      overagePolicy: featureOveragePolicy
    };
  }

  function trackEvent(row = {}) {
    validateEvent(row);
    const event = {
      id: createId("evt"),
      name: cleanString(row.name),
      version: Number(row.version || 1),
      userId: cleanString(row.userId),
      workspaceId: cleanString(row.workspaceId),
      sessionId: cleanString(row.sessionId),
      source: cleanString(row.source, "web"),
      properties: row.properties || {},
      createdAt: nowIso()
    };
    state.events.push(event);
    persist();
    return event;
  }

  function getActivationDashboard({ from, to, segment = "all" } = {}) {
    const fromMs = Date.parse(from || 0) || 0;
    const toMs = Date.parse(to || nowIso()) || Date.now();
    const events = state.events.filter((row) => {
      const ts = Date.parse(row.createdAt || 0);
      if (ts < fromMs || ts > toMs) {
        return false;
      }
      if (segment === "all") {
        return true;
      }
      return cleanString(row.properties && row.properties.segment, "all") === segment;
    });
    const counts = countBy(events, "name");
    const funnel = {
      visit: counts["landing_view"] || 0,
      start: counts["tool_start"] || 0,
      success: counts["generation_success"] || 0,
      signup: counts["auth_signup_success"] || 0,
      trial: counts["trial_started"] || 0,
      paid: counts["subscription_paid"] || 0
    };
    const ratio = (numerator, denominator) => {
      if (!denominator) {
        return 0;
      }
      return Number(((numerator / denominator) * 100).toFixed(2));
    };
    const segmentsAvailable = Array.from(new Set(events
      .map((row) => cleanString(row.properties && row.properties.segment, "all"))
      .filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));
    return {
      range: { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
      segment,
      funnel,
      conversionRates: {
        visitToStartPct: ratio(funnel.start, funnel.visit),
        startToSuccessPct: ratio(funnel.success, funnel.start),
        successToSignupPct: ratio(funnel.signup, funnel.success),
        signupToTrialPct: ratio(funnel.trial, funnel.signup),
        trialToPaidPct: ratio(funnel.paid, funnel.trial),
        visitToPaidPct: ratio(funnel.paid, funnel.visit)
      },
      segmentsAvailable,
      kpiDefinitions: [
        {
          key: "visit_to_start",
          label: "Visit to Tool Start",
          formula: "tool_start / landing_view",
          owner: "Growth"
        },
        {
          key: "success_rate",
          label: "Generation Success Rate",
          formula: "generation_success / tool_start",
          owner: "Product"
        },
        {
          key: "trial_to_paid",
          label: "Trial to Paid",
          formula: "subscription_paid / trial_started",
          owner: "Revenue"
        }
      ],
      rawCounts: counts
    };
  }

  function getCogsDashboard({ from, to } = {}) {
    const fromMs = Date.parse(from || 0) || 0;
    const toMs = Date.parse(to || nowIso()) || Date.now();
    const rows = state.usage.filter((row) => {
      const ts = Date.parse(row.createdAt || 0);
      return ts >= fromMs && ts <= toMs;
    });
    const byFeature = {};
    for (const row of rows) {
      if (!byFeature[row.feature]) {
        byFeature[row.feature] = {
          runs: 0,
          units: 0,
          costUsd: 0,
          activeUsers: new Set()
        };
      }
      byFeature[row.feature].runs += 1;
      byFeature[row.feature].units += Number(row.units || 0);
      byFeature[row.feature].costUsd += Number(row.estimatedCostUsd || 0);
      if (row.userId) {
        byFeature[row.feature].activeUsers.add(row.userId);
      }
    }
    const features = Object.keys(byFeature).map((feature) => {
      const row = byFeature[feature];
      const activeUsers = row.activeUsers.size;
      return {
        feature,
        runs: row.runs,
        units: row.units,
        costUsd: Number(row.costUsd.toFixed(4)),
        costPerRunUsd: Number((row.costUsd / Math.max(1, row.runs)).toFixed(4)),
        costPerActiveUserUsd: Number((row.costUsd / Math.max(1, activeUsers)).toFixed(4)),
        activeUsers
      };
    });
    const byPlan = {};
    for (const subscription of state.subscriptions) {
      const plan = PLAN_MAP.get(cleanString(subscription.planId)) || PLAN_MAP.get("free");
      const planId = plan.id;
      if (!byPlan[planId]) {
        byPlan[planId] = {
          planId,
          planName: plan.name,
          monthlyRevenueUsd: 0,
          estimatedCostUsd: 0
        };
      }
      byPlan[planId].monthlyRevenueUsd += Number(plan.priceUsdMonthly || 0);
      const workspaceCost = rows
        .filter((row) => row.workspaceId === subscription.workspaceId)
        .reduce((sum, row) => sum + Number(row.estimatedCostUsd || 0), 0);
      byPlan[planId].estimatedCostUsd += workspaceCost;
    }
    const grossMarginByPlan = Object.values(byPlan).map((row) => ({
      ...row,
      grossMarginUsd: Number((row.monthlyRevenueUsd - row.estimatedCostUsd).toFixed(4)),
      grossMarginPct: row.monthlyRevenueUsd > 0
        ? Number((((row.monthlyRevenueUsd - row.estimatedCostUsd) / row.monthlyRevenueUsd) * 100).toFixed(2))
        : 0
    }));
    const totals = features.reduce((acc, row) => ({
      runs: acc.runs + Number(row.runs || 0),
      units: acc.units + Number(row.units || 0),
      costUsd: Number((acc.costUsd + Number(row.costUsd || 0)).toFixed(4))
    }), { runs: 0, units: 0, costUsd: 0 });
    return {
      range: { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
      features,
      totals,
      plans: grossMarginByPlan,
      grossMarginByPlan
    };
  }

  function saveProject({ workspaceId, userId, tool, title, payload, sourceProjectId }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
    const now = nowIso();
    const project = {
      id: createId("prj"),
      workspaceId,
      tool: cleanString(tool),
      title: cleanString(title, `${cleanString(tool, "Project")} ${new Date().toISOString().slice(0, 10)}`),
      sourceProjectId: cleanString(sourceProjectId),
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      payload: payload || {},
      versions: [
        {
          id: createId("ver"),
          createdAt: now,
          createdBy: userId,
          payload: payload || {}
        }
      ],
      handoffs: []
    };
    state.projects.push(project);
    persist();
    return project;
  }

  function updateProject({ workspaceId, userId, projectId, title, payload }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
    const project = state.projects.find((row) => row.id === projectId && row.workspaceId === workspaceId) || null;
    if (!project) {
      throw createError(404, "Project not found.");
    }
    if (cleanString(title)) {
      project.title = cleanString(title);
    }
    if (payload && typeof payload === "object") {
      project.payload = payload;
      project.versions.push({
        id: createId("ver"),
        createdAt: nowIso(),
        createdBy: userId,
        payload
      });
    }
    project.updatedAt = nowIso();
    persist();
    return project;
  }

  function listProjects({ workspaceId, userId, q = "", sort = "updated_desc" }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
    const needle = cleanString(q).toLowerCase();
    let rows = state.projects.filter((row) => row.workspaceId === workspaceId);
    if (needle) {
      rows = rows.filter((row) =>
        cleanString(row.title).toLowerCase().includes(needle)
        || cleanString(row.tool).toLowerCase().includes(needle)
      );
    }
    if (sort === "updated_asc") {
      rows.sort((a, b) => Date.parse(a.updatedAt || 0) - Date.parse(b.updatedAt || 0));
    } else if (sort === "title_asc") {
      rows.sort((a, b) => cleanString(a.title).localeCompare(cleanString(b.title)));
    } else {
      rows.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
    }
    return rows;
  }

  function getProject({ workspaceId, userId, projectId }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
    return state.projects.find((row) => row.workspaceId === workspaceId && row.id === projectId) || null;
  }

  function appendProjectExport({ workspaceId, userId, projectId, exportType, metadata }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
    const project = state.projects.find((row) => row.id === projectId && row.workspaceId === workspaceId) || null;
    if (!project) {
      throw createError(404, "Project not found.");
    }
    project.exports = ensureArray(project.exports);
    project.exports.push({
      id: createId("exp"),
      type: cleanString(exportType),
      metadata: metadata || {},
      createdBy: userId,
      createdAt: nowIso()
    });
    project.updatedAt = nowIso();
    persist();
    return project.exports[project.exports.length - 1];
  }

  function deleteProject({ workspaceId, userId, projectId }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
    const before = state.projects.length;
    state.projects = state.projects.filter((row) => !(row.workspaceId === workspaceId && row.id === projectId));
    persist();
    return before !== state.projects.length;
  }

  function createHandoff({ workspaceId, userId, fromTool, toTool, payload, sourceProjectId }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
    const handoff = {
      id: createId("hof"),
      workspaceId,
      createdBy: userId,
      fromTool: cleanString(fromTool),
      toTool: cleanString(toTool),
      sourceProjectId: cleanString(sourceProjectId),
      payload: payload || {},
      createdAt: nowIso()
    };
    state.handoffs = ensureArray(state.handoffs);
    state.handoffs.push(handoff);
    const sourceProject = sourceProjectId
      ? state.projects.find((row) => row.id === sourceProjectId && row.workspaceId === workspaceId)
      : null;
    if (sourceProject) {
      sourceProject.handoffs.push(handoff);
      sourceProject.updatedAt = nowIso();
    }
    persist();
    return handoff;
  }

  function getHandoff({ workspaceId, userId, handoffId }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
    const handoffs = ensureArray(state.handoffs);
    return handoffs.find((row) => row.id === handoffId && row.workspaceId === workspaceId) || null;
  }

  function createAnalyzerJob({ workspaceId, userId, payload }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
    const now = nowIso();
    const job = {
      id: createId("job"),
      workspaceId,
      userId,
      status: "queued",
      retries: 0,
      failureReason: "",
      payload: payload || {},
      result: null,
      createdAt: now,
      startedAt: "",
      completedAt: "",
      updatedAt: now
    };
    state.analyzerJobs.push(job);
    persist();
    return job;
  }

  function updateAnalyzerJob(jobId, patch = {}) {
    const job = state.analyzerJobs.find((row) => row.id === jobId) || null;
    if (!job) {
      throw createError(404, "Analyzer job not found.");
    }
    Object.assign(job, patch);
    job.updatedAt = nowIso();
    persist();
    return job;
  }

  function getAnalyzerJob(jobId, userId) {
    const job = state.analyzerJobs.find((row) => row.id === jobId) || null;
    if (!job) {
      return null;
    }
    requireWorkspaceRole(userId, job.workspaceId, ["owner", "editor", "viewer"]);
    return job;
  }

  function setOnboarding(userId, payload = {}) {
    const user = getUserById(userId);
    if (!user) {
      throw createError(404, "User not found.");
    }
    user.onboarding = {
      role: cleanString(payload.role),
      sermonCadence: cleanString(payload.sermonCadence),
      ministryContext: cleanString(payload.ministryContext),
      recommendedWorkflow: cleanArray(payload.recommendedWorkflow, 8),
      completedAt: nowIso()
    };
    user.updatedAt = nowIso();
    persist();
    return user.onboarding;
  }

  function processTrialLifecycle(nowMs = Date.now()) {
    const reminderWindows = [7, 3, 1];
    const notifications = [];
    for (const subscription of state.subscriptions) {
      if (subscription.status !== "trialing") {
        continue;
      }
      const trialEndsMs = Date.parse(subscription.trialEndsAt || 0);
      const daysLeft = Math.ceil((trialEndsMs - nowMs) / (24 * 60 * 60 * 1000));
      if (daysLeft <= 0) {
        subscription.status = "expired";
        subscription.planId = "free";
        subscription.updatedAt = nowIso();
        state.entitlementsAudit.push({
          id: createId("audit"),
          workspaceId: subscription.workspaceId,
          event: "trial_expired",
          source: "lifecycle",
          detail: "Trial ended and was downgraded to free.",
          createdAt: nowIso()
        });
      } else if (reminderWindows.includes(daysLeft)) {
        const user = getUserById(subscription.userId);
        if (!user || !user.emailPrefs || user.emailPrefs.lifecycle === false) {
          continue;
        }
        const note = {
          id: createId("note"),
          userId: user.id,
          type: "trial-reminder",
          title: `Trial expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
          body: "Upgrade now to keep premium workflows active.",
          cta: "/#homePricing",
          createdAt: nowIso(),
          readAt: null,
          payload: { daysLeft, workspaceId: subscription.workspaceId }
        };
        state.notifications.push(note);
        notifications.push(note);
      }
    }
    for (const user of state.users) {
      if (user.deletedAt || user.disabled) {
        continue;
      }
      if (user.emailPrefs && user.emailPrefs.lifecycle === false) {
        continue;
      }
      const recentPrepEvent = state.events
        .filter((event) => event.userId === user.id)
        .filter((event) => event.name === "generation_success")
        .filter((event) => Date.parse(event.createdAt || 0) >= nowMs - (7 * 24 * 60 * 60 * 1000))
        .length;
      if (recentPrepEvent === 0) {
        const note = {
          id: createId("note"),
          userId: user.id,
          type: "weekly-prep-reminder",
          title: "Weekly prep reminder",
          body: "Plan this week’s sermon or lesson with Bible AI Hub.",
          cta: "/",
          createdAt: nowIso(),
          readAt: null,
          payload: {}
        };
        state.notifications.push(note);
        notifications.push(note);
      }
    }
    if (notifications.length) {
      persist();
    } else {
      persist();
    }
    return notifications;
  }

  function listNotifications(userId, unreadOnly = false) {
    let rows = state.notifications.filter((row) => row.userId === userId);
    if (unreadOnly) {
      rows = rows.filter((row) => !row.readAt);
    }
    rows.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    return rows;
  }

  function markNotificationRead(userId, noteId) {
    const row = state.notifications.find((note) => note.id === noteId && note.userId === userId) || null;
    if (!row) {
      throw createError(404, "Notification not found.");
    }
    row.readAt = nowIso();
    persist();
    return row;
  }

  function createLearningPath({ workspaceId, userId, title, items }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
    const pathRow = {
      id: createId("path"),
      workspaceId,
      title: cleanString(title, "Learning Path"),
      createdBy: userId,
      items: normalizeLearningPathItems(items),
      visibility: "workspace",
      shareId: createId("share"),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.learningPaths.push(pathRow);
    persist();
    return pathRow;
  }

  function listLearningPaths({ workspaceId, userId }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
    return state.learningPaths
      .filter((row) => row.workspaceId === workspaceId)
      .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
  }

  function getLearningPath({ workspaceId, userId, pathId }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
    return state.learningPaths.find((row) => row.workspaceId === workspaceId && row.id === pathId) || null;
  }

  function updateLearningPath({ workspaceId, userId, pathId, patch = {} }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
    const row = state.learningPaths.find((pathRow) => pathRow.workspaceId === workspaceId && pathRow.id === pathId) || null;
    if (!row) {
      throw createError(404, "Learning path not found.");
    }
    if (cleanString(patch.title)) {
      row.title = cleanString(patch.title);
    }
    if (Array.isArray(patch.items)) {
      row.items = normalizeLearningPathItems(patch.items);
    }
    if (cleanString(patch.visibility) === "workspace" || cleanString(patch.visibility) === "private") {
      row.visibility = cleanString(patch.visibility);
    }
    row.updatedAt = nowIso();
    persist();
    return row;
  }

  function deleteLearningPath({ workspaceId, userId, pathId }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
    const before = state.learningPaths.length;
    state.learningPaths = state.learningPaths.filter((row) => !(row.workspaceId === workspaceId && row.id === pathId));
    persist();
    return before !== state.learningPaths.length;
  }

  function shareLearningPath({ workspaceId, userId, pathId }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
    const row = state.learningPaths.find((pathRow) => pathRow.workspaceId === workspaceId && pathRow.id === pathId) || null;
    if (!row) {
      throw createError(404, "Learning path not found.");
    }
    if (!cleanString(row.shareId)) {
      row.shareId = createId("share");
    }
    row.visibility = "workspace";
    row.updatedAt = nowIso();
    persist();
    return {
      id: row.id,
      shareId: row.shareId,
      shareUrl: `/ai/apps/video-search/?path=${encodeURIComponent(row.id)}&share=${encodeURIComponent(row.shareId)}`
    };
  }

  function createSeries({ workspaceId, userId, title, startDate, endDate, ownerId, weeks }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
    const row = {
      id: createId("series"),
      workspaceId,
      title: cleanString(title, "Untitled Series"),
      startDate: cleanString(startDate),
      endDate: cleanString(endDate),
      ownerId: cleanString(ownerId, userId),
      weeks: ensureArray(weeks).map((week, index) => ({
        id: createId("week"),
        order: Number(week.order || index + 1),
        date: cleanString(week.date),
        passage: cleanString(week.passage),
        theme: cleanString(week.theme),
        ownerId: cleanString(week.ownerId, userId)
      })),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.series.push(row);
    persist();
    return row;
  }

  function listSeries({ workspaceId, userId }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor", "viewer"]);
    return state.series
      .filter((row) => row.workspaceId === workspaceId)
      .sort((a, b) => Date.parse(a.startDate || 0) - Date.parse(b.startDate || 0));
  }

  function updateSeries({ workspaceId, userId, seriesId, patch }) {
    requireWorkspaceRole(userId, workspaceId, ["owner", "editor"]);
    const row = state.series.find((seriesRow) => seriesRow.id === seriesId && seriesRow.workspaceId === workspaceId) || null;
    if (!row) {
      throw createError(404, "Series not found.");
    }
    if (cleanString(patch.title)) {
      row.title = cleanString(patch.title);
    }
    if (cleanString(patch.startDate)) {
      row.startDate = cleanString(patch.startDate);
    }
    if (cleanString(patch.endDate)) {
      row.endDate = cleanString(patch.endDate);
    }
    if (Array.isArray(patch.weeks)) {
      row.weeks = ensureArray(patch.weeks).map((week, index) => ({
        id: cleanString(week.id, createId("week")),
        order: Number(week.order || index + 1),
        date: cleanString(week.date),
        passage: cleanString(week.passage),
        theme: cleanString(week.theme),
        ownerId: cleanString(week.ownerId, userId)
      }));
    }
    row.updatedAt = nowIso();
    persist();
    return row;
  }

  function upsertVideoGovernance(actorId, payload = {}) {
    const actor = getUserById(actorId);
    if (!actor || actor.role !== "admin") {
      throw createError(403, "Admin access required.");
    }
    const videoId = cleanString(payload.videoId);
    if (!videoId) {
      throw createError(400, "videoId is required.");
    }
    const tier = cleanString(payload.tier, "free") === "premium" ? "premium" : "free";
    const requiredPlans = ensureArray(payload.requiredPlans).map((planId) => cleanString(planId)).filter(Boolean);
    let row = state.videoGovernance.find((item) => item.videoId === videoId) || null;
    if (!row) {
      row = { id: createId("vidgov"), videoId, tier, requiredPlans, updatedAt: nowIso() };
      state.videoGovernance.push(row);
    } else {
      row.tier = tier;
      row.requiredPlans = requiredPlans;
      row.updatedAt = nowIso();
    }
    persist();
    return row;
  }

  function canAccessVideo(workspaceId, videoId) {
    const governance = state.videoGovernance.find((row) => row.videoId === videoId) || null;
    if (!governance || governance.tier !== "premium") {
      return { allowed: true, tier: "free" };
    }
    const entitlements = getWorkspaceEntitlements(workspaceId);
    const allowedByFeature = Boolean(entitlements.features["premium-video"]);
    const allowedByPlan = !governance.requiredPlans.length || governance.requiredPlans.includes(entitlements.planId);
    return {
      allowed: allowedByFeature && allowedByPlan,
      tier: "premium",
      reasonCode: allowedByFeature && allowedByPlan ? "ok" : "premium_required"
    };
  }

  function getSeatStats(workspaceId) {
    const workspace = getWorkspaceById(workspaceId);
    if (!workspace) {
      return { used: 0, limit: 0, remaining: 0 };
    }
    const plan = getPlanForWorkspace(workspaceId);
    const subscription = getActiveSubscription(workspaceId);
    const limit = Math.max(1, Number(subscription && subscription.seats || plan.seatLimit || 1));
    const used = workspace.members.length;
    return {
      used,
      limit,
      remaining: Math.max(0, limit - used)
    };
  }

  function updateSeatCount(actorId, workspaceId, seats) {
    requireWorkspaceRole(actorId, workspaceId, ["owner"]);
    const subscription = getActiveSubscription(workspaceId);
    if (!subscription) {
      throw createError(404, "Subscription not found for workspace.");
    }
    subscription.seats = Math.max(1, Number(seats || 1));
    subscription.updatedAt = nowIso();
    persist();
    return getSeatStats(workspaceId);
  }

  function getTeamDashboard(workspaceId, actorId) {
    requireWorkspaceRole(actorId, workspaceId, ["owner", "editor"]);
    const workspace = getWorkspaceById(workspaceId);
    const usage = usageSummary(workspaceId);
    const projectRows = state.projects.filter((row) => row.workspaceId === workspaceId);
    const activeUsers = new Set(
      state.usage
        .filter((row) => row.workspaceId === workspaceId)
        .filter((row) => Date.parse(row.createdAt || 0) >= Date.now() - (7 * 24 * 60 * 60 * 1000))
        .map((row) => row.userId)
    ).size;
    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        memberCount: workspace.members.length
      },
      seats: getSeatStats(workspaceId),
      activeUsersLast7d: activeUsers,
      weeklyOutputVolume: projectRows.filter((row) => Date.parse(row.updatedAt || 0) >= Date.now() - (7 * 24 * 60 * 60 * 1000)).length,
      usage
    };
  }

  function checkRateLimit({ key, limit = 100, windowMs = 60 * 1000 }) {
    const now = Date.now();
    const slot = rateLimiter.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > slot.resetAt) {
      slot.count = 0;
      slot.resetAt = now + windowMs;
    }
    slot.count += 1;
    rateLimiter.set(key, slot);
    return {
      allowed: slot.count <= limit,
      count: slot.count,
      resetAt: slot.resetAt
    };
  }

  function logAbuse(event) {
    state.events.push({
      id: createId("evt"),
      name: "abuse_detected",
      version: 1,
      userId: cleanString(event.userId),
      workspaceId: cleanString(event.workspaceId),
      sessionId: cleanString(event.sessionId),
      source: "api",
      properties: event,
      createdAt: nowIso()
    });
    persist();
  }

  return {
    dataPath,
    state,
    PLAN_CATALOG,
    FEATURE_LIMIT_KEYS,
    persist,
    nowIso,
    getUserById,
    getWorkspaceById,
    getPrimaryWorkspaceIdForUser,
    sanitizeUser,
    signup,
    login,
    loginGoogle,
    requestMagicLink,
    verifyMagicLink,
    logout,
    refreshSession,
    requestPasswordReset,
    resetPassword,
    deleteAccount,
    adminDisableUser,
    resolveAuth,
    listWorkspacesForUser,
    getWorkspaceRole,
    requireWorkspaceRole,
    setActiveWorkspace,
    createWorkspace,
    addWorkspaceMember,
    updateWorkspaceMemberRole,
    acceptInvite,
    setWorkspaceAppAccess,
    roleToolAccessAllowed,
    getActiveSubscription,
    getPlanForWorkspace,
    createCheckout,
    openBillingPortal,
    applyWebhook,
    getWorkspaceEntitlements,
    addEntitlementOverride,
    getEntitlementAudit,
    getUsageForWorkspace,
    usageSummary,
    usageForecast,
    recordUsage,
    checkQuota,
    getWorkspaceActivity,
    trackEvent,
    getActivationDashboard,
    getCogsDashboard,
    saveProject,
    updateProject,
    listProjects,
    getProject,
    appendProjectExport,
    deleteProject,
    createHandoff,
    getHandoff,
    createAnalyzerJob,
    updateAnalyzerJob,
    getAnalyzerJob,
    setOnboarding,
    processTrialLifecycle,
    listNotifications,
    markNotificationRead,
    createLearningPath,
    listLearningPaths,
    getLearningPath,
    updateLearningPath,
    deleteLearningPath,
    shareLearningPath,
    createSeries,
    listSeries,
    updateSeries,
    upsertVideoGovernance,
    canAccessVideo,
    getCreditStatus,
    checkCredits,
    consumeCredits,
    getSeatStats,
    updateSeatCount,
    getTeamDashboard,
    checkRateLimit,
    logAbuse
  };
}

function loadState(dataPath) {
  if (!fs.existsSync(dataPath)) {
    const seed = {
      users: [],
      sessions: [],
      passwordResets: [],
      magicLinks: [],
      workspaces: [],
      subscriptions: [],
      webhookEvents: [],
      entitlementOverrides: [],
      entitlementsAudit: [],
      usage: [],
      events: [],
      projects: [],
      handoffs: [],
      analyzerJobs: [],
      notifications: [],
      learningPaths: [],
      series: [],
      teamInvites: [],
      videoGovernance: []
    };
    fs.writeFileSync(dataPath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
    return seed;
  }
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      users: ensureArray(parsed.users),
      sessions: ensureArray(parsed.sessions),
      passwordResets: ensureArray(parsed.passwordResets),
      magicLinks: ensureArray(parsed.magicLinks),
      workspaces: ensureArray(parsed.workspaces),
      subscriptions: ensureArray(parsed.subscriptions),
      webhookEvents: ensureArray(parsed.webhookEvents),
      entitlementOverrides: ensureArray(parsed.entitlementOverrides),
      entitlementsAudit: ensureArray(parsed.entitlementsAudit),
      usage: ensureArray(parsed.usage),
      events: ensureArray(parsed.events),
      projects: ensureArray(parsed.projects),
      handoffs: ensureArray(parsed.handoffs),
      analyzerJobs: ensureArray(parsed.analyzerJobs),
      notifications: ensureArray(parsed.notifications),
      learningPaths: ensureArray(parsed.learningPaths),
      series: ensureArray(parsed.series),
      teamInvites: ensureArray(parsed.teamInvites),
      videoGovernance: ensureArray(parsed.videoGovernance)
    };
  } catch (_) {
    return loadStateWithBackup(dataPath);
  }
}

function loadStateWithBackup(dataPath) {
  const backupPath = `${dataPath}.corrupt.${Date.now()}.bak`;
  try {
    fs.copyFileSync(dataPath, backupPath);
  } catch (_) {
    // Best effort only.
  }
  fs.writeFileSync(dataPath, JSON.stringify({
    users: [],
    sessions: [],
    passwordResets: [],
    magicLinks: [],
    workspaces: [],
    subscriptions: [],
    webhookEvents: [],
    entitlementOverrides: [],
    entitlementsAudit: [],
    usage: [],
    events: [],
    projects: [],
    handoffs: [],
    analyzerJobs: [],
    notifications: [],
    learningPaths: [],
    series: [],
    teamInvites: [],
    videoGovernance: []
  }, null, 2), "utf8");
  return loadState(dataPath);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveWritableDataPath(preferredPath) {
  const preferredDir = path.dirname(preferredPath);
  try {
    ensureDir(preferredDir);
    fs.accessSync(preferredDir, fs.constants.W_OK);
    return preferredPath;
  } catch (_) {
    const fallbackDir = path.join(os.tmpdir(), "bible-ai-hub", "server", "data");
    ensureDir(fallbackDir);
    return path.join(fallbackDir, "platform-state.json");
  }
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString("hex")}`;
}

function isAdminEmail(email) {
  return normalizeEmail(email) === normalizeEmail(ADMIN_EMAIL);
}

function isGuestEmail(email) {
  return normalizeEmail(email).endsWith(GUEST_EMAIL_DOMAIN);
}

function defaultCreditsForEmail(email) {
  const safeEmail = normalizeEmail(email);
  if (isAdminEmail(safeEmail)) {
    return ADMIN_DEFAULT_CREDITS;
  }
  if (isGuestEmail(safeEmail)) {
    return GUEST_DEFAULT_CREDITS;
  }
  return null;
}

function applyAccountDefaults(user) {
  if (!user || typeof user !== "object") {
    return false;
  }
  const safeEmail = normalizeEmail(user.email);
  let changed = false;

  if (isAdminEmail(safeEmail) && user.role !== "admin") {
    user.role = "admin";
    changed = true;
  }
  if (!cleanString(user.role)) {
    user.role = "user";
    changed = true;
  }

  if (isAdminEmail(safeEmail)) {
    if (!Number.isFinite(Number(user.credits)) || Number(user.credits) < ADMIN_DEFAULT_CREDITS) {
      user.credits = ADMIN_DEFAULT_CREDITS;
      changed = true;
    }
  } else if (isGuestEmail(safeEmail)) {
    if (!Number.isFinite(Number(user.credits))) {
      user.credits = GUEST_DEFAULT_CREDITS;
      changed = true;
    }
  } else if (typeof user.credits === "undefined") {
    user.credits = null;
    changed = true;
  }

  return changed;
}

function createToken() {
  return crypto.randomBytes(28).toString("hex");
}

function normalizeEmail(email) {
  return cleanString(email).toLowerCase();
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

function cleanArray(value, max = 8) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => cleanString(item))
    .filter(Boolean)
    .slice(0, max);
}

function normalizeLearningPathItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => ({
      id: cleanString(item && item.id, createId("step")),
      order: Number(item && item.order) || (index + 1),
      title: cleanString(item && item.title),
      videoId: cleanString(item && item.videoId),
      timestampSeconds: Number(item && item.timestampSeconds || 0),
      url: cleanString(item && item.url),
      goal: cleanString(item && item.goal),
      notes: cleanString(item && item.notes)
    }))
    .filter((row) => row.title || row.videoId || row.url)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function normalizeRole(role) {
  const safe = cleanString(role, "viewer").toLowerCase();
  if (safe === "owner" || safe === "editor" || safe === "viewer") {
    return safe;
  }
  return "viewer";
}

function normalizeOveragePolicy(value) {
  const safe = value && typeof value === "object" ? value : {};
  const defaultPolicy = safe.default && typeof safe.default === "object"
    ? safe.default
    : DEFAULT_OVERAGE_POLICY;
  const normalized = {
    default: {
      mode: cleanString(defaultPolicy.mode, cleanString(DEFAULT_OVERAGE_POLICY.mode)),
      resetCadence: cleanString(defaultPolicy.resetCadence, cleanString(DEFAULT_OVERAGE_POLICY.resetCadence)),
      message: cleanString(defaultPolicy.message, cleanString(DEFAULT_OVERAGE_POLICY.message))
    }
  };

  for (const [featureKey, row] of Object.entries(safe)) {
    if (featureKey === "default") {
      continue;
    }
    const source = row && typeof row === "object" ? row : {};
    normalized[featureKey] = {
      mode: cleanString(source.mode, normalized.default.mode),
      resetCadence: cleanString(source.resetCadence, normalized.default.resetCadence),
      message: cleanString(source.message, normalized.default.message)
    };
  }

  return normalized;
}

function resolveFeatureOveragePolicy(overagePolicy, feature) {
  const normalized = normalizeOveragePolicy(overagePolicy);
  const specific = normalized[cleanString(feature)];
  return specific || normalized.default;
}

function countBy(rows, key) {
  const counts = {};
  for (const row of ensureArray(rows)) {
    const value = cleanString(row && row[key]);
    if (!value) {
      continue;
    }
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function validateEvent(row) {
  const name = cleanString(row && row.name);
  if (!name) {
    throw createError(400, "Event name is required.");
  }
  if (!/^[a-z0-9_.-]{3,80}$/i.test(name)) {
    throw createError(400, "Event name is invalid.");
  }
  const properties = row && row.properties;
  if (properties && typeof properties !== "object") {
    throw createError(400, "Event properties must be an object.");
  }
}

function createError(status, message, extras = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extras);
  return error;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password, encoded) {
  if (!encoded || !encoded.startsWith("scrypt$")) {
    return false;
  }
  const parts = encoded.split("$");
  if (parts.length !== 3) {
    return false;
  }
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(String(password || ""), salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  createPlatformStore,
  PLAN_CATALOG,
  PLAN_MAP,
  FEATURE_LIMIT_KEYS
};
