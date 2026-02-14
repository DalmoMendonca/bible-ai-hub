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
    saveProjectAndOpen,
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
  let saveBtn = null;
  let exportBtn = null;
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

  function setActionButtonsVisible(isVisible) {
    if (saveBtn) {
      saveBtn.classList.toggle("hidden", !isVisible);
    }
    if (exportBtn) {
      exportBtn.classList.toggle("hidden", !isVisible);
    }
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

  function resolveAnnotationRanges(manuscript, annotations) {
    const source = String(manuscript || "");
    const rows = Array.isArray(annotations) ? annotations : [];
    const resolved = [];

    for (const row of rows) {
      if (!row || typeof row !== "object") {
        continue;
      }
      let start = Number(row.startIndex);
      let end = Number(row.endIndex);
      const targetText = cleanString(row.targetText);
      if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) {
        if (!targetText) {
          continue;
        }
        const index = source.toLowerCase().indexOf(targetText.toLowerCase());
        if (index < 0) {
          continue;
        }
        start = index;
        end = index + targetText.length;
      }
      start = Math.max(0, Math.min(source.length, start));
      end = Math.max(start + 1, Math.min(source.length, end));
      resolved.push({
        id: cleanString(row.id, `ann_${resolved.length + 1}`),
        start,
        end,
        kind: cleanString(row.kind, "sentence"),
        severity: cleanString(row.severity, "improve"),
        title: cleanString(row.title, "Inline feedback"),
        comment: cleanString(row.comment || row.feedback),
        suggestion: cleanString(row.suggestion),
        targetText: source.slice(start, end)
      });
    }

    resolved.sort((a, b) => a.start - b.start);
    const output = [];
    let lastEnd = -1;
    for (const row of resolved) {
      if (row.start < lastEnd) {
        continue;
      }
      output.push(row);
      lastEnd = row.end;
      if (output.length >= 18) {
        break;
      }
    }
    return output;
  }

  function renderInlineAnnotations(manuscript, annotations) {
    const source = cleanString(manuscript);
    if (!source) {
      return `<p class="inline-hint">No manuscript text available for inline annotations.</p>`;
    }
    const ranges = resolveAnnotationRanges(source, annotations);
    if (!ranges.length) {
      return `<p class="inline-hint">Inline annotations are not available for this run.</p>`;
    }

    let cursor = 0;
    let textHtml = "";
    for (const row of ranges) {
      textHtml += escapeHtml(source.slice(cursor, row.start)).replace(/\n/g, "<br />");
      textHtml += `<mark class="eval-annot eval-annot-${escapeHtml(row.severity)}" data-eval-annot="${escapeHtml(row.id)}">${escapeHtml(source.slice(row.start, row.end))}</mark>`;
      cursor = row.end;
    }
    textHtml += escapeHtml(source.slice(cursor)).replace(/\n/g, "<br />");

    return `
      <div class="eval-annotation-shell">
        <div class="eval-annotation-doc" data-eval-annot-doc>${textHtml}</div>
        <div class="eval-annotation-comments">
          ${ranges.map((row, index) => `
            <article class="eval-annotation-item" data-eval-annot-comment="${escapeHtml(row.id)}">
              <p class="eval-annotation-meta">#${index + 1} | ${escapeHtml(row.kind)} | ${escapeHtml(row.severity)}</p>
              <h4>${escapeHtml(row.title)}</h4>
              <p>${escapeHtml(cleanString(row.comment, "No comment."))}</p>
              ${row.suggestion ? `<p class="inline-hint"><strong>Suggestion:</strong> ${escapeHtml(row.suggestion)}</p>` : ""}
            </article>
          `).join("")}
        </div>
      </div>
    `;
  }

  function wireAnnotationInteractions() {
    const marks = Array.from(document.querySelectorAll("[data-eval-annot]"));
    const comments = Array.from(document.querySelectorAll("[data-eval-annot-comment]"));
    if (!marks.length || !comments.length) {
      return;
    }

    const activate = (id) => {
      marks.forEach((mark) => {
        mark.classList.toggle("is-active", cleanString(mark.getAttribute("data-eval-annot")) === id);
      });
      comments.forEach((comment) => {
        comment.classList.toggle("is-active", cleanString(comment.getAttribute("data-eval-annot-comment")) === id);
      });
    };

    marks.forEach((mark) => {
      mark.addEventListener("click", () => {
        const id = cleanString(mark.getAttribute("data-eval-annot"));
        if (!id) {
          return;
        }
        activate(id);
        const comment = document.querySelector(`[data-eval-annot-comment="${id}"]`);
        if (comment) {
          comment.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    });

    comments.forEach((comment) => {
      comment.addEventListener("click", () => {
        const id = cleanString(comment.getAttribute("data-eval-annot-comment"));
        if (!id) {
          return;
        }
        activate(id);
        const mark = document.querySelector(`[data-eval-annot="${id}"]`);
        if (mark) {
          mark.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });
  }

  function renderAnalysis(diagnostics, ai, inputSnapshot) {
    const input = inputSnapshot && typeof inputSnapshot === "object" ? inputSnapshot : {};
    const refsLabel = diagnostics.references.length
      ? diagnostics.references.slice(0, 10).join(", ")
      : "No explicit references detected.";

    return `
      <div class="card">
        <span class="kicker">Project Inputs</span>
        <p><strong>Sermon type:</strong> ${escapeHtml(cleanString(input.sermonType, "Expository"))}</p>
        <p><strong>Target length:</strong> ${escapeHtml(String(Number(input.targetMinutes || diagnostics.targetMinutes || 35)))} min</p>
        <p><strong>Revision objective:</strong> ${escapeHtml(cleanString(input.revisionObjective, "balanced"))}</p>
        <p><strong>Manuscript:</strong></p>
        <div class="eval-input-text">${escapeHtml(cleanString(input.manuscript)).replace(/\n/g, "<br />")}</div>
      </div>

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

      <div class="card">
        <span class="kicker">Inline Annotations</span>
        ${renderInlineAnnotations(cleanString(input.manuscript), ai.annotations)}
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
    setActionButtonsVisible(false);

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

      const generated = {
        input: { sermonType, targetMinutes, revisionObjective, manuscript, diagnostics },
        output: ai
      };
      const persisted = await saveProjectAndOpen(
        "research-helper",
        `Sermon Evaluation - ${sermonType}`,
        generated,
        activeProjectId
      );
      activeProjectId = cleanString(persisted && persisted.projectId);
      if (persisted && persisted.navigated) {
        return;
      }
      lastGenerated = generated;
      result.innerHTML = renderAnalysis(diagnostics, ai, generated.input);
      wireAnnotationInteractions();
      setActionButtonsVisible(true);
      showNotice("AI sermon evaluation complete.", "ok");
      await trackEvent("generation_success", { tool: "research-helper" });
    } catch (error) {
      showNotice(`Could not evaluate sermon: ${escapeHtml(error.message || "Unknown error")}`, "error");
      setActionButtonsVisible(false);
    } finally {
      setBusy(button, "", false);
    }
  });

  saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn secondary hidden";
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
  exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn secondary hidden";
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
  setActionButtonsVisible(false);

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
        result.innerHTML = renderAnalysis(input.diagnostics, payload.output, input);
        wireAnnotationInteractions();
        setActionButtonsVisible(true);
      }
      showNotice("Loaded saved Sermon Evaluation project.", "ok");
    } catch (error) {
      showNotice(`Could not load project: ${escapeHtml(cleanString(error.message))}`, "error");
    }
  }

  void hydrateFromProject();
  void hydrateFromHandoff();
})();
