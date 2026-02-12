(function () {
  const {
    $,
    escapeHtml,
    fetchBiblePassage,
    apiPost,
    cleanArray,
    cleanString,
    setBusy
  } = window.AIBible;

  const form = $("#prepForm");
  const notice = $("#prepNotice");
  const result = $("#prepResult");
  const button = $("#prepButton");

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
    `;
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
        goal
      });

      result.innerHTML = renderPlan(passage, ai);
      showNotice(`AI sermon plan generated from ${escapeHtml(passage.reference)}.`, "ok");
    } catch (error) {
      showNotice(`Could not generate sermon plan: ${escapeHtml(error.message || "Unknown error")}`, "error");
    } finally {
      setBusy(button, "", false);
    }
  });
})();
