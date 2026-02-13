(function () {
  const {
    $,
    escapeHtml,
    textMetrics,
    estimatePassiveVoice,
    findScriptureReferences,
    renderScore,
    cleanArray,
    cleanString,
    apiPost,
    setBusy,
    saveProject,
    updateProject,
    appendProjectExport,
    hydrateProjectFromQuery,
    getHandoff,
    trackEvent,
    registerToolLifecycle
  } = window.AIBible;

  const form = $("#evalForm");
  const notice = $("#evalNotice");
  const result = $("#evalResult");
  const button = $("#evalButton");
  let lastGenerated = null;
  let activeProjectId = "";
  registerToolLifecycle("research-helper");

  function showNotice(message, type) {
    notice.className = `notice ${type || ""}`.trim();
    notice.innerHTML = message;
    notice.classList.remove("hidden");
  }

  function hideNotice() {
    notice.classList.add("hidden");
    notice.textContent = "";
  }

  function countOccurrences(text, pattern) {
    const matches = String(text || "").match(pattern);
    return matches ? matches.length : 0;
  }

  function localDiagnostics(text, targetMinutes) {
    const metrics = textMetrics(text);
    const passive = estimatePassiveVoice(text);
    const references = findScriptureReferences(text);
    const questions = countOccurrences(text, /\?/g);
    const callsToAction = countOccurrences(
      text.toLowerCase(),
      /\b(apply|obey|repent|believe|trust|serve|forgive|go|act|confess|pray)\b/g
    );

    return {
      metrics,
      passive,
      references,
      questions,
      callsToAction,
      estimatedMinutesAt130Wpm: Number((metrics.wordCount / 130).toFixed(1)),
      targetMinutes
    };
  }

  function listHtml(items, max = 8) {
    const rows = cleanArray(items, max);
    if (!rows.length) {
      return `<p class="inline-hint">No items returned.</p>`;
    }

    return `<ul class="list">${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function renderScores(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    if (!safeRows.length) {
      return `<p class="inline-hint">No scores returned.</p>`;
    }

    return safeRows
      .map((row) => {
        const label = cleanString(row.label, "Category");
        const score = Number(row.score || 0);
        const rationale = cleanString(row.rationale);

        return `
          <article class="result-item">
            <h3>${escapeHtml(label)} ${renderScore(score)}</h3>
            <p>${escapeHtml(rationale)}</p>
          </article>
        `;
      })
      .join("");
  }

  function renderTrendSeries(series) {
    const safe = Array.isArray(series) ? series.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value)) : [];
    if (!safe.length) {
      return `<p class="inline-hint">No trend history yet.</p>`;
    }
    const max = Math.max(...safe, 1);
    return `
      <div class="metric-grid">
        ${safe.map((value, index) => `
          <div class="metric">
            <strong>${Number(value).toFixed(2)}</strong>
            <span>Run ${index + 1}</span>
            <div class="progress-track"><span class="progress-fill" style="width:${Math.max(4, (value / max) * 100)}%"></span></div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderAnalysis(diagnostics, ai) {
    const refsLabel = diagnostics.references.length
      ? diagnostics.references.slice(0, 10).join(", ")
      : "No explicit references detected.";

    return `
      <div class="card">
        <span class="kicker">Local Diagnostics</span>
        <div class="metric-grid">
          <div class="metric"><strong>${diagnostics.metrics.wordCount}</strong><span>Total words</span></div>
          <div class="metric"><strong>${diagnostics.metrics.sentenceCount}</strong><span>Total sentences</span></div>
          <div class="metric"><strong>${diagnostics.metrics.avgSentenceLength}</strong><span>Words per sentence</span></div>
          <div class="metric"><strong>${diagnostics.metrics.readability}</strong><span>Readability (${escapeHtml(diagnostics.metrics.readabilityBand)})</span></div>
          <div class="metric"><strong>${diagnostics.estimatedMinutesAt130Wpm} min</strong><span>Estimated duration at 130 WPM</span></div>
          <div class="metric"><strong>${diagnostics.targetMinutes} min</strong><span>Target duration</span></div>
        </div>
        <p><strong>Scripture references:</strong> ${escapeHtml(refsLabel)}</p>
        <p><strong>Passive voice estimate:</strong> ${diagnostics.passive.count} sentence(s)</p>
        <p><strong>Reflective questions:</strong> ${diagnostics.questions}</p>
        <p><strong>Action verbs:</strong> ${diagnostics.callsToAction}</p>
      </div>

      <div class="card">
        <span class="kicker">AI Verdict</span>
        <p><strong>Revision objective:</strong> ${escapeHtml(cleanString(ai.revisionObjective || "balanced"))}</p>
        <p>${escapeHtml(cleanString(ai.overallVerdict, "No verdict returned."))}</p>
      </div>

      <div class="card">
        <span class="kicker">AI Scores</span>
        ${renderScores(ai.scores)}
      </div>

      ${ai && ai.trends ? `
        <div class="card">
          <span class="kicker">Trend Window (Last ${escapeHtml(String(ai.trends.window || 10))})</span>
          <p><strong>Average score:</strong> ${escapeHtml(String(ai.trends.averageScore || 0))}</p>
          <p><strong>Previous average:</strong> ${escapeHtml(String(ai.trends.previousAverage || 0))}</p>
          <p><strong>Delta:</strong> ${escapeHtml(String(ai.trends.delta || 0))}</p>
          ${renderTrendSeries(ai.trends.series)}
        </div>
      ` : ""}

      ${ai && ai.revisionDelta ? `
        <div class="card">
          <span class="kicker">Revision Delta</span>
          <p><strong>Score delta:</strong> ${escapeHtml(String(ai.revisionDelta.scoreDelta || 0))}</p>
          <p><strong>Manuscript length delta:</strong> ${escapeHtml(String(ai.revisionDelta.manuscriptLengthDelta || 0))} chars</p>
        </div>
      ` : ""}

      <div class="card">
        <span class="kicker">Strengths</span>
        ${listHtml(ai.strengths, 8)}
      </div>

      <div class="card">
        <span class="kicker">Gaps</span>
        ${listHtml(ai.gaps, 8)}
      </div>

      <div class="card">
        <span class="kicker">Recommended Revisions</span>
        ${listHtml(ai.revisions, 10)}
      </div>

      <div class="card">
        <span class="kicker">Tighten These Lines</span>
        ${listHtml(ai.tightenLines, 6)}
      </div>
    `;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideNotice();
    result.innerHTML = "";

    const sermonType = $("#evalType").value;
    const targetMinutes = Number($("#evalTarget").value || 35);
    const revisionObjective = $("#evalObjective").value || "balanced";
    const manuscript = $("#evalText").value.trim();

    if (!manuscript) {
      showNotice("Paste your sermon manuscript first.", "error");
      return;
    }

    setBusy(button, "Evaluating...", true);

    try {
      const diagnostics = localDiagnostics(manuscript, targetMinutes);
      const ai = await apiPost("/api/ai/research-helper", {
        sermonType,
        targetMinutes,
        revisionObjective,
        diagnostics,
        manuscript
      });

      lastGenerated = {
        input: { sermonType, targetMinutes, revisionObjective, manuscript, diagnostics },
        output: ai
      };
      result.innerHTML = renderAnalysis(diagnostics, ai);
      showNotice("AI sermon evaluation complete.", "ok");
      await trackEvent("generation_success", { tool: "research-helper" });
    } catch (error) {
      showNotice(`Could not evaluate sermon: ${escapeHtml(error.message || "Unknown error")}`, "error");
    } finally {
      setBusy(button, "", false);
    }
  });

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn secondary";
  saveBtn.textContent = "Save Evaluation";
  saveBtn.addEventListener("click", async () => {
    if (!lastGenerated) {
      showNotice("Run an evaluation before saving.", "error");
      return;
    }
    try {
      if (activeProjectId) {
        await updateProject(activeProjectId, lastGenerated);
      } else {
        const saved = await saveProject("research-helper", "Sermon Evaluation", lastGenerated);
        activeProjectId = cleanString(saved && saved.project && saved.project.id);
      }
      await trackEvent("project_saved", { tool: "research-helper" });
      showNotice("Evaluation saved.", "ok");
    } catch (error) {
      showNotice(`Could not save evaluation: ${escapeHtml(error.message || "Unknown error")}`, "error");
    }
  });
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn secondary";
  exportBtn.textContent = "Export Trend CSV";
  exportBtn.addEventListener("click", async () => {
    if (!lastGenerated || !lastGenerated.output) {
      showNotice("Run an evaluation before exporting.", "error");
      return;
    }
    const trends = lastGenerated.output.trends && Array.isArray(lastGenerated.output.trends.series)
      ? lastGenerated.output.trends.series
      : [];
    if (!trends.length) {
      showNotice("No trend data is available yet.", "error");
      return;
    }
    const csv = [
      "run_index,score",
      ...trends.map((score, index) => `${index + 1},${Number(score || 0)}`)
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "sermon-evaluation-trends.csv";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    if (activeProjectId) {
      try {
        await appendProjectExport(activeProjectId, "sermon-evaluation-trends-csv", {
          rows: trends.length
        });
      } catch (_) {
        // Export history logging should not block download UX.
      }
    }
    showNotice("Trend CSV exported.", "ok");
  });
  const buttonRow = document.querySelector("#evalForm .btn-row");
  if (buttonRow) {
    buttonRow.appendChild(saveBtn);
    buttonRow.appendChild(exportBtn);
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
      const manuscriptSeed = cleanString(payload.manuscriptSeed);
      if (manuscriptSeed) {
        $("#evalText").value = manuscriptSeed;
      }
      showNotice("Loaded handoff context from Sermon Preparation.", "ok");
    } catch (_) {
      // keep page usable even if handoff lookup fails
    }
  }

  async function hydrateFromProject() {
    try {
      const project = await hydrateProjectFromQuery("research-helper");
      if (!project || !project.payload || typeof project.payload !== "object") {
        return;
      }
      const payload = project.payload;
      activeProjectId = cleanString(project.id);
      const input = payload.input && typeof payload.input === "object" ? payload.input : {};
      if (input.sermonType) {
        $("#evalType").value = cleanString(input.sermonType);
      }
      if (Number.isFinite(Number(input.targetMinutes))) {
        $("#evalTarget").value = String(Number(input.targetMinutes));
      }
      if (input.revisionObjective) {
        $("#evalObjective").value = cleanString(input.revisionObjective);
      }
      if (input.manuscript) {
        $("#evalText").value = cleanString(input.manuscript);
      }
      if (input.diagnostics && typeof input.diagnostics === "object") {
        // Keep local diagnostics in sync for immediate render consistency.
      }
      if (payload.output && input.diagnostics) {
        lastGenerated = payload;
        result.innerHTML = renderAnalysis(input.diagnostics, payload.output);
      }
      showNotice("Loaded saved Sermon Evaluation project.", "ok");
    } catch (error) {
      showNotice(`Could not load project: ${escapeHtml(cleanString(error.message))}`, "error");
    }
  }

  void hydrateFromProject();
  void hydrateFromHandoff();
})();
