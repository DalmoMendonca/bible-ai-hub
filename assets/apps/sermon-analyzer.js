(function () {
  const {
    $,
    escapeHtml,
    tokenize,
    apiGet,
    apiPost,
    apiPostForm,
    cleanArray,
    cleanString,
    setBusy,
    saveProject,
    updateProject,
    saveProjectAndOpen,
    appendProjectExport,
    hydrateProjectFromQuery,
    trackEvent,
    registerToolLifecycle
  } = window.AIBible;

  const form = $("#audioForm");
  const fileInput = $("#audioFile");
  const contextInput = $("#audioContext");
  const goalInput = $("#audioGoal");
  const notesInput = $("#audioNotes");
  const transcriptInput = $("#audioTranscript");
  const notice = $("#audioNotice");
  const result = $("#audioResult");
  const button = $("#audioButton");
  const copyButton = $("#audioCopy");
  let saveButton = null;

  const chartsWrap = $("#chartsWrap");
  const pipelineStatus = $("#pipelineStatus");
  const waveformCanvas = $("#waveform");
  const emotionalArcCanvas = $("#emotionalArcChart");
  const pacingCanvas = $("#pacingChart");
  const vocalCanvas = $("#vocalChart");

  let lastReportText = "";
  let lastPayload = null;
  let lastProjectPayload = null;
  let activeProjectId = "";
  const MAX_SAFE_UPLOAD_BYTES = 5.5 * 1024 * 1024;
  const OPTIMIZED_SAMPLE_RATE = 8000;
  registerToolLifecycle("sermon-analyzer");

  function setReportActionsVisible(isVisible) {
    if (copyButton) {
      copyButton.classList.toggle("hidden", !isVisible);
    }
    if (saveButton) {
      saveButton.classList.toggle("hidden", !isVisible);
    }
  }

  function showNotice(message, type) {
    notice.className = `notice ${type || ""}`.trim();
    notice.innerHTML = message;
    notice.classList.remove("hidden");
  }

  function hideNotice() {
    notice.classList.add("hidden");
    notice.textContent = "";
  }

  function listHtml(items, max = 8) {
    const rows = normalizeListItems(items, max);
    if (!rows.length) {
      return `<p class="inline-hint">No items returned.</p>`;
    }

    return `<ul class="list">${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function normalizeListItems(items, max = 8) {
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .map((item) => {
        if (typeof item === "string") {
          return cleanString(item);
        }
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return "";
        }
        const action = cleanString(item.action || item.title || item.target || item.focus);
        const rationale = cleanString(item.rationale || item.why);
        const metric = cleanString(item.metric || item.measure);
        const priority = cleanString(item.priority);
        const parts = [];
        if (action) parts.push(action);
        if (rationale) parts.push(`Why: ${rationale}`);
        if (metric) parts.push(`Metric: ${metric}`);
        if (priority) parts.push(`Priority: ${priority}`);
        return cleanString(parts.join(" | "));
      })
      .filter(Boolean)
      .slice(0, max);
  }

  function formatBytes(bytes) {
    const safe = Math.max(0, Number(bytes || 0));
    if (safe >= 1024 * 1024) {
      return `${(safe / (1024 * 1024)).toFixed(2)} MB`;
    }
    if (safe >= 1024) {
      return `${(safe / 1024).toFixed(1)} KB`;
    }
    return `${Math.round(safe)} B`;
  }

  function formatClock(seconds) {
    const safe = Math.max(0, Number(seconds || 0));
    const hrs = Math.floor(safe / 3600);
    const mins = Math.floor((safe % 3600) / 60);
    const secs = Math.floor(safe % 60);

    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function formatMetric(value, suffix = "", decimals = 1) {
    if (!Number.isFinite(Number(value))) {
      return "N/A";
    }
    return `${Number(value).toFixed(decimals)}${suffix}`;
  }

  function formatMetricSource(source) {
    const clean = cleanString(source, "unavailable").toLowerCase();
    if (clean === "audio") {
      return "Audio-derived";
    }
    if (clean === "transcript_estimate") {
      return "Transcript estimate";
    }
    return "Unavailable";
  }

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.floor((sorted.length - 1) * p);
    return sorted[idx];
  }

  function mean(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function std(values) {
    if (values.length < 2) return 0;
    const avg = mean(values);
    const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  function toDb(amplitude) {
    return 20 * Math.log10(Math.max(amplitude, 1e-8));
  }

  function estimatePitch(frame, sampleRate) {
    const length = frame.length;
    if (length < 32) return null;

    let meanValue = 0;
    for (let i = 0; i < length; i += 1) {
      meanValue += frame[i];
    }
    meanValue /= length;

    const centered = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      centered[i] = frame[i] - meanValue;
    }

    const minHz = 75;
    const maxHz = 360;
    const minLag = Math.floor(sampleRate / maxHz);
    const maxLag = Math.floor(sampleRate / minHz);

    let bestLag = -1;
    let bestScore = 0;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let ac = 0;
      let energyA = 0;
      let energyB = 0;

      for (let i = 0; i < length - lag; i += 1) {
        const a = centered[i];
        const b = centered[i + lag];
        ac += a * b;
        energyA += a * a;
        energyB += b * b;
      }

      const denom = Math.sqrt(energyA * energyB) || 1;
      const score = ac / denom;

      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }

    if (bestLag <= 0 || bestScore < 0.24) {
      return null;
    }

    const freq = sampleRate / bestLag;
    if (!Number.isFinite(freq) || freq < 60 || freq > 420) {
      return null;
    }

    return freq;
  }

  function drawWaveform(channelData) {
    const ctx = waveformCanvas.getContext("2d");
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f7fbff";
    ctx.fillRect(0, 0, width, height);

    const middle = height / 2;
    const samplesPerPixel = Math.max(1, Math.floor(channelData.length / width));

    ctx.beginPath();
    ctx.moveTo(0, middle);

    for (let x = 0; x < width; x += 1) {
      const start = x * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, channelData.length);
      let peak = 0;

      for (let i = start; i < end; i += 1) {
        const value = Math.abs(channelData[i]);
        if (value > peak) peak = value;
      }

      const y = peak * (height * 0.42);
      ctx.lineTo(x, middle - y);
    }

    for (let x = width - 1; x >= 0; x -= 1) {
      const start = x * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, channelData.length);
      let peak = 0;

      for (let i = start; i < end; i += 1) {
        const value = Math.abs(channelData[i]);
        if (value > peak) peak = value;
      }

      const y = peak * (height * 0.42);
      ctx.lineTo(x, middle + y);
    }

    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "rgba(45,159,211,0.38)");
    gradient.addColorStop(1, "rgba(42,105,200,0.24)");
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, middle);
    ctx.lineTo(width, middle);
    ctx.strokeStyle = "rgba(31,55,83,0.28)";
    ctx.stroke();
  }

  function drawLineChart(canvas, points, options) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f7fbff";
    ctx.fillRect(0, 0, width, height);

    const safePoints = Array.isArray(points) ? points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
    if (safePoints.length < 2) {
      ctx.fillStyle = "#5d7390";
      ctx.font = "14px Source Sans 3";
      ctx.fillText("Not enough data yet", 14, 24);
      return;
    }

    const padding = 26;
    const xMin = Math.min(...safePoints.map((p) => p.x));
    const xMax = Math.max(...safePoints.map((p) => p.x));
    const yMin = Number.isFinite(options.yMin) ? options.yMin : Math.min(...safePoints.map((p) => p.y));
    const yMax = Number.isFinite(options.yMax) ? options.yMax : Math.max(...safePoints.map((p) => p.y));

    const mapX = (x) => padding + ((x - xMin) / Math.max(xMax - xMin, 1e-6)) * (width - padding * 2);
    const mapY = (y) => height - padding - ((y - yMin) / Math.max(yMax - yMin, 1e-6)) * (height - padding * 2);

    if (Array.isArray(options.bands)) {
      for (const band of options.bands) {
        const yTop = mapY(band.max);
        const yBottom = mapY(band.min);
        ctx.fillStyle = band.color;
        ctx.fillRect(padding, yTop, width - padding * 2, yBottom - yTop);
      }
    }

    ctx.strokeStyle = "rgba(33,53,76,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.stroke();

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = options.lineColor || "#2d9fd3";

    safePoints.forEach((point, idx) => {
      const x = mapX(point.x);
      const y = mapY(point.y);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    if (options.fillColor) {
      ctx.beginPath();
      safePoints.forEach((point, idx) => {
        const x = mapX(point.x);
        const y = mapY(point.y);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(mapX(safePoints[safePoints.length - 1].x), height - padding);
      ctx.lineTo(mapX(safePoints[0].x), height - padding);
      ctx.closePath();
      ctx.fillStyle = options.fillColor;
      ctx.fill();
    }

    if (options.title) {
      ctx.fillStyle = "#3b5572";
      ctx.font = "12px Source Sans 3";
      ctx.fillText(options.title, padding, 16);
    }
  }

  function drawDualChart(canvas, seriesA, seriesB, options) {
    const merged = [...seriesA, ...seriesB];
    if (!merged.length) {
      drawLineChart(canvas, [], options);
      return;
    }

    drawLineChart(canvas, seriesA, {
      yMin: options.yMin,
      yMax: options.yMax,
      lineColor: options.lineA,
      fillColor: "rgba(45,159,211,0.14)",
      title: options.title
    });

    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const padding = 26;
    const xMin = Math.min(...merged.map((p) => p.x));
    const xMax = Math.max(...merged.map((p) => p.x));
    const yMin = Number.isFinite(options.yMin) ? options.yMin : Math.min(...merged.map((p) => p.y));
    const yMax = Number.isFinite(options.yMax) ? options.yMax : Math.max(...merged.map((p) => p.y));
    const mapX = (x) => padding + ((x - xMin) / Math.max(xMax - xMin, 1e-6)) * (width - padding * 2);
    const mapY = (y) => height - padding - ((y - yMin) / Math.max(yMax - yMin, 1e-6)) * (height - padding * 2);

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = options.lineB || "#2a69c8";
    seriesB.forEach((point, idx) => {
      const x = mapX(point.x);
      const y = mapY(point.y);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function downsamplePoints(points, maxPoints) {
    if (!Array.isArray(points) || points.length <= maxPoints) {
      return points || [];
    }

    const step = Math.ceil(points.length / maxPoints);
    const output = [];
    for (let i = 0; i < points.length; i += step) {
      output.push(points[i]);
    }
    return output;
  }

  function analyzeAudioBuffer(audioBuffer) {
    const data = audioBuffer.getChannelData(0);
    const durationSeconds = audioBuffer.duration;
    const sampleRate = audioBuffer.sampleRate;

    const frameSize = 2048;
    const hopSize = 1024;
    const estimatedFrameCount = Math.floor((data.length - frameSize) / hopSize);
    const frameStride = Math.max(1, Math.floor(estimatedFrameCount / 2600));

    const frames = [];
    const dbValues = [];
    const pitchValues = [];
    const rmsValues = [];

    let peak = 0;
    let silentStreakStart = null;
    const pauseMoments = [];

    for (let i = 0, frameIndex = 0; i + frameSize < data.length; i += hopSize, frameIndex += 1) {
      if (frameIndex % frameStride !== 0) {
        continue;
      }

      const frame = data.slice(i, i + frameSize);
      let sumSq = 0;
      let localPeak = 0;
      let zeroCrossings = 0;

      for (let j = 0; j < frame.length; j += 1) {
        const value = frame[j];
        const abs = Math.abs(value);
        sumSq += value * value;
        if (abs > localPeak) localPeak = abs;
        if (j > 0 && ((frame[j - 1] >= 0 && value < 0) || (frame[j - 1] < 0 && value >= 0))) {
          zeroCrossings += 1;
        }
      }

      if (localPeak > peak) peak = localPeak;

      const rms = Math.sqrt(sumSq / frame.length);
      const db = toDb(rms);
      const timeSec = i / sampleRate;
      const pitch = estimatePitch(frame, sampleRate);

      const zcr = zeroCrossings / frame.length;

      frames.push({ t: Number(timeSec.toFixed(3)), rms, db, pitch, zcr });
      rmsValues.push(rms);
      dbValues.push(db);
      if (pitch) pitchValues.push(pitch);

      if (rms < 0.015) {
        if (silentStreakStart === null) {
          silentStreakStart = timeSec;
        }
      } else if (silentStreakStart !== null) {
        const silenceDuration = timeSec - silentStreakStart;
        if (silenceDuration >= 0.45) {
          pauseMoments.push({
            start: Number(silentStreakStart.toFixed(2)),
            end: Number(timeSec.toFixed(2)),
            duration: Number(silenceDuration.toFixed(2))
          });
        }
        silentStreakStart = null;
      }
    }

    const avgRms = mean(rmsValues);
    const avgDb = toDb(avgRms);
    const dynamicRangeDb = percentile(dbValues, 0.95) - percentile(dbValues, 0.2);
    const silenceRatio = frames.length ? frames.filter((frame) => frame.rms < 0.015).length / frames.length : 0;

    const monotoneSections = [];
    const windowSec = 20;
    for (let startSec = 0; startSec < durationSeconds; startSec += windowSec) {
      const endSec = startSec + windowSec;
      const windowFrames = frames.filter((frame) => frame.t >= startSec && frame.t < endSec);
      const windowPitch = windowFrames.map((frame) => frame.pitch).filter((pitch) => Number.isFinite(pitch));
      if (windowPitch.length < 6) continue;

      const pitchStd = std(windowPitch);
      const dbStd = std(windowFrames.map((frame) => frame.db));
      if (pitchStd < 11 && dbStd < 2.2) {
        monotoneSections.push({
          start: Number(startSec.toFixed(1)),
          end: Number(Math.min(endSec, durationSeconds).toFixed(1)),
          duration: Number(Math.min(windowSec, durationSeconds - startSec).toFixed(1))
        });
      }
    }

    const pitchMean = mean(pitchValues);
    const pitchStd = std(pitchValues);
    const pitchRange = pitchValues.length ? Math.max(...pitchValues) - Math.min(...pitchValues) : 0;
    const volumeStdDb = std(dbValues);

    const varietyScore = Math.max(0, Math.min(100,
      (Math.min(pitchStd / 45, 1) * 45) +
      (Math.min(dynamicRangeDb / 12, 1) * 35) +
      (Math.min(volumeStdDb / 6, 1) * 20)
    ));

    const loudnessContour = downsamplePoints(
      frames.map((frame) => ({ x: frame.t, y: Number(frame.db.toFixed(2)) })),
      420
    );
    const pitchContour = downsamplePoints(
      frames
        .filter((frame) => Number.isFinite(frame.pitch))
        .map((frame) => ({ x: frame.t, y: Number(frame.pitch.toFixed(2)) })),
      420
    );

    return {
      channelData: data,
      payload: {
        durationSeconds: Number(durationSeconds.toFixed(2)),
        acoustic: {
          avgDb: Number(avgDb.toFixed(2)),
          peakDb: Number(toDb(peak).toFixed(2)),
          dynamicRangeDb: Number(dynamicRangeDb.toFixed(2)),
          silenceRatio: Number(silenceRatio.toFixed(4)),
          volumeStdDb: Number(volumeStdDb.toFixed(2))
        },
        pitch: {
          meanHz: Number(pitchMean.toFixed(2)),
          stdHz: Number(pitchStd.toFixed(2)),
          rangeHz: Number(pitchRange.toFixed(2)),
          validSamples: pitchValues.length,
          varietyScore: Number(varietyScore.toFixed(1))
        },
        pauseMoments,
        monotoneSections,
        contours: {
          loudness: loudnessContour,
          pitch: pitchContour
        }
      }
    };
  }

  function renderPipeline(orchestration) {
    const rows = Array.isArray(orchestration) ? orchestration : [];
    if (!rows.length) {
      pipelineStatus.classList.add("hidden");
      pipelineStatus.innerHTML = "";
      return;
    }

    pipelineStatus.classList.remove("hidden");
    pipelineStatus.innerHTML = rows
      .map((row) => {
        const status = cleanString(row.status, "completed").toLowerCase();
        const className = status === "completed" ? "ok" : status === "degraded" ? "warn" : "err";
        const seconds = Number(row.durationMs || 0) / 1000;
        return `<span class="pipeline-chip ${className}">${escapeHtml(cleanString(row.agent))} | ${seconds.toFixed(2)}s</span>`;
      })
      .join("");
  }

  function renderTranscriptTable(segments) {
    const rows = Array.isArray(segments) ? segments.slice(0, 140) : [];
    if (!rows.length) {
      return `<p class="inline-hint">No transcript segments returned.</p>`;
    }

    return `
      <div class="transcript-wrap">
        <table class="transcript-table">
          <thead>
            <tr><th>Time</th><th>Transcript</th></tr>
          </thead>
          <tbody>
            ${rows.map((segment) => `
              <tr>
                <td>${escapeHtml(`${formatClock(segment.start)} - ${formatClock(segment.end)}`)}</td>
                <td>${escapeHtml(cleanString(segment.text))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderSectionsWithRange(rows, label) {
    if (!Array.isArray(rows) || !rows.length) {
      return `<p class="inline-hint">No ${escapeHtml(label)} sections detected.</p>`;
    }

    return `<ul class="list">${rows.slice(0, 12).map((row) => {
      const range = `${formatClock(row.start)} - ${formatClock(row.end)}`;
      const pace = Number.isFinite(Number(row.wpm)) ? ` (${Number(row.wpm).toFixed(0)} WPM)` : "";
      return `<li>${escapeHtml(range + pace + (row.textSample ? `: ${row.textSample}` : ""))}</li>`;
    }).join("")}</ul>`;
  }

  function renderMonotoneSections(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      return `<p class="inline-hint">No significant monotone sections detected.</p>`;
    }

    return `<ul class="list">${rows.slice(0, 12).map((row) => `<li>${escapeHtml(`${formatClock(row.start)} - ${formatClock(row.end)} (${Number(row.duration || 0).toFixed(1)}s)`)}</li>`).join("")}</ul>`;
  }

  function buildReportText(payload) {
    const lines = [];
    lines.push("Sermon Analyzer Report");
    lines.push(`Generated: ${cleanString(payload.meta.generatedAt)}`);
    lines.push(`Duration: ${formatClock(payload.meta.durationSeconds)}`);
    if (payload.meta && payload.meta.metricProvenance) {
      const pacingSource = cleanString(payload.meta.metricProvenance.pacing && payload.meta.metricProvenance.pacing.source, "unavailable");
      const vocalSource = cleanString(payload.meta.metricProvenance.vocalDynamics && payload.meta.metricProvenance.vocalDynamics.source, "unavailable");
      lines.push(`Pacing source: ${pacingSource}`);
      lines.push(`Vocal source: ${vocalSource}`);
    }
    lines.push("");
    lines.push("Executive Summary:");
    lines.push(cleanString(payload.coachingFeedback.executiveSummary));
    lines.push("");
    lines.push("Priority Actions:");
    normalizeListItems(payload.coachingFeedback.priorityActions, 12).forEach((item) => lines.push(`- ${item}`));
    lines.push("");
    lines.push("Practice Drills:");
    normalizeListItems(payload.coachingFeedback.practiceDrills, 12).forEach((item) => lines.push(`- ${item}`));
    lines.push("");
    lines.push("Scripture References:");
    cleanArray(payload.contentAnalysis.scriptureReferences, 20).forEach((item) => lines.push(`- ${item}`));
    return lines.join("\n");
  }

  function renderReport(payload, projectInput) {
    const meta = payload.meta || {};
    const transcript = payload.transcript || {};
    const emotionalArc = payload.emotionalArc || {};
    const pacing = payload.pacingAnalysis || {};
    const vocal = payload.vocalDynamics || {};
    const content = payload.contentAnalysis || {};
    const coaching = payload.coachingFeedback || {};
    const coachMode = payload.coachMode || {};
    const comparative = payload.comparativeAnalytics || {};
    const metricProvenance = meta.metricProvenance && typeof meta.metricProvenance === "object"
      ? meta.metricProvenance
      : {};
    const pacingSource = metricProvenance.pacing && typeof metricProvenance.pacing === "object"
      ? metricProvenance.pacing
      : {};
    const vocalSource = metricProvenance.vocalDynamics && typeof metricProvenance.vocalDynamics === "object"
      ? metricProvenance.vocalDynamics
      : {};
    const hasVocalSignal = [vocal.varietyScore, vocal.dynamicRangeDb, vocal.pitchStdHz]
      .some((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
    const input = projectInput && typeof projectInput === "object" ? projectInput : {};

    return `
      <div class="card">
        <span class="kicker">Project Inputs</span>
        <p><strong>Context:</strong> ${escapeHtml(cleanString(input.context, "General sermon context"))}</p>
        <p><strong>Coaching goal:</strong> ${escapeHtml(cleanString(input.goal, "Not specified"))}</p>
        <p><strong>Notes:</strong> ${escapeHtml(cleanString(input.notes, "Not specified"))}</p>
        <p><strong>Transcript override:</strong> ${cleanString(input.transcriptOverride) ? "Provided" : "Not provided"}</p>
        <p><strong>Source file:</strong> ${escapeHtml(cleanString(input.fileName, cleanString(meta.fileName, "n/a")))}${Number(input.fileSizeBytes || 0) > 0 ? ` (${formatBytes(input.fileSizeBytes)})` : ""}</p>
      </div>

      <div class="card">
        <span class="kicker">Report Overview</span>
        <div class="metric-grid">
          <div class="metric"><strong>${formatClock(meta.durationSeconds)}</strong><span>Duration</span></div>
          <div class="metric"><strong>${formatMetric(pacing.avgWpm)}</strong><span>Average WPM</span></div>
          <div class="metric"><strong>${formatMetric(vocal.varietyScore)}</strong><span>Vocal variety score</span></div>
          <div class="metric"><strong>${formatMetric(pacing.rhythmScore)}</strong><span>Rhythm score</span></div>
          <div class="metric"><strong>${formatMetric(vocal.dynamicRangeDb, " dB")}</strong><span>Dynamic range</span></div>
          <div class="metric"><strong>${formatMetric(content.gospelClarityScore)}</strong><span>Gospel clarity score</span></div>
        </div>
        <p class="inline-hint"><strong>Pacing source:</strong> ${escapeHtml(formatMetricSource(pacingSource.source))}${cleanString(pacingSource.note) ? ` | ${escapeHtml(cleanString(pacingSource.note))}` : ""}</p>
        <p class="inline-hint"><strong>Vocal source:</strong> ${escapeHtml(formatMetricSource(vocalSource.source))}${cleanString(vocalSource.note) ? ` | ${escapeHtml(cleanString(vocalSource.note))}` : ""}</p>
      </div>

      <div class="card">
        <span class="kicker">Coaching Summary</span>
        <p>${escapeHtml(cleanString(coaching.executiveSummary, "No executive summary returned."))}</p>
      </div>

      <div class="card">
        <span class="kicker">Pacing Analysis</span>
        <p><strong>Target band:</strong> ${escapeHtml(cleanString(pacing.targetBandWpm, "120-150"))}</p>
        <p><strong>Pause moments:</strong> ${Number(pacing.pauseCount || 0)} (${formatMetric(pacing.pauseTimeSec, "s")} total)</p>
        <h3 class="section-title" style="margin-top:0.95rem;">Fast Sections</h3>
        ${renderSectionsWithRange(pacing.fastSections, "fast")}
        <h3 class="section-title" style="margin-top:0.95rem;">Slow Sections</h3>
        ${renderSectionsWithRange(pacing.slowSections, "slow")}
      </div>

      <div class="card">
        <span class="kicker">Vocal Dynamics</span>
        ${hasVocalSignal ? `
          <p><strong>Average loudness:</strong> ${formatMetric(vocal.avgDb, " dB")} | <strong>Peak:</strong> ${formatMetric(vocal.peakDb, " dB")}</p>
          <p><strong>Pitch mean/std:</strong> ${formatMetric(vocal.pitchMeanHz, " Hz")} / ${formatMetric(vocal.pitchStdHz, " Hz")}</p>
          <p><strong>Pitch range:</strong> ${formatMetric(vocal.pitchRangeHz, " Hz")} | <strong>Monotone risk:</strong> ${formatMetric(vocal.monotoneRiskScore)}</p>
        ` : `<p class="inline-hint">Vocal dynamics are unavailable for this run. Upload audio with local waveform analysis for full acoustic metrics.</p>`}
        <h3 class="section-title" style="margin-top:0.95rem;">Monotone Sections</h3>
        ${renderMonotoneSections(vocal.monotoneSections)}
      </div>

      <div class="card">
        <span class="kicker">Content Analysis</span>
        <p>${escapeHtml(cleanString(content.summary, "No content summary returned."))}</p>
        <h3 class="section-title" style="margin-top:0.95rem;">Scripture References</h3>
        ${listHtml(content.scriptureReferences, 30)}
        <h3 class="section-title" style="margin-top:0.95rem;">Key Themes</h3>
        ${listHtml(content.keyThemes, 12)}
        <h3 class="section-title" style="margin-top:0.95rem;">Structure Movements</h3>
        ${listHtml(content.structureMovements, 12)}
        <h3 class="section-title" style="margin-top:0.95rem;">Illustration Tracking</h3>
        ${listHtml(content.illustrationTracking, 12)}
        <h3 class="section-title" style="margin-top:0.95rem;">Calls to Action</h3>
        ${listHtml(content.callsToAction, 12)}
      </div>

      <div class="card">
        <span class="kicker">Coaching Feedback</span>
        <h3 class="section-title">Strengths</h3>
        ${listHtml(coaching.strengths, 10)}
        <h3 class="section-title" style="margin-top:0.95rem;">Risks</h3>
        ${listHtml(coaching.risks, 10)}
        <h3 class="section-title" style="margin-top:0.95rem;">Priority Actions</h3>
        ${listHtml(coaching.priorityActions, 10)}
        <h3 class="section-title" style="margin-top:0.95rem;">Practice Drills</h3>
        ${listHtml(coaching.practiceDrills, 12)}
        <h3 class="section-title" style="margin-top:0.95rem;">Next Week Plan</h3>
        ${listHtml(coaching.nextWeekPlan, 10)}
      </div>

      ${coachMode && Array.isArray(coachMode.drills) && coachMode.drills.length ? `
        <div class="card">
          <span class="kicker">Coach Mode (${escapeHtml(String(coachMode.planDays || 7))} Days)</span>
          <ul class="list coach-drill-list">
            ${(coachMode.drills || []).map((drill) => `
              <li>
                <strong>Day ${Number(drill.day || 0)} - ${escapeHtml(cleanString(drill.focus))}:</strong> ${escapeHtml(cleanString(drill.target))} (${escapeHtml(cleanString(drill.metric))})
                <button type="button" class="btn secondary coach-drill-btn" data-drill-id="${escapeHtml(`day-${Number(drill.day || 0)}-${cleanString(drill.focus).toLowerCase().replace(/\s+/g, "-")}`)}" data-drill-day="${escapeHtml(String(Number(drill.day || 0)))}">Mark Complete</button>
              </li>
            `).join("")}
          </ul>
        </div>
      ` : ""}

      ${comparative ? `
        <div class="card">
          <span class="kicker">Comparative Analytics</span>
          <p><strong>Pacing delta:</strong> ${escapeHtml(String(comparative.pacingDeltaWpm || 0))} WPM</p>
          <p><strong>Vocal variety delta:</strong> ${escapeHtml(String(comparative.vocalVarietyDelta || 0))}</p>
          <p><strong>Clarity delta:</strong> ${escapeHtml(String(comparative.clarityDelta || 0))}</p>
        </div>
      ` : ""}

      <div class="card">
        <span class="kicker">Full Transcript</span>
        <p><strong>Language:</strong> ${escapeHtml(cleanString(transcript.language, "unknown"))} | <strong>Words:</strong> ${Number(transcript.wordCount || tokenize(transcript.text || "").length)}</p>
        <p>${escapeHtml(cleanString(transcript.text).slice(0, 1200))}${cleanString(transcript.text).length > 1200 ? "..." : ""}</p>
        ${renderTranscriptTable(transcript.segments)}
      </div>
    `;
  }

  function wireCoachDrillButtons() {
    const buttons = Array.from(document.querySelectorAll(".coach-drill-btn"));
    for (const buttonEl of buttons) {
      buttonEl.addEventListener("click", async () => {
        const drillId = cleanString(buttonEl.getAttribute("data-drill-id"));
        const day = cleanString(buttonEl.getAttribute("data-drill-day"));
        if (!drillId) {
          return;
        }
        buttonEl.disabled = true;
        buttonEl.textContent = "Saving...";
        try {
          await apiPost("/api/coach/drills/complete", {
            drillId,
            date: new Date().toISOString().slice(0, 10),
            completed: true
          });
          buttonEl.textContent = "Completed";
          buttonEl.classList.add("is-complete");
          await trackEvent("coach_drill_marked_complete", { tool: "sermon-analyzer", drillId, day });
        } catch (error) {
          buttonEl.disabled = false;
          buttonEl.textContent = "Mark Complete";
          showNotice(`Could not save drill completion: ${escapeHtml(cleanString(error.message))}`, "error");
        }
      });
    }
  }

  function renderCharts(payload, localAnalysis) {
    if (!localAnalysis || !localAnalysis.channelData || !localAnalysis.payload) {
      chartsWrap.classList.add("hidden");
      return;
    }
    chartsWrap.classList.remove("hidden");

    drawWaveform(localAnalysis.channelData);

    const emotionalPoints = (payload.emotionalArc && Array.isArray(payload.emotionalArc.points)
      ? payload.emotionalArc.points
      : []).map((point) => ({ x: Number(point.timeSec || 0), y: Number(point.intensity || 0) }));

    drawLineChart(emotionalArcCanvas, emotionalPoints, {
      yMin: 0,
      yMax: 100,
      lineColor: "#2a69c8",
      fillColor: "rgba(42,105,200,0.16)",
      title: "Intensity 0-100"
    });

    const pacingPoints = (payload.pacingAnalysis && Array.isArray(payload.pacingAnalysis.sectionWpm)
      ? payload.pacingAnalysis.sectionWpm
      : []).map((section) => ({
      x: Number(section.start || 0),
      y: Number(section.wpm || 0)
    }));

    drawLineChart(pacingCanvas, pacingPoints, {
      yMin: 60,
      yMax: 210,
      lineColor: "#2d9fd3",
      fillColor: "rgba(45,159,211,0.16)",
      title: "Words per minute",
      bands: [
        { min: 120, max: 150, color: "rgba(16,185,129,0.14)" }
      ]
    });

    const loudnessSeries = (localAnalysis.payload.contours && localAnalysis.payload.contours.loudness
      ? localAnalysis.payload.contours.loudness
      : []).map((point) => ({ x: Number(point.x), y: Number(point.y) }));
    const pitchSeries = (localAnalysis.payload.contours && localAnalysis.payload.contours.pitch
      ? localAnalysis.payload.contours.pitch
      : []).map((point) => ({ x: Number(point.x), y: Number(point.y / 6 - 50) }));

    drawDualChart(vocalCanvas, loudnessSeries, pitchSeries, {
      yMin: -70,
      yMax: 20,
      lineA: "#2d9fd3",
      lineB: "#2a69c8",
      title: "Blue: loudness dB | Navy: pitch proxy"
    });
  }

  async function decodeAudio(file) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    await ctx.close();
    return buffer;
  }

  function buildMonoDownsampledPcm(audioBuffer, targetSampleRate) {
    const channels = Math.max(1, Number(audioBuffer.numberOfChannels || 1));
    const sourceRate = Number(audioBuffer.sampleRate || 44100);
    const sourceLength = Number(audioBuffer.length || 0);
    const mono = new Float32Array(sourceLength);

    for (let channel = 0; channel < channels; channel += 1) {
      const input = audioBuffer.getChannelData(channel);
      for (let i = 0; i < sourceLength; i += 1) {
        mono[i] += Number(input[i] || 0);
      }
    }

    for (let i = 0; i < sourceLength; i += 1) {
      mono[i] /= channels;
    }

    const ratio = sourceRate / targetSampleRate;
    const outputLength = Math.max(1, Math.floor(sourceLength / Math.max(ratio, 1e-6)));
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.min(sourceLength, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j += 1) {
        sum += mono[j];
      }
      output[i] = sum / Math.max(1, end - start);
    }

    return output;
  }

  function writeAscii(view, offset, value) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  function encodePcm16Wav(samples, sampleRate) {
    const sampleCount = samples.length;
    const bytesPerSample = 2;
    const dataLength = sampleCount * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < sampleCount; i += 1) {
      const sample = Math.max(-1, Math.min(1, Number(samples[i] || 0)));
      const encoded = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, Math.round(encoded), true);
      offset += bytesPerSample;
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  function replaceExtension(fileName, extension) {
    return String(fileName || "audio")
      .replace(/\.[a-z0-9]+$/i, "") + extension;
  }

  function buildOptimizedUploadFile(file, audioBuffer) {
    const downsampled = buildMonoDownsampledPcm(audioBuffer, OPTIMIZED_SAMPLE_RATE);
    const wavBlob = encodePcm16Wav(downsampled, OPTIMIZED_SAMPLE_RATE);
    return new File([wavBlob], replaceExtension(file.name, ".wav"), { type: "audio/wav" });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideNotice();
    result.innerHTML = "";
    pipelineStatus.classList.add("hidden");
    pipelineStatus.innerHTML = "";
    chartsWrap.classList.add("hidden");
    lastReportText = "";
    setReportActionsVisible(false);

    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      showNotice("Choose an audio file before analyzing.", "error");
      return;
    }

    setBusy(button, "Analyzing Sermon...", true);

    try {
      const audioBuffer = await decodeAudio(file);
      const localAnalysis = analyzeAudioBuffer(audioBuffer);
      let uploadFile = file;
      let optimizationNote = "";

      if (file.size > MAX_SAFE_UPLOAD_BYTES) {
        setBusy(button, "Optimizing Audio...", true);
        uploadFile = buildOptimizedUploadFile(file, audioBuffer);
        if (uploadFile.size > MAX_SAFE_UPLOAD_BYTES) {
          throw new Error(`Audio file is too large to upload (${formatBytes(uploadFile.size)} after optimization). Use a shorter clip or paste transcript override.`);
        }
        optimizationNote = ` Audio optimized from ${formatBytes(file.size)} to ${formatBytes(uploadFile.size)} for reliable upload.`;
        setBusy(button, "Analyzing Sermon...", true);
      }

      const formData = new FormData();
      formData.append("audio", uploadFile);
      formData.append("context", cleanString(contextInput.value));
      formData.append("goal", cleanString(goalInput.value));
      formData.append("notes", cleanString(notesInput.value));
      formData.append("transcriptOverride", cleanString(transcriptInput.value));
      formData.append("localAnalysis", JSON.stringify(localAnalysis.payload));

      formData.append("asyncMode", "true");
      const kickoff = await apiPostForm("/api/ai/sermon-analyzer", formData);
      let payload = kickoff;
      if (cleanString(kickoff.mode) === "async" && kickoff.jobId) {
        setBusy(button, "Processing Queue Job...", true);
        payload = await pollAnalyzerJob(kickoff.jobId);
      }

      const generatedProjectPayload = {
        input: {
          context: cleanString(contextInput.value),
          goal: cleanString(goalInput.value),
          notes: cleanString(notesInput.value),
          transcriptOverride: cleanString(transcriptInput.value),
          fileName: cleanString(file && file.name),
          fileSizeBytes: Number(file && file.size || 0),
          fileType: cleanString(file && file.type),
          uploadOptimized: cleanString(uploadFile && uploadFile.name) !== cleanString(file && file.name),
          localAnalysis: localAnalysis && localAnalysis.payload ? localAnalysis.payload : {}
        },
        output: payload
      };
      const persisted = await saveProjectAndOpen(
        "sermon-analyzer",
        `Analyzer Report - ${cleanString(payload && payload.meta && payload.meta.fileName, cleanString(file && file.name, "audio"))}`,
        generatedProjectPayload,
        activeProjectId
      );
      activeProjectId = cleanString(persisted && persisted.projectId);
      if (persisted && persisted.navigated) {
        return;
      }

      renderPipeline(payload.orchestration);
      renderCharts(payload, localAnalysis);
      result.innerHTML = renderReport(payload, generatedProjectPayload.input);
      wireCoachDrillButtons();
      lastReportText = buildReportText(payload);
      lastPayload = payload;
      lastProjectPayload = generatedProjectPayload;
      setReportActionsVisible(true);

      showNotice(`Full sermon analyzer report generated.${escapeHtml(optimizationNote)}`, "ok");
      await trackEvent("generation_success", { tool: "sermon-analyzer" });
    } catch (error) {
      chartsWrap.classList.add("hidden");
      showNotice(`Sermon analysis failed: ${escapeHtml(error.message || "Unknown error")}`, "error");
      setReportActionsVisible(false);
    } finally {
      setBusy(button, "", false);
    }
  });

  copyButton.addEventListener("click", async () => {
    const reportText = lastReportText || cleanString(result.innerText);
    if (!reportText) {
      showNotice("Generate a report before copying.", "error");
      return;
    }

    try {
      await navigator.clipboard.writeText(reportText);
      if (activeProjectId) {
        await appendProjectExport(activeProjectId, "sermon-analyzer-report-copy", {
          fileName: cleanString(lastPayload && lastPayload.meta && lastPayload.meta.fileName)
        });
      }
      showNotice("Analyzer report copied to clipboard.", "ok");
    } catch (_) {
      const temp = document.createElement("textarea");
      temp.value = reportText;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
      showNotice("Analyzer report copied to clipboard.", "ok");
    }
  });

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn secondary hidden";
  saveBtn.textContent = "Save Report";
  saveBtn.addEventListener("click", async () => {
    if (!lastProjectPayload) {
      showNotice("Generate an analyzer report before saving.", "error");
      return;
    }
    try {
      if (activeProjectId) {
        await updateProject(activeProjectId, lastProjectPayload);
      } else {
        const report = lastProjectPayload && lastProjectPayload.output ? lastProjectPayload.output : {};
        const saved = await saveProject("sermon-analyzer", `Analyzer Report - ${cleanString(report && report.meta && report.meta.fileName)}`, lastProjectPayload);
        activeProjectId = cleanString(saved && saved.project && saved.project.id);
      }
      await trackEvent("project_saved", { tool: "sermon-analyzer" });
      showNotice("Analyzer report saved.", "ok");
    } catch (error) {
      showNotice(`Could not save report: ${escapeHtml(error.message || "Unknown error")}`, "error");
    }
  });
  const row = document.querySelector("#audioForm .btn-row");
  if (row) {
    row.appendChild(saveBtn);
  }
  saveButton = saveBtn;
  setReportActionsVisible(false);

  async function hydrateFromProject() {
    try {
      const project = await hydrateProjectFromQuery("sermon-analyzer");
      if (!project || !project.payload || typeof project.payload !== "object") {
        return;
      }
      const payload = project.payload.output && typeof project.payload.output === "object"
        ? project.payload.output
        : project.payload;
      const projectPayload = project.payload.output && typeof project.payload.output === "object"
        ? project.payload
        : { input: {}, output: payload };
      activeProjectId = cleanString(project.id);
      if (payload.meta && payload.meta.fileName) {
        showNotice(`Loaded saved analyzer report (${escapeHtml(cleanString(payload.meta.fileName))}).`, "ok");
      } else {
        showNotice("Loaded saved analyzer report.", "ok");
      }
      lastPayload = payload;
      lastProjectPayload = projectPayload;
      lastReportText = buildReportText(payload);
      result.innerHTML = renderReport(payload, projectPayload.input);
      wireCoachDrillButtons();
      chartsWrap.classList.add("hidden");
      pipelineStatus.classList.add("hidden");
      setReportActionsVisible(true);
    } catch (error) {
      showNotice(`Could not load project: ${escapeHtml(cleanString(error.message))}`, "error");
    }
  }

  async function pollAnalyzerJob(jobId) {
    const started = Date.now();
    const timeoutMs = 8 * 60 * 1000;

    while (Date.now() - started < timeoutMs) {
      const status = await apiGet(`/api/ai/sermon-analyzer/jobs/${encodeURIComponent(cleanString(jobId))}`);
      const state = cleanString(status.status);
      if (state === "completed" && status.result) {
        return status.result;
      }
      if (state === "failed") {
        throw new Error(cleanString(status.failureReason, "Analyzer job failed."));
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("Analyzer job timed out. Retry with a shorter audio file.");
  }

  void hydrateFromProject();
})();

