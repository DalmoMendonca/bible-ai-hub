const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const VIDEO_LIBRARY = [];
const SUPPORTED_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const INDEX_RELATIVE_PATH = path.join("server", "data", "video-library-index.json");
const DEFAULT_VIDEO_PUBLIC_STRIP_PREFIX = "ai/videos";
let BUNDLED_VIDEO_INDEX = null;

try {
  BUNDLED_VIDEO_INDEX = require("./data/video-library-index.json");
} catch (_) {
  BUNDLED_VIDEO_INDEX = null;
}

let activeRootDir = "";
let lastHydrationMs = 0;

function hydrateVideoLibrary(rootDir, options = {}) {
  const force = Boolean(options.force);
  const maxAgeMs = Number(options.maxAgeMs || 20000);
  const now = Date.now();

  if (
    !force
    && VIDEO_LIBRARY.length
    && activeRootDir === rootDir
    && (now - lastHydrationMs) < maxAgeMs
  ) {
    return VIDEO_LIBRARY;
  }

  activeRootDir = rootDir;

  const indexPath = path.join(rootDir, INDEX_RELATIVE_PATH);
  const persisted = readIndexFile(indexPath);
  const persistedVideos = Array.isArray(persisted.videos) ? persisted.videos : [];
  const persistedByRelPath = new Map();
  const persistedById = new Map();

  for (const row of persistedVideos) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const relativePath = cleanString(row.relativePath);
    const id = cleanString(row.id);
    if (relativePath) {
      persistedByRelPath.set(relativePath, row);
    }
    if (id) {
      persistedById.set(id, row);
    }
  }

  const videoRoot = path.join(rootDir, "ai", "videos");
  const files = discoverVideoFiles(videoRoot);
  const discoveredRelativePaths = new Set();

  const discoveredRows = files.map((filePath) => {
    const relativePath = toPosix(path.relative(rootDir, filePath));
    discoveredRelativePaths.add(relativePath);
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    const fileName = path.basename(filePath);
    const stat = fs.statSync(filePath);
    const fileMtimeMs = Math.floor(stat.mtimeMs);
    const fileSizeBytes = Number(stat.size || 0);
    const derived = deriveMetadata(baseName);
    const fallbackId = slugify(baseName) || slugify(fileName);
    const persistedRow = persistedByRelPath.get(relativePath) || persistedById.get(fallbackId) || {};

    const previousDuration = Number(persistedRow.durationSeconds || 0);
    const durationNeedsProbe = (
      !previousDuration
      || Number(persistedRow.fileSizeBytes || 0) !== fileSizeBytes
      || Number(persistedRow.fileMtimeMs || 0) !== fileMtimeMs
    );
    const durationSeconds = durationNeedsProbe
      ? probeDurationSeconds(filePath)
      : previousDuration;

    let transcriptText = cleanString(persistedRow.transcriptText);
    let transcriptSegments = sanitizeSegments(persistedRow.transcriptSegments, 10000);
    let transcriptLanguage = cleanString(persistedRow.transcriptLanguage, "unknown");
    let transcriptStatus = cleanString(persistedRow.transcriptStatus, transcriptText ? "ready" : "pending");
    let lastError = cleanString(persistedRow.lastError);

    if (!transcriptText) {
      const sidecar = loadSidecarTranscript(filePath, durationSeconds);
      if (sidecar) {
        transcriptText = cleanString(sidecar.text);
        transcriptSegments = sanitizeSegments(sidecar.segments, 10000);
        transcriptLanguage = cleanString(sidecar.language, "unknown");
        transcriptStatus = transcriptText ? "ready" : "pending";
        lastError = "";
      }
    }

    if (transcriptText && !transcriptSegments.length) {
      transcriptSegments = deriveSegmentsFromText(transcriptText, durationSeconds || 0);
    }

    if (!transcriptText) {
      transcriptStatus = transcriptStatus === "error" ? "error" : "pending";
    } else {
      transcriptStatus = "ready";
    }

    const publicUrl = cleanString(persistedRow.publicUrl, `/${relativePath}`);
    const hostedUrl = deriveHostedUrl({
      persistedHostedUrl: persistedRow.hostedUrl,
      relativePath,
      fileName
    });

    return {
      id: cleanString(persistedRow.id, fallbackId),
      fileName,
      relativePath,
      publicUrl,
      hostedUrl,
      playbackUrl: cleanString(
        persistedRow.playbackUrl,
        hostedUrl || publicUrl
      ),
      sourceAvailable: true,
      title: cleanString(persistedRow.title, derived.title || fileName),
      category: cleanString(persistedRow.category, derived.category),
      topic: cleanString(persistedRow.topic, derived.topic),
      logosVersion: cleanString(persistedRow.logosVersion, derived.logosVersion),
      difficulty: cleanString(persistedRow.difficulty, derived.difficulty),
      tags: mergeTags(persistedRow.tags, derived.tags),
      durationSeconds: Number(durationSeconds || 0),
      duration: secondsToDuration(durationSeconds || 0),
      transcriptStatus,
      transcriptLanguage,
      transcriptText,
      transcriptSegments,
      transcriptionUpdatedAt: cleanString(persistedRow.transcriptionUpdatedAt),
      fileSizeBytes,
      fileMtimeMs,
      lastError,
      createdAt: cleanString(persistedRow.createdAt, new Date().toISOString()),
      updatedAt: new Date().toISOString()
    };
  });
  const discoveredIds = new Set(discoveredRows.map((row) => cleanString(row.id)).filter(Boolean));

  const persistedOnlyRows = persistedVideos
    .filter((row) => row && typeof row === "object")
    .filter((row) => {
      const relativePath = cleanString(row.relativePath);
      const id = cleanString(row.id);
      return (!relativePath || !discoveredRelativePaths.has(relativePath)) && (!id || !discoveredIds.has(id));
    })
    .map((persistedRow) => {
      const relativePath = cleanString(persistedRow.relativePath);
      const fileName = cleanString(
        persistedRow.fileName,
        relativePath ? path.basename(relativePath) : ""
      );
      const fallbackId = cleanString(
        persistedRow.id,
        slugify(fileName || persistedRow.title || relativePath || `video-${Date.now()}`)
      );
      const derived = deriveMetadata(path.basename(fileName || fallbackId, path.extname(fileName || "")));
      const durationSeconds = Number(persistedRow.durationSeconds || durationToSeconds(persistedRow.duration || 0));
      const transcriptText = cleanString(persistedRow.transcriptText);
      let transcriptSegments = sanitizeSegments(persistedRow.transcriptSegments, 10000);
      let transcriptStatus = cleanString(persistedRow.transcriptStatus, transcriptText ? "ready" : "pending");
      if (transcriptText && !transcriptSegments.length) {
        transcriptSegments = deriveSegmentsFromText(transcriptText, durationSeconds || 0);
      }
      if (!transcriptText) {
        transcriptStatus = transcriptStatus === "error" ? "error" : "pending";
      } else {
        transcriptStatus = "ready";
      }

      const publicUrl = cleanString(persistedRow.publicUrl, relativePath ? `/${relativePath}` : "");
      const hostedUrl = deriveHostedUrl({
        persistedHostedUrl: persistedRow.hostedUrl,
        relativePath,
        fileName
      });

      return {
        id: fallbackId,
        fileName,
        relativePath,
        publicUrl,
        hostedUrl,
        playbackUrl: cleanString(persistedRow.playbackUrl, hostedUrl || publicUrl),
        sourceAvailable: false,
        title: cleanString(persistedRow.title, derived.title || fileName || fallbackId),
        category: cleanString(persistedRow.category, derived.category),
        topic: cleanString(persistedRow.topic, derived.topic),
        logosVersion: cleanString(persistedRow.logosVersion, derived.logosVersion),
        difficulty: cleanString(persistedRow.difficulty, derived.difficulty),
        tags: mergeTags(persistedRow.tags, derived.tags),
        durationSeconds: Number(durationSeconds || 0),
        duration: cleanString(persistedRow.duration, secondsToDuration(durationSeconds || 0)),
        transcriptStatus,
        transcriptLanguage: cleanString(persistedRow.transcriptLanguage, "unknown"),
        transcriptText,
        transcriptSegments,
        transcriptionUpdatedAt: cleanString(persistedRow.transcriptionUpdatedAt),
        fileSizeBytes: Number(persistedRow.fileSizeBytes || 0),
        fileMtimeMs: Number(persistedRow.fileMtimeMs || 0),
        lastError: cleanString(persistedRow.lastError),
        createdAt: cleanString(persistedRow.createdAt, new Date().toISOString()),
        updatedAt: new Date().toISOString()
      };
    });

  const rows = [...discoveredRows, ...persistedOnlyRows];

  rows.sort((a, b) => a.title.localeCompare(b.title));
  VIDEO_LIBRARY.splice(0, VIDEO_LIBRARY.length, ...rows);
  lastHydrationMs = now;
  saveVideoLibraryIndex(rootDir);
  return VIDEO_LIBRARY;
}

