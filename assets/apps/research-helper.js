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
    setBusy
  } = window.AIBible;

  const form = $("#evalForm");
  const notice = $("#evalNotice");
  const result = $("#evalResult");
  const button = $("#evalButton");

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
        <p>${escapeHtml(cleanString(ai.overallVerdict, "No verdict returned."))}</p>
      </div>

      <div class="card">
        <span class="kicker">AI Scores</span>
        ${renderScores(ai.scores)}
      </div>

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
        diagnostics,
        manuscript
      });

      result.innerHTML = renderAnalysis(diagnostics, ai);
      showNotice("AI sermon evaluation complete.", "ok");
    } catch (error) {
      showNotice(`Could not evaluate sermon: ${escapeHtml(error.message || "Unknown error")}`, "error");
    } finally {
      setBusy(button, "", false);
    }
  });
})();
