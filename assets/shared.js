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
    workspaceId: "bah_workspace_id"
  };
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
  disableLegacyServiceWorkers();

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
      }
      if (user) {
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
      }
    } catch (_) {
      // Ignore localStorage write failures.
    }
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
      throw new Error("Unable to initialize session.");
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

  async function apiGet(url) {
    return apiRequest(url, { method: "GET" });
  }

  async function apiPost(url, payload) {
    return apiRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload || {})
    });
  }

  async function apiPatch(url, payload) {
    return apiRequest(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload || {})
    });
  }

  async function apiDelete(url) {
    return apiRequest(url, {
      method: "DELETE"
    });
  }

  async function apiPostForm(url, formData) {
    return apiRequest(url, {
      method: "POST",
      body: formData
    });
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

  async function trackEvent(name, properties) {
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
    return `
      <div class="bah-shell">
        <a class="header-link" href="/pricing/">Pricing</a>
        <button type="button" class="header-link bah-projects-btn" data-bah-projects>Projects</button>
        <button type="button" class="header-link bah-notice-btn" data-bah-notices>Notices</button>
        <select class="select bah-workspace-select" data-bah-workspace></select>
        <button type="button" class="header-link bah-user-btn" data-bah-account>${escapeHtml(userName)}</button>
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

    const accountBtn = $("[data-bah-account]", shell);
    if (accountBtn) {
      accountBtn.addEventListener("click", () => {
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
  void ensureAuthReady()
    .then(() => Promise.all([
      bootHeaderShell(),
      trackEvent("landing_view", {
        path: window.location.pathname
      })
    ]))
    .catch(() => {
      // App remains usable even if session bootstrap fails.
    });

  window.AIBible = {
    $, $all, escapeHtml, fetchBiblePassage, apiGet, apiPost, apiPatch, apiDelete, apiPostForm, splitSentences, tokenize, topKeywords,
    textMetrics, estimatePassiveVoice, findScriptureReferences, renderScore, clamp,
    summarizeKeywords, highlightTerms, createEl, setBusy, cleanString, cleanArray,
    ensureAuthReady, trackEvent, saveProject, getProject, updateProject, listProjects, deleteProject, appendProjectExport,
    createHandoff, getHandoff, createLearningPath, listLearningPaths, getLearningPath, updateLearningPath, deleteLearningPath, shareLearningPath,
    hydrateProjectFromQuery, getQueryParam,
    registerToolLifecycle,
    getAuthState: () => ({ ...authState })
  };
})();
