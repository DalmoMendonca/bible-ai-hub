(function () {
  const {
    $,
    $all,
    escapeHtml,
    tokenize,
    highlightTerms,
    apiGet,
    apiPost,
    apiPatch,
    saveProject,
    updateProject,
    saveProjectAndOpen,
    hydrateProjectFromQuery,
    createLearningPath,
    listLearningPaths,
    getLearningPath,
    updateLearningPath,
    deleteLearningPath,
    shareLearningPath,
    appendProjectExport,
    cleanArray,
    cleanString,
    setBusy,
    trackEvent,
    registerToolLifecycle
  } = window.AIBible;

  const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";

  const form = $("#videoForm");
  const queryInput = $("#videoQuery");
  const categorySelect = $("#videoCategory");
  const difficultySelect = $("#videoDifficulty");
  const versionSelect = $("#videoVersion");
  const maxMinutesInput = $("#videoMaxMinutes");
  const sortSelect = $("#videoSort");
  const autoTranscribeInput = $("#videoAutoTranscribe");
  const disablePersonalizationInput = $("#videoDisablePersonalization");
  const notice = $("#videoNotice");
  const result = $("#videoResult");
  const libraryStats = $("#libraryStats");
  const button = $("#videoButton");
  const ingestButton = $("#videoIngestNext");
  const refreshButton = $("#videoRefresh");
  const playerMount = $("#videoPlayerMount");
  const pathLibrary = $("#videoPathLibrary");
  let latestResultMap = new Map();
  let activeProjectId = "";
  let activePath = null;
  registerToolLifecycle("video-search");

  function showNotice(message, type) {
    notice.className = `notice ${type || ""}`.trim();
    notice.innerHTML = message;
    notice.classList.remove("hidden");
  }

  function formatPercent(value) {
    return `${Number(value || 0).toFixed(1)}%`;
  }

  function renderConfidence(confidence) {
    const row = confidence && typeof confidence === "object" ? confidence : null;
    if (!row) {
      return "";
    }
    const tier = cleanString(row.tier, "medium").toLowerCase();
    const tierLabel = tier === "high" ? "High" : tier === "low" ? "Low" : "Medium";
    const diagnostics = row.diagnostics && typeof row.diagnostics === "object" ? row.diagnostics : {};
    const reasonCodes = cleanArray(row.reasonCodes, 6);
    return `
      <div class="card">
        <span class="kicker">Search Confidence</span>
        <p><strong>${escapeHtml(tierLabel)}</strong> (${formatPercent(row.score || 0)})</p>
        <p>${escapeHtml(cleanString(row.summary))}</p>
        <p class="inline-hint">
          Top score: ${formatPercent(diagnostics.topScore || 0)} |
          Avg top-3: ${formatPercent(diagnostics.avgTop3Score || 0)} |
          Query overlap: ${formatPercent(diagnostics.termOverlap || 0)} |
          Transcript coverage: ${formatPercent(diagnostics.transcriptCoverage || 0)}
        </p>
        ${reasonCodes.length ? `<p class="inline-hint"><strong>Signals:</strong> ${reasonCodes.map((item) => escapeHtml(item)).join(", ")}</p>` : ""}
      </div>
    `;
  }

  function renderStats(stats) {
    if (!stats) {
      libraryStats.innerHTML = "";
      return;
    }

    libraryStats.innerHTML = `
      <div class="card">
        <span class="kicker">Library Status</span>
        <div class="video-stats-grid">
          <div class="video-stat"><strong>${Number(stats.totalVideos || 0)}</strong><span>Total Videos</span></div>
          <div class="video-stat"><strong>${Number(stats.transcribedVideos || 0)}</strong><span>Transcribed</span></div>
          <div class="video-stat"><strong>${Number(stats.pendingVideos || 0)}</strong><span>Pending</span></div>
          <div class="video-stat"><strong>${Number(stats.erroredVideos || 0)}</strong><span>Errored</span></div>
          <div class="video-stat"><strong>${Number(stats.totalDurationHours || 0).toFixed(2)}h</strong><span>Total Runtime</span></div>
        </div>
      </div>
    `;
  }

  function renderIngestion(ingestion) {
    if (!ingestion) {
      return "";
    }

    const attempted = cleanArray((ingestion.attempted || []).map((row) => row.title), 12);
    const completed = cleanArray((ingestion.completed || []).map((row) => row.title), 12);
    const failed = cleanArray((ingestion.failed || []).map((row) => `${row.title}: ${row.error}`), 12);
    const unavailable = cleanArray((ingestion.unavailable || []).map((row) => row.title), 12);

    if (!attempted.length && !completed.length && !failed.length && !unavailable.length) {
      return "";
    }

    return `
      <div class="card">
        <span class="kicker">Ingestion Activity</span>
        <p><strong>Mode:</strong> ${escapeHtml(cleanString(ingestion.mode, "auto"))}</p>
        ${attempted.length ? `<p><strong>Attempted:</strong> ${attempted.map((item) => escapeHtml(item)).join(", ")}</p>` : ""}
        ${completed.length ? `<p><strong>Completed:</strong> ${completed.map((item) => escapeHtml(item)).join(", ")}</p>` : ""}
        ${failed.length ? `<p><strong>Failed:</strong> ${failed.map((item) => escapeHtml(item)).join(" | ")}</p>` : ""}
        ${unavailable.length ? `<p><strong>Unavailable On This Server:</strong> ${unavailable.map((item) => escapeHtml(item)).join(", ")}</p>` : ""}
      </div>
    `;
  }

  function renderResults(rows, queryTerms) {
    if (!rows.length) {
      return `
        <div class="card">
          <h3 class="section-title">No timestamped matches yet</h3>
          <p>Try broader terms, enable auto-transcription, or remove one filter.</p>
        </div>
      `;
    }

    return rows.map((item) => {
      const highlightedTitle = queryTerms.length
        ? highlightTerms(escapeHtml(cleanString(item.title)), queryTerms)
        : escapeHtml(cleanString(item.title));
      const highlightedSnippet = queryTerms.length
        ? highlightTerms(escapeHtml(cleanString(item.snippet)), queryTerms)
        : escapeHtml(cleanString(item.snippet));

      return `
        <article class="result-item video-result-item">
          <div class="video-result-head">
            <h3>${highlightedTitle}</h3>
            <div class="video-result-actions">
              ${item.locked
                ? `<a class="video-jump-link" href="${escapeHtml(cleanString(item.url))}" target="_blank" rel="noopener noreferrer">Unlock Premium</a>`
                : `<button type="button" class="video-play-inline" data-play-result="${escapeHtml(cleanString(item.id))}">Play Here</button>
                   <a class="video-jump-link" href="${escapeHtml(cleanString(item.url))}" target="_blank" rel="noopener noreferrer">Jump to ${escapeHtml(cleanString(item.timestamp, "0:00"))}</a>`}
            </div>
          </div>
          <p><strong>Category:</strong> ${escapeHtml(cleanString(item.category))}
          | <strong>Topic:</strong> ${escapeHtml(cleanString(item.topic))}
          | <strong>Difficulty:</strong> ${escapeHtml(cleanString(item.difficulty))}
          | <strong>Version:</strong> ${escapeHtml(cleanString(item.logosVersion))}
          | <strong>Duration:</strong> ${escapeHtml(cleanString(item.duration))}
          </p>
          <p>${highlightedSnippet}</p>
          ${item.locked ? `<p class="inline-hint">Premium clip. Upgrade to play this video.</p>` : ""}
          ${item.sourceAvailable === false ? `<p class="inline-hint">Source video is hosted externally for playback.</p>` : ""}
          <p><strong>Why:</strong> ${escapeHtml(cleanString(item.why))}</p>
          <div class="tag-row">
            ${(item.tags || []).map((tag) => `<span class="tag">${escapeHtml(cleanString(tag))}</span>`).join("")}
          </div>
          <p><strong>Match score:</strong> ${formatPercent(item.score)} ${cleanString(item.transcriptStatus) !== "ready" ? " | transcript pending" : ""}</p>
        </article>
      `;
    }).join("");
  }

  function renderRelated(rows) {
    if (!rows.length) {
      return "";
    }

    return `
      <div class="card">
        <span class="kicker">Related Content</span>
        <div class="video-related-grid">
          ${rows.map((item) => `
            <a class="video-related-item" href="${escapeHtml(cleanString(item.url))}" target="_blank" rel="noopener noreferrer">
              <strong>${escapeHtml(cleanString(item.title))}</strong>
              <span>${escapeHtml(cleanString(item.category))} | ${escapeHtml(cleanString(item.duration))}</span>
            </a>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderSuggestions(items) {
    const rows = cleanArray(items, 8);
    if (!rows.length) {
      return "";
    }

    return `
      <div class="card">
        <span class="kicker">Suggested Follow-up Searches</span>
        <div class="tag-row">
          ${rows.map((item) => `<button type="button" class="video-suggestion-chip" data-suggest-query="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}
        </div>
      </div>
    `;
  }

  function buildPathResults(pathRow) {
    const items = Array.isArray(pathRow && pathRow.items) ? pathRow.items : [];
    return items
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((item) => ({
        id: `path-${cleanString(pathRow.id)}-${cleanString(item.id)}`,
        videoId: cleanString(item.videoId),
        title: cleanString(item.title, "Path Item"),
        category: "Learning Path",
        topic: cleanString(item.goal, "Path item"),
        difficulty: "n/a",
        logosVersion: "n/a",
        duration: "n/a",
        transcriptStatus: "ready",
        timestamp: formatTimestamp(Number(item.timestampSeconds || 0)),
        timestampSeconds: Number(item.timestampSeconds || 0),
        snippet: cleanString(item.notes || item.goal || ""),
        tags: [],
        playbackUrl: cleanString(item.url),
        url: cleanString(item.url),
        why: cleanString(item.goal || "Saved from search results."),
        score: 100
      }));
  }

  function formatTimestamp(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds || 0)));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  async function loadPathLibrary() {
    if (!pathLibrary) {
      return;
    }
    pathLibrary.innerHTML = `<h3 class="section-title">Learning Paths</h3><p class="inline-hint">Loading...</p>`;
    let payload = { paths: [] };
    try {
      payload = await listLearningPaths();
    } catch (error) {
      pathLibrary.innerHTML = `<h3 class="section-title">Learning Paths</h3><p class="inline-hint">${escapeHtml(cleanString(error.message, "Could not load learning paths."))}</p>`;
      return;
    }
    const paths = Array.isArray(payload.paths) ? payload.paths : [];
    if (!paths.length) {
      pathLibrary.innerHTML = `
        <h3 class="section-title">Learning Paths</h3>
        <p class="inline-hint">No saved paths yet. Save top results to create your first path.</p>
      `;
      return;
    }
    pathLibrary.innerHTML = `
      <h3 class="section-title">Learning Paths</h3>
      <div class="list">
        ${paths.slice(0, 18).map((pathRow) => `
          <article class="result-item">
            <h3>${escapeHtml(cleanString(pathRow.title))}</h3>
            <p>${Number(Array.isArray(pathRow.items) ? pathRow.items.length : 0)} item(s)</p>
            <div class="btn-row">
              <button type="button" class="btn secondary" data-path-open="${escapeHtml(cleanString(pathRow.id))}">Open</button>
              <button type="button" class="btn secondary" data-path-share="${escapeHtml(cleanString(pathRow.id))}">Share</button>
              <button type="button" class="btn secondary" data-path-delete="${escapeHtml(cleanString(pathRow.id))}">Delete</button>
            </div>
          </article>
        `).join("")}
      </div>
    `;
    $all("[data-path-open]", pathLibrary).forEach((buttonEl) => {
      buttonEl.addEventListener("click", async () => {
        const pathId = cleanString(buttonEl.getAttribute("data-path-open"));
        if (!pathId) {
          return;
        }
        try {
          const response = await getLearningPath(pathId);
          const pathRow = response && response.path ? response.path : null;
          if (!pathRow) {
            return;
          }
          activePath = pathRow;
          const rows = buildPathResults(pathRow);
          latestResultMap = new Map(rows.map((row) => [cleanString(row.id), row]));
          result.innerHTML = `
            <div class="card">
              <span class="kicker">Learning Path</span>
              <h3 class="section-title">${escapeHtml(cleanString(pathRow.title))}</h3>
              <p class="inline-hint">${Number(rows.length)} step(s) loaded from saved path.</p>
            </div>
            ${renderResults(rows, [])}
          `;
          wireResultPlayButtons();
          showNotice(`Loaded learning path "${escapeHtml(cleanString(pathRow.title))}".`, "ok");
        } catch (error) {
          showNotice(`Could not open path: ${escapeHtml(cleanString(error.message))}`, "error");
        }
      });
    });
    $all("[data-path-share]", pathLibrary).forEach((buttonEl) => {
      buttonEl.addEventListener("click", async () => {
        const pathId = cleanString(buttonEl.getAttribute("data-path-share"));
        if (!pathId) {
          return;
        }
        try {
          const response = await shareLearningPath(pathId);
          const shareUrl = cleanString(response && response.share && response.share.shareUrl);
          const absolute = shareUrl ? `${window.location.origin}${shareUrl}` : "";
          if (absolute) {
            await navigator.clipboard.writeText(absolute);
          }
          showNotice(absolute ? "Path share link copied." : "Path is shared with your workspace.", "ok");
        } catch (error) {
          showNotice(`Could not share path: ${escapeHtml(cleanString(error.message))}`, "error");
        }
      });
    });
    $all("[data-path-delete]", pathLibrary).forEach((buttonEl) => {
      buttonEl.addEventListener("click", async () => {
        const pathId = cleanString(buttonEl.getAttribute("data-path-delete"));
        if (!pathId) {
          return;
        }
        if (!window.confirm("Delete this learning path?")) {
          return;
        }
        try {
          await deleteLearningPath(pathId);
          await trackEvent("learning_path_deleted", { pathId });
          await loadPathLibrary();
          showNotice("Learning path deleted.", "ok");
        } catch (error) {
          showNotice(`Could not delete path: ${escapeHtml(cleanString(error.message))}`, "error");
        }
      });
    });
  }

  function wireQueryChips() {
    $all("[data-example-query]").forEach((buttonEl) => {
      buttonEl.addEventListener("click", () => {
        queryInput.value = buttonEl.getAttribute("data-example-query") || "";
        form.requestSubmit();
      });
    });
  }

  function wireResultSuggestionChips() {
    $all("[data-suggest-query]", result).forEach((buttonEl) => {
      buttonEl.addEventListener("click", () => {
        queryInput.value = buttonEl.getAttribute("data-suggest-query") || "";
        form.requestSubmit();
      });
    });
  }

  function clearInlinePlayer() {
    if (!playerMount) {
      return;
    }
    playerMount.innerHTML = "";
    playerMount.classList.add("hidden");
  }

  function looksLikeYouTubeUrl(value) {
    return /youtu\.be\/|youtube\.com\//i.test(cleanString(value));
  }

  function looksLikeDirectVideoUrl(value) {
    return /\.(mp4|mov|m4v|webm|mkv)(?:$|[?#])/i.test(cleanString(value));
  }

  function basePlaybackUrl(value) {
    const clean = cleanString(value);
    if (!clean) {
      return "";
    }
    return clean.split("#")[0];
  }

  function getYouTubeEmbedUrl(value, startSeconds) {
    const clean = cleanString(value);
    if (!clean) {
      return "";
    }

    try {
      const parsed = new URL(clean, window.location.origin);
      let id = "";

      if (parsed.hostname.includes("youtu.be")) {
        id = cleanString(parsed.pathname.split("/").filter(Boolean)[0]);
      } else if (parsed.pathname.startsWith("/watch")) {
        id = cleanString(parsed.searchParams.get("v"));
      } else {
        const pieces = parsed.pathname.split("/").filter(Boolean);
        const embedIdx = pieces.findIndex((piece) => piece === "embed" || piece === "shorts");
        if (embedIdx >= 0 && pieces[embedIdx + 1]) {
          id = cleanString(pieces[embedIdx + 1]);
        }
      }

      if (!id) {
        return "";
      }

      return `https://www.youtube.com/embed/${encodeURIComponent(id)}?start=${Math.max(0, Math.floor(Number(startSeconds || 0)))}&autoplay=1`;
    } catch (_) {
      return "";
    }
  }

  function playResultInline(item) {
    if (!playerMount) {
      return;
    }

    const url = cleanString(item.playbackUrl || item.url);
    const timestamp = Math.max(0, Number(item.timestampSeconds || 0));
    const title = cleanString(item.title, "Video");

    if (!url) {
      showNotice("This result does not have a playable URL yet.", "error");
      return;
    }

    playerMount.classList.remove("hidden");

    if (looksLikeYouTubeUrl(url)) {
      const embedUrl = getYouTubeEmbedUrl(url, timestamp);
      if (!embedUrl) {
        playerMount.innerHTML = `
          <span class="kicker">Playback</span>
          <p>Could not build an inline player for this URL. Use <a href="${escapeHtml(cleanString(item.url || url))}" target="_blank" rel="noopener noreferrer">Open in new tab</a>.</p>
        `;
        return;
      }

      playerMount.innerHTML = `
        <span class="kicker">Now Playing</span>
        <h3 class="section-title">${escapeHtml(title)}</h3>
        <p class="inline-hint">Starting at ${escapeHtml(cleanString(item.timestamp, "0:00"))}</p>
        <div class="video-embed-wrap">
          <iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>
        </div>
        <p class="inline-hint"><a href="${escapeHtml(cleanString(item.url || url))}" target="_blank" rel="noopener noreferrer">Open playback in new tab</a></p>
      `;
      return;
    }

    const directUrl = basePlaybackUrl(url);
    if (looksLikeDirectVideoUrl(directUrl) || directUrl.startsWith("/")) {
      playerMount.innerHTML = `
        <span class="kicker">Now Playing</span>
        <h3 class="section-title">${escapeHtml(title)}</h3>
        <p class="inline-hint">Starting at ${escapeHtml(cleanString(item.timestamp, "0:00"))}</p>
        <video id="inlineVideoPlayer" class="video-inline-player" controls preload="metadata" src="${escapeHtml(directUrl)}"></video>
        <p class="inline-hint"><a href="${escapeHtml(cleanString(item.url || url))}" target="_blank" rel="noopener noreferrer">Open playback in new tab</a></p>
      `;

      const videoEl = $("#inlineVideoPlayer", playerMount);
      if (videoEl) {
        videoEl.addEventListener("loadedmetadata", () => {
          try {
            videoEl.currentTime = timestamp;
          } catch (_) {
            // Ignore browser seek restrictions and keep player usable.
          }
          const playPromise = videoEl.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => {});
          }
        }, { once: true });
      }
      return;
    }

    playerMount.innerHTML = `
      <span class="kicker">Playback</span>
      <h3 class="section-title">${escapeHtml(title)}</h3>
      <p>This source cannot be embedded inline. <a href="${escapeHtml(cleanString(item.url || url))}" target="_blank" rel="noopener noreferrer">Open in new tab</a>.</p>
    `;
  }

  function wireResultPlayButtons() {
    $all("[data-play-result]", result).forEach((buttonEl) => {
      buttonEl.addEventListener("click", () => {
        const id = cleanString(buttonEl.getAttribute("data-play-result"));
        const row = latestResultMap.get(id);
        if (!row) {
          return;
        }
        playResultInline(row);
      });
    });
  }

  function uniqueSorted(items) {
    return Array.from(new Set(items.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function updateFilterOptions(videos) {
    const rows = Array.isArray(videos) ? videos : [];
    const categories = uniqueSorted(rows.map((row) => cleanString(row.category)));
    const versions = uniqueSorted(rows.map((row) => cleanString(row.logosVersion)));

    const currentCategory = categorySelect.value;
    const currentVersion = versionSelect.value;

    categorySelect.innerHTML = `<option value="all">All Categories</option>${categories.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    versionSelect.innerHTML = `<option value="all">All Versions</option>${versions.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;

    if (categories.includes(currentCategory)) {
      categorySelect.value = currentCategory;
    }
    if (versions.includes(currentVersion)) {
      versionSelect.value = currentVersion;
    }
  }

  async function fetchLibraryStatus(forceRefresh) {
    const url = `${API_BASE}/api/video-library/status${forceRefresh ? "?refresh=true" : ""}`;
    let response;

    try {
      response = await fetch(url);
    } catch (_) {
      throw new Error("Cannot reach local AI API. Start with `npm start` then open http://localhost:3000/ai/.");
    }

    let data = {};
    try {
      data = await response.json();
    } catch (_) {
      data = {};
    }

    if (!response.ok) {
      throw new Error(cleanString(data.error, `Library status failed (${response.status})`));
    }

    return data;
  }

  async function loadLibraryStatus(forceRefresh) {
    setBusy(refreshButton, "Refreshing...", true);
    try {
      const payload = await fetchLibraryStatus(forceRefresh);
      renderStats(payload.stats);
      updateFilterOptions(payload.videos);
      showNotice("Library synced. You can run semantic search now.", "ok");
    } catch (error) {
      showNotice(`Unable to load library status: ${escapeHtml(cleanString(error.message))}`, "error");
    } finally {
      setBusy(refreshButton, "", false);
    }
  }

  refreshButton.addEventListener("click", async () => {
    await loadLibraryStatus(true);
  });

  ingestButton.addEventListener("click", async () => {
    setBusy(ingestButton, "Ingesting...", true);
    try {
      const payload = await apiPost("/api/video-library/ingest-next", { maxVideos: 1, refreshCatalog: true });
      renderStats(payload.stats);

      const processed = cleanArray((payload.processed || []).map((row) => row.title), 8);
      const failed = cleanArray((payload.failed || []).map((row) => `${row.title}: ${row.error}`), 8);

      if (processed.length) {
        showNotice(`Ingested transcript for: ${processed.map((item) => escapeHtml(item)).join(", ")}.`, "ok");
      } else if (failed.length) {
        showNotice(`Ingestion failed: ${failed.map((item) => escapeHtml(item)).join(" | ")}`, "error");
      } else {
        showNotice("No pending videos to ingest right now.", "ok");
      }
    } catch (error) {
      showNotice(`Could not ingest next video: ${escapeHtml(cleanString(error.message, "Unknown error"))}`, "error");
    } finally {
      setBusy(ingestButton, "", false);
    }
  });

  async function renderSearchPayload(payload, query, sessionInput) {
    const rows = Array.isArray(payload.results) ? payload.results : [];
    const related = Array.isArray(payload.relatedContent) ? payload.relatedContent : [];
    const queryTerms = tokenize(query);
    const input = sessionInput && typeof sessionInput === "object" ? sessionInput : { query, payload };
    renderStats(payload.stats);
    latestResultMap = new Map(rows.map((row) => [cleanString(row.id), row]));

    result.innerHTML = `
      ${renderIngestion(payload.ingestion)}
      <div class="card">
        <span class="kicker">Project Inputs</span>
        <p><strong>Query:</strong> ${escapeHtml(cleanString(input.query, query))}</p>
        <p><strong>Category:</strong> ${escapeHtml(cleanString(input.filters && input.filters.category, "all"))}
        | <strong>Difficulty:</strong> ${escapeHtml(cleanString(input.filters && input.filters.difficulty, "all"))}
        | <strong>Version:</strong> ${escapeHtml(cleanString(input.filters && input.filters.logosVersion, "all"))}
        | <strong>Max length:</strong> ${escapeHtml(String(Number(input.filters && input.filters.maxMinutes || 0)))} min</p>
        <p><strong>Sort:</strong> ${escapeHtml(cleanString(input.sortMode, "relevance"))}
        | <strong>Auto-transcribe:</strong> ${input.autoTranscribe !== false ? "On" : "Off"}
        | <strong>Personalization:</strong> ${input.disablePersonalization ? "Off" : "On"}</p>
      </div>
      ${payload.personalization && payload.personalization.enabled ? `<div class="card"><span class="kicker">Personalized Recommendations Enabled</span><p class="inline-hint">Suggestions are influenced by your recent activity. You can disable this in the form.</p></div>` : ""}
      ${renderConfidence(payload.confidence)}
      ${payload.guidance ? `<div class="card"><span class="kicker">AI Guidance</span><p>${escapeHtml(cleanString(payload.guidance))}</p></div>` : ""}
      ${rows.length ? `<div class="card"><span class="kicker">Learning Paths & Search Sessions</span><div class="btn-row"><button type="button" class="btn secondary" id="videoSavePath">Save Top Results as Path</button><button type="button" class="btn secondary" id="videoSaveSearchProject">${activeProjectId ? "Update Search Session" : "Save Search Session"}</button></div></div>` : ""}
      ${renderResults(rows, queryTerms)}
      ${renderRelated(related)}
      ${renderSuggestions(payload.suggestedQueries)}
    `;
    wireResultSuggestionChips();
    wireResultPlayButtons();
    const savePathBtn = $("#videoSavePath", result);
    if (savePathBtn) {
      savePathBtn.addEventListener("click", async () => {
        try {
          const created = await createLearningPath(`Learning Path: ${query}`, rows.slice(0, 8).map((row, index) => ({
            order: index + 1,
            title: row.title,
            videoId: row.videoId,
            timestampSeconds: row.timestampSeconds,
            url: row.url,
            goal: row.why,
            notes: `Match score ${row.score}`
          })));
          await trackEvent("learning_path_saved", { resultCount: rows.length });
          showNotice("Learning path saved.", "ok");
          await loadPathLibrary();
          const createdPathId = cleanString(created && created.path && created.path.id);
          if (activeProjectId && createdPathId) {
            await appendProjectExport(activeProjectId, "learning-path-created", { pathId: createdPathId });
          }
        } catch (error) {
          showNotice(`Could not save learning path: ${escapeHtml(cleanString(error.message))}`, "error");
        }
      });
    }
    const saveSearchBtn = $("#videoSaveSearchProject", result);
    if (saveSearchBtn) {
      saveSearchBtn.addEventListener("click", async () => {
        const projectPayload = {
          ...(input && typeof input === "object" ? input : {}),
          query: cleanString(input && input.query, query),
          payload
        };
        try {
          if (activeProjectId) {
            await updateProject(activeProjectId, projectPayload);
          } else {
            const saved = await saveProject("video-search", `Video Search - ${query}`, projectPayload);
            activeProjectId = cleanString(saved && saved.project && saved.project.id);
          }
          await trackEvent("project_saved", { tool: "video-search", resultCount: rows.length });
          showNotice("Search session saved.", "ok");
          await renderSearchPayload(payload, query, projectPayload);
        } catch (error) {
          showNotice(`Could not save search session: ${escapeHtml(cleanString(error.message))}`, "error");
        }
      });
    }
    if (!rows.length) {
      clearInlinePlayer();
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const query = cleanString(queryInput.value);
    const category = categorySelect.value;
    const difficulty = difficultySelect.value;
    const logosVersion = versionSelect.value;
    const maxMinutes = Number(maxMinutesInput.value || 0);
    const sortMode = sortSelect.value;
    const autoTranscribe = Boolean(autoTranscribeInput.checked);
    const disablePersonalization = Boolean(disablePersonalizationInput && disablePersonalizationInput.checked);

    if (!query) {
      showNotice("Enter a question to run AI video search.", "error");
      result.innerHTML = "";
      clearInlinePlayer();
      return;
    }

    setBusy(button, "Searching...", true);

    try {
      if (disablePersonalizationInput) {
        await apiPatch("/api/user/settings", {
          personalization: {
            optOut: disablePersonalization
          }
        });
      }
      const payload = await apiPost("/api/ai/video-search", {
        query,
        filters: {
          category,
          difficulty,
          logosVersion,
          maxMinutes
        },
        sortMode,
        autoTranscribe,
        transcribeMode: autoTranscribe ? "auto" : "skip"
      });

      const projectPayload = {
        query,
        payload,
        filters: {
          category,
          difficulty,
          logosVersion,
          maxMinutes
        },
        sortMode,
        autoTranscribe,
        disablePersonalization
      };
      const persisted = await saveProjectAndOpen(
        "video-search",
        `Video Search - ${query}`,
        projectPayload,
        activeProjectId
      );
      activeProjectId = cleanString(persisted && persisted.projectId);
      if (persisted && persisted.navigated) {
        return;
      }

      await renderSearchPayload(payload, query, projectPayload);

      const rows = Array.isArray(payload.results) ? payload.results : [];

      const completed = payload.ingestion && Array.isArray(payload.ingestion.completed)
        ? payload.ingestion.completed.length
        : 0;
      const unavailable = payload.ingestion && Array.isArray(payload.ingestion.unavailable)
        ? payload.ingestion.unavailable.length
        : 0;
      const confidence = payload.confidence && typeof payload.confidence === "object" ? payload.confidence : {};
      const confidenceTier = cleanString(confidence.tier, rows.length ? "medium" : "low");
      const noticeType = confidenceTier === "low" ? "error" : rows.length ? "ok" : "error";
      showNotice(
        `Found ${rows.length} timestamped result${rows.length === 1 ? "" : "s"} for "${escapeHtml(query)}"${completed ? ` and transcribed ${completed} new video${completed === 1 ? "" : "s"}` : ""}${unavailable ? ` (${unavailable} source${unavailable === 1 ? "" : "s"} only available as hosted playback)` : ""}. Confidence: ${escapeHtml(cleanString(confidenceTier))}.`,
        noticeType
      );
      await trackEvent("generation_success", { tool: "video-search", resultCount: rows.length });
    } catch (error) {
      result.innerHTML = "";
      clearInlinePlayer();
      showNotice(`Video search failed: ${escapeHtml(cleanString(error.message, "Unknown error"))}`, "error");
    } finally {
      setBusy(button, "", false);
    }
  });

  wireQueryChips();
  if (disablePersonalizationInput) {
    void apiGet("/api/user/settings")
      .then((settings) => {
        if (settings && settings.personalization) {
          disablePersonalizationInput.checked = Boolean(settings.personalization.optOut);
        }
      })
      .catch(() => {});
  }
  const govSaveButton = $("#govSave");
  if (govSaveButton) {
    govSaveButton.addEventListener("click", async () => {
      const videoId = cleanString($("#govVideoId") && $("#govVideoId").value);
      const videoIds = videoId.split(",").map((value) => value.trim()).filter(Boolean);
      const tier = cleanString($("#govTier") && $("#govTier").value, "free");
      const requiredPlans = cleanString($("#govPlans") && $("#govPlans").value)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (!videoId) {
        showNotice("Enter a video ID to save governance.", "error");
        return;
      }
      try {
        await apiPost("/api/video-governance", {
          videoIds,
          tier,
          requiredPlans
        });
        await trackEvent("video_governance_updated", { videoId, tier });
        showNotice(`Access rule saved for ${escapeHtml(videoId)}.`, "ok");
      } catch (error) {
        showNotice(`Could not save access rule: ${escapeHtml(cleanString(error.message))}`, "error");
      }
    });
  }

  async function hydrateFromProject() {
    try {
      const project = await hydrateProjectFromQuery("video-search");
      if (!project || !project.payload || typeof project.payload !== "object") {
        return false;
      }
      activeProjectId = cleanString(project.id);
      const payload = project.payload.payload && typeof project.payload.payload === "object"
        ? project.payload.payload
        : null;
      const query = cleanString(project.payload.query);
      if (!payload || !query) {
        return false;
      }
      queryInput.value = query;
      await renderSearchPayload(payload, query, project.payload);
      showNotice("Loaded saved video search session.", "ok");
      return true;
    } catch (error) {
      showNotice(`Could not load project: ${escapeHtml(cleanString(error.message))}`, "error");
      return false;
    }
  }

  async function hydrateFromPathQuery() {
    const params = new URLSearchParams(window.location.search || "");
    const pathId = cleanString(params.get("path"));
    if (!pathId) {
      return false;
    }
    try {
      const payload = await getLearningPath(pathId);
      const pathRow = payload && payload.path ? payload.path : null;
      if (!pathRow) {
        return false;
      }
      activePath = pathRow;
      const rows = buildPathResults(pathRow);
      latestResultMap = new Map(rows.map((row) => [cleanString(row.id), row]));
      result.innerHTML = `
        <div class="card">
          <span class="kicker">Learning Path</span>
          <h3 class="section-title">${escapeHtml(cleanString(pathRow.title))}</h3>
          <p class="inline-hint">${rows.length} step(s) loaded from shared path.</p>
        </div>
        ${renderResults(rows, [])}
      `;
      wireResultPlayButtons();
      showNotice(`Loaded path "${escapeHtml(cleanString(pathRow.title))}".`, "ok");
      return true;
    } catch (error) {
      showNotice(`Could not load path: ${escapeHtml(cleanString(error.message))}`, "error");
      return false;
    }
  }

  void (async () => {
    await loadLibraryStatus(false);
    await loadPathLibrary();
    const projectLoaded = await hydrateFromProject();
    if (!projectLoaded) {
      await hydrateFromPathQuery();
    }
  })();
})();

