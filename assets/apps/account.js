(function () {
  const {
    $,
    $all,
    escapeHtml,
    cleanString,
    ensureAuthReady,
    getAuthState,
    openAuthModal,
    apiGet,
    apiPatch,
    listProjects,
    deleteProject,
    applyTheme,
    signOut
  } = window.AIBible;

  const accountMount = $("#accountMount");
  const projectsMount = $("#accountProjects");
  const projectsSearch = $("#accountProjectSearch");
  const projectsSort = $("#accountProjectSort");
  const notice = $("#accountNotice");
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

  function formatDate(value) {
    const ts = Date.parse(cleanString(value));
    if (!Number.isFinite(ts)) {
      return "Unknown";
    }
    return new Date(ts).toLocaleString();
  }

  function renderGuestState() {
    if (accountMount) {
      accountMount.innerHTML = `
        <article class="card">
          <h3 class="section-title">Sign in to access your account</h3>
          <p class="lead">Your projects, settings, and admin tools are available after sign-in.</p>
          <div class="btn-row">
            <button type="button" class="btn primary" data-account-signin>Sign In</button>
          </div>
        </article>
      `;
    }
    if (projectsMount) {
      projectsMount.innerHTML = `<p class="inline-hint">Projects are available after sign-in.</p>`;
    }
    const signInBtn = $("[data-account-signin]", accountMount || document);
    if (signInBtn) {
      signInBtn.addEventListener("click", () => {
        void openAuthModal();
      });
    }
  }

  async function renderAccount(user) {
    if (!accountMount) {
      return;
    }
    const credits = Number.isFinite(Number(user && user.credits))
      ? String(Number(user.credits))
      : "Unlimited";
    accountMount.innerHTML = `
      <article class="card">
        <span class="kicker">Profile</span>
        <h3 class="section-title">${escapeHtml(cleanString(user && user.name, "User"))}</h3>
        <p><strong>Email:</strong> ${escapeHtml(cleanString(user && user.email, "Unknown"))}</p>
        <p><strong>Role:</strong> ${escapeHtml(cleanString(user && user.role, "user"))}</p>
        <p><strong>Credits:</strong> ${escapeHtml(credits)}</p>
      </article>
      <article class="card">
        <span class="kicker">Settings</span>
        <form id="accountSettingsForm" class="form-grid">
          <div class="field span-2">
            <label class="check-row"><input type="checkbox" id="accountDarkMode" /> Use dark mode</label>
          </div>
          <div class="field span-2">
            <label class="check-row"><input type="checkbox" id="accountLifecycle" /> Email lifecycle reminders</label>
          </div>
          <div class="field span-2">
            <label class="check-row"><input type="checkbox" id="accountPersonalization" /> Disable personalization</label>
          </div>
          <div class="field span-2">
            <label for="accountTheology">Bible Study theological profile</label>
            <select id="accountTheology" class="select">
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
              <button type="submit" class="btn primary">Save Settings</button>
              <button type="button" class="btn secondary" id="accountSignOut">Sign Out</button>
            </div>
          </div>
          <p class="inline-hint" id="accountSettingsStatus"></p>
        </form>
      </article>
      ${isAdmin(user) ? `
        <article class="card">
          <span class="kicker">Admin</span>
          <h3 class="section-title">Administration</h3>
          <div class="btn-row">
            <a class="btn secondary" href="/how-it-works.html">Edit Prompts</a>
            <a class="btn secondary" href="/account/admin-projects/">All Projects Dashboard</a>
            <a class="btn secondary" href="/ai/apps/dashboard/">Operations Dashboard</a>
          </div>
        </article>
      ` : ""}
    `;

    const themeInput = $("#accountDarkMode");
    const lifecycleInput = $("#accountLifecycle");
    const personalizationInput = $("#accountPersonalization");
    const theologyInput = $("#accountTheology");
    const form = $("#accountSettingsForm");
    const statusEl = $("#accountSettingsStatus");
    const signOutBtn = $("#accountSignOut");
    if (themeInput) {
      themeInput.checked = cleanString(document.documentElement.getAttribute("data-theme"), "light") === "dark";
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
    } catch (error) {
      if (statusEl) {
        statusEl.textContent = cleanString(error && error.message, "Could not load settings.");
      }
    }

    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const nextTheme = themeInput && themeInput.checked ? "dark" : "light";
        applyTheme(nextTheme, true);
        try {
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
        }
      });
    }

    if (signOutBtn) {
      signOutBtn.addEventListener("click", async () => {
        await signOut();
        window.location.href = "/";
      });
    }
  }

  async function renderProjects() {
    if (!projectsMount) {
      return;
    }
    projectsMount.innerHTML = `<p class="inline-hint">Loading projects...</p>`;
    const query = cleanString(projectsSearch && projectsSearch.value);
    const sort = cleanString(projectsSort && projectsSort.value, "updated_desc");

    let payload = { projects: [] };
    try {
      payload = await listProjects(query, sort);
    } catch (error) {
      projectsMount.innerHTML = `<p class="inline-hint">${escapeHtml(cleanString(error && error.message, "Could not load projects."))}</p>`;
      return;
    }

    const rows = Array.isArray(payload.projects) ? payload.projects : [];
    if (!rows.length) {
      projectsMount.innerHTML = `<p class="inline-hint">No projects yet.</p>`;
      return;
    }

    projectsMount.innerHTML = rows.map((row) => `
      <article class="bah-project-item">
        <div class="bah-project-main">
          <strong>${escapeHtml(cleanString(row.title, "Untitled Project"))}</strong>
          <span>${escapeHtml(cleanString(row.tool))} | Updated ${escapeHtml(formatDate(row.updatedAt))}</span>
        </div>
        <div class="bah-project-actions">
          <button type="button" class="btn secondary" data-account-project-open="${escapeHtml(cleanString(row.id))}" data-account-project-tool="${escapeHtml(cleanString(row.tool))}">Open</button>
          <button type="button" class="btn secondary" data-account-project-delete="${escapeHtml(cleanString(row.id))}">Delete</button>
        </div>
      </article>
    `).join("");

    $all("[data-account-project-open]", projectsMount).forEach((buttonEl) => {
      buttonEl.addEventListener("click", () => {
        const projectId = cleanString(buttonEl.getAttribute("data-account-project-open"));
        const tool = cleanString(buttonEl.getAttribute("data-account-project-tool"));
        if (!projectId) {
          return;
        }
        window.location.href = `${routeForTool(tool)}?project=${encodeURIComponent(projectId)}`;
      });
    });

    $all("[data-account-project-delete]", projectsMount).forEach((buttonEl) => {
      buttonEl.addEventListener("click", async () => {
        const projectId = cleanString(buttonEl.getAttribute("data-account-project-delete"));
        if (!projectId) {
          return;
        }
        if (!window.confirm("Delete this project? This cannot be undone.")) {
          return;
        }
        try {
          await deleteProject(projectId);
          showNotice("Project deleted.", "ok");
          await renderProjects();
        } catch (error) {
          showNotice(`Could not delete project: ${escapeHtml(cleanString(error && error.message))}`, "error");
        }
      });
    });
  }

  async function init() {
    await ensureAuthReady();
    const auth = getAuthState();
    const user = auth && auth.user ? auth.user : null;
    if (isGuest(user)) {
      renderGuestState();
      return;
    }
    await renderAccount(user);
    await renderProjects();

    if (projectsSearch) {
      projectsSearch.addEventListener("input", () => {
        window.clearTimeout(Number(projectsSearch.dataset.timer || 0));
        const timer = window.setTimeout(() => {
          void renderProjects();
        }, 220);
        projectsSearch.dataset.timer = String(timer);
      });
    }
    if (projectsSort) {
      projectsSort.addEventListener("change", () => {
        void renderProjects();
      });
    }
  }

  void init().catch((error) => {
    showNotice(cleanString(error && error.message, "Could not load account page."), "error");
  });
})();
