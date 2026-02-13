(function () {
  const {
    $,
    escapeHtml,
    fetchBiblePassage,
    apiGet,
    apiPost,
    apiPatch,
    cleanArray,
    cleanString,
    setBusy,
    saveProject,
    updateProject,
    appendProjectExport,
    hydrateProjectFromQuery,
    createHandoff,
    trackEvent,
    registerToolLifecycle
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
  let lastGenerated = null;
  let activeProjectId = "";
  registerToolLifecycle("bible-study");

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
        ${stage.evidence && typeof stage.evidence === "object" ? `
          <p><strong>Confidence:</strong> ${escapeHtml(cleanString(stage.evidence.confidence, "unknown"))}</p>
          ${cleanString(stage.evidence.rationale) ? `<p>${escapeHtml(cleanString(stage.evidence.rationale))}</p>` : ""}
          ${(stage.evidence.citations || []).length ? `<p><strong>Citations:</strong> ${(stage.evidence.citations || []).map((row) => {
            const ref = cleanString(row.reference);
            return `<a href="https://bible-api.com/${encodeURIComponent(ref)}?translation=web" target="_blank" rel="noopener noreferrer">${escapeHtml(ref)}</a>`;
          }).join(", ")}</p>` : ""}
        ` : ""}
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

  async function copyStudyExport(content, exportType, reference) {
    await navigator.clipboard.writeText(cleanString(content));
    if (activeProjectId) {
      await appendProjectExport(activeProjectId, cleanString(exportType), {
        reference: cleanString(reference)
      });
    }
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

      ${(ai && ai.exportPack && ai.exportPack.markdown) ? `
        <div class="card">
          <span class="kicker">Export Pack</span>
          <div class="btn-row">
            <button type="button" class="btn secondary" id="studyCopyExport">Copy Markdown Export</button>
            ${ai.exportPack.docText ? `<button type="button" class="btn secondary" id="studyCopyDocExport">Copy Doc Text</button>` : ""}
            ${ai.exportPack.html ? `<button type="button" class="btn secondary" id="studyDownloadHtmlExport">Download HTML</button>` : ""}
          </div>
        </div>
      ` : ""}
    `;
  }

  function renderActionButtons() {
    if (!lastGenerated) {
      return "";
    }
    return `
      <div class="card">
        <span class="kicker">Project Actions</span>
        <div class="btn-row">
          <button type="button" class="btn secondary" id="studySaveProject">${activeProjectId ? "Update Study Project" : "Save Study Project"}</button>
          <button type="button" class="btn secondary" id="studyHandoffPrep">Send to Sermon Preparation</button>
        </div>
      </div>
    `;
  }

  async function wireActionButtons() {
    const saveBtn = $("#studySaveProject");
    const handoffBtn = $("#studyHandoffPrep");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        if (!lastGenerated) {
          return;
        }
        try {
          const title = `Bible Study - ${cleanString(lastGenerated.passage.reference)}`;
          if (activeProjectId) {
            await updateProject(activeProjectId, lastGenerated);
          } else {
            const saved = await saveProject("bible-study", title, lastGenerated);
            activeProjectId = cleanString(saved && saved.project && saved.project.id);
          }
          await trackEvent("project_saved", { tool: "bible-study" });
          showNotice("Study project saved.", "ok");
        } catch (error) {
          showNotice(`Could not save project: ${escapeHtml(error.message || "Unknown error")}`, "error");
        }
      });
    }
    if (handoffBtn) {
      handoffBtn.addEventListener("click", async () => {
        if (!lastGenerated) {
          return;
        }
        try {
          const handoff = await createHandoff("bible-study", "sermon-preparation", {
            passage: lastGenerated.passage,
            summary: cleanString(lastGenerated.ai.summary),
            clear: lastGenerated.ai.clear
          });
          await trackEvent("handoff_created", {
            from: "bible-study",
            to: "sermon-preparation"
          });
          window.location.href = `/ai/apps/sermon-preparation/?handoff=${encodeURIComponent(cleanString(handoff && handoff.handoff && handoff.handoff.id || ""))}`;
        } catch (error) {
          showNotice(`Could not create handoff: ${escapeHtml(error.message || "Unknown error")}`, "error");
        }
      });
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideNotice();
    result.innerHTML = "";

    const reference = $("#reference").value.trim();
    const focus = $("#focus").value.trim();
    const question = $("#question").value.trim();
    const theologicalProfile = $("#theologicalProfile") ? $("#theologicalProfile").value : "text-centered";

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
        question,
        theologicalProfile
      });
      lastGenerated = {
        input: { focus, question, theologicalProfile },
        passage,
        ai: ai || {}
      };
      result.innerHTML = `${renderStudy(passage, ai || {})}${renderActionButtons()}`;
      await wireActionButtons();
      const copyExportBtn = $("#studyCopyExport");
      const copyDocBtn = $("#studyCopyDocExport");
      const downloadHtmlBtn = $("#studyDownloadHtmlExport");
      if (copyExportBtn && ai && ai.exportPack && ai.exportPack.markdown) {
        copyExportBtn.addEventListener("click", async () => {
          try {
            await copyStudyExport(ai.exportPack.markdown, "bible-study-markdown", passage.reference);
            showNotice("Markdown export copied.", "ok");
          } catch (copyError) {
            showNotice(`Could not copy markdown export: ${escapeHtml(cleanString(copyError.message))}`, "error");
          }
        });
      }
      if (copyDocBtn && ai && ai.exportPack && ai.exportPack.docText) {
        copyDocBtn.addEventListener("click", async () => {
          try {
            await copyStudyExport(ai.exportPack.docText, "bible-study-doc-text", passage.reference);
            showNotice("Doc text export copied.", "ok");
          } catch (copyError) {
            showNotice(`Could not copy doc export: ${escapeHtml(cleanString(copyError.message))}`, "error");
          }
        });
      }
      if (downloadHtmlBtn && ai && ai.exportPack && ai.exportPack.html) {
        downloadHtmlBtn.addEventListener("click", async () => {
          try {
            const blob = new Blob([cleanString(ai.exportPack.html)], { type: "text/html;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `bible-study-${cleanString(passage.reference).replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "export"}.html`;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);
            if (activeProjectId) {
              await appendProjectExport(activeProjectId, "bible-study-html", {
                reference: cleanString(passage.reference)
              });
            }
            showNotice("HTML export downloaded.", "ok");
          } catch (downloadError) {
            showNotice(`Could not download HTML export: ${escapeHtml(cleanString(downloadError.message))}`, "error");
          }
        });
      }
      showNotice(`AI study generated from ${escapeHtml(passage.reference)}.`, "ok");
      void apiPatch("/api/user/settings", {
        studyPreferences: {
          theologicalProfile
        }
      }).catch(() => {});
      await trackEvent("generation_success", { tool: "bible-study" });
    } catch (error) {
      showNotice(`Could not generate study: ${escapeHtml(error.message || "Unknown error")}`, "error");
    } finally {
      setBusy(button, "", false);
    }
  });

  async function hydrateFromProject() {
    try {
      const project = await hydrateProjectFromQuery("bible-study");
      if (!project || !project.payload || typeof project.payload !== "object") {
        return;
      }
      const payload = project.payload;
      activeProjectId = cleanString(project.id);

      if (payload.passage && payload.passage.reference) {
        $("#reference").value = cleanString(payload.passage.reference);
      }
      if (payload.input && payload.input.focus) {
        $("#focus").value = cleanString(payload.input.focus);
      }
      if (payload.input && payload.input.question) {
        $("#question").value = cleanString(payload.input.question);
      }
      if (payload.input && payload.input.theologicalProfile && $("#theologicalProfile")) {
        $("#theologicalProfile").value = cleanString(payload.input.theologicalProfile);
      }

      if (payload.passage && payload.ai) {
        lastGenerated = payload;
        result.innerHTML = `${renderStudy(payload.passage, payload.ai)}${renderActionButtons()}`;
        await wireActionButtons();
        const copyExportBtn = $("#studyCopyExport");
        const copyDocBtn = $("#studyCopyDocExport");
        const downloadHtmlBtn = $("#studyDownloadHtmlExport");
        if (copyExportBtn && payload.ai.exportPack && payload.ai.exportPack.markdown) {
          copyExportBtn.addEventListener("click", async () => {
            try {
              await copyStudyExport(payload.ai.exportPack.markdown, "bible-study-markdown", payload.passage.reference);
              showNotice("Markdown export copied.", "ok");
            } catch (copyError) {
              showNotice(`Could not copy markdown export: ${escapeHtml(cleanString(copyError.message))}`, "error");
            }
          });
        }
        if (copyDocBtn && payload.ai.exportPack && payload.ai.exportPack.docText) {
          copyDocBtn.addEventListener("click", async () => {
            try {
              await copyStudyExport(payload.ai.exportPack.docText, "bible-study-doc-text", payload.passage.reference);
              showNotice("Doc text export copied.", "ok");
            } catch (copyError) {
              showNotice(`Could not copy doc export: ${escapeHtml(cleanString(copyError.message))}`, "error");
            }
          });
        }
        if (downloadHtmlBtn && payload.ai.exportPack && payload.ai.exportPack.html) {
          downloadHtmlBtn.addEventListener("click", async () => {
            try {
              const blob = new Blob([cleanString(payload.ai.exportPack.html)], { type: "text/html;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `bible-study-${cleanString(payload.passage.reference).replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "export"}.html`;
              document.body.appendChild(anchor);
              anchor.click();
              document.body.removeChild(anchor);
              URL.revokeObjectURL(url);
              if (activeProjectId) {
                await appendProjectExport(activeProjectId, "bible-study-html", {
                  reference: cleanString(payload.passage.reference)
                });
              }
              showNotice("HTML export downloaded.", "ok");
            } catch (downloadError) {
              showNotice(`Could not download HTML export: ${escapeHtml(cleanString(downloadError.message))}`, "error");
            }
          });
        }
      }
      showNotice("Loaded saved Bible Study project.", "ok");
    } catch (error) {
      showNotice(`Could not load project: ${escapeHtml(cleanString(error.message))}`, "error");
    }
  }

  async function hydrateSavedPreferences() {
    if (!$("#theologicalProfile")) {
      return;
    }
    try {
      const settings = await apiGet("/api/user/settings");
      const savedProfile = cleanString(settings && settings.studyPreferences && settings.studyPreferences.theologicalProfile);
      if (savedProfile) {
        $("#theologicalProfile").value = savedProfile;
      }
    } catch (_) {
      // Preference hydration should not block tool usage.
    }
  }

  void hydrateSavedPreferences();
  void hydrateFromProject();
})();