function saveVideoLibraryIndex(rootDir) {
  const activeRoot = cleanString(rootDir, activeRootDir);
  if (!activeRoot) {
    return;
  }

  try {
    const indexPath = path.join(activeRoot, INDEX_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });

    const payload = {
      version: 2,
      updatedAt: new Date().toISOString(),
      videos: VIDEO_LIBRARY
    };

    fs.writeFileSync(indexPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch (_) {
    // Netlify Functions runtime is read-only outside /tmp.
    // Swallow persistence errors and keep in-memory state for the request lifecycle.
  }
}

function setVideoTranscript(videoId, transcript, rootDir) {
  const row = VIDEO_LIBRARY.find((video) => cleanString(video.id) === cleanString(videoId));
  if (!row) {
    return null;
  }

  const text = cleanString(transcript && transcript.text);
  const durationSeconds = Number(transcript && transcript.durationSeconds) || Number(row.durationSeconds || 0);
  const segments = sanitizeSegments(
    (transcript && transcript.segments) || [],
    12000
  );
  const normalizedSegments = segments.length ? segments : deriveSegmentsFromText(text, durationSeconds);

  row.transcriptText = text;
  row.transcriptSegments = normalizedSegments;
  row.transcriptLanguage = cleanString(transcript && transcript.language, "unknown");
  row.transcriptStatus = text ? "ready" : "pending";
  row.transcriptionUpdatedAt = new Date().toISOString();
  row.lastError = "";
  row.durationSeconds = Number(durationSeconds || 0);
  row.duration = secondsToDuration(durationSeconds || 0);
  row.updatedAt = new Date().toISOString();

  saveVideoLibraryIndex(rootDir);
  return row;
}

function setVideoTranscriptionError(videoId, message, rootDir) {
  const row = VIDEO_LIBRARY.find((video) => cleanString(video.id) === cleanString(videoId));
  if (!row) {
    return null;
  }

  row.transcriptStatus = "error";
  row.lastError = cleanString(message);
  row.updatedAt = new Date().toISOString();
  saveVideoLibraryIndex(rootDir);
  return row;
}

function getVideoLibraryStats() {
  const totalVideos = VIDEO_LIBRARY.length;
  const ready = VIDEO_LIBRARY.filter((video) => video.transcriptStatus === "ready").length;
  const errored = VIDEO_LIBRARY.filter((video) => video.transcriptStatus === "error").length;
  const pending = Math.max(0, totalVideos - ready - errored);
  const totalDurationSeconds = VIDEO_LIBRARY.reduce((sum, video) => sum + Number(video.durationSeconds || 0), 0);

  return {
    totalVideos,
    transcribedVideos: ready,
    pendingVideos: pending,
    erroredVideos: errored,
    totalDurationSeconds: Number(totalDurationSeconds.toFixed(2)),
    totalDurationHours: Number((totalDurationSeconds / 3600).toFixed(2))
  };
}

function videoSearchDocument(video) {
  const transcriptPreview = cleanString(video.transcriptText).slice(0, 5000);

  return [
    cleanString(video.title),
    `Category: ${cleanString(video.category)}`,
    `Topic: ${cleanString(video.topic)}`,
    `Difficulty: ${cleanString(video.difficulty)}`,
    `Logos Version: ${cleanString(video.logosVersion)}`,
    `Tags: ${(Array.isArray(video.tags) ? video.tags : []).join(", ")}`,
    transcriptPreview ? `Transcript: ${transcriptPreview}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function durationToSeconds(input) {
  if (Number.isFinite(input)) {
    return Number(input);
  }

  const value = cleanString(input);
  if (!value) {
    return 0;
  }

  const pieces = value.split(":").map((part) => Number(part));
  if (!pieces.every((part) => Number.isFinite(part) && part >= 0)) {
    return 0;
  }

  if (pieces.length === 3) {
    return (pieces[0] * 3600) + (pieces[1] * 60) + pieces[2];
  }
  if (pieces.length === 2) {
    return (pieces[0] * 60) + pieces[1];
  }
  if (pieces.length === 1) {
    return pieces[0];
  }
  return 0;
}

function secondsToDuration(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  const rounded = Math.round(safe);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = Math.floor(rounded % 60);

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function readIndexFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return fallbackIndexData();
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") {
      return fallbackIndexData();
    }
    return data;
  } catch (_) {
    return fallbackIndexData();
  }
}

function fallbackIndexData() {
  const bundled = BUNDLED_VIDEO_INDEX;
  if (bundled && typeof bundled === "object" && Array.isArray(bundled.videos)) {
    return bundled;
  }
  return { videos: [] };
}

function discoverVideoFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const stack = [root];
  const files = [];

  while (stack.length) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (entry.isFile() && SUPPORTED_VIDEO_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function loadSidecarTranscript(videoPath, durationSeconds) {
  const dir = path.dirname(videoPath);
  const ext = path.extname(videoPath);
  const base = path.basename(videoPath, ext);
  const sidecars = [
    `${base}.transcript.json`,
    `${base}.json`,
    `${base}.txt`,
    `${base}.srt`,
    `${base}.vtt`
  ];

  for (const sidecarName of sidecars) {
    const fullPath = path.join(dir, sidecarName);
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    const loaded = parseSidecarFile(fullPath, durationSeconds);
    if (loaded && cleanString(loaded.text)) {
      return loaded;
    }
  }

  return null;
}

function parseSidecarFile(filePath, durationSeconds) {
  const ext = path.extname(filePath).toLowerCase();
  let raw = "";

  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (_) {
    return null;
  }

  if (!raw.trim()) {
    return null;
  }

  if (ext === ".txt") {
    const text = cleanString(raw);
    return {
      text,
      language: "unknown",
      segments: deriveSegmentsFromText(text, durationSeconds || 0)
    };
  }

  if (ext === ".srt" || ext === ".vtt") {
    const segments = parseSubtitles(raw);
    return {
      text: segments.map((segment) => segment.text).join(" "),
      language: "unknown",
      segments
    };
  }

  if (ext === ".json") {
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        const segments = sanitizeSegments(data, 12000);
        return {
          text: segments.map((segment) => segment.text).join(" "),
          language: "unknown",
          segments
        };
      }

      if (!data || typeof data !== "object") {
        return null;
      }

      const text = cleanString(data.text || data.transcript || data.content);
      const segments = sanitizeSegments(data.segments || data.captions || [], 12000);
      const normalizedSegments = segments.length
        ? segments
        : deriveSegmentsFromText(text, Number(data.durationSeconds || durationSeconds || 0));
      return {
        text,
        language: cleanString(data.language, "unknown"),
        segments: normalizedSegments
      };
    } catch (_) {
      return null;
    }
  }

  return null;
}

function parseSubtitles(rawText) {
  const lines = String(rawText || "")
    .replace(/\r/g, "")
    .split("\n");

  const segments = [];
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx].trim();

    if (!line) {
      idx += 1;
      continue;
    }

    if (/^\d+$/.test(line)) {
      idx += 1;
      continue;
    }

    const timeMatch = line.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
    if (!timeMatch) {
      idx += 1;
      continue;
    }

    const start = subtitleTimeToSeconds(timeMatch[1]);
    const end = subtitleTimeToSeconds(timeMatch[2]);
    idx += 1;

    const textLines = [];
    while (idx < lines.length && lines[idx].trim()) {
      textLines.push(lines[idx].trim());
      idx += 1;
    }

    const text = cleanString(textLines.join(" "));
    if (text) {
      segments.push({
        start: Number(start.toFixed(2)),
        end: Number(end.toFixed(2)),
        text
      });
    }
  }

  return sanitizeSegments(segments, 12000);
}

function subtitleTimeToSeconds(value) {
  const clean = cleanString(value).replace(",", ".");
  const pieces = clean.split(":");
  if (pieces.length !== 3) {
    return 0;
  }
  const hours = Number(pieces[0] || 0);
  const minutes = Number(pieces[1] || 0);
  const seconds = Number(pieces[2] || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return 0;
  }
  return (hours * 3600) + (minutes * 60) + seconds;
}

function sanitizeSegments(value, maxSegments) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, maxSegments)
    .map((segment) => ({
      start: Number(segment.start || 0),
      end: Number(segment.end || segment.start || 0),
      text: cleanString(segment.text)
    }))
    .filter((segment) => segment.text)
    .map((segment) => ({
      start: Number(segment.start.toFixed(2)),
      end: Number(Math.max(segment.end, segment.start).toFixed(2)),
      text: segment.text
    }));
}

function deriveSegmentsFromText(text, durationSeconds) {
  const clean = cleanString(text);
  if (!clean) {
    return [];
  }

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((part) => cleanString(part))
    .filter(Boolean);
  const parts = sentences.length ? sentences : [clean];
  const totalDuration = Math.max(Number(durationSeconds || 0), parts.length * 4);
  const step = totalDuration / parts.length;

  return parts.map((part, idx) => ({
    start: Number((idx * step).toFixed(2)),
    end: Number(((idx + 1) * step).toFixed(2)),
    text: part
  }));
}

function probeDurationSeconds(filePath) {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ],
    {
      encoding: "utf8"
    }
  );

  if (result.status !== 0) {
    return 0;
  }

  const value = Number(cleanString(result.stdout));
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Number(value.toFixed(2));
}

function deriveMetadata(baseName) {
  const normalized = cleanString(baseName)
    .replace(/^YTDown\.com_YouTube_/i, "")
    .replace(/^YouTube_/i, "")
    .replace(/_Media_[A-Za-z0-9]{6,20}/gi, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\b\d{3,4}p\b/gi, " ")
    .replace(/\b\d{3}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const title = titleCase(normalized);
  const lower = normalized.toLowerCase();
  const tags = [];

  if (/\blogos\b/i.test(normalized)) tags.push("Logos");
  if (/\bsermon|preach|homiletics\b/i.test(normalized)) tags.push("Sermon Prep");
  if (/\bresearch|paper|bibliography|citation\b/i.test(normalized)) tags.push("Research");
  if (/\bgreek|hebrew|syntax|morphology|word study\b/i.test(normalized)) tags.push("Original Languages");
  if (/\bai|assistant|new logos\b/i.test(normalized)) tags.push("AI");
  if (/\bbible study|study\b/i.test(normalized)) tags.push("Bible Study");
  if (/\bworkflow|setup\b/i.test(normalized)) tags.push("Workflow");

  const versionMatch = normalized.match(/\blogos\s*(\d{1,2})\b/i);
  const logosVersion = versionMatch
    ? `Logos ${versionMatch[1]}`
    : /\bnew logos\b/i.test(normalized)
      ? "Logos 10"
      : "General";

  let category = "Logos Basics";
  if (/\bsermon|preach|homiletics\b/i.test(lower)) {
    category = "Sermon Prep";
  } else if (/\bgreek|hebrew|syntax|word study|morphology\b/i.test(lower)) {
    category = "Original Languages";
  } else if (/\bresearch|paper|citation|bibliography\b/i.test(lower)) {
    category = "Research";
  } else if (/\bai\b|new logos/.test(lower)) {
    category = "AI Features";
  }

  let difficulty = "Intermediate";
  if (/\bbeginner|intro|introduction|start|basics\b/i.test(lower)) {
    difficulty = "Beginner";
  } else if (/\badvanced|expert|research|syntax|morphology|deep\b/i.test(lower)) {
    difficulty = "Advanced";
  }

  const topic = category === "Sermon Prep"
    ? "Sermon Workflow"
    : category === "Original Languages"
      ? "Word Study"
      : category === "Research"
        ? "Academic Research"
        : "Logos Training";

  const termTags = normalized
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4)
    .slice(0, 8);

  return {
    title: title || cleanString(baseName),
    category,
    topic,
    logosVersion,
    difficulty,
    tags: mergeTags(tags, termTags)
  };
}

function mergeTags(primary, secondary) {
  const all = [...toStringArray(primary), ...toStringArray(secondary)];
  const seen = new Set();
  const output = [];

  for (const tag of all) {
    const clean = cleanString(tag);
    if (!clean) {
      continue;
    }

    const key = clean.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(clean);
    if (output.length >= 20) {
      break;
    }
  }

  return output;
}

function toStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => cleanString(item)).filter(Boolean);
}

function slugify(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function titleCase(value) {
  return cleanString(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toPosix(filePath) {
  return String(filePath || "").split(path.sep).join("/");
}

function deriveHostedUrl({
  persistedHostedUrl = "",
  relativePath = "",
  fileName = ""
}) {
  const explicit = cleanString(persistedHostedUrl);
  if (explicit) {
    return explicit;
  }

  const baseUrl = cleanString(process.env.VIDEO_PUBLIC_BASE_URL);
  if (!baseUrl) {
    return "";
  }

  const mode = cleanString(process.env.VIDEO_PUBLIC_PATH_MODE, "relative").toLowerCase();
  const stripPrefix = normalizeStripPrefix(
    cleanString(process.env.VIDEO_PUBLIC_STRIP_PREFIX, DEFAULT_VIDEO_PUBLIC_STRIP_PREFIX)
  );

  let targetPath = "";
  if (mode === "basename") {
    targetPath = cleanString(fileName);
  } else if (mode === "none") {
    targetPath = "";
  } else {
    targetPath = toPosix(relativePath).replace(/^\/+/, "");
    if (stripPrefix) {
      const stripLower = stripPrefix.toLowerCase();
      const targetLower = targetPath.toLowerCase();
      if (targetLower === stripLower) {
        targetPath = "";
      } else if (targetLower.startsWith(`${stripLower}/`)) {
        targetPath = targetPath.slice(stripPrefix.length + 1);
      }
    }
  }

  return joinUrlPath(baseUrl, targetPath);
}

function joinUrlPath(baseUrl, targetPath) {
  const base = cleanString(baseUrl).replace(/\/+$/, "");
  if (!base) {
    return "";
  }

  const normalizedTarget = toPosix(cleanString(targetPath)).replace(/^\/+/, "");
  if (!normalizedTarget) {
    return base;
  }

  const encodedTarget = normalizedTarget
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${base}/${encodedTarget}`;
}

function normalizeStripPrefix(value) {
  return toPosix(cleanString(value))
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function cleanString(value, fallback = "") {
  if (typeof value === "string") {
    const normalized = sanitizeBrandingText(value).trim();
    return normalized || fallback;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  const normalized = sanitizeBrandingText(String(value)).trim();
  return normalized || fallback;
}

function sanitizeBrandingText(value) {
  return String(value || "")
    .replace(/learnlogos\.com/gi, "Bible AI Hub")
    .replace(/\blearnlogos\b/gi, "Bible AI Hub");
}

module.exports = {
  VIDEO_LIBRARY,
  hydrateVideoLibrary,
  saveVideoLibraryIndex,
  setVideoTranscript,
  setVideoTranscriptionError,
  getVideoLibraryStats,
  durationToSeconds,
  secondsToDuration,
  videoSearchDocument
};
