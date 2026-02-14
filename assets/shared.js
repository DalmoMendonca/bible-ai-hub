(function () {
  const STOP_WORDS = new Set([
    "the", "and", "for", "that", "with", "this", "from", "have", "your", "you", "our",
    "are", "was", "were", "their", "will", "into", "about", "there", "what", "when",
    "where", "which", "while", "been", "being", "them", "they", "then", "than", "does",
    "did", "done", "through", "these", "those", "after", "before", "because", "under",
    "over", "within", "without", "would", "could", "should", "may", "might", "must",
    "unto", "upon", "said", "says", "his", "her", "him", "she", "has", "had", "not",
    "but", "all", "any", "each", "every", "who", "whom", "whose", "how", "why", "can",
    "also", "therefore", "thus", "therein", "thereof", "it", "its"
  ]);

  const FALLBACK_PASSAGES = {
    "john 3:16": {
      reference: "John 3:16",
      text: "For God so loved the world, that he gave his only Son, that whoever believes in him should not perish but have eternal life.",
      translation_name: "WEB"
    },
    "romans 12:1-2": {
      reference: "Romans 12:1-2",
      text: "I urge you therefore, brothers, by the mercies of God, to present your bodies a living sacrifice, holy, acceptable to God, which is your spiritual service. Don't be conformed to this world, but be transformed by the renewing of your mind, so that you may prove what is the good, well-pleasing, and perfect will of God.",
      translation_name: "WEB"
    },
    "psalm 23": {
      reference: "Psalm 23",
      text: "The LORD is my shepherd: I shall lack nothing. He makes me lie down in green pastures. He leads me beside still waters. He restores my soul.",
      translation_name: "WEB"
    }
  };
  const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";
  const STORAGE_KEYS = {
    token: "bah_session_token",
    user: "bah_user",
    workspaceId: "bah_workspace_id",
    theme: "bah_theme"
  };
  const THEME_DARK = "dark";
  const THEME_LIGHT = "light";
  const ADMIN_EMAIL = "dalmomendonca@gmail.com";
  const DEFAULT_ONBOARDING_QUESTIONS = [
    "What best describes your role right now?",
    "How often are you preparing sermons or lessons?",
    "What outcome matters most this month?"
  ];
  let authState = {
    token: "",
    user: null,
    workspaceId: ""
  };
  let authReadyPromise = null;
  let featureFlagsState = null;
  let themeState = THEME_LIGHT;
  let analyticsBootPromise = null;
  let analyticsMeasurementId = "";
  disableLegacyServiceWorkers();
  applyInitialTheme();

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeReference(reference) {
    return String(reference || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function parseChapterRangeReference(reference) {
    const clean = String(reference || "").trim();
    if (!clean || clean.includes(":")) {
      return null;
    }

    const match = clean.match(/^(.+?)\s+(\d{1,3})\s*-\s*(\d{1,3})$/i);
    if (!match) {
      return null;
    }

    const book = match[1].trim();
    const start = Number(match[2]);
    const end = Number(match[3]);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return null;
    }

    const span = end - start + 1;
    if (span < 2) {
      return null;
    }

    if (span > 12) {
      return {
        book,
        start,
        end,
        references: [],
        tooLarge: true
      };
    }

    const references = [];
    for (let chapter = start; chapter <= end; chapter += 1) {
      references.push(`${book} ${chapter}`);
    }

    return {
      book,
      start,
      end,
      references,
      tooLarge: false
    };
  }

  async function fetchBibleApiPassage(reference) {
    const clean = String(reference || "").trim();
    const url = `https://bible-api.com/${encodeURIComponent(clean)}?translation=web`;

    let response;
    try {
      response = await fetch(url);
    } catch (_) {
      throw new Error("Unable to reach Bible API right now.");
    }

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }

    if (!response.ok || data.error) {
      const detail = cleanString(data.detail);
      const apiError = cleanString(data.error);
      const message =
        detail
        || apiError
        || `Unable to fetch passage right now (HTTP ${response.status}).`;
      const error = new Error(message);
      error.apiError = apiError;
      error.detail = detail;
      throw error;
    }

    return {
      reference: cleanString(data.reference, clean),
      text: cleanString(data.text).replace(/\s+/g, " "),
      translation_name: cleanString(data.translation_name, "WEB")
    };
  }

  async function fetchWholeChapterRange(range) {
    const passages = [];
    for (const chapterRef of range.references) {
      const passage = await fetchBibleApiPassage(chapterRef);
      passages.push(passage);
    }

    return {
      reference: `${range.book} ${range.start}-${range.end}`,
      text: passages.map((passage) => cleanString(passage.text)).join("\n\n"),
      translation_name: passages[0] ? passages[0].translation_name : "WEB"
    };
  }

  async function fetchBiblePassage(reference) {
    const clean = String(reference || "").trim();
    if (!clean) {
      throw new Error("Enter a passage reference first.");
    }

    try {
      return await fetchBibleApiPassage(clean);
    } catch (error) {
      const chapterRange = parseChapterRangeReference(clean);
      if (chapterRange) {
        if (chapterRange.tooLarge) {
          throw new Error("That chapter range is too large. Please request 12 chapters or fewer at a time.");
        }

        try {
          return await fetchWholeChapterRange(chapterRange);
        } catch (_) {
          // fall through to fallback + original error below
        }
      }

      const fallback = FALLBACK_PASSAGES[normalizeReference(clean)];
      if (fallback) {
        return fallback;
      }

      throw error;
    }
  }

  function applyTheme(theme, persist) {
    const safeTheme = cleanString(theme, THEME_LIGHT) === THEME_DARK ? THEME_DARK : THEME_LIGHT;
    themeState = safeTheme;
    const root = document.documentElement;
    if (root) {
      root.setAttribute("data-theme", safeTheme);
    }
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEYS.theme, safeTheme);
      } catch (_) {
        // ignore localStorage write failures
      }
    }
    return safeTheme;
  }

  function readStoredTheme() {
    try {
      const raw = cleanString(localStorage.getItem(STORAGE_KEYS.theme), "");
      if (raw === THEME_DARK || raw === THEME_LIGHT) {
        return raw;
      }
    } catch (_) {
      // ignore localStorage read failures
    }
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return THEME_DARK;
    }
    return THEME_LIGHT;
  }

  function applyInitialTheme() {
    applyTheme(readStoredTheme(), false);
  }

  function toggleTheme() {
    const next = themeState === THEME_DARK ? THEME_LIGHT : THEME_DARK;
    return applyTheme(next, true);
  }

  function isGuestUser(user) {
    const email = cleanString(user && user.email).toLowerCase();
    return Boolean(
      user
      && (user.isGuest || email.endsWith("@local.bibleaihub"))
    );
  }

  function isAdminUser(user) {
    const email = cleanString(user && user.email).toLowerCase();
    return cleanString(user && user.role).toLowerCase() === "admin"
      || email === ADMIN_EMAIL;
  }

  function currentCreditsLabel(user) {
    const credits = user && Number.isFinite(Number(user.credits))
      ? Number(user.credits)
      : null;
    return credits === null ? "Unlimited" : String(credits);
  }

  function readStoredAuth() {
    try {
      const token = localStorage.getItem(STORAGE_KEYS.token) || "";
      const workspaceId = localStorage.getItem(STORAGE_KEYS.workspaceId) || "";
      const userRaw = localStorage.getItem(STORAGE_KEYS.user) || "";
      const user = userRaw ? JSON.parse(userRaw) : null;
      authState = { token, workspaceId, user };
    } catch (_) {
      authState = { token: "", workspaceId: "", user: null };
    }
    return authState;
  }

  function storeAuth(data) {
    const token = cleanString(data && data.sessionToken);
    const user = data && data.user && typeof data.user === "object" ? data.user : null;
    const workspaceId = cleanString(data && data.workspaceId);
    authState = {
      token,
      user,
      workspaceId
    };
    try {
      if (token) {
        localStorage.setItem(STORAGE_KEYS.token, token);
      } else {
        localStorage.removeItem(STORAGE_KEYS.token);
      }
      if (workspaceId) {
        localStorage.setItem(STORAGE_KEYS.workspaceId, workspaceId);
      } else {
        localStorage.removeItem(STORAGE_KEYS.workspaceId);
      }
      if (user) {
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
      } else {
        localStorage.removeItem(STORAGE_KEYS.user);
      }
    } catch (_) {
      // Ignore localStorage write failures.
    }
    featureFlagsState = null;
  }

  function clearStoredAuth() {
    authState = { token: "", user: null, workspaceId: "" };
    try {
      localStorage.removeItem(STORAGE_KEYS.token);
      localStorage.removeItem(STORAGE_KEYS.user);
      localStorage.removeItem(STORAGE_KEYS.workspaceId);
    } catch (_) {
      // ignore
    }
    featureFlagsState = null;
  }

  function getMagicLinkTokenFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      return cleanString(
        params.get("magicLinkToken")
        || params.get("magic_link_token")
        || params.get("token")
      );
    } catch (_) {
      return "";
    }
  }

  function stripMagicLinkTokenFromUrl() {
    try {
      const url = new URL(window.location.href);
      let changed = false;
      ["magicLinkToken", "magic_link_token", "token"].forEach((key) => {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
          changed = true;
        }
      });
      if (!changed) {
        return;
      }
      const search = url.searchParams.toString();
      const cleaned = `${url.pathname}${search ? `?${search}` : ""}${url.hash || ""}`;
      window.history.replaceState({}, "", cleaned);
    } catch (_) {
      // best effort only
    }
  }

  function authHeaders(extraHeaders) {
    const headers = {
      ...(extraHeaders || {})
    };
    if (authState.token) {
      headers.Authorization = `Bearer ${authState.token}`;
      headers["X-Session-Token"] = authState.token;
    }
    if (authState.workspaceId) {
      headers["X-Workspace-Id"] = authState.workspaceId;
    }
    return headers;
  }

  async function rawApiRequest(url, options) {
    try {
      return await fetch(`${API_BASE}${url}`, options);
    } catch (_) {
      throw new Error("Cannot reach local AI API. Start the app with `npm start` and open http://localhost:3000/ai/.");
    }
  }

  async function ensureAuthSession() {
    const urlMagicToken = getMagicLinkTokenFromUrl();
    if (urlMagicToken) {
      try {
        const auth = await publicApiPost("/api/auth/magic-link/verify", { token: urlMagicToken });
        storeAuth(auth || {});
      } catch (_) {
        // if token is invalid, continue with regular auth bootstrap
      } finally {
        stripMagicLinkTokenFromUrl();
      }
    }

    readStoredAuth();
    if (authState.token) {
      const existing = await rawApiRequest("/api/auth/session", {
        method: "GET",
        headers: authHeaders()
      });
      if (existing.ok) {
        const payload = await existing.json().catch(() => ({}));
        if (payload && payload.user) {
          storeAuth({
            sessionToken: authState.token,
            user: payload.user,
            workspaceId: payload.activeWorkspaceId || authState.workspaceId
          });
          return authState;
        }
      }
    }
    const guestResponse = await rawApiRequest("/api/auth/guest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    if (!guestResponse.ok) {
      const guestErrorPayload = await guestResponse.json().catch(() => ({}));
      throw new Error(cleanString(guestErrorPayload && guestErrorPayload.error, "Unable to initialize session."));
    }
    const guestData = await guestResponse.json().catch(() => ({}));
    storeAuth(guestData || {});
    if (authState.user && !authState.user.onboarding && String(window.location.pathname || "").startsWith("/ai/apps/")) {
      void promptOnboardingOnce();
    }
    return authState;
  }

  function ensureAuthReady() {
    if (!authReadyPromise) {
      authReadyPromise = ensureAuthSession().catch((error) => {
        clearStoredAuth();
        throw error;
      });
    }
    return authReadyPromise;
  }

  async function apiRequest(url, options = {}) {
    await ensureAuthReady();
    const requestOptions = { ...(options || {}) };
    requestOptions.headers = authHeaders(requestOptions.headers);

    let response = await rawApiRequest(url, requestOptions);
    if (response.status === 401) {
      clearStoredAuth();
      authReadyPromise = null;
      await ensureAuthReady();
      requestOptions.headers = authHeaders(options.headers);
      response = await rawApiRequest(url, requestOptions);
    }

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }

    if (!response.ok) {
      const message = data && data.error ? data.error : `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = data;
      throw error;
    }

    return data;
  }

  async function apiGet(url, options = {}) {
    return apiRequest(url, {
      ...(options || {}),
      method: "GET"
    });
  }

  async function apiPost(url, payload, options = {}) {
    const requestOptions = options && typeof options === "object" ? options : {};
    const extraHeaders = requestOptions.headers && typeof requestOptions.headers === "object"
      ? requestOptions.headers
      : {};
    return apiRequest(url, {
      ...requestOptions,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders
      },
      body: JSON.stringify(payload || {})
    });
  }

  async function publicApiPost(url, payload) {
    const response = await rawApiRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && data.error ? data.error : `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function publicApiGet(url) {
    const response = await rawApiRequest(url, {
      method: "GET"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && data.error ? data.error : `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function apiPatch(url, payload, options = {}) {
    const requestOptions = options && typeof options === "object" ? options : {};
    const extraHeaders = requestOptions.headers && typeof requestOptions.headers === "object"
      ? requestOptions.headers
      : {};
    return apiRequest(url, {
      ...requestOptions,
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders
      },
      body: JSON.stringify(payload || {})
    });
  }

  async function apiDelete(url, options = {}) {
    return apiRequest(url, {
      ...(options || {}),
      method: "DELETE"
    });
  }

  async function apiPostForm(url, formData, options = {}) {
    return apiRequest(url, {
      ...(options && typeof options === "object" ? options : {}),
      method: "POST",
      body: formData
    });
  }

  async function getFeatureFlags(options = {}) {
    const force = Boolean(options && options.force);
    if (featureFlagsState && !force) {
      return featureFlagsState;
    }
    const payload = await apiGet("/api/feature-flags");
    featureFlagsState = payload && typeof payload === "object"
      ? payload
      : { flags: {} };
    return featureFlagsState;
  }

  async function isFeatureEnabled(flagKey, fallback = false) {
    const key = cleanString(flagKey);
    if (!key) {
      return Boolean(fallback);
    }
    try {
      const payload = await getFeatureFlags();
      const row = payload && payload.flags && typeof payload.flags === "object"
        ? payload.flags[key]
        : null;
      if (row && typeof row.enabled === "boolean") {
        return row.enabled;
      }
    } catch (_) {
      // If feature-flag fetch fails, fall back to caller default.
    }
    return Boolean(fallback);
  }

  function splitSentences(text) {
    return String(text || "")
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  function tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1);
  }

  function topKeywords(text, max = 8) {
    const tokens = tokenize(text).filter((token) => !STOP_WORDS.has(token));
    const counts = new Map();

    for (const token of tokens) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([word, count]) => ({ word, count }));
  }

  function countSyllables(word) {
    const clean = String(word || "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");

    if (!clean) {
      return 0;
    }

    const stripped = clean.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    const groups = stripped.match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  function textMetrics(text) {
    const words = tokenize(text);
    const sentences = splitSentences(text);
    const wordCount = words.length;
    const sentenceCount = Math.max(1, sentences.length);
    const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);

    const avgSentenceLength = wordCount / sentenceCount;
    const flesch = 206.835 - 1.015 * avgSentenceLength - 84.6 * (syllables / Math.max(wordCount, 1));

    return {
      wordCount,
      sentenceCount,
      avgSentenceLength: Number(avgSentenceLength.toFixed(1)),
      readability: Number(flesch.toFixed(1)),
      readabilityBand: flesch >= 70 ? "Easy" : flesch >= 55 ? "Moderate" : flesch >= 40 ? "Challenging" : "Dense"
    };
  }

  function estimatePassiveVoice(text) {
    const sentences = splitSentences(text);
    const passivePattern = /\b(am|is|are|was|were|be|been|being)\s+\w+(ed|en)\b/i;
    const matches = sentences.filter((sentence) => passivePattern.test(sentence));

    return {
      count: matches.length,
      ratio: sentences.length ? matches.length / sentences.length : 0,
      examples: matches.slice(0, 3)
    };
  }

  function findScriptureReferences(text) {
    const pattern = /\b(?:[1-3]\s*)?[A-Z][a-z]+\s+\d{1,3}(?::\d{1,3}(?:-\d{1,3})?)?/g;
    return String(text || "").match(pattern) || [];
  }

  function toScoreClass(score) {
    if (score >= 8) return "high";
    if (score >= 5) return "mid";
    return "low";
  }

  function renderScore(score) {
    const bounded = Math.max(0, Math.min(10, Number(score || 0))).toFixed(1);
    return `<span class="score ${toScoreClass(Number(bounded))}">${bounded}/10</span>`;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function summarizeKeywords(keywords) {
    return keywords
      .map((item) => `${item.word} (${item.count})`)
      .join(", ");
  }

  function highlightTerms(text, terms) {
    let output = String(text || "");
    const uniqueTerms = Array.from(new Set((terms || []).filter(Boolean))).sort((a, b) => b.length - a.length);

    for (const term of uniqueTerms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      output = output.replace(new RegExp(`(${escaped})`, "ig"), "<mark class=\"highlight\">$1</mark>");
    }

    return output;
  }

  function createEl(tag, className, html) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (typeof html === "string") element.innerHTML = html;
    return element;
  }

  function setBusy(button, busyText, isBusy) {
    if (!button) {
      return;
    }

    if (!button.dataset.originalLabel) {
      button.dataset.originalLabel = button.textContent || "";
    }

    button.disabled = Boolean(isBusy);
    button.textContent = isBusy ? busyText : button.dataset.originalLabel;
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

  function normalizeAnalyticsEventName(name) {
    return cleanString(name)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "event";
  }

  function normalizeAnalyticsValue(value) {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    return cleanString(value).slice(0, 120);
  }

  function normalizeAnalyticsParams(properties) {
    const input = properties && typeof properties === "object" ? properties : {};
    const output = {};
    for (const [key, value] of Object.entries(input)) {
      const safeKey = cleanString(key)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
      if (!safeKey) {
        continue;
      }
      output[safeKey] = normalizeAnalyticsValue(value);
    }
    return output;
  }

  function getMetaAnalyticsId() {
    const meta = document.querySelector('meta[name="bah-ga-id"]');
    return cleanString(meta && meta.content);
  }

  function loadAnalyticsScript(measurementId) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-bah-ga]");
      if (existing) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      script.setAttribute("data-bah-ga", "1");
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Google Analytics script."));
      document.head.appendChild(script);
    });
  }

  async function bootAnalytics() {
    if (analyticsBootPromise) {
      return analyticsBootPromise;
    }
    analyticsBootPromise = (async () => {
      let measurementId = getMetaAnalyticsId();
      if (!measurementId) {
        try {
          const config = await publicApiGet("/api/public-config");
          measurementId = cleanString(config && config.gaMeasurementId);
        } catch (_) {
          measurementId = "";
        }
      }
      if (!measurementId) {
        return;
      }
      await loadAnalyticsScript(measurementId);
      window.dataLayer = window.dataLayer || [];
      function gtag() {
        window.dataLayer.push(arguments);
      }
      if (typeof window.gtag !== "function") {
        window.gtag = gtag;
      }
      window.gtag("js", new Date());
      window.gtag("config", measurementId, {
        anonymize_ip: true,
        transport_type: "beacon",
        send_page_view: true
      });
      analyticsMeasurementId = measurementId;
      const user = authState && authState.user ? authState.user : null;
      window.gtag("set", "user_properties", {
        role: cleanString(user && user.role, "guest"),
        is_guest: isGuestUser(user),
        workspace_id: cleanString(authState && authState.workspaceId)
      });
    })().catch(() => {
      analyticsMeasurementId = "";
    });
    return analyticsBootPromise;
  }

  function trackAnalyticsEvent(name, properties) {
    if (!analyticsMeasurementId || typeof window.gtag !== "function") {
      return;
    }
    window.gtag("event", normalizeAnalyticsEventName(name), {
      page_path: cleanString(window.location && window.location.pathname),
      ...normalizeAnalyticsParams(properties)
    });
  }

  async function trackEvent(name, properties) {
    trackAnalyticsEvent(name, properties);
    try {
      await apiPost("/api/events", {
        name,
        source: "web",
        properties: properties || {}
      });
    } catch (_) {
      // Event tracking failures should never break the UX.
    }
  }

  async function saveProject(tool, title, payload) {
    return apiPost("/api/projects", {
      workspaceId: authState.workspaceId,
      tool: cleanString(tool),
      title: cleanString(title, `${cleanString(tool, "Project")} ${new Date().toLocaleDateString()}`),
      payload: payload || {}
    });
  }

  async function getProject(projectId) {
    return apiGet(`/api/projects/${encodeURIComponent(cleanString(projectId))}?workspaceId=${encodeURIComponent(authState.workspaceId)}`);
  }

  async function updateProject(projectId, payload) {
    return apiPatch(`/api/projects/${encodeURIComponent(cleanString(projectId))}`, {
      workspaceId: authState.workspaceId,
      payload: payload || {}
    });
  }

  async function listProjects(query, sort) {
    const q = encodeURIComponent(cleanString(query));
    const s = encodeURIComponent(cleanString(sort, "updated_desc"));
    return apiGet(`/api/projects?workspaceId=${encodeURIComponent(authState.workspaceId)}&q=${q}&sort=${s}`);
  }

  async function deleteProject(projectId) {
    return apiDelete(`/api/projects/${encodeURIComponent(cleanString(projectId))}?workspaceId=${encodeURIComponent(authState.workspaceId)}`);
  }

  async function appendProjectExport(projectId, exportType, metadata) {
    return apiPost(`/api/projects/${encodeURIComponent(cleanString(projectId))}/exports`, {
      workspaceId: authState.workspaceId,
      exportType: cleanString(exportType),
      metadata: metadata || {}
    });
  }

  async function createHandoff(fromTool, toTool, payload, sourceProjectId) {
    return apiPost("/api/handoffs", {
      workspaceId: authState.workspaceId,
      fromTool: cleanString(fromTool),
      toTool: cleanString(toTool),
      payload: payload || {},
      sourceProjectId: cleanString(sourceProjectId)
    });
  }

  async function getHandoff(handoffId) {
    return apiGet(`/api/handoffs/${encodeURIComponent(cleanString(handoffId))}?workspaceId=${encodeURIComponent(authState.workspaceId)}`);
  }

  async function createLearningPath(title, items) {
    return apiPost("/api/learning-paths", {
      workspaceId: authState.workspaceId,
      title: cleanString(title),
      items: Array.isArray(items) ? items : []
    });
  }

  async function listLearningPaths() {
    return apiGet(`/api/learning-paths?workspaceId=${encodeURIComponent(authState.workspaceId)}`);
  }

  async function getLearningPath(pathId) {
    return apiGet(`/api/learning-paths/${encodeURIComponent(cleanString(pathId))}?workspaceId=${encodeURIComponent(authState.workspaceId)}`);
  }

  async function updateLearningPath(pathId, patch) {
    return apiPatch(`/api/learning-paths/${encodeURIComponent(cleanString(pathId))}`, {
      workspaceId: authState.workspaceId,
      ...(patch && typeof patch === "object" ? patch : {})
    });
  }

  async function deleteLearningPath(pathId) {
    return apiDelete(`/api/learning-paths/${encodeURIComponent(cleanString(pathId))}?workspaceId=${encodeURIComponent(authState.workspaceId)}`);
  }

  async function shareLearningPath(pathId) {
    return apiPost(`/api/learning-paths/${encodeURIComponent(cleanString(pathId))}/share`, {
      workspaceId: authState.workspaceId
    });
  }

  function headerShellHtml(state) {
    const userName = cleanString(state && state.user && state.user.name, "Guest");
    const guest = isGuestUser(state && state.user);
    const creditsLabel = currentCreditsLabel(state && state.user);
    const accountLabel = guest ? "Account" : userName;
    return `
      <div class="bah-shell" aria-label="Global navigation">
        <nav class="bah-cluster bah-cluster-primary" aria-label="Primary">
          <a class="header-link bah-link-pill" href="/#homePricing">Pricing</a>
          <button type="button" class="header-link bah-link-pill bah-projects-btn" data-bah-projects>Projects</button>
          <button type="button" class="header-link bah-link-pill bah-notice-btn" data-bah-notices>Notices</button>
        </nav>
        <div class="bah-cluster bah-cluster-account" aria-label="Account and settings">
          <span class="bah-credit-chip" title="Remaining monthly credits">Credits <strong>${escapeHtml(creditsLabel)}</strong></span>
          ${guest
            ? `<button type="button" class="header-link bah-link-pill bah-link-pill-primary bah-auth-btn" data-bah-auth-open>Sign In</button>`
            : `<button type="button" class="header-link bah-link-pill bah-feedback-btn" data-bah-feedback-open>Feedback</button>`}
          <label class="bah-workspace-wrap">
            <span class="bah-workspace-label">Workspace</span>
            <select class="select bah-workspace-select" data-bah-workspace aria-label="Active workspace"></select>
          </label>
          <button type="button" class="header-link bah-link-pill bah-user-btn bah-account-btn" data-bah-account>${escapeHtml(accountLabel)}</button>
        </div>
      </div>
    `;
  }

  function formatProjectDate(isoDate) {
    const timestamp = Date.parse(cleanString(isoDate));
    if (!Number.isFinite(timestamp)) {
      return "Unknown";
    }
    return new Date(timestamp).toLocaleString();
  }

  function routeForTool(tool) {
    const routes = {
      "bible-study": "/ai/apps/bible-study/",
      "sermon-preparation": "/ai/apps/sermon-preparation/",
      "teaching-tools": "/ai/apps/teaching-tools/",
      "research-helper": "/ai/apps/research-helper/",
      "sermon-analyzer": "/ai/apps/sermon-analyzer/",
      "video-search": "/ai/apps/video-search/"
    };
    return routes[cleanString(tool)] || "/";
  }

  function humanizeTool(tool) {
    const labels = {
      "bible-study": "Bible Study",
      "sermon-preparation": "Sermon Preparation",
      "teaching-tools": "Teaching Tools",
      "research-helper": "Sermon Evaluation",
      "sermon-analyzer": "Sermon Analyzer",
      "video-search": "Video Search"
    };
    return labels[cleanString(tool)] || cleanString(tool, "Project");
  }

  function buildProjectsDialog() {
    const existing = document.querySelector("[data-bah-project-modal]");
    if (existing) {
      return existing;
    }
    const modal = document.createElement("div");
    modal.className = "bah-project-modal hidden";
    modal.setAttribute("data-bah-project-modal", "1");
    modal.innerHTML = `
      <div class="bah-project-backdrop" data-bah-project-close></div>
      <section class="bah-project-panel" role="dialog" aria-modal="true" aria-label="Projects">
        <div class="bah-project-head">
          <h3>Projects</h3>
          <button type="button" class="bah-project-close" data-bah-project-close aria-label="Close projects panel">Close</button>
        </div>
        <div class="bah-project-controls">
          <input type="search" class="input" data-bah-project-search placeholder="Search by title or tool" />
          <select class="select" data-bah-project-sort>
            <option value="updated_desc">Recently Updated</option>
            <option value="updated_asc">Oldest Updated</option>
            <option value="title_asc">Title A-Z</option>
          </select>
        </div>
        <div class="bah-project-list" data-bah-project-list></div>
      </section>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function closeProjectsDialog(modal) {
    if (!modal) {
      return;
    }
    modal.classList.add("hidden");
  }

  async function renderProjectsDialogList(modal) {
    if (!modal) {
      return;
    }
    const listMount = modal.querySelector("[data-bah-project-list]");
    const searchInput = modal.querySelector("[data-bah-project-search]");
    const sortSelect = modal.querySelector("[data-bah-project-sort]");
    if (!listMount) {
      return;
    }
    const query = cleanString(searchInput && searchInput.value);
    const sort = cleanString(sortSelect && sortSelect.value, "updated_desc");
    listMount.innerHTML = `<p class="inline-hint">Loading projects...</p>`;

    let payload = { projects: [] };
    try {
      payload = await listProjects(query, sort);
    } catch (error) {
      listMount.innerHTML = `<p class="inline-hint">${escapeHtml(cleanString(error.message, "Could not load projects."))}</p>`;
      return;
    }

    const rows = Array.isArray(payload.projects) ? payload.projects : [];
    if (!rows.length) {
      listMount.innerHTML = `<p class="inline-hint">No projects found for this workspace.</p>`;
      return;
    }

    listMount.innerHTML = rows.map((row) => {
      const exportsCount = Array.isArray(row.exports) ? row.exports.length : 0;
      const versionsCount = Array.isArray(row.versions) ? row.versions.length : 0;
      return `
        <article class="bah-project-item">
          <div class="bah-project-main">
            <strong>${escapeHtml(cleanString(row.title, "Untitled Project"))}</strong>
            <span>${escapeHtml(humanizeTool(row.tool))} | Updated ${escapeHtml(formatProjectDate(row.updatedAt))}</span>
            <span>${versionsCount} version${versionsCount === 1 ? "" : "s"} | ${exportsCount} export${exportsCount === 1 ? "" : "s"}</span>
          </div>
          <div class="bah-project-actions">
            <button type="button" class="btn secondary" data-project-open="${escapeHtml(cleanString(row.id))}" data-project-tool="${escapeHtml(cleanString(row.tool))}">Open</button>
            <button type="button" class="btn secondary" data-project-delete="${escapeHtml(cleanString(row.id))}">Delete</button>
          </div>
        </article>
      `;
    }).join("");

    $all("[data-project-open]", listMount).forEach((buttonEl) => {
      buttonEl.addEventListener("click", () => {
        const projectId = cleanString(buttonEl.getAttribute("data-project-open"));
        const tool = cleanString(buttonEl.getAttribute("data-project-tool"));
        if (!projectId) {
          return;
        }
        const route = routeForTool(tool);
        window.location.href = `${route}?project=${encodeURIComponent(projectId)}`;
      });
    });

    $all("[data-project-delete]", listMount).forEach((buttonEl) => {
      buttonEl.addEventListener("click", async () => {
        const projectId = cleanString(buttonEl.getAttribute("data-project-delete"));
        if (!projectId) {
          return;
        }
        if (!window.confirm("Delete this project? This cannot be undone.")) {
          return;
        }
        try {
          await deleteProject(projectId);
          await trackEvent("project_deleted", { projectId });
          await renderProjectsDialogList(modal);
        } catch (error) {
          window.alert(cleanString(error.message, "Could not delete project."));
        }
      });
    });
  }

  function wireProjectsDialog(modal) {
    if (!modal || modal.getAttribute("data-bah-project-wired") === "1") {
      return;
    }
    modal.setAttribute("data-bah-project-wired", "1");
    $all("[data-bah-project-close]", modal).forEach((buttonEl) => {
      buttonEl.addEventListener("click", () => closeProjectsDialog(modal));
    });
    const searchInput = modal.querySelector("[data-bah-project-search]");
    const sortSelect = modal.querySelector("[data-bah-project-sort]");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        window.clearTimeout(Number(searchInput.dataset.timer || 0));
        const timer = window.setTimeout(() => {
          void renderProjectsDialogList(modal);
        }, 220);
        searchInput.dataset.timer = String(timer);
      });
    }
    if (sortSelect) {
      sortSelect.addEventListener("change", () => {
        void renderProjectsDialogList(modal);
      });
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.classList.contains("hidden")) {
        closeProjectsDialog(modal);
      }
    });
  }

  async function openProjectsDialog() {
    const modal = buildProjectsDialog();
    wireProjectsDialog(modal);
    modal.classList.remove("hidden");
    await renderProjectsDialogList(modal);
  }

  async function populateWorkspaceSelect(selectEl) {
    if (!selectEl) {
      return;
    }
    let payload = {};
    try {
      payload = await apiGet("/api/workspaces");
    } catch (_) {
      payload = { workspaces: [] };
    }
    const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
    if (!workspaces.length) {
      selectEl.innerHTML = "<option>Workspace</option>";
      return;
    }
    selectEl.innerHTML = workspaces
      .map((workspace) => `<option value="${escapeHtml(workspace.id)}">${escapeHtml(workspace.name)} (${escapeHtml(workspace.role)})</option>`)
      .join("");
    const active = cleanString(payload.activeWorkspaceId || authState.workspaceId || workspaces[0].id);
    if (active) {
      selectEl.value = active;
      authState.workspaceId = active;
      try {
        localStorage.setItem(STORAGE_KEYS.workspaceId, active);
      } catch (_) {
        // ignore
      }
    }
    selectEl.addEventListener("change", async () => {
      const workspaceId = cleanString(selectEl.value);
      if (!workspaceId) {
        return;
      }
      await apiPost("/api/workspaces/active", { workspaceId });
      authState.workspaceId = workspaceId;
      try {
        localStorage.setItem(STORAGE_KEYS.workspaceId, workspaceId);
      } catch (_) {
        // ignore
      }
      await trackEvent("workspace_switch", { workspaceId });
      window.location.reload();
    });
  }

  async function showNotices() {
    let payload = { notifications: [] };
    try {
      payload = await apiGet("/api/notifications");
    } catch (_) {
      payload = { notifications: [] };
    }
    const items = Array.isArray(payload.notifications) ? payload.notifications : [];
    if (!items.length) {
      window.alert("No notifications right now.");
      return;
    }
    const lines = items.slice(0, 6).map((item) => `- ${cleanString(item.title)}: ${cleanString(item.body)}`);
    window.alert(lines.join("\n"));
    for (const item of items.slice(0, 6)) {
      if (!item.readAt) {
        try {
          await apiPost(`/api/notifications/${encodeURIComponent(cleanString(item.id))}/read`, {});
        } catch (_) {
          // no-op
        }
      }
    }
  }

  async function promptOnboardingOnce() {
    const key = "bah_onboarding_prompted";
    try {
      if (localStorage.getItem(key)) {
        return;
      }
    } catch (_) {
      // ignore localStorage read errors
    }
    let config = { questions: [] };
    try {
      config = await apiGet("/api/onboarding/config");
    } catch (_) {
      config = { questions: [] };
    }
    const questions = Array.isArray(config.questions) && config.questions.length
      ? config.questions
      : DEFAULT_ONBOARDING_QUESTIONS.map((label, idx) => ({ id: `q${idx + 1}`, label }));
    const answers = await collectOnboardingAnswers({
      questions,
      defaultWorkflow: Array.isArray(config.defaultWorkflow) && config.defaultWorkflow.length
        ? config.defaultWorkflow
        : ["bible-study", "sermon-preparation", "research-helper", "sermon-analyzer"]
    });
    if (!answers) {
      return;
    }
    try {
      await apiPost("/api/onboarding", {
        role: cleanString(answers.role),
        sermonCadence: cleanString(answers.sermonCadence),
        ministryContext: cleanString(answers.ministryContext),
        recommendedWorkflow: cleanArray(answers.recommendedWorkflow, 8)
      });
      await trackEvent("onboarding_completed", { role: cleanString(answers.role) });
      localStorage.setItem(key, "1");
    } catch (_) {
      // no-op
    }
  }

  function getOnboardingModal() {
    const existing = document.querySelector("[data-bah-onboarding]");
    if (existing) {
      return existing;
    }
    const modal = document.createElement("div");
    modal.className = "bah-onboarding hidden";
    modal.setAttribute("data-bah-onboarding", "1");
    modal.innerHTML = `
      <div class="bah-onboarding-backdrop"></div>
      <section class="bah-onboarding-panel" role="dialog" aria-modal="true" aria-label="Onboarding">
        <h3>Welcome to Bible AI Hub</h3>
        <p class="inline-hint">Set your ministry profile so outputs are tuned to your context.</p>
        <div class="form-grid">
          <div class="field">
            <label data-onboarding-label="role"></label>
            <input class="input" data-onboarding-input="role" placeholder="e.g., Pastor" />
          </div>
          <div class="field">
            <label data-onboarding-label="cadence"></label>
            <input class="input" data-onboarding-input="cadence" placeholder="e.g., Weekly" />
          </div>
          <div class="field span-2">
            <label data-onboarding-label="context"></label>
            <textarea class="textarea" data-onboarding-input="context" placeholder="Describe your ministry context and outcomes."></textarea>
          </div>
          <div class="field span-2">
            <label>Recommended Workflow</label>
            <div class="bah-onboarding-workflow" data-onboarding-workflow></div>
          </div>
          <div class="field span-2">
            <div class="btn-row">
              <button type="button" class="btn secondary" data-onboarding-skip>Skip</button>
              <button type="button" class="btn primary" data-onboarding-save>Save Profile</button>
            </div>
          </div>
        </div>
      </section>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  async function collectOnboardingAnswers({ questions, defaultWorkflow }) {
    const modal = getOnboardingModal();
    modal.classList.remove("hidden");
    const roleLabel = modal.querySelector("[data-onboarding-label='role']");
    const cadenceLabel = modal.querySelector("[data-onboarding-label='cadence']");
    const contextLabel = modal.querySelector("[data-onboarding-label='context']");
    const roleInput = modal.querySelector("[data-onboarding-input='role']");
    const cadenceInput = modal.querySelector("[data-onboarding-input='cadence']");
    const contextInput = modal.querySelector("[data-onboarding-input='context']");
    const workflowMount = modal.querySelector("[data-onboarding-workflow]");
    const saveBtn = modal.querySelector("[data-onboarding-save]");
    const skipBtn = modal.querySelector("[data-onboarding-skip]");

    const firstQuestion = questions[0] && questions[0].label ? questions[0].label : DEFAULT_ONBOARDING_QUESTIONS[0];
    const secondQuestion = questions[1] && questions[1].label ? questions[1].label : DEFAULT_ONBOARDING_QUESTIONS[1];
    const thirdQuestion = questions[2] && questions[2].label ? questions[2].label : DEFAULT_ONBOARDING_QUESTIONS[2];
    if (roleLabel) roleLabel.textContent = firstQuestion;
    if (cadenceLabel) cadenceLabel.textContent = secondQuestion;
    if (contextLabel) contextLabel.textContent = thirdQuestion;
    if (roleInput) roleInput.value = "Pastor";
    if (cadenceInput) cadenceInput.value = "Weekly";
    if (contextInput) contextInput.value = "Clearer and more faithful outputs";

    const toolLabels = {
      "bible-study": "Bible Study",
      "sermon-preparation": "Sermon Preparation",
      "teaching-tools": "Teaching Tools",
      "research-helper": "Sermon Evaluation",
      "sermon-analyzer": "Sermon Analyzer",
      "video-search": "Video Search"
    };
    const workflow = Array.isArray(defaultWorkflow) && defaultWorkflow.length
      ? defaultWorkflow
      : ["bible-study", "sermon-preparation", "research-helper", "sermon-analyzer"];
    if (workflowMount) {
      workflowMount.innerHTML = workflow.map((tool) => `
        <label class="check-row">
          <input type="checkbox" data-onboarding-tool="${escapeHtml(cleanString(tool))}" checked />
          ${escapeHtml(cleanString(toolLabels[tool], tool))}
        </label>
      `).join("");
    }

    return new Promise((resolve) => {
      let resolved = false;
      const finish = (value) => {
        if (resolved) {
          return;
        }
        resolved = true;
        modal.classList.add("hidden");
        resolve(value);
      };
      const onSave = () => {
        const selectedWorkflow = $all("[data-onboarding-tool]", modal)
          .filter((inputEl) => inputEl && inputEl.checked)
          .map((inputEl) => cleanString(inputEl.getAttribute("data-onboarding-tool")))
          .filter(Boolean);
        finish({
          role: cleanString(roleInput && roleInput.value, "Pastor"),
          sermonCadence: cleanString(cadenceInput && cadenceInput.value, "Weekly"),
          ministryContext: cleanString(contextInput && contextInput.value, "Clearer and more faithful outputs"),
          recommendedWorkflow: selectedWorkflow.length ? selectedWorkflow : workflow
        });
      };
      const onSkip = () => finish(null);
      if (saveBtn) {
        saveBtn.onclick = onSave;
      }
      if (skipBtn) {
        skipBtn.onclick = onSkip;
      }
    });
  }

  let googleScriptPromise = null;

  function loadGoogleIdentityScript() {
    if (googleScriptPromise) {
      return googleScriptPromise;
    }
    googleScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-bah-google-gsi]");
      if (existing) {
        if (window.google && window.google.accounts && window.google.accounts.id) {
          resolve();
        } else {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error("Could not load Google identity script.")), { once: true });
        }
        return;
      }

      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.setAttribute("data-bah-google-gsi", "1");
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Google identity script."));
      document.head.appendChild(script);
    });
    return googleScriptPromise;
  }

  function getAuthModal() {
    const existing = document.querySelector("[data-bah-auth-modal]");
    if (existing) {
      return existing;
    }
    const modal = document.createElement("div");
    modal.className = "bah-auth-modal hidden";
    modal.setAttribute("data-bah-auth-modal", "1");
    modal.innerHTML = `
      <div class="bah-account-backdrop" data-bah-auth-close></div>
      <section class="bah-account-panel" role="dialog" aria-modal="true" aria-label="Sign in">
        <div class="bah-project-head">
          <h3>Sign In</h3>
          <button type="button" class="bah-project-close" data-bah-auth-close>Close</button>
        </div>
        <div class="form-grid">
          <div class="field span-2">
            <label for="bahMagicEmail">Email (magic link, no password)</label>
            <input id="bahMagicEmail" class="input" type="email" placeholder="you@example.com" />
          </div>
          <div class="field span-2">
            <div class="btn-row">
              <button type="button" class="btn primary" data-bah-magic-request>Send Magic Link</button>
            </div>
            <p class="inline-hint" data-bah-magic-status></p>
          </div>
          <div class="field span-2">
            <label for="bahMagicToken">Magic Link Token</label>
            <input id="bahMagicToken" class="input" type="text" placeholder="Paste token from your email" />
          </div>
          <div class="field span-2">
            <div class="btn-row">
              <button type="button" class="btn secondary" data-bah-magic-verify>Verify Magic Link</button>
            </div>
          </div>
          <div class="field span-2">
            <h4 class="section-title" style="margin:0;">Or continue with Google</h4>
            <div data-bah-google-mount></div>
            <p class="inline-hint" data-bah-google-status></p>
          </div>
        </div>
      </section>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  async function renderGoogleSignInButton(modal) {
    const mount = modal.querySelector("[data-bah-google-mount]");
    const status = modal.querySelector("[data-bah-google-status]");
    if (!mount || !status) {
      return;
    }
    mount.innerHTML = "";
    status.textContent = "Loading Google sign-in...";
    try {
      const config = await publicApiGet("/api/auth/google/config");
      if (!config || !config.enabled || !cleanString(config.clientId)) {
        status.textContent = "Google sign-in is not configured yet.";
        return;
      }
      await loadGoogleIdentityScript();
      if (!(window.google && window.google.accounts && window.google.accounts.id)) {
        status.textContent = "Google sign-in is unavailable in this browser.";
        return;
      }
      window.google.accounts.id.initialize({
        client_id: cleanString(config.clientId),
        callback: async (response) => {
          try {
            const auth = await publicApiPost("/api/auth/google/token", {
              idToken: cleanString(response && response.credential)
            });
            storeAuth(auth || {});
            authReadyPromise = Promise.resolve(authState);
            window.location.reload();
          } catch (error) {
            status.textContent = cleanString(error && error.message, "Google sign-in failed.");
          }
        }
      });
      window.google.accounts.id.renderButton(mount, {
        theme: themeState === THEME_DARK ? "filled_black" : "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: 260
      });
      status.textContent = "";
    } catch (error) {
      status.textContent = cleanString(error && error.message, "Could not initialize Google sign-in.");
    }
  }

  async function openAuthModal() {
    const modal = getAuthModal();
    modal.classList.remove("hidden");

    const close = () => modal.classList.add("hidden");
    $all("[data-bah-auth-close]", modal).forEach((buttonEl) => {
      buttonEl.onclick = close;
    });

    const emailInput = modal.querySelector("#bahMagicEmail");
    const tokenInput = modal.querySelector("#bahMagicToken");
    const requestBtn = modal.querySelector("[data-bah-magic-request]");
    const verifyBtn = modal.querySelector("[data-bah-magic-verify]");
    const statusEl = modal.querySelector("[data-bah-magic-status]");

    if (emailInput && !cleanString(emailInput.value)) {
      emailInput.value = "";
      emailInput.focus();
    }

    if (requestBtn) {
      requestBtn.onclick = async () => {
        const email = cleanString(emailInput && emailInput.value).toLowerCase();
        if (!email || !email.includes("@")) {
          if (statusEl) statusEl.textContent = "Enter a valid email first.";
          return;
        }
        try {
          setBusy(requestBtn, "Sending...", true);
          const response = await publicApiPost("/api/auth/magic-link/request", { email });
          const token = cleanString(response && response.magicLinkToken);
          const detail = cleanString(response && response.detail);
          const expiresMinutes = Number(response && response.expiresInMinutes || 15);

          if (tokenInput && token) {
            tokenInput.value = token;
          }

          if (response && response.simulated && token) {
            if (statusEl) {
              statusEl.textContent = `Email delivery is not configured yet. Completing sign-in directly for ${email}...`;
            }
            const auth = await publicApiPost("/api/auth/magic-link/verify", { token });
            storeAuth(auth || {});
            authReadyPromise = Promise.resolve(authState);
            window.location.reload();
            return;
          }

          if (statusEl) {
            const inboxMessage = `Magic link sent to ${email}. It expires in ${expiresMinutes} minutes.`;
            statusEl.textContent = detail ? `${inboxMessage} ${detail}` : inboxMessage;
          }
        } catch (error) {
          if (statusEl) {
            statusEl.textContent = cleanString(error && error.message, "Could not send magic link.");
          }
        } finally {
          setBusy(requestBtn, "", false);
        }
      };
    }

    if (verifyBtn) {
      verifyBtn.onclick = async () => {
        const token = cleanString(tokenInput && tokenInput.value);
        if (!token) {
          if (statusEl) statusEl.textContent = "Paste your token first.";
          return;
        }
        try {
          setBusy(verifyBtn, "Verifying...", true);
          const auth = await publicApiPost("/api/auth/magic-link/verify", { token });
          storeAuth(auth || {});
          authReadyPromise = Promise.resolve(authState);
          window.location.reload();
        } catch (error) {
          if (statusEl) {
            statusEl.textContent = cleanString(error && error.message, "Magic link verification failed.");
          }
        } finally {
          setBusy(verifyBtn, "", false);
        }
      };
    }

    await renderGoogleSignInButton(modal);
  }

  function getFeedbackModal() {
    const existing = document.querySelector("[data-bah-feedback-modal]");
    if (existing) {
      return existing;
    }
    const modal = document.createElement("div");
    modal.className = "bah-feedback-modal hidden";
    modal.setAttribute("data-bah-feedback-modal", "1");
    modal.innerHTML = `
      <div class="bah-account-backdrop" data-bah-feedback-close></div>
      <section class="bah-account-panel" role="dialog" aria-modal="true" aria-label="Share feedback">
        <div class="bah-project-head">
          <h3>Share Feedback</h3>
          <button type="button" class="bah-project-close" data-bah-feedback-close>Close</button>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="bahFeedbackRating">How helpful was this page?</label>
            <select id="bahFeedbackRating" class="select">
              <option value="5">5 - Excellent</option>
              <option value="4">4 - Good</option>
              <option value="3">3 - Okay</option>
              <option value="2">2 - Needs work</option>
              <option value="1">1 - Poor</option>
            </select>
          </div>
          <div class="field span-2">
            <label for="bahFeedbackMessage">Feedback</label>
            <textarea id="bahFeedbackMessage" class="textarea" placeholder="What worked, what broke, and what should be improved?"></textarea>
          </div>
          <div class="field span-2">
            <div class="btn-row">
              <button type="button" class="btn primary" data-bah-feedback-submit>Send Feedback</button>
            </div>
            <p class="inline-hint" data-bah-feedback-status></p>
          </div>
        </div>
      </section>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  async function openFeedbackModal() {
    if (isGuestUser(authState.user)) {
      window.alert("Sign in with email or Google to submit feedback.");
      await openAuthModal();
      return;
    }
    const modal = getFeedbackModal();
    modal.classList.remove("hidden");
    const close = () => modal.classList.add("hidden");
    $all("[data-bah-feedback-close]", modal).forEach((buttonEl) => {
      buttonEl.onclick = close;
    });
    const submitBtn = modal.querySelector("[data-bah-feedback-submit]");
    const messageInput = modal.querySelector("#bahFeedbackMessage");
    const ratingInput = modal.querySelector("#bahFeedbackRating");
    const statusEl = modal.querySelector("[data-bah-feedback-status]");

    if (submitBtn) {
      submitBtn.onclick = async () => {
        const message = cleanString(messageInput && messageInput.value);
        const rating = Number(ratingInput && ratingInput.value || 0);
        if (!message || message.length < 8) {
          if (statusEl) statusEl.textContent = "Please provide a bit more detail (at least a short sentence).";
          return;
        }
        try {
          setBusy(submitBtn, "Sending...", true);
          await apiPost("/api/feedback", {
            pagePath: window.location.pathname,
            message,
            rating,
            sentiment: rating >= 4 ? "positive" : "neutral"
          });
          if (statusEl) {
            statusEl.textContent = "Thank you. Your feedback was sent.";
          }
          if (messageInput) {
            messageInput.value = "";
          }
        } catch (error) {
          if (statusEl) {
            statusEl.textContent = cleanString(error && error.message, "Could not send feedback right now.");
          }
        } finally {
          setBusy(submitBtn, "", false);
        }
      };
    }
  }

  function ensureFeedbackFab() {
    const existing = document.querySelector("[data-bah-feedback-fab]");
    if (existing) {
      existing.classList.toggle("hidden", isGuestUser(authState.user));
      return existing;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bah-feedback-fab";
    button.setAttribute("data-bah-feedback-fab", "1");
    button.textContent = "Feedback";
    button.classList.toggle("hidden", isGuestUser(authState.user));
    button.addEventListener("click", () => {
      void openFeedbackModal();
    });
    document.body.appendChild(button);
    return button;
  }

  function enforceIconSizing() {
    const groups = [
      { selector: ".hero-icon", size: 32 },
      { selector: ".tool-card svg", size: 30 },
      { selector: ".feature-head svg", size: 20 },
      { selector: ".feature-icon", size: 20 }
    ];
    for (const group of groups) {
      $all(group.selector).forEach((icon) => {
        if (!icon || icon.tagName.toLowerCase() !== "svg") {
          return;
        }
        icon.setAttribute("width", String(group.size));
        icon.setAttribute("height", String(group.size));
        icon.style.width = `${group.size}px`;
        icon.style.height = `${group.size}px`;
        icon.style.maxWidth = `${group.size}px`;
        icon.style.maxHeight = `${group.size}px`;
      });
    }
  }

  function getAccountModal() {
    const existing = document.querySelector("[data-bah-account-modal]");
    if (existing) {
      return existing;
    }
    const modal = document.createElement("div");
    modal.className = "bah-account-modal hidden";
    modal.setAttribute("data-bah-account-modal", "1");
    modal.innerHTML = `
      <div class="bah-account-backdrop" data-bah-account-close></div>
      <section class="bah-account-panel" role="dialog" aria-modal="true" aria-label="Account Settings">
        <div class="bah-project-head">
          <h3>Account Settings</h3>
          <button type="button" class="bah-project-close" data-bah-account-close>Close</button>
        </div>
        <div class="form-grid">
          <div class="field span-2">
            <label class="check-row"><input type="checkbox" data-bah-setting-dark-mode /> Use dark mode</label>
            <p class="inline-hint">Theme is saved in this browser profile.</p>
          </div>
          <div class="field span-2">
            <label class="check-row"><input type="checkbox" data-bah-setting-lifecycle /> Email lifecycle reminders</label>
          </div>
          <div class="field span-2">
            <label class="check-row"><input type="checkbox" data-bah-setting-personalization /> Disable personalization</label>
          </div>
          <div class="field span-2">
            <label for="bahSettingTheology">Bible Study theological profile</label>
            <select id="bahSettingTheology" class="select" data-bah-setting-theology>
              <option value="text-centered">Text-centered</option>
              <option value="reformed">Reformed</option>
              <option value="wesleyan">Wesleyan</option>
              <option value="baptist">Baptist</option>
              <option value="pentecostal">Pentecostal</option>
              <option value="anglican">Anglican</option>
            </select>
          </div>
          <div class="field span-2">
            <div class="btn-row">
              <button type="button" class="btn primary" data-bah-account-save>Save Settings</button>
              <button type="button" class="btn secondary" data-bah-account-signout>Sign Out</button>
            </div>
          </div>
        </div>
        <p class="inline-hint" data-bah-account-status></p>
      </section>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  async function openAccountModal() {
    const modal = getAccountModal();
    modal.classList.remove("hidden");
    const themeInput = modal.querySelector("[data-bah-setting-dark-mode]");
    const lifecycleInput = modal.querySelector("[data-bah-setting-lifecycle]");
    const personalizationInput = modal.querySelector("[data-bah-setting-personalization]");
    const theologyInput = modal.querySelector("[data-bah-setting-theology]");
    const statusEl = modal.querySelector("[data-bah-account-status]");
    const saveBtn = modal.querySelector("[data-bah-account-save]");
    const signoutBtn = modal.querySelector("[data-bah-account-signout]");

    const close = () => modal.classList.add("hidden");
    $all("[data-bah-account-close]", modal).forEach((buttonEl) => {
      buttonEl.onclick = close;
    });

    if (themeInput) {
      themeInput.checked = themeState === THEME_DARK;
    }

    try {
      const settings = await apiGet("/api/user/settings");
      if (lifecycleInput) {
        lifecycleInput.checked = Boolean(settings && settings.emailPrefs && settings.emailPrefs.lifecycle !== false);
      }
      if (personalizationInput) {
        personalizationInput.checked = Boolean(settings && settings.personalization && settings.personalization.optOut);
      }
      if (theologyInput) {
        theologyInput.value = cleanString(settings && settings.studyPreferences && settings.studyPreferences.theologicalProfile, "text-centered");
      }
      if (statusEl) {
        statusEl.textContent = "";
      }
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = cleanString(error && error.message, "Could not load settings.");
      }
    }

    if (saveBtn) {
      saveBtn.onclick = async () => {
        const nextTheme = themeInput && themeInput.checked ? THEME_DARK : THEME_LIGHT;
        applyTheme(nextTheme, true);
        try {
          setBusy(saveBtn, "Saving...", true);
          await apiPatch("/api/user/settings", {
            emailPrefs: {
              lifecycle: lifecycleInput ? lifecycleInput.checked : true
            },
            personalization: {
              optOut: personalizationInput ? personalizationInput.checked : false
            },
            studyPreferences: {
              theologicalProfile: cleanString(theologyInput && theologyInput.value, "text-centered")
            }
          });
          if (statusEl) {
            statusEl.textContent = "Settings saved.";
          }
        } catch (error) {
          if (statusEl) {
            statusEl.textContent = cleanString(error && error.message, "Could not save settings.");
          }
        } finally {
          setBusy(saveBtn, "", false);
        }
      };
    }

    if (signoutBtn) {
      signoutBtn.onclick = async () => {
        if (!window.confirm("Sign out of this session?")) {
          return;
        }
        try {
          await apiPost("/api/auth/logout", {});
        } catch (_) {
          // ignore and clear local auth anyway
        }
        clearStoredAuth();
        authReadyPromise = null;
        window.location.reload();
      };
    }
  }

  async function bootHeaderShell() {
    await ensureAuthReady();
    const headerInner = $(".header-inner");
    if (!headerInner || $("[data-bah-shell]", headerInner)) {
      return;
    }
    const shell = createEl("div", "", headerShellHtml(authState));
    shell.setAttribute("data-bah-shell", "1");
    headerInner.appendChild(shell);

    const workspaceSelect = $("[data-bah-workspace]", shell);
    await populateWorkspaceSelect(workspaceSelect);

    const authBtn = $("[data-bah-auth-open]", shell);
    if (authBtn) {
      authBtn.addEventListener("click", () => {
        void openAuthModal();
      });
    }

    const feedbackBtn = $("[data-bah-feedback-open]", shell);
    if (feedbackBtn) {
      feedbackBtn.addEventListener("click", () => {
        void openFeedbackModal();
      });
    }

    const accountBtn = $("[data-bah-account]", shell);
    if (accountBtn) {
      accountBtn.addEventListener("click", () => {
        if (isGuestUser(authState.user)) {
          void openAuthModal();
          return;
        }
        void openAccountModal();
      });
    }

    const noticeBtn = $("[data-bah-notices]", shell);
    if (noticeBtn) {
      noticeBtn.addEventListener("click", () => {
        void showNotices();
      });
    }

    const projectsBtn = $("[data-bah-projects]", shell);
    if (projectsBtn) {
      projectsBtn.addEventListener("click", () => {
        void openProjectsDialog();
      });
    }

    ensureFeedbackFab();
    enforceIconSizing();
  }

  function registerToolLifecycle(toolSlug) {
    const slug = cleanString(toolSlug, "unknown-tool");
    void trackEvent("tool_start", {
      tool: slug,
      path: window.location.pathname
    });
  }

  function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search || "");
    return cleanString(params.get(cleanString(name)));
  }

  async function hydrateProjectFromQuery(expectedTool, onProjectLoaded) {
    const projectId = getQueryParam("project");
    if (!projectId) {
      return null;
    }
    const payload = await getProject(projectId);
    const project = payload && payload.project ? payload.project : null;
    if (!project) {
      return null;
    }
    const projectTool = cleanString(project.tool);
    if (expectedTool && projectTool && cleanString(expectedTool) !== projectTool) {
      throw new Error(`Project belongs to ${projectTool}, not ${expectedTool}.`);
    }
    if (typeof onProjectLoaded === "function") {
      onProjectLoaded(project);
    }
    return project;
  }

  async function disableLegacyServiceWorkers() {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      if (!registrations.length) {
        return;
      }

      await Promise.all(registrations.map((registration) => registration.unregister()));

      if ("caches" in window && typeof caches.keys === "function") {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (_) {
      // Ignore SW cleanup failures; app should continue normally.
    }
  }

  readStoredAuth();
  enforceIconSizing();
  window.addEventListener("load", () => {
    enforceIconSizing();
  });
  void ensureAuthReady()
    .then(async () => {
      await bootAnalytics();
      await bootHeaderShell();
      await trackEvent("landing_view", {
        path: window.location.pathname,
        referrer: cleanString(document.referrer)
      });
    })
    .catch(() => {
      // App remains usable even if session bootstrap fails.
      void bootAnalytics();
      enforceIconSizing();
    });

  window.AIBible = {
    $, $all, escapeHtml, fetchBiblePassage, apiGet, apiPost, apiPatch, apiDelete, apiPostForm, splitSentences, tokenize, topKeywords,
    textMetrics, estimatePassiveVoice, findScriptureReferences, renderScore, clamp,
    summarizeKeywords, highlightTerms, createEl, setBusy, cleanString, cleanArray,
    getFeatureFlags, isFeatureEnabled,
    publicApiGet, publicApiPost,
    toggleTheme, applyTheme,
    openAuthModal, openFeedbackModal,
    ensureAuthReady, trackEvent, saveProject, getProject, updateProject, listProjects, deleteProject, appendProjectExport,
    createHandoff, getHandoff, createLearningPath, listLearningPaths, getLearningPath, updateLearningPath, deleteLearningPath, shareLearningPath,
    hydrateProjectFromQuery, getQueryParam,
    registerToolLifecycle,
    getAuthState: () => ({ ...authState })
  };
})();
