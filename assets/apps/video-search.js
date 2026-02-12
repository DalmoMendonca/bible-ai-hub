(function () {
  const {
    $,
    $all,
    escapeHtml,
    tokenize,
    highlightTerms,
    apiPost,
    cleanArray,
    cleanString,
    setBusy
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
  const notice = $("#videoNotice");
  const result = $("#videoResult");
  const libraryStats = $("#libraryStats");
  const button = $("#videoButton");
  const ingestButton = $("#videoIngestNext");
  const refreshButton = $("#videoRefresh");
  const playerMount = $("#videoPlayerMount");
  let latestResultMap = new Map();

  function showNotice(message, type) {
    notice.className = `notice ${type || ""}`.trim();
    notice.innerHTML = message;
    notice.classList.remove("hidden");
  }

  function formatPercent(value) {
    return `${Number(value || 0).toFixed(1)}%`;
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
              <button type="button" class="video-play-inline" data-play-result="${escapeHtml(cleanString(item.id))}">Play Here</button>
              <a class="video-jump-link" href="${escapeHtml(cleanString(item.url))}" target="_blank" rel="noopener noreferrer">Jump to ${escapeHtml(cleanString(item.timestamp, "0:00"))}</a>
            </div>
          </div>
          <p><strong>Category:</strong> ${escapeHtml(cleanString(item.category))}
          | <strong>Topic:</strong> ${escapeHtml(cleanString(item.topic))}
          | <strong>Difficulty:</strong> ${escapeHtml(cleanString(item.difficulty))}
          | <strong>Version:</strong> ${escapeHtml(cleanString(item.logosVersion))}
          | <strong>Duration:</strong> ${escapeHtml(cleanString(item.duration))}
          </p>
          <p>${highlightedSnippet}</p>
          ${item.sourceAvailable === false ? `<p class="inline-hint">Source video is hosted externally for playback.</p>` : ""}
          <p><strong>Why:</strong> ${escapeHtml(cleanString(item.why))}</p>
          <div class="tag-row">
            ${(item.tags || []).map((tag) => `<span class="tag">${escapeHtml(cleanString(tag))}</span>`).join("")}
          </div>
          <p><strong>AI confidence:</strong> ${formatPercent(item.score)} ${cleanString(item.transcriptStatus) !== "ready" ? " | transcript pending" : ""}</p>
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const query = cleanString(queryInput.value);
    const category = categorySelect.value;
    const difficulty = difficultySelect.value;
    const logosVersion = versionSelect.value;
    const maxMinutes = Number(maxMinutesInput.value || 0);
    const sortMode = sortSelect.value;
    const autoTranscribe = Boolean(autoTranscribeInput.checked);

    if (!query) {
      showNotice("Enter a question to run AI video search.", "error");
      result.innerHTML = "";
      clearInlinePlayer();
      return;
    }

    setBusy(button, "Searching...", true);

    try {
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

      const rows = Array.isArray(payload.results) ? payload.results : [];
      const related = Array.isArray(payload.relatedContent) ? payload.relatedContent : [];
      const queryTerms = tokenize(query);
      renderStats(payload.stats);
      latestResultMap = new Map(rows.map((row) => [cleanString(row.id), row]));

      result.innerHTML = `
        ${renderIngestion(payload.ingestion)}
        ${payload.guidance ? `<div class="card"><span class="kicker">AI Guidance</span><p>${escapeHtml(cleanString(payload.guidance))}</p></div>` : ""}
        ${renderResults(rows, queryTerms)}
        ${renderRelated(related)}
        ${renderSuggestions(payload.suggestedQueries)}
      `;
      wireResultSuggestionChips();
      wireResultPlayButtons();
      if (!rows.length) {
        clearInlinePlayer();
      }

      const completed = payload.ingestion && Array.isArray(payload.ingestion.completed)
        ? payload.ingestion.completed.length
        : 0;
      const unavailable = payload.ingestion && Array.isArray(payload.ingestion.unavailable)
        ? payload.ingestion.unavailable.length
        : 0;
      showNotice(
        `Found ${rows.length} timestamped result${rows.length === 1 ? "" : "s"} for "${escapeHtml(query)}"${completed ? ` and transcribed ${completed} new video${completed === 1 ? "" : "s"}` : ""}${unavailable ? ` (${unavailable} source${unavailable === 1 ? "" : "s"} only available as hosted playback)` : ""}.`,
        rows.length ? "ok" : "error"
      );
    } catch (error) {
      result.innerHTML = "";
      clearInlinePlayer();
      showNotice(`Video search failed: ${escapeHtml(cleanString(error.message, "Unknown error"))}`, "error");
    } finally {
      setBusy(button, "", false);
    }
  });

  wireQueryChips();
  loadLibraryStatus(false);
})();

