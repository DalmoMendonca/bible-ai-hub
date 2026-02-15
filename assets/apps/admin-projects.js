(function () {
  const {
    $,
    $all,
    cleanString,
    escapeHtml,
    ensureAuthReady,
    getAuthState,
    apiGet,
    openAuthModal
  } = window.AIBible;

  const mount = $("#adminProjectsMount");
  const notice = $("#adminProjectsNotice");
  const searchInput = $("#adminProjectsSearch");
  const sortSelect = $("#adminProjectsSort");
  const ADMIN_EMAIL = "dalmomendonca@gmail.com";

  function isGuest(user) {
    if (!user || typeof user !== "object") {
      return true;
    }
    const email = cleanString(user.email).toLowerCase();
    return Boolean(user.isGuest || email.endsWith("@local.bibleaihub"));
  }

  function isAdmin(user) {
    const email = cleanString(user && user.email).toLowerCase();
    return cleanString(user && user.role).toLowerCase() === "admin"
      || email === ADMIN_EMAIL;
  }

  function showNotice(message, type) {
    if (!notice) {
      return;
    }
    notice.className = `notice ${type || ""}`.trim();
    notice.innerHTML = cleanString(message);
    notice.classList.remove("hidden");
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
    const key = cleanString(tool);
    return labels[key] || key || "Project";
  }

  function normalizeToolSlug(tool) {
    return cleanString(tool).toLowerCase().replace(/[^a-z0-9-]/g, "");
  }

  function toolToneClass(tool) {
    const slug = normalizeToolSlug(tool);
    return slug ? `tool-tone--${slug}` : "";
  }

  function renderToolBadge(tool) {
    return `<span class="bah-tool-badge ${escapeHtml(toolToneClass(tool))}">${escapeHtml(humanizeTool(tool))}</span>`;
  }

  function formatDate(value) {
    const ts = Date.parse(cleanString(value));
    if (!Number.isFinite(ts)) {
      return "Unknown";
    }
    return new Date(ts).toLocaleString();
  }

  async function renderProjects() {
    if (!mount) {
      return;
    }
    mount.innerHTML = `<p class="inline-hint">Loading all projects...</p>`;
    const query = cleanString(searchInput && searchInput.value);
    const sort = cleanString(sortSelect && sortSelect.value, "updated_desc");
    let payload = { projects: [] };
    try {
      payload = await apiGet(`/api/admin/projects?q=${encodeURIComponent(query)}&sort=${encodeURIComponent(sort)}&limit=1200`);
    } catch (error) {
      mount.innerHTML = `<p class="inline-hint">${escapeHtml(cleanString(error && error.message, "Could not load projects."))}</p>`;
      return;
    }
    const rows = Array.isArray(payload.projects) ? payload.projects : [];
    if (!rows.length) {
      mount.innerHTML = `<p class="inline-hint">No projects found.</p>`;
      return;
    }
    mount.innerHTML = `
      <p class="inline-hint">${rows.length} project(s) shown.</p>
      ${rows.map((row) => `
        <article class="bah-project-item ${escapeHtml(toolToneClass(row.tool))}">
          <div class="bah-project-main">
            <strong>${escapeHtml(cleanString(row.title, "Untitled Project"))}</strong>
            <span>${renderToolBadge(row.tool)} <span class="bah-project-meta-sep">|</span> Updated ${escapeHtml(formatDate(row.updatedAt))}</span>
            <span>User: ${escapeHtml(cleanString(row.userEmail, row.userId || "unknown"))} | Workspace: ${escapeHtml(cleanString(row.workspaceName, row.workspaceId || "unknown"))}</span>
            <span>${Number(row.versionsCount || 0)} version(s) | ${Number(row.exportsCount || 0)} export(s)</span>
          </div>
          <div class="bah-project-actions">
            <button type="button" class="btn secondary" data-admin-open-project="${escapeHtml(cleanString(row.id))}" data-admin-tool="${escapeHtml(cleanString(row.tool))}">Open</button>
          </div>
        </article>
      `).join("")}
    `;
    $all("[data-admin-open-project]", mount).forEach((buttonEl) => {
      buttonEl.addEventListener("click", () => {
        const projectId = cleanString(buttonEl.getAttribute("data-admin-open-project"));
        const tool = cleanString(buttonEl.getAttribute("data-admin-tool"));
        if (!projectId) {
          return;
        }
        window.location.href = `${routeForTool(tool)}?project=${encodeURIComponent(projectId)}`;
      });
    });
  }

  async function init() {
    await ensureAuthReady();
    const auth = getAuthState();
    const user = auth && auth.user ? auth.user : null;
    if (isGuest(user)) {
      showNotice("Sign in with your admin account to view this page.", "error");
      await openAuthModal();
      return;
    }
    if (!isAdmin(user)) {
      showNotice("Admin access required.", "error");
      return;
    }

    await renderProjects();
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        window.clearTimeout(Number(searchInput.dataset.timer || 0));
        const timer = window.setTimeout(() => {
          void renderProjects();
        }, 220);
        searchInput.dataset.timer = String(timer);
      });
    }
    if (sortSelect) {
      sortSelect.addEventListener("change", () => {
        void renderProjects();
      });
    }
  }

  void init().catch((error) => {
    showNotice(cleanString(error && error.message, "Could not initialize admin projects dashboard."), "error");
  });
})();
