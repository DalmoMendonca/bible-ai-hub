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

  const STAGE_ORDER = ["confess", "list", "exegete", "analyze", "relate"];
  const STAGE_SECTIONS = [
    { title: "Study Actions", key: "actions", max: 10 },
    { title: "AI Findings For This Passage", key: "aiFindings", max: 9 },
    { title: "Diagnostic Questions", key: "diagnosticQuestions", max: 8 },
    { title: "Micro-Prompts", key: "microPrompts", max: 7 },
    { title: "Deliverables", key: "deliverables", max: 7 },
    { title: "Quality Checks", key: "qualityChecks", max: 7 },
    { title: "Cautions", key: "cautions", max: 6 }
  ];
  const TEN_STEP_SECTIONS = [
    { title: "What To Do", key: "whatToDo", max: 8 },
    { title: "AI Helps", key: "aiHelps", max: 7 },
    { title: "Quality Checks", key: "qualityChecks", max: 7 }
  ];
  const WORKFLOW_SECTIONS = [
    { title: "Assistant Response", key: "assistantResponse", max: 9 },
    { title: "Next Actions", key: "nextActions", max: 9 },
    { title: "Integration Notes", key: "integrationNotes", max: 9 },
    { title: "Prayer Prompts", key: "prayerPrompts", max: 8 }
  ];

  const form = $("#studyForm");
  const notice = $("#studyNotice");
  const result = $("#studyResult");
  const button = $("#studyButton");

  function showNotice(message, type) {
    notice.className = `notice ${type || ""}`.trim();
    notice.innerHTML = message;
    notice.classList.remove("hidden");
  }

  function hideNotice() {
    notice.classList.add("hidden");
    notice.textContent = "";
  }

  function listHtml(items, max = 10) {
    const rows = cleanArray(items, max);
    if (!rows.length) {
      return `<p class="inline-hint">No items returned.</p>`;
    }

    return `<ul class="list">${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function listSectionHtml(title, items, max) {
    return `
      <h4 class="study-subtitle">${escapeHtml(title)}</h4>
      ${listHtml(items, max)}
    `;
  }

  // Keep frontend resilient if the API returns an incomplete stage payload.
  function normalizeStage(stageKey, stageData) {
    const fallbackLabel = stageKey.charAt(0).toUpperCase() + stageKey.slice(1);
    return stageData && typeof stageData === "object"
      ? stageData
      : {
        code: fallbackLabel.charAt(0),
        label: fallbackLabel,
        definition: "",
        stageSummary: "",
        actions: Array.isArray(stageData) ? stageData : []
      };
  }

  function stageCardHtml(stageKey, stageData) {
    const fallbackLabel = stageKey.charAt(0).toUpperCase() + stageKey.slice(1);
    const stage = normalizeStage(stageKey, stageData);
    const sectionsHtml = STAGE_SECTIONS
      .map((section) => listSectionHtml(section.title, stage[section.key], section.max))
      .join("");

    return `
      <div class="card">
        <span class="kicker">${escapeHtml(cleanString(stage.code, fallbackLabel.charAt(0)))}</span>
        <h3 class="section-title">${escapeHtml(cleanString(stage.label, fallbackLabel))}</h3>
        ${cleanString(stage.definition) ? `<p>${escapeHtml(cleanString(stage.definition))}</p>` : ""}
        ${cleanString(stage.stageSummary) ? `<p><strong>Stage Aim:</strong> ${escapeHtml(cleanString(stage.stageSummary))}</p>` : ""}
        ${sectionsHtml}
      </div>
    `;
  }

  function tenStepCardHtml(step) {
    const sectionsHtml = TEN_STEP_SECTIONS
      .map((section) => listSectionHtml(section.title, step[section.key], section.max))
      .join("");

    return `
      <article class="study-step-card">
        <h4>Step ${Number(step.stepNumber || 0)}: ${escapeHtml(cleanString(step.stepName, "Study Step"))}</h4>
        ${cleanString(step.objective) ? `<p><strong>Objective:</strong> ${escapeHtml(cleanString(step.objective))}</p>` : ""}
        ${sectionsHtml}
        ${cleanString(step.outputArtifact) ? `<p><strong>Output Artifact:</strong> ${escapeHtml(cleanString(step.outputArtifact))}</p>` : ""}
      </article>
    `;
  }

  function renderStudy(passage, ai) {
    const clear = ai && ai.clear && typeof ai.clear === "object" ? ai.clear : {};
    const tenStep = Array.isArray(ai && ai.tenStep) ? ai.tenStep : [];
    const lens = ai && ai.passageLens && typeof ai.passageLens === "object" ? ai.passageLens : {};
    const workflow = ai && ai.studyWorkflow && typeof ai.studyWorkflow === "object" ? ai.studyWorkflow : {};
    const workflowSectionsHtml = WORKFLOW_SECTIONS
      .map((section) => listSectionHtml(section.title, workflow[section.key], section.max))
      .join("");

    return `
      <div class="card">
        <span class="kicker">Passage</span>
        <h3 class="section-title">${escapeHtml(passage.reference)} (${escapeHtml(passage.translation_name)})</h3>
        <p>${escapeHtml(passage.text)}</p>
      </div>

      <div class="card">
        <span class="kicker">Study Blueprint</span>
        <p><strong>Summary:</strong> ${escapeHtml(cleanString(ai && ai.summary, "No summary returned."))}</p>
        <h4 class="study-subtitle">Context Summary</h4>
        <p>${escapeHtml(cleanString(lens.contextSummary, "No context summary returned."))}</p>
        <h4 class="study-subtitle">Textual Horizon</h4>
        ${listHtml(lens.textualHorizon, 8)}
        <h4 class="study-subtitle">Interpretive Risks</h4>
        ${listHtml(lens.interpretiveRisks, 8)}
        <h4 class="study-subtitle">Pastoral Aim</h4>
        <p>${escapeHtml(cleanString(lens.pastoralAim, "No pastoral aim returned."))}</p>
      </div>

      ${STAGE_ORDER.map((key) => stageCardHtml(key, clear[key])).join("")}

      <div class="card">
        <span class="kicker">10-Step Study Method</span>
        <div class="study-step-grid">
          ${tenStep.length ? tenStep.map((step) => tenStepCardHtml(step)).join("") : `<p class="inline-hint">No 10-step plan returned.</p>`}
        </div>
      </div>

      <div class="card">
        <span class="kicker">Workflow Support</span>
        ${workflowSectionsHtml}
      </div>
    `;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideNotice();
    result.innerHTML = "";

    const reference = $("#reference").value.trim();
    const focus = $("#focus").value.trim();
    const question = $("#question").value.trim();

    if (!reference) {
      showNotice("Enter a Bible reference before running the study.", "error");
      return;
    }

    setBusy(button, "Generating...", true);

    try {
      const passage = await fetchBiblePassage(reference);
      const ai = await apiPost("/api/ai/bible-study", {
        passage,
        focus,
        question
      });

      result.innerHTML = renderStudy(passage, ai || {});
      showNotice(`AI study generated from ${escapeHtml(passage.reference)}.`, "ok");
    } catch (error) {
      showNotice(`Could not generate study: ${escapeHtml(error.message || "Unknown error")}`, "error");
    } finally {
      setBusy(button, "", false);
    }
  });
})();
