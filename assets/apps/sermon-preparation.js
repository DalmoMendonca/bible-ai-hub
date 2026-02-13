(function () {
  const {
    $,
    escapeHtml,
    fetchBiblePassage,
    apiGet,
    apiPost,
    cleanArray,
    cleanString,
    setBusy,
    saveProject,
    updateProject,
    hydrateProjectFromQuery,
    createHandoff,
    getHandoff,
    trackEvent,
    registerToolLifecycle
  } = window.AIBible;

  const form = $("#prepForm");
  const notice = $("#prepNotice");
  const result = $("#prepResult");
  const button = $("#prepButton");
  const seriesList = $("#seriesList");
  const seriesCreateButton = $("#seriesCreate");
  let lastGenerated = null;
  let activeProjectId = "";
  registerToolLifecycle("sermon-preparation");

  function showNotice(message, type) {
    notice.className = `notice ${type || ""}`.trim();
    notice.innerHTML = message;
    notice.classList.remove("hidden");
  }

  function hideNotice() {
    notice.classList.add("hidden");
    notice.textContent = "";
  }

  function listHtml(items) {
    const rows = cleanArray(items, 10);
    if (!rows.length) {
      return `<p class="inline-hint">No items returned.</p>`;
    }
    return `<ul class="list">${rows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>`;
  }

  function renderOutlineRows(outline) {
    const rows = Array.isArray(outline) ? outline : [];
    if (!rows.length) {
      return `<p class="inline-hint">No outline returned.</p>`;
    }

    return rows
      .map((row, index) => {
        const refs = cleanArray(row.supportingReferences, 5);
        return `
          <article class="result-item">
            <h3>${index + 1}. ${escapeHtml(cleanString(row.heading, "Main point"))}</h3>
            <p>${escapeHtml(cleanString(row.explanation))}</p>
            <p><strong>Application:</strong> ${escapeHtml(cleanString(row.application))}</p>
            ${refs.length ? `<p><strong>Support:</strong> ${refs.map((item) => escapeHtml(item)).join(", ")}</p>` : ""}
          </article>
        `;
      })
      .join("");
  }

  function renderTimingRows(timingPlan) {
    const rows = Array.isArray(timingPlan) ? timingPlan : [];
    if (!rows.length) {
      return `<li>No timing plan returned.</li>`;
    }

    return rows
      .map((row) => {
        const minutes = Number(row.minutes);
        return `<li><strong>${escapeHtml(cleanString(row.segment, "Segment"))}</strong>${Number.isFinite(minutes) ? ` (${minutes} min)` : ""}: ${escapeHtml(cleanString(row.purpose))}</li>`;
      })
      .join("");
  }

  function renderPlan(passage, ai) {
    return `
      <div class="card">
        <span class="kicker">Passage</span>
        <h3 class="section-title">${escapeHtml(passage.reference)} (${escapeHtml(passage.translation_name)})</h3>
        <p>${escapeHtml(passage.text)}</p>
      </div>

      <div class="card">
        <span class="kicker">Core Idea</span>
        ${ai && ai.styleMode ? `<p><strong>Style Mode:</strong> ${escapeHtml(cleanString(ai.styleMode))}</p>` : ""}
        ${ai && ai.preachabilityScore ? `
          <p><strong>Preachability Score:</strong> ${escapeHtml(String(ai.preachabilityScore.overall || 0))}/10</p>
          <ul class="list">
            ${(ai.preachabilityScore.rubric || []).map((row) => `<li>${escapeHtml(cleanString(row.dimension))}: ${escapeHtml(String(row.score || 0))}/10</li>`).join("")}
          </ul>
        ` : ""}
        <h3 class="section-title">Big Idea</h3>
        <p>${escapeHtml(cleanString(ai.bigIdea, "No big idea returned."))}</p>
      </div>

      <div class="card">
        <span class="kicker">Title Options</span>
        ${listHtml(ai.titleOptions)}
      </div>

      <div class="card">
        <span class="kicker">Outline</span>
        ${renderOutlineRows(ai.outline)}
      </div>

      <div class="card">
        <span class="kicker">Transitions</span>
        ${listHtml(ai.transitions)}
      </div>

      <div class="card">
        <span class="kicker">Application</span>
        ${listHtml(ai.applications)}
      </div>

      <div class="card">
        <span class="kicker">Illustration Ideas</span>
        ${listHtml(ai.illustrations)}
      </div>

      <div class="card">
        <span class="kicker">Timing Plan</span>
        <ul class="list">${renderTimingRows(ai.timingPlan)}</ul>
      </div>

      ${ai && ai.tighteningPass && ai.tighteningPass.applied ? `
        <div class="card">
          <span class="kicker">Tightening Pass</span>
          <p><strong>Before:</strong> ${escapeHtml((ai.tighteningPass.before || []).join(" | "))}</p>
          <p><strong>After:</strong> ${escapeHtml((ai.tighteningPass.after || []).join(" | "))}</p>
          ${(ai.tighteningPass.notes || []).length ? `<ul class="list">${(ai.tighteningPass.notes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}
        </div>
      ` : ""}
    `;
  }

  function renderActions() {
    if (!lastGenerated) {
      return "";
    }
    return `
      <div class="card">
        <span class="kicker">Project Actions</span>
        <div class="btn-row">
          <button type="button" class="btn secondary" id="prepSaveProject">${activeProjectId ? "Update Sermon Plan" : "Save Sermon Plan"}</button>
          <button type="button" class="btn secondary" id="prepHandoffEval">Send to Sermon Evaluation</button>
        </div>
      </div>
    `;
  }

  async function wireActions() {
    const saveBtn = $("#prepSaveProject");
    const handoffBtn = $("#prepHandoffEval");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        try {
          const title = `Sermon Plan - ${cleanString(lastGenerated && lastGenerated.passage && lastGenerated.passage.reference)}`;
          if (activeProjectId) {
            await updateProject(activeProjectId, lastGenerated);
          } else {
            const saved = await saveProject("sermon-preparation", title, lastGenerated);
            activeProjectId = cleanString(saved && saved.project && saved.project.id);
          }
          await trackEvent("project_saved", { tool: "sermon-preparation" });
          showNotice("Sermon plan saved.", "ok");
        } catch (error) {
          showNotice(`Could not save project: ${escapeHtml(error.message || "Unknown error")}`, "error");
        }
      });
    }
    if (handoffBtn) {
      handoffBtn.addEventListener("click", async () => {
        try {
          const handoff = await createHandoff("sermon-preparation", "research-helper", {
            manuscriptSeed: [
              cleanString(lastGenerated.ai.bigIdea),
              ...(lastGenerated.ai.outline || []).map((item) => `${item.heading}: ${item.explanation}`)
            ].join("\n\n"),
            plan: lastGenerated.ai
          });
          await trackEvent("handoff_created", {
            from: "sermon-preparation",
            to: "research-helper"
          });
          window.location.href = `/ai/apps/research-helper/?handoff=${encodeURIComponent(cleanString(handoff && handoff.handoff && handoff.handoff.id || ""))}`;
        } catch (error) {
          showNotice(`Could not create handoff: ${escapeHtml(error.message || "Unknown error")}`, "error");
        }
      });
    }
  }

  async function hydrateFromHandoff() {
    const params = new URLSearchParams(window.location.search);
    if (cleanString(params.get("project"))) {
      return;
    }
    const handoffId = cleanString(params.get("handoff"));
    if (!handoffId) {
      return;
    }
    try {
      const response = await getHandoff(handoffId);
      const payload = response && response.handoff ? response.handoff.payload || {} : {};
      const passage = payload.passage || {};
      if (passage.reference) {
        $("#prepReference").value = cleanString(passage.reference);
      }
      if (payload.summary) {
        $("#prepTheme").value = cleanString(payload.summary).slice(0, 120);
      }
      showNotice("Loaded handoff context from Bible Study.", "ok");
    } catch (_) {
      // Ignore missing handoffs and keep form usable.
    }
  }

  function renderSeriesList(seriesRows) {
    const rows = Array.isArray(seriesRows) ? seriesRows : [];
    if (!rows.length) {
      return `<p class="inline-hint">No series created yet.</p>`;
    }
    return rows.map((row) => `
      <article class="result-item">
        <h3>${escapeHtml(cleanString(row.title, "Series"))}</h3>
        <p><strong>Start:</strong> ${escapeHtml(cleanString(row.startDate, "n/a"))} | <strong>Weeks:</strong> ${Array.isArray(row.weeks) ? row.weeks.length : 0}</p>
        ${Array.isArray(row.weeks) && row.weeks.length ? `<p>${row.weeks.map((week) => `${escapeHtml(cleanString(week.order))}. ${escapeHtml(cleanString(week.passage || week.theme || "Week"))}`).join(" | ")}</p>` : ""}
      </article>
    `).join("");
  }

  async function loadSeries() {
    if (!seriesList) {
      return;
    }
    try {
      const payload = await apiGet("/api/series");
      seriesList.innerHTML = renderSeriesList(payload.series);
    } catch (_) {
      seriesList.innerHTML = `<p class="inline-hint">Series list unavailable.</p>`;
    }
  }

  if (seriesCreateButton) {
    seriesCreateButton.addEventListener("click", async () => {
      const title = $("#seriesTitle") ? $("#seriesTitle").value.trim() : "";
      const date = $("#seriesDate") ? $("#seriesDate").value : "";
      if (!title) {
        showNotice("Enter a series title first.", "error");
        return;
      }
      try {
        await apiPost("/api/series", {
          title,
          startDate: date,
          weeks: [
            {
              order: 1,
              date,
              passage: cleanString($("#prepReference") && $("#prepReference").value),
              theme: cleanString($("#prepTheme") && $("#prepTheme").value)
            }
          ]
        });
        showNotice("Series created.", "ok");
        await loadSeries();
      } catch (error) {
        showNotice(`Could not create series: ${escapeHtml(error.message || "Unknown error")}`, "error");
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideNotice();
    result.innerHTML = "";

    const reference = $("#prepReference").value.trim();
    const theme = $("#prepTheme").value.trim();
    const audience = $("#prepAudience").value;
    const minutes = Number($("#prepMinutes").value || 30);
    const goal = $("#prepGoal").value.trim();
    const styleMode = $("#prepStyleMode") ? $("#prepStyleMode").value : "expository";
    const tightenWeakSections = Boolean($("#prepTighten") && $("#prepTighten").checked);
    const seriesTitle = $("#prepSeriesTitle") ? $("#prepSeriesTitle").value.trim() : "";
    const seriesWeek = $("#prepSeriesWeek") ? $("#prepSeriesWeek").value.trim() : "";
    const priorThemes = $("#prepSeriesThemes")
      ? $("#prepSeriesThemes").value.split(",").map((item) => item.trim()).filter(Boolean)
      : [];

    if (!reference) {
      showNotice("Enter a passage reference first.", "error");
      return;
    }

    setBusy(button, "Building...", true);

    try {
      const passage = await fetchBiblePassage(reference);
      const ai = await apiPost("/api/ai/sermon-preparation", {
        passage,
        theme,
        audience,
        minutes,
        goal,
        styleMode,
        tightenWeakSections,
        seriesContext: {
          title: seriesTitle,
          week: seriesWeek,
          priorThemes
        }
      });

      lastGenerated = {
        input: {
          reference,
          theme,
          audience,
          minutes,
          goal,
          styleMode,
          tightenWeakSections,
          seriesTitle,
          seriesWeek,
          priorThemes
        },
        passage,
        ai
      };
      result.innerHTML = `${renderPlan(passage, ai)}${renderActions()}`;
      await wireActions();
      showNotice(`AI sermon plan generated from ${escapeHtml(passage.reference)}.`, "ok");
      await trackEvent("generation_success", { tool: "sermon-preparation" });
    } catch (error) {
      showNotice(`Could not generate sermon plan: ${escapeHtml(error.message || "Unknown error")}`, "error");
    } finally {
      setBusy(button, "", false);
    }
  });

  async function hydrateFromProject() {
    try {
      const project = await hydrateProjectFromQuery("sermon-preparation");
      if (!project || !project.payload || typeof project.payload !== "object") {
        return;
      }
      const payload = project.payload;
      activeProjectId = cleanString(project.id);
      if (payload.passage && payload.passage.reference) {
        $("#prepReference").value = cleanString(payload.passage.reference);
      }
      if (payload.input && payload.input.theme) {
        $("#prepTheme").value = cleanString(payload.input.theme);
      }
      if (payload.input && payload.input.audience) {
        $("#prepAudience").value = cleanString(payload.input.audience);
      }
      if (payload.input && Number.isFinite(Number(payload.input.minutes))) {
        $("#prepMinutes").value = String(Number(payload.input.minutes));
      }
      if (payload.input && payload.input.goal) {
        $("#prepGoal").value = cleanString(payload.input.goal);
      }
      if (payload.input && payload.input.styleMode && $("#prepStyleMode")) {
        $("#prepStyleMode").value = cleanString(payload.input.styleMode);
      }
      if (payload.input && typeof payload.input.tightenWeakSections === "boolean" && $("#prepTighten")) {
        $("#prepTighten").checked = Boolean(payload.input.tightenWeakSections);
      }
      if (payload.input && payload.input.seriesTitle && $("#prepSeriesTitle")) {
        $("#prepSeriesTitle").value = cleanString(payload.input.seriesTitle);
      }
      if (payload.input && payload.input.seriesWeek && $("#prepSeriesWeek")) {
        $("#prepSeriesWeek").value = cleanString(payload.input.seriesWeek);
      }
      if (payload.input && Array.isArray(payload.input.priorThemes) && $("#prepSeriesThemes")) {
        $("#prepSeriesThemes").value = payload.input.priorThemes.map((item) => cleanString(item)).filter(Boolean).join(", ");
      }
      if (payload.passage && payload.ai) {
        lastGenerated = payload;
        result.innerHTML = `${renderPlan(payload.passage, payload.ai)}${renderActions()}`;
        await wireActions();
      }
      showNotice("Loaded saved Sermon Preparation project.", "ok");
    } catch (error) {
      showNotice(`Could not load project: ${escapeHtml(cleanString(error.message))}`, "error");
    }
  }

  void hydrateFromProject();
  void hydrateFromHandoff();
  void loadSeries();
})();
