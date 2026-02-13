(function () {
  const {
    $,
    escapeHtml,
    fetchBiblePassage,
    apiPost,
    cleanArray,
    cleanString,
    setBusy,
    saveProject,
    updateProject,
    appendProjectExport,
    hydrateProjectFromQuery,
    trackEvent,
    registerToolLifecycle
  } = window.AIBible;

  const form = $("#teachForm");
  const notice = $("#teachNotice");
  const result = $("#teachResult");
  const button = $("#teachButton");
  const printButton = $("#teachPrint");
  const copyButton = $("#teachCopy");
  const exportLeaderButton = document.createElement("button");
  const exportStudentButton = document.createElement("button");
  const exportParentButton = document.createElement("button");
  const exportSlidesButton = document.createElement("button");
  let saveBtn = null;
  let lastGenerated = null;
  let activeProjectId = "";
  registerToolLifecycle("teaching-tools");
  const BIBLE_BOOK_PATTERN = /\b(?:gen(?:esis)?|exo(?:dus)?|lev(?:iticus)?|num(?:bers)?|deut(?:eronomy)?|josh(?:ua)?|judg(?:es)?|ruth|(?:1|2)\s*sam(?:uel)?|(?:1|2)\s*kings?|(?:1|2)\s*chron(?:icles)?|ezra|neh(?:emiah)?|esth(?:er)?|job|ps(?:alm|alms)?|prov(?:erbs)?|eccl(?:esiastes)?|song(?:\s+of\s+solomon)?|isa(?:iah)?|jer(?:emiah)?|lam(?:entations)?|ezek(?:iel)?|dan(?:iel)?|hos(?:ea)?|joel|amos|obad(?:iah)?|jonah|mic(?:ah)?|nah(?:um)?|hab(?:akkuk)?|zeph(?:aniah)?|hag(?:gai)?|zech(?:ariah)?|mal(?:achi)?|matt?(?:hew)?|mark|luke?|john|acts?|rom(?:ans)?|(?:1|2)\s*cor(?:inthians)?|gal(?:atians)?|eph(?:esians)?|phil(?:ippians)?|col(?:ossians)?|(?:1|2)\s*thess(?:alonians)?|(?:1|2)\s*tim(?:othy)?|titus|philem(?:on)?|heb(?:rews)?|james?|(?:1|2)\s*peter|(?:1|2|3)\s*john|jude|rev(?:elation)?)\b/i;

  function showNotice(message, type) {
    notice.className = `notice ${type || ""}`.trim();
    notice.innerHTML = message;
    notice.classList.remove("hidden");
  }

  function hideNotice() {
    notice.classList.add("hidden");
    notice.textContent = "";
  }

  function setExportButtonsVisible(isVisible) {
    copyButton.classList.toggle("hidden", !isVisible);
    printButton.classList.toggle("hidden", !isVisible);
    if (saveBtn) {
      saveBtn.classList.toggle("hidden", !isVisible);
    }
    exportLeaderButton.classList.toggle("hidden", !isVisible);
    exportStudentButton.classList.toggle("hidden", !isVisible);
    exportParentButton.classList.toggle("hidden", !isVisible);
    exportSlidesButton.classList.toggle("hidden", !isVisible);
  }

  function isLikelyBibleReference(value) {
    const input = cleanString(value);
    if (!input) {
      return false;
    }
    return /\d/.test(input) && BIBLE_BOOK_PATTERN.test(input);
  }

  function listHtml(items, max = 8) {
    const rows = cleanArray(items, max);
    if (!rows.length) {
      return `<p class="inline-hint">No items returned.</p>`;
    }
    return `<ul class="list">${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function renderTimeline(items) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      return `<p class="inline-hint">No session timeline returned.</p>`;
    }

    return rows
      .map((row) => {
        const segment = cleanString(row.segment, "Session Segment");
        const minutes = Number(row.minutes);
        const plan = cleanString(row.plan);

        return `
          <article class="result-item">
            <h3>${escapeHtml(segment)}${Number.isFinite(minutes) ? ` (${minutes} min)` : ""}</h3>
            <p>${escapeHtml(plan)}</p>
          </article>
        `;
      })
      .join("");
  }

  function renderQuestionTiers(dq) {
    const safe = dq && typeof dq === "object" ? dq : {};

    return `
      <div class="card">
        <span class="kicker">Discussion Questions</span>
        <h3 class="section-title">Icebreakers</h3>
        ${listHtml(safe.icebreakers, 5)}
        <h3 class="section-title" style="margin-top:0.95rem;">Observation</h3>
        ${listHtml(safe.observation, 5)}
        <h3 class="section-title" style="margin-top:0.95rem;">Interpretation</h3>
        ${listHtml(safe.interpretation, 5)}
        <h3 class="section-title" style="margin-top:0.95rem;">Application</h3>
        ${listHtml(safe.application, 5)}
        <h3 class="section-title" style="margin-top:0.95rem;">Challenge</h3>
        ${listHtml(safe.challenge, 5)}
      </div>
    `;
  }

  function renderIllustrations(items) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      return `
        <div class="card">
          <span class="kicker">Illustration Ideas</span>
          <p class="inline-hint">No illustrations returned.</p>
        </div>
      `;
    }

    return `
      <div class="card">
        <span class="kicker">Illustration Ideas</span>
        ${rows.map((row) => `
          <article class="result-item">
            <h3>${escapeHtml(cleanString(row.title, "Illustration"))}</h3>
            <p>${escapeHtml(cleanString(row.description))}</p>
            <p><strong>Connection:</strong> ${escapeHtml(cleanString(row.connection))}</p>
          </article>
        `).join("")}
      </div>
    `;
  }

  function renderApplicationPathways(app) {
    const safe = app && typeof app === "object" ? app : {};

    return `
      <div class="card">
        <span class="kicker">Application Pathways</span>
        <h3 class="section-title">Personal</h3>
        ${listHtml(safe.personal, 6)}
        <h3 class="section-title" style="margin-top:0.95rem;">Family</h3>
        ${listHtml(safe.family, 6)}
        <h3 class="section-title" style="margin-top:0.95rem;">Church</h3>
        ${listHtml(safe.church, 6)}
        <h3 class="section-title" style="margin-top:0.95rem;">Mission</h3>
        ${listHtml(safe.mission, 6)}
      </div>
    `;
  }

  function renderAgeAdaptation(age) {
    const safe = age && typeof age === "object" ? age : {};

    return `
      <div class="card">
        <span class="kicker">Age-Appropriate Content</span>
        <h3 class="section-title">Audience-Specific Explanation</h3>
        <p>${escapeHtml(cleanString(safe.chosenAudienceExplanation, "No explanation returned."))}</p>
        <h3 class="section-title" style="margin-top:0.95rem;">Simplified Language Version</h3>
        <p>${escapeHtml(cleanString(safe.simplifiedExplanation, "No simplified explanation returned."))}</p>
        <h3 class="section-title" style="margin-top:0.95rem;">Vocabulary to Explain</h3>
        ${listHtml(safe.vocabularyToExplain, 8)}
        <h3 class="section-title" style="margin-top:0.95rem;">Differentiation Tips</h3>
        ${listHtml(safe.differentiationTips, 8)}
      </div>
    `;
  }

  function renderPlan(meta, ai) {
    const lessonPlan = ai.lessonPlan && typeof ai.lessonPlan === "object" ? ai.lessonPlan : {};

    return `
      <div class="card">
        <span class="kicker">Lesson Input</span>
        <h3 class="section-title">${escapeHtml(meta.sourceTitle)}</h3>
        <p><strong>Audience:</strong> ${escapeHtml(cleanString(meta.audienceLabel, meta.audience))} | <strong>Setting:</strong> ${escapeHtml(meta.setting)} | <strong>Group:</strong> ${escapeHtml(String(meta.groupSize))} | <strong>Length:</strong> ${escapeHtml(String(meta.length))} min</p>
        ${meta.resources ? `<p><strong>Resources:</strong> ${escapeHtml(meta.resources)}</p>` : ""}
        ${meta.passageText ? `<p>${escapeHtml(meta.passageText)}</p>` : ""}
      </div>

      <div class="card">
        <span class="kicker">Overview</span>
        <p>${escapeHtml(cleanString(ai.overview, "No overview returned."))}</p>
        <p><strong>Central Truth:</strong> ${escapeHtml(cleanString(ai.centralTruth, "No central truth returned."))}</p>
      </div>

      <div class="card">
        <span class="kicker">Lesson Plan</span>
        <h3 class="section-title">${escapeHtml(cleanString(lessonPlan.title, "Untitled Lesson"))}</h3>
        <p><strong>Key Verse:</strong> ${escapeHtml(cleanString(lessonPlan.keyVerse, "Not provided"))}</p>
        <h3 class="section-title" style="margin-top:0.95rem;">Objectives</h3>
        ${listHtml(lessonPlan.objectives, 7)}
      </div>

      <div class="card">
        <span class="kicker">Session Timeline</span>
        ${renderTimeline(lessonPlan.sessionTimeline)}
      </div>

      ${renderAgeAdaptation(ai.ageAppropriateContent)}

      ${renderQuestionTiers(ai.discussionQuestions)}

      ${renderIllustrations(ai.illustrationIdeas)}

      ${renderApplicationPathways(ai.applicationPathways)}

      <div class="card">
        <span class="kicker">Visuals and Media</span>
        ${listHtml(ai.visualsAndMedia, 8)}
      </div>

      <div class="card">
        <span class="kicker">Printable Handout Summary</span>
        ${listHtml(ai.printableHandout, 12)}
      </div>

      <div class="card">
        <span class="kicker">Leader Coaching</span>
        ${listHtml(ai.leaderCoaching, 8)}
        <h3 class="section-title" style="margin-top:0.95rem;">Closing Prayer Prompt</h3>
        <p>${escapeHtml(cleanString(ai.closingPrayerPrompt, "No prayer prompt returned."))}</p>
      </div>

      <div class="card">
        <span class="kicker">Take-Home Challenge</span>
        <p>${escapeHtml(cleanString(ai.takeHomeChallenge, "No challenge returned."))}</p>
      </div>
    `;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideNotice();
    result.innerHTML = "";
    setExportButtonsVisible(false);

    const rawPassage = $("#teachPassage").value.trim();
    const selectedAudiences = Array.from(document.querySelectorAll("#teachAudienceKids, #teachAudienceYouth, #teachAudienceAdults, #teachAudienceMixed"))
      .filter((inputEl) => inputEl && inputEl.checked)
      .map((inputEl) => cleanString(inputEl.value))
      .filter(Boolean);
    const setting = $("#teachSetting").value;
    const groupSize = Number($("#teachGroupSize").value || 12);
    const length = Number($("#teachLength").value || 45);
    const outcome = $("#teachOutcome").value.trim();
    const resources = $("#teachResources").value.trim();
    const notes = $("#teachNotes").value.trim();

    if (!rawPassage) {
      showNotice("Enter a passage or topic.", "error");
      return;
    }
    if (!selectedAudiences.length) {
      showNotice("Select at least one audience before generating a kit.", "error");
      return;
    }
    const primaryAudience = selectedAudiences[0];

    setBusy(button, "Building Kit...", true);

    try {
      let sourceTitle = rawPassage;
      let passageText = `Topic focus: ${rawPassage}`;
      let usedPassageLookup = false;

      if (isLikelyBibleReference(rawPassage)) {
        try {
          const passage = await fetchBiblePassage(rawPassage);
          sourceTitle = passage.reference;
          passageText = passage.text;
          usedPassageLookup = true;
        } catch (_) {
          sourceTitle = rawPassage;
          passageText = `Topic focus: ${rawPassage}`;
          usedPassageLookup = false;
        }
      }

      const ai = await apiPost("/api/ai/teaching-tools", {
        sourceTitle,
        passageText,
        audience: primaryAudience,
        audiences: selectedAudiences,
        setting,
        groupSize,
        length,
        outcome,
        resources,
        notes
      });
      lastGenerated = {
        input: {
          sourceTitle,
          passageText,
          audience: primaryAudience,
          selectedAudiences,
          setting,
          groupSize,
          length,
          resources,
          outcome,
          notes,
          sourceMode: usedPassageLookup ? "passage" : "topic"
        },
        output: ai
      };
      result.innerHTML = renderPlan({
        sourceTitle,
        passageText,
        audience: primaryAudience,
        audienceLabel: selectedAudiences.join(", "),
        setting,
        groupSize,
        length,
        resources
      }, ai);
      if (ai && ai.multiAudience && Array.isArray(ai.comparisonSummary) && ai.comparisonSummary.length) {
        const comparisonCard = document.createElement("div");
        comparisonCard.className = "card";
        comparisonCard.innerHTML = `
          <span class="kicker">Parallel Audience Comparison</span>
          <div class="metric-grid">
            ${ai.comparisonSummary.map((row) => `
              <div class="metric">
                <strong>${escapeHtml(cleanString(row.audience))}</strong>
                <span>${Number(row.objectiveCount || 0)} objectives | ${Number(row.discussionQuestionCount || 0)} questions</span>
              </div>
            `).join("")}
          </div>
        `;
        result.appendChild(comparisonCard);
      }
      const sourceMode = usedPassageLookup ? "passage" : "topic";
      showNotice(`Full AI teaching kit generated for ${escapeHtml(sourceTitle)} (${sourceMode} mode).`, "ok");
      setExportButtonsVisible(true);
      await trackEvent("generation_success", { tool: "teaching-tools", mode: sourceMode });
    } catch (error) {
      showNotice(`Could not generate teaching kit: ${escapeHtml(error.message || "Unknown error")}`, "error");
      setExportButtonsVisible(false);
    } finally {
      setBusy(button, "", false);
    }
  });

  copyButton.addEventListener("click", async () => {
    if (!result.innerHTML.trim()) {
      showNotice("Generate a teaching kit before copying.", "error");
      return;
    }

    const text = result.innerText.trim();
    try {
      await navigator.clipboard.writeText(text);
      if (activeProjectId) {
        await appendProjectExport(activeProjectId, "teaching-kit-copy", {
          sourceTitle: cleanString(lastGenerated && lastGenerated.input && lastGenerated.input.sourceTitle)
        });
      }
      showNotice("Teaching kit copied to clipboard.", "ok");
    } catch (_) {
      const temp = document.createElement("textarea");
      temp.value = text;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
      showNotice("Teaching kit copied to clipboard.", "ok");
    }
  });

  printButton.addEventListener("click", () => {
    if (!result.innerHTML.trim()) {
      showNotice("Generate a teaching kit before printing.", "error");
      return;
    }
    if (activeProjectId) {
      void appendProjectExport(activeProjectId, "teaching-kit-print", {
        sourceTitle: cleanString(lastGenerated && lastGenerated.input && lastGenerated.input.sourceTitle)
      });
    }
    window.print();
  });

  setExportButtonsVisible(false);

  function downloadTextFile(fileName, content) {
    const blob = new Blob([String(content || "")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  exportLeaderButton.type = "button";
  exportLeaderButton.className = "btn secondary hidden";
  exportLeaderButton.textContent = "Leader Handout";
  exportLeaderButton.addEventListener("click", () => {
    if (!lastGenerated) {
      return;
    }
    const handout = cleanString(lastGenerated.output && lastGenerated.output.exports && lastGenerated.output.exports.handouts && lastGenerated.output.exports.handouts.leader);
    downloadTextFile("leader-handout.txt", handout);
    if (activeProjectId) {
      void appendProjectExport(activeProjectId, "teaching-kit-leader-handout", {
        sourceTitle: cleanString(lastGenerated.input && lastGenerated.input.sourceTitle)
      });
    }
  });

  exportStudentButton.type = "button";
  exportStudentButton.className = "btn secondary hidden";
  exportStudentButton.textContent = "Student Handout";
  exportStudentButton.addEventListener("click", () => {
    if (!lastGenerated) {
      return;
    }
    const handout = cleanString(lastGenerated.output && lastGenerated.output.exports && lastGenerated.output.exports.handouts && lastGenerated.output.exports.handouts.student);
    downloadTextFile("student-handout.txt", handout);
    if (activeProjectId) {
      void appendProjectExport(activeProjectId, "teaching-kit-student-handout", {
        sourceTitle: cleanString(lastGenerated.input && lastGenerated.input.sourceTitle)
      });
    }
  });

  exportParentButton.type = "button";
  exportParentButton.className = "btn secondary hidden";
  exportParentButton.textContent = "Parent Handout";
  exportParentButton.addEventListener("click", () => {
    if (!lastGenerated) {
      return;
    }
    const handout = cleanString(lastGenerated.output && lastGenerated.output.exports && lastGenerated.output.exports.handouts && lastGenerated.output.exports.handouts.parent);
    downloadTextFile("parent-handout.txt", handout);
    if (activeProjectId) {
      void appendProjectExport(activeProjectId, "teaching-kit-parent-handout", {
        sourceTitle: cleanString(lastGenerated.input && lastGenerated.input.sourceTitle)
      });
    }
  });

  exportSlidesButton.type = "button";
  exportSlidesButton.className = "btn secondary hidden";
  exportSlidesButton.textContent = "Slide Outline";
  exportSlidesButton.addEventListener("click", () => {
    if (!lastGenerated) {
      return;
    }
    const slideOutline = lastGenerated.output && lastGenerated.output.exports && lastGenerated.output.exports.slideOutline;
    downloadTextFile("slide-outline.json", JSON.stringify(slideOutline || {}, null, 2));
    if (activeProjectId) {
      void appendProjectExport(activeProjectId, "teaching-kit-slides", {
        sourceTitle: cleanString(lastGenerated.input && lastGenerated.input.sourceTitle)
      });
    }
  });

  saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn secondary hidden";
  saveBtn.textContent = "Save Kit";
  saveBtn.addEventListener("click", async () => {
    if (!lastGenerated) {
      showNotice("Generate a teaching kit before saving.", "error");
      return;
    }
    try {
      if (activeProjectId) {
        await updateProject(activeProjectId, lastGenerated);
      } else {
        const saved = await saveProject("teaching-tools", `Teaching Kit - ${cleanString(lastGenerated.input.sourceTitle)}`, lastGenerated);
        activeProjectId = cleanString(saved && saved.project && saved.project.id);
      }
      await trackEvent("project_saved", { tool: "teaching-tools" });
      showNotice("Teaching kit saved.", "ok");
    } catch (error) {
      showNotice(`Could not save kit: ${escapeHtml(error.message || "Unknown error")}`, "error");
    }
  });
  const buttonRow = document.querySelector("#teachForm .btn-row");
  if (buttonRow) {
    buttonRow.appendChild(saveBtn);
    buttonRow.appendChild(exportLeaderButton);
    buttonRow.appendChild(exportStudentButton);
    buttonRow.appendChild(exportParentButton);
    buttonRow.appendChild(exportSlidesButton);
  }

  async function hydrateFromProject() {
    try {
      const project = await hydrateProjectFromQuery("teaching-tools");
      if (!project || !project.payload || typeof project.payload !== "object") {
        return;
      }
      const payload = project.payload;
      activeProjectId = cleanString(project.id);
      const input = payload.input && typeof payload.input === "object" ? payload.input : {};
      if (input.sourceTitle) {
        $("#teachPassage").value = cleanString(input.sourceTitle);
      }
      if (input.setting) {
        $("#teachSetting").value = cleanString(input.setting);
      }
      if (Number.isFinite(Number(input.groupSize))) {
        $("#teachGroupSize").value = String(Number(input.groupSize));
      }
      if (Number.isFinite(Number(input.length))) {
        $("#teachLength").value = String(Number(input.length));
      }
      if (input.outcome) {
        $("#teachOutcome").value = cleanString(input.outcome);
      }
      if (input.resources) {
        $("#teachResources").value = cleanString(input.resources);
      }
      if (input.notes) {
        $("#teachNotes").value = cleanString(input.notes);
      }
      if (Array.isArray(input.selectedAudiences)) {
        const selected = new Set(input.selectedAudiences.map((item) => cleanString(item)));
        const kids = $("#teachAudienceKids");
        const youth = $("#teachAudienceYouth");
        const adults = $("#teachAudienceAdults");
        const mixed = $("#teachAudienceMixed");
        if (kids) kids.checked = selected.has("Kids (7-11)");
        if (youth) youth.checked = selected.has("Youth (12-18)");
        if (adults) adults.checked = selected.has("Adults");
        if (mixed) mixed.checked = selected.has("Mixed ages");
      } else if (input.audience) {
        const audienceValue = cleanString(input.audience);
        const map = {
          "Kids (7-11)": "#teachAudienceKids",
          "Youth (12-18)": "#teachAudienceYouth",
          "Adults": "#teachAudienceAdults",
          "Mixed ages": "#teachAudienceMixed"
        };
        const target = map[audienceValue];
        if (target) {
          const inputEl = $(target);
          if (inputEl) {
            inputEl.checked = true;
          }
        }
      }
      if (payload.output && typeof payload.output === "object") {
        lastGenerated = payload;
        result.innerHTML = renderPlan({
          sourceTitle: cleanString(input.sourceTitle, cleanString(payload.output && payload.output.sourceTitle)),
          passageText: cleanString(input.passageText),
          audience: cleanString(input.audience),
          audienceLabel: Array.isArray(input.selectedAudiences) && input.selectedAudiences.length
            ? input.selectedAudiences.map((item) => cleanString(item)).filter(Boolean).join(", ")
            : cleanString(input.audience),
          setting: cleanString(input.setting),
          groupSize: Number(input.groupSize || 0),
          length: Number(input.length || 0),
          resources: cleanString(input.resources)
        }, payload.output);
        if (payload.output.multiAudience && Array.isArray(payload.output.comparisonSummary) && payload.output.comparisonSummary.length) {
          const comparisonCard = document.createElement("div");
          comparisonCard.className = "card";
          comparisonCard.innerHTML = `
            <span class="kicker">Parallel Audience Comparison</span>
            <div class="metric-grid">
              ${payload.output.comparisonSummary.map((row) => `
                <div class="metric">
                  <strong>${escapeHtml(cleanString(row.audience))}</strong>
                  <span>${Number(row.objectiveCount || 0)} objectives | ${Number(row.discussionQuestionCount || 0)} questions</span>
                </div>
              `).join("")}
            </div>
          `;
          result.appendChild(comparisonCard);
        }
        setExportButtonsVisible(true);
      }
      showNotice("Loaded saved Teaching Tools project.", "ok");
    } catch (error) {
      showNotice(`Could not load project: ${escapeHtml(cleanString(error.message))}`, "error");
    }
  }

  void hydrateFromProject();
})();
