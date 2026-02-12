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

  const form = $("#teachForm");
  const notice = $("#teachNotice");
  const result = $("#teachResult");
  const button = $("#teachButton");
  const printButton = $("#teachPrint");
  const copyButton = $("#teachCopy");
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
        <p><strong>Audience:</strong> ${escapeHtml(meta.audience)} | <strong>Setting:</strong> ${escapeHtml(meta.setting)} | <strong>Group:</strong> ${escapeHtml(String(meta.groupSize))} | <strong>Length:</strong> ${escapeHtml(String(meta.length))} min</p>
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
    const audience = $("#teachAudience").value;
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
        audience,
        setting,
        groupSize,
        length,
        outcome,
        resources,
        notes
      });

      result.innerHTML = renderPlan({ sourceTitle, passageText, audience, setting, groupSize, length, resources }, ai);
      const sourceMode = usedPassageLookup ? "passage" : "topic";
      showNotice(`Full AI teaching kit generated for ${escapeHtml(sourceTitle)} (${sourceMode} mode).`, "ok");
      setExportButtonsVisible(true);
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
    window.print();
  });

  setExportButtonsVisible(false);
})();
