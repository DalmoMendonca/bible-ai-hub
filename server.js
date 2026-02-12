const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const express = require("express");
const multer = require("multer");
const {
  VIDEO_LIBRARY,
  hydrateVideoLibrary,
  setVideoTranscript,
  setVideoTranscriptionError,
  getVideoLibraryStats,
  durationToSeconds,
  videoSearchDocument
} = require("./server/video-library");
const { createBibleStudyWorkflow } = require("./server/bible-study-workflow");
const {
  buildSermonPreparationPrompt,
  buildTeachingToolsPrompt,
  buildResearchHelperPrompt,
  buildVideoSearchGuidancePrompt,
  buildSermonInsightsPrompt
} = require("./server/prompts");

const ROOT_DIR = resolveRootDir();
const OPENAI_BASE_URL = "https://api.openai.com/v1";

loadEnvFile(path.join(ROOT_DIR, ".env"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";
const OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
const OPENAI_BIBLE_STUDY_MODEL = process.env.OPENAI_BIBLE_STUDY_MODEL || "gpt-4.1-nano";
const OPENAI_BIBLE_STUDY_MAX_TOKENS = Number(process.env.OPENAI_BIBLE_STUDY_MAX_TOKENS || 1800);
const OPENAI_LONG_FORM_MODEL = process.env.OPENAI_LONG_FORM_MODEL || "gpt-4.1-nano";
const OPENAI_RETRY_ATTEMPTS = Number(process.env.OPENAI_RETRY_ATTEMPTS || 4);
const OPENAI_RETRY_BASE_MS = Number(process.env.OPENAI_RETRY_BASE_MS || 650);
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "6mb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 70 * 1024 * 1024
  }
});

let videoEmbeddingCache = { key: "", vectors: [] };
const segmentEmbeddingCache = new Map();
const videoTranscriptionJobs = new Map();
const LEGACY_APP_SLUGS = [
  "bible-study",
  "sermon-preparation",
  "teaching-tools",
  "research-helper",
  "sermon-analyzer",
  "video-search"
];
const bibleStudyWorkflow = createBibleStudyWorkflow({
  chatJson: (payload) => chatJson({
    ...payload,
    model: OPENAI_BIBLE_STUDY_MODEL,
    maxTokens: OPENAI_BIBLE_STUDY_MAX_TOKENS
  }),
  cleanString,
  cleanArray,
  cleanObjectArray
});

ensureVideoCatalog({ force: true, maxAgeMs: 0 });

app.get("/api/health", (_req, res) => {
  ensureVideoCatalog();
  const stats = getVideoLibraryStats();
  res.json({
    ok: true,
    openaiConfigured: Boolean(OPENAI_API_KEY),
    chatModel: OPENAI_CHAT_MODEL,
    embedModel: OPENAI_EMBED_MODEL,
    transcribeModel: OPENAI_TRANSCRIBE_MODEL,
    catalogSize: stats.totalVideos,
    transcribedVideos: stats.transcribedVideos,
    pendingVideos: stats.pendingVideos
  });
});

app.get("/api/video-library/status", asyncHandler(async (req, res) => {
  const force = String(req.query.refresh || "").toLowerCase() === "true";
  ensureVideoCatalog({ force });
  const stats = getVideoLibraryStats();

  res.json({
    stats,
    videos: VIDEO_LIBRARY.map((video) => {
      const playbackBaseUrl = resolveVideoPlaybackBaseUrl(video);
      return {
        id: video.id,
        title: video.title,
        category: video.category,
        topic: video.topic,
        difficulty: video.difficulty,
        logosVersion: video.logosVersion,
        duration: video.duration,
        durationSeconds: video.durationSeconds,
        transcriptStatus: video.transcriptStatus,
        transcriptionUpdatedAt: video.transcriptionUpdatedAt,
        tags: video.tags,
        sourceAvailable: video.sourceAvailable !== false,
        hostedUrl: cleanString(video.hostedUrl),
        playbackUrl: playbackBaseUrl,
        url: buildTimestampedPlaybackUrl(playbackBaseUrl, 0)
      };
    })
  });
}));

app.post("/api/video-library/ingest-next", requireOpenAIKey, asyncHandler(async (req, res) => {
  const input = req.body || {};
  const maxVideos = clampNumber(Number(input.maxVideos || 1), 1, 4, 1);
  const dryRun = Boolean(input.dryRun);
  ensureVideoCatalog({ force: Boolean(input.refreshCatalog), maxAgeMs: 0 });

  const pending = VIDEO_LIBRARY
    .filter((video) => video.transcriptStatus !== "ready")
    .filter((video) => video.sourceAvailable !== false)
    .sort((a, b) => Number(a.durationSeconds || 0) - Number(b.durationSeconds || 0));
  const unavailable = VIDEO_LIBRARY
    .filter((video) => video.transcriptStatus !== "ready")
    .filter((video) => video.sourceAvailable === false)
    .map((video) => ({
      id: video.id,
      title: video.title,
      reason: "Source file is not available on this server instance."
    }));

  if (!pending.length) {
    res.json({
      ok: true,
      message: unavailable.length
        ? "No locally available pending videos. Run ingestion on the machine that has source video files."
        : "No pending videos for ingestion.",
      processed: [],
      failed: [],
      unavailable,
      stats: getVideoLibraryStats()
    });
    return;
  }

  const targets = pending.slice(0, maxVideos);
  if (dryRun) {
    res.json({
      ok: true,
      dryRun: true,
      targets: targets.map((video) => ({
        id: video.id,
        title: video.title,
        duration: video.duration
      })),
      unavailable,
      stats: getVideoLibraryStats()
    });
    return;
  }

  const processed = [];
  const failed = [];

  for (const video of targets) {
    try {
      await ensureVideoTranscriptReady(video.id);
      processed.push({
        id: video.id,
        title: video.title,
        duration: video.duration
      });
    } catch (error) {
      failed.push({
        id: video.id,
        title: video.title,
        error: cleanString(error && error.message, "Transcription failed")
      });
    }
  }

  ensureVideoCatalog({ force: true, maxAgeMs: 0 });
  res.json({
    ok: failed.length === 0,
    processed,
    failed,
    unavailable,
    stats: getVideoLibraryStats()
  });
}));

app.post("/api/ai/bible-study", requireOpenAIKey, asyncHandler(async (req, res) => {
  const input = req.body || {};
  const passage = input.passage || {};

  const reference = cleanString(passage.reference || input.reference, "Unknown reference");
  const text = cleanString(passage.text || input.text);
  const focus = cleanString(input.focus);
  const question = cleanString(input.question);
  const translation = cleanString(passage.translation_name, "WEB");

  if (!text) {
    res.status(400).json({ error: "Passage text is required." });
    return;
  }

  const response = await bibleStudyWorkflow.generateStudy({
    passage: {
      reference,
      text,
      translation
    },
    focus,
    question
  });
  res.json(response);
}));

app.post("/api/ai/sermon-preparation", requireOpenAIKey, asyncHandler(async (req, res) => {
  const input = req.body || {};
  const passage = input.passage || {};

  const reference = cleanString(passage.reference || input.reference, "Unknown reference");
  const text = cleanString(passage.text || input.text);
  const audience = cleanString(input.audience, "Sunday congregation");
  const minutes = clampNumber(Number(input.minutes || 30), 8, 90, 30);
  const theme = cleanString(input.theme);
  const goal = cleanString(input.goal);

  const sermonPlanPrompt = buildSermonPreparationPrompt({
    passage: { reference, text },
    audience,
    minutes,
    theme,
    goal
  });
  const ai = await chatJson({
    ...sermonPlanPrompt,
    temperature: 0.4
  });

  const outline = cleanObjectArray(ai.outline, 4)
    .map((item) => ({
      heading: cleanString(item.heading),
      explanation: cleanString(item.explanation),
      application: cleanString(item.application),
      supportingReferences: cleanArray(item.supportingReferences, 4)
    }))
    .filter((item) => item.heading || item.explanation || item.application);

  const timingPlan = cleanObjectArray(ai.timingPlan, 6)
    .map((item) => ({
      segment: cleanString(item.segment),
      minutes: clampNumber(Number(item.minutes), 1, 90, null),
      purpose: cleanString(item.purpose)
    }))
    .filter((item) => item.segment);

  res.json({
    bigIdea: cleanString(ai.bigIdea),
    titleOptions: cleanArray(ai.titleOptions, 5),
    outline,
    transitions: cleanArray(ai.transitions, 6),
    applications: cleanArray(ai.applications, 6),
    illustrations: cleanArray(ai.illustrations, 6),
    timingPlan
  });
}));

app.post("/api/ai/teaching-tools", requireOpenAIKey, asyncHandler(async (req, res) => {
  const input = req.body || {};

  const sourceTitle = cleanString(input.sourceTitle, "Bible Lesson");
  const passageText = cleanString(input.passageText);
  const audience = cleanString(input.audience, "Adults");
  const length = clampNumber(Number(input.length || 45), 15, 120, 45);
  const setting = cleanString(input.setting, "Small group");
  const groupSize = clampNumber(Number(input.groupSize || 12), 1, 300, 12);
  const resources = cleanString(input.resources);
  const outcome = cleanString(input.outcome);
  const notes = cleanString(input.notes);

  const teachingKitPrompt = buildTeachingToolsPrompt({
    sourceTitle,
    passageText,
    audience,
    setting,
    groupSize,
    resources,
    length,
    outcome,
    notes
  });
  const ai = await chatJson({
    ...teachingKitPrompt,
    temperature: 0.35,
    model: OPENAI_LONG_FORM_MODEL,
    maxTokens: 1700
  });

  const lessonPlanRaw = ai.lessonPlan && typeof ai.lessonPlan === "object" ? ai.lessonPlan : {};
  const ageRaw = ai.ageAppropriateContent && typeof ai.ageAppropriateContent === "object"
    ? ai.ageAppropriateContent
    : {};
  const dqRaw = ai.discussionQuestions && typeof ai.discussionQuestions === "object"
    ? ai.discussionQuestions
    : {};
  const appRaw = ai.applicationPathways && typeof ai.applicationPathways === "object"
    ? ai.applicationPathways
    : {};

  const sessionTimeline = cleanObjectArray(lessonPlanRaw.sessionTimeline, 8)
    .map((row) => ({
      segment: cleanString(row.segment),
      minutes: clampNumber(Number(row.minutes), 1, 120, null),
      plan: cleanString(row.plan)
    }))
    .filter((row) => row.segment || row.plan);

  const illustrationIdeas = cleanObjectArray(ai.illustrationIdeas, 6)
    .map((row) => ({
      title: cleanString(row.title),
      description: cleanString(row.description),
      connection: cleanString(row.connection)
    }))
    .filter((row) => row.title || row.description);

  res.json({
    overview: cleanString(ai.overview),
    centralTruth: cleanString(ai.centralTruth),
    lessonPlan: {
      title: cleanString(lessonPlanRaw.title),
      keyVerse: cleanString(lessonPlanRaw.keyVerse),
      objectives: cleanArray(lessonPlanRaw.objectives, 7),
      sessionTimeline
    },
    ageAppropriateContent: {
      chosenAudienceExplanation: cleanString(ageRaw.chosenAudienceExplanation),
      simplifiedExplanation: cleanString(ageRaw.simplifiedExplanation),
      vocabularyToExplain: cleanArray(ageRaw.vocabularyToExplain, 8),
      differentiationTips: cleanArray(ageRaw.differentiationTips, 8)
    },
    discussionQuestions: {
      icebreakers: cleanArray(dqRaw.icebreakers, 5),
      observation: cleanArray(dqRaw.observation, 5),
      interpretation: cleanArray(dqRaw.interpretation, 5),
      application: cleanArray(dqRaw.application, 5),
      challenge: cleanArray(dqRaw.challenge, 5)
    },
    illustrationIdeas,
    applicationPathways: {
      personal: cleanArray(appRaw.personal, 6),
      family: cleanArray(appRaw.family, 6),
      church: cleanArray(appRaw.church, 6),
      mission: cleanArray(appRaw.mission, 6)
    },
    visualsAndMedia: cleanArray(ai.visualsAndMedia, 8),
    printableHandout: cleanArray(ai.printableHandout, 10),
    leaderCoaching: cleanArray(ai.leaderCoaching, 8),
    closingPrayerPrompt: cleanString(ai.closingPrayerPrompt),
    takeHomeChallenge: cleanString(ai.takeHomeChallenge)
  });
}));

app.post("/api/ai/research-helper", requireOpenAIKey, asyncHandler(async (req, res) => {
  const input = req.body || {};
  const manuscript = cleanString(input.manuscript);

  if (!manuscript) {
    res.status(400).json({ error: "Sermon manuscript is required." });
    return;
  }

  const researchPrompt = buildResearchHelperPrompt({
    sermonType: cleanString(input.sermonType, "Expository"),
    targetMinutes: clampNumber(Number(input.targetMinutes || 35), 8, 90, 35),
    diagnostics: input.diagnostics || {},
    manuscript
  });
  const ai = await chatJson({
    ...researchPrompt,
    temperature: 0.35
  });

  const scores = cleanObjectArray(ai.scores, 6)
    .map((row) => ({
      label: cleanString(row.label),
      score: clampNumber(Number(row.score), 0, 10, 0),
      rationale: cleanString(row.rationale)
    }))
    .filter((row) => row.label);

  res.json({
    overallVerdict: cleanString(ai.overallVerdict),
    scores,
    strengths: cleanArray(ai.strengths, 6),
    gaps: cleanArray(ai.gaps, 7),
    revisions: cleanArray(ai.revisions, 8),
    tightenLines: cleanArray(ai.tightenLines, 4)
  });
}));

app.post("/api/ai/sermon-analyzer", requireOpenAIKey, upload.single("audio"), asyncHandler(async (req, res) => {
  const context = cleanString(req.body && req.body.context, "General sermon context");
  const goal = cleanString(req.body && req.body.goal);
  const notes = cleanString(req.body && req.body.notes);
  const transcriptOverride = cleanString(req.body && req.body.transcriptOverride);
  const localAnalysis = safeJsonParse(req.body && req.body.localAnalysis, {});

  const orchestration = [];
  const startedAt = Date.now();

  if (!req.file && !transcriptOverride) {
    res.status(400).json({ error: "Upload audio (or provide transcript override) to run sermon analyzer." });
    return;
  }

  let transcript;
  const transcriptionStart = Date.now();
  try {
    if (req.file) {
      transcript = await transcriptionAgent(req.file);
      let transcriptionStatus = "completed";
      let transcriptionNote = `Model: ${OPENAI_TRANSCRIBE_MODEL}`;
      if (!cleanString(transcript.text) && transcriptOverride) {
        transcript = transcriptFromManualText(transcriptOverride, Number(localAnalysis.durationSeconds || transcript.durationSeconds || 0));
        transcriptionStatus = "degraded";
        transcriptionNote = "Transcription returned empty text, switched to manual transcript override";
      }
      orchestration.push({
        agent: "transcription_agent",
        status: transcriptionStatus,
        durationMs: Date.now() - transcriptionStart,
        note: transcriptionNote
      });
    } else {
      transcript = transcriptFromManualText(transcriptOverride, Number(localAnalysis.durationSeconds || 0));
      orchestration.push({
        agent: "transcription_agent",
        status: "completed",
        durationMs: Date.now() - transcriptionStart,
        note: "Used manual transcript override"
      });
    }
  } catch (error) {
    if (transcriptOverride) {
      transcript = transcriptFromManualText(transcriptOverride, Number(localAnalysis.durationSeconds || 0));
      orchestration.push({
        agent: "transcription_agent",
        status: "degraded",
        durationMs: Date.now() - transcriptionStart,
        note: `Transcription failed, used manual transcript (${cleanString(error.message)})`
      });
    } else {
      throw error;
    }
  }

  const pacingAnalysis = computePacingAnalysis(transcript, localAnalysis);
  const vocalDynamics = computeVocalDynamics(localAnalysis);

  const insights = await sermonInsightsAgent({
    context,
    goal,
    notes,
    transcript,
    pacingAnalysis,
    vocalDynamics,
    localAnalysis
  });

  orchestration.push({
    agent: "insights_agent",
    status: "completed",
    durationMs: insights.durationMs,
    note: "Generated emotional arc, content analysis, and coaching feedback"
  });

  res.json({
    meta: {
      fileName: req.file ? cleanString(req.file.originalname) : "manual-transcript",
      durationSeconds: Number((transcript.durationSeconds || 0).toFixed(2)),
      transcriptionModel: OPENAI_TRANSCRIBE_MODEL,
      generatedAt: new Date().toISOString(),
      totalPipelineMs: Date.now() - startedAt
    },
    orchestration,
    transcript: {
      text: cleanString(transcript.text),
      language: cleanString(transcript.language, "unknown"),
      wordCount: tokenize(transcript.text).length,
      segments: transcript.segments
    },
    emotionalArc: {
      points: insights.emotionArc.points,
      summary: cleanString(insights.emotionArc.summary)
    },
    pacingAnalysis,
    vocalDynamics,
    contentAnalysis: insights.contentAnalysis.report,
    coachingFeedback: insights.coaching.report
  });
}));

app.post("/api/ai/video-search", requireOpenAIKey, asyncHandler(async (req, res) => {
  const input = req.body || {};
  const query = cleanString(input.query);
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const category = cleanString(input.category || filters.category, "all");
  const difficulty = cleanString(input.difficulty || filters.difficulty, "all");
  const logosVersion = cleanString(input.logosVersion || filters.logosVersion, "all");
  const maxMinutes = clampNumber(Number(input.maxMinutes || filters.maxMinutes || 0), 0, 600, 0);
  const sortMode = cleanString(input.sortMode, "relevance");
  const forceRefresh = Boolean(input.refreshCatalog);
  const autoTranscribe = input.autoTranscribe !== false;
  const requestedMode = cleanString(input.transcribeMode);
  const transcribeMode = requestedMode === "force"
    ? "force"
    : (!autoTranscribe || requestedMode === "skip" || requestedMode === "off")
      ? "skip"
      : "auto";
  const autoTranscribeMaxMinutes = clampNumber(
    Number(input.autoTranscribeMaxMinutes || 35),
    5,
    240,
    35
  );
  const maxAutoTranscribeVideos = clampNumber(
    Number(input.maxAutoTranscribeVideos || (transcribeMode === "force" ? 2 : 1)),
    1,
    4,
    transcribeMode === "force" ? 2 : 1
  );

  if (!query) {
    res.status(400).json({ error: "Enter a search query." });
    return;
  }

  ensureVideoCatalog({ force: forceRefresh });

  const filterSet = { category, difficulty, logosVersion, maxMinutes };
  let filteredRows = applyVideoFilters(VIDEO_LIBRARY, filterSet);
  const preStats = getVideoLibraryStats();
  if (!filteredRows.length) {
    res.json({
      results: [],
      relatedContent: [],
      guidance: "No videos are available for the current filter combination.",
      suggestedQueries: [],
      stats: preStats,
      ingestion: {
        mode: transcribeMode,
        attempted: [],
        completed: [],
        failed: []
      }
    });
    return;
  }

  const ingestion = await transcribeMissingVideosForSearch(filteredRows, {
    mode: transcribeMode,
    autoTranscribeMaxMinutes,
    maxAutoTranscribeVideos
  });

  ensureVideoCatalog({ force: ingestion.completed.length > 0, maxAgeMs: 0 });
  filteredRows = applyVideoFilters(VIDEO_LIBRARY, filterSet);
  if (!filteredRows.length) {
    res.json({
      results: [],
      relatedContent: [],
      guidance: "Filters currently exclude every discovered video.",
      suggestedQueries: [],
      stats: getVideoLibraryStats(),
      ingestion
    });
    return;
  }

  let queryEmbedding = [];
  let corpusEmbeddings = [];
  let semanticSearchEnabled = true;

  try {
    queryEmbedding = await fetchEmbeddings([query]).then((data) => data[0]);
    corpusEmbeddings = await ensureVideoEmbeddings();
  } catch (_) {
    semanticSearchEnabled = false;
  }

  const catalogIndex = new Map(VIDEO_LIBRARY.map((video, idx) => [video.id, idx]));
  const queryTerms = tokenize(query);

  const scored = filteredRows
    .map((video) => {
      const idx = catalogIndex.get(video.id);
      const semantic = semanticSearchEnabled
        ? Math.max(0, cosineSimilarity(queryEmbedding, corpusEmbeddings[idx] || []))
        : 0;
      const lexical = lexicalScoreVideo(video, queryTerms);
      const transcriptBoost = video.transcriptStatus === "ready" ? 0.06 : -0.02;
      const score = semanticSearchEnabled
        ? semantic * 0.76 + lexical * 0.2 + transcriptBoost
        : lexical * 0.88 + (transcriptBoost * 0.5);

      return {
        ...video,
        score,
        semantic,
        lexical
      };
    })
    .filter((row) => row.score > 0.01);

  let sorted = scored;
  if (sortMode === "duration") {
    sorted = [...sorted].sort((a, b) => Number(a.durationSeconds || 0) - Number(b.durationSeconds || 0));
  } else if (sortMode === "title") {
    sorted = [...sorted].sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortMode === "newest") {
    sorted = [...sorted].sort((a, b) => Number(b.fileMtimeMs || 0) - Number(a.fileMtimeMs || 0));
  } else {
    sorted = [...sorted].sort((a, b) => b.score - a.score);
  }

  const topRows = sorted.slice(0, 8);
  const chunkCandidates = topRows.flatMap((video) => buildVideoSearchChunks(video, 26)
    .map((chunk) => ({ ...chunk, video })));
  let chunkEmbeddings = [];
  let chunkSemanticEnabled = semanticSearchEnabled;
  if (chunkSemanticEnabled && chunkCandidates.length) {
    try {
      chunkEmbeddings = await ensureChunkEmbeddings(chunkCandidates);
    } catch (_) {
      chunkSemanticEnabled = false;
    }
  }

  const scoredChunks = chunkCandidates
    .map((chunk, idx) => {
      const semantic = chunkSemanticEnabled
        ? Math.max(0, cosineSimilarity(queryEmbedding, chunkEmbeddings[idx] || []))
        : 0;
      const lexical = lexicalScoreText(chunk.text, queryTerms);
      const chunkScore = chunkSemanticEnabled
        ? semantic * 0.8 + lexical * 0.2
        : lexical;
      const score = (chunk.video.score * 0.3) + (chunkScore * 0.7);

      return {
        ...chunk,
        score,
        chunkScore,
        semantic,
        lexical
      };
    })
    .sort((a, b) => b.score - a.score);

  const videoHitCounter = new Map();
  const results = [];

  for (const row of scoredChunks) {
    const currentCount = Number(videoHitCounter.get(row.video.id) || 0);
    if (currentCount >= 3) {
      continue;
    }

    videoHitCounter.set(row.video.id, currentCount + 1);
    const playbackBaseUrl = resolveVideoPlaybackBaseUrl(row.video);
    results.push({
      id: `${row.video.id}:${Math.floor(row.start)}`,
      videoId: row.video.id,
      title: row.video.title,
      category: row.video.category,
      topic: row.video.topic,
      difficulty: row.video.difficulty,
      logosVersion: row.video.logosVersion,
      duration: row.video.duration,
      durationSeconds: row.video.durationSeconds,
      transcriptStatus: row.video.transcriptStatus,
      timestamp: formatMediaTimestamp(row.start),
      timestampSeconds: Number(row.start.toFixed(2)),
      endTimestamp: formatMediaTimestamp(row.end),
      endSeconds: Number(row.end.toFixed(2)),
      snippet: cleanString(row.text).slice(0, 420),
      tags: row.video.tags,
      playbackUrl: playbackBaseUrl,
      hostedUrl: cleanString(row.video.hostedUrl),
      sourceAvailable: row.video.sourceAvailable !== false,
      url: buildTimestampedPlaybackUrl(playbackBaseUrl, row.start),
      why: cleanString(buildMatchReason(row, queryTerms)),
      score: Number((row.score * 100).toFixed(2))
    });

    if (results.length >= 12) {
      break;
    }
  }

  if (!results.length) {
    for (const video of topRows) {
      const playbackBaseUrl = resolveVideoPlaybackBaseUrl(video);
      results.push({
        id: `${video.id}:0`,
        videoId: video.id,
        title: video.title,
        category: video.category,
        topic: video.topic,
        difficulty: video.difficulty,
        logosVersion: video.logosVersion,
        duration: video.duration,
        durationSeconds: video.durationSeconds,
        transcriptStatus: video.transcriptStatus,
        timestamp: "0:00",
        timestampSeconds: 0,
        endTimestamp: formatMediaTimestamp(Math.min(60, Number(video.durationSeconds || 0))),
        endSeconds: Math.min(60, Number(video.durationSeconds || 0)),
        snippet: cleanString(video.transcriptText || videoSearchDocument(video)).slice(0, 320),
        tags: video.tags,
        playbackUrl: playbackBaseUrl,
        hostedUrl: cleanString(video.hostedUrl),
        sourceAvailable: video.sourceAvailable !== false,
        url: buildTimestampedPlaybackUrl(playbackBaseUrl, 0),
        why: "Matched by title/tags metadata while transcript indexing is still in progress.",
        score: Number((video.score * 100).toFixed(2))
      });
      if (results.length >= 10) {
        break;
      }
    }
  }

  const relatedContent = buildRelatedContent(sorted, topRows.map((row) => row.id), queryTerms);

  let guidanceText = "";
  let suggestedQueries = [];

  try {
    const guidancePrompt = buildVideoSearchGuidancePrompt({
      query,
      topMatches: results.slice(0, 6).map((row) => ({
        title: row.title,
        timestamp: row.timestamp,
        category: row.category,
        topic: row.topic,
        difficulty: row.difficulty
      }))
    });
    const guidance = await chatJson({
      ...guidancePrompt,
      temperature: 0.35
    });

    guidanceText = cleanString(guidance.guidance);
    suggestedQueries = cleanArray(guidance.suggestedQueries, 6);
  } catch (_) {
    guidanceText = "";
    suggestedQueries = [];
  }

  if (!guidanceText) {
    guidanceText = buildGuidanceFallback(query, results);
  }
    if (!suggestedQueries.length) {
      suggestedQueries = buildSuggestedQueriesFallback(query, results);
    }

  const rankingMode = chunkSemanticEnabled ? "semantic+lexical" : "lexical-fallback";
  res.json({
    stats: getVideoLibraryStats(),
    ingestion,
    filters: filterSet,
    rankingMode,
    results,
    relatedContent,
    guidance: guidanceText,
    suggestedQueries
  });
}));

for (const slug of LEGACY_APP_SLUGS) {
  app.get(`/ai/${slug}`, (_req, res) => {
    res.redirect(302, `/ai/apps/${slug}/`);
  });
  app.get(`/ai/${slug}/`, (_req, res) => {
    res.redirect(302, `/ai/apps/${slug}/`);
  });
}

app.use(express.static(ROOT_DIR));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Route not found." });
    return;
  }

  res.status(404).sendFile(path.join(ROOT_DIR, "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    const status = OPENAI_API_KEY ? "configured" : "missing";
    console.log(`Bible AI Hub server running on http://localhost:${PORT}`);
    console.log(`OpenAI key status: ${status}`);
  });
}

function resolveRootDir() {
  const candidates = [
    __dirname,
    process.cwd(),
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "..", ".."),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "..", "..")
  ];
  const seen = new Set();

  for (const rawCandidate of candidates) {
    const candidate = path.resolve(rawCandidate);
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    const hasAppShell = fs.existsSync(path.join(candidate, "ai", "index.html"));
    const hasVideoIndex = fs.existsSync(path.join(candidate, "server", "data", "video-library-index.json"));
    if (hasAppShell || hasVideoIndex) {
      return candidate;
    }
  }

  return __dirname;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

module.exports = {
  app
};

function requireOpenAIKey(_req, res, next) {
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: "OPENAI_API_KEY is missing in .env" });
    return;
  }

  next();
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      const message = cleanString(error && error.message, "Unexpected server error");
      const status = error && error.status ? error.status : 500;
      res.status(status).json({ error: message });
    });
  };
}

async function chatJson({ system, user, temperature = 0.3, model = OPENAI_CHAT_MODEL, maxTokens = 0 }) {
  const payload = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature,
    response_format: { type: "json_object" }
  };
  if (Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0) {
    payload.max_tokens = Math.floor(Number(maxTokens));
  }

  const data = await openAIRequest("/chat/completions", payload);
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "{}";

  return parseJsonObject(content);
}

async function fetchEmbeddings(texts) {
  const payload = {
    model: OPENAI_EMBED_MODEL,
    input: texts
  };

  const data = await openAIRequest("/embeddings", payload);
  return Array.isArray(data.data) ? data.data.map((item) => item.embedding || []) : [];
}

async function fetchEmbeddingsInBatches(texts, batchSize = 64) {
  const rows = Array.isArray(texts) ? texts : [];
  if (!rows.length) {
    return [];
  }

  const output = [];
  for (let idx = 0; idx < rows.length; idx += batchSize) {
    const batch = rows.slice(idx, idx + batchSize);
    const vectors = await fetchEmbeddings(batch);
    for (const vector of vectors) {
      output.push(vector || []);
    }
  }

  return output;
}

function buildCatalogCacheKey(rows) {
  return `${OPENAI_EMBED_MODEL}|${rows
    .map((row) => [
      cleanString(row.id),
      Number(row.fileMtimeMs || 0),
      cleanString(row.transcriptionUpdatedAt),
      cleanString(row.transcriptStatus)
    ].join(":"))
    .join("|")}`;
}

function ensureVideoCatalog(options = {}) {
  const before = buildCatalogCacheKey(VIDEO_LIBRARY);
  hydrateVideoLibrary(ROOT_DIR, options);
  const after = buildCatalogCacheKey(VIDEO_LIBRARY);

  if (before !== after) {
    videoEmbeddingCache = { key: "", vectors: [] };
    segmentEmbeddingCache.clear();
  }

  return VIDEO_LIBRARY;
}

async function ensureVideoEmbeddings() {
  ensureVideoCatalog();
  const key = buildCatalogCacheKey(VIDEO_LIBRARY);

  if (
    videoEmbeddingCache.key === key
    && Array.isArray(videoEmbeddingCache.vectors)
    && videoEmbeddingCache.vectors.length === VIDEO_LIBRARY.length
  ) {
    return videoEmbeddingCache.vectors;
  }

  const docs = VIDEO_LIBRARY.map((video) => videoSearchDocument(video));
  const vectors = await fetchEmbeddingsInBatches(docs, 48);
  videoEmbeddingCache = { key, vectors };
  return vectors;
}

function applyVideoFilters(videos, filters) {
  const category = cleanString(filters.category, "all").toLowerCase();
  const difficulty = cleanString(filters.difficulty, "all").toLowerCase();
  const logosVersion = cleanString(filters.logosVersion, "all").toLowerCase();
  const maxMinutes = Number(filters.maxMinutes || 0);

  return videos.filter((video) => {
    if (category !== "all" && cleanString(video.category).toLowerCase() !== category) {
      return false;
    }
    if (difficulty !== "all" && cleanString(video.difficulty).toLowerCase() !== difficulty) {
      return false;
    }
    if (logosVersion !== "all" && cleanString(video.logosVersion).toLowerCase() !== logosVersion) {
      return false;
    }
    if (maxMinutes > 0) {
      const minutes = Number(video.durationSeconds || durationToSeconds(video.duration || 0)) / 60;
      if (minutes > maxMinutes) {
        return false;
      }
    }
    return true;
  });
}

async function transcribeMissingVideosForSearch(videos, options) {
  const mode = cleanString(options.mode, "auto");
  const autoTranscribeMaxMinutes = Number(options.autoTranscribeMaxMinutes || 35);
  const maxAutoTranscribeVideos = Number(options.maxAutoTranscribeVideos || 1);
  const pending = videos
    .filter((video) => video.transcriptStatus !== "ready")
    .filter((video) => video.sourceAvailable !== false);
  const unavailable = videos
    .filter((video) => video.transcriptStatus !== "ready")
    .filter((video) => video.sourceAvailable === false)
    .map((video) => ({
      id: video.id,
      title: video.title,
      reason: "Source video unavailable on this server."
    }));
  const attempted = [];
  const completed = [];
  const failed = [];

  if (!pending.length || mode === "skip") {
    return {
      mode,
      attempted,
      completed,
      failed,
      unavailable
    };
  }

  const sortedPending = [...pending].sort((a, b) => Number(a.durationSeconds || 0) - Number(b.durationSeconds || 0));
  let candidates = [];

  if (mode === "force") {
    candidates = sortedPending.slice(0, maxAutoTranscribeVideos);
  } else {
    const shortOnly = sortedPending.filter((video) => (Number(video.durationSeconds || 0) / 60) <= autoTranscribeMaxMinutes);
    candidates = shortOnly.slice(0, Math.max(1, maxAutoTranscribeVideos));
  }

  for (const video of candidates) {
    attempted.push({
      id: video.id,
      title: video.title,
      duration: video.duration
    });

    try {
      await ensureVideoTranscriptReady(video.id);
      completed.push({
        id: video.id,
        title: video.title
      });
    } catch (error) {
      failed.push({
        id: video.id,
        title: video.title,
        error: cleanString(error && error.message, "Transcription failed")
      });
    }
  }

  return {
    mode,
    attempted,
    completed,
    failed,
    unavailable
  };
}

async function ensureVideoTranscriptReady(videoId) {
  const id = cleanString(videoId);
  ensureVideoCatalog();
  const row = VIDEO_LIBRARY.find((video) => cleanString(video.id) === id);
  if (!row) {
    throw new Error("Video not found in library.");
  }

  if (row.transcriptStatus === "ready" && cleanString(row.transcriptText)) {
    return row;
  }

  if (row.sourceAvailable === false) {
    throw new Error("Video source is not available on this server. Run local ingestion before deployment.");
  }

  if (videoTranscriptionJobs.has(id)) {
    return videoTranscriptionJobs.get(id);
  }

  const job = (async () => {
    try {
      const transcript = await transcribeVideoFile(row);
      const updated = setVideoTranscript(id, transcript, ROOT_DIR);
      videoEmbeddingCache = { key: "", vectors: [] };
      segmentEmbeddingCache.clear();
      return updated || row;
    } catch (error) {
      setVideoTranscriptionError(id, cleanString(error && error.message, "Transcription failed"), ROOT_DIR);
      throw error;
    }
  })();

  videoTranscriptionJobs.set(id, job);
  try {
    return await job;
  } finally {
    videoTranscriptionJobs.delete(id);
  }
}

async function transcribeVideoFile(video) {
  const absolutePath = path.join(ROOT_DIR, cleanString(video.relativePath));
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Video file does not exist: ${absolutePath}`);
  }

  const probedDuration = probeDurationSeconds(absolutePath);
  const durationSeconds = Math.max(Number(video.durationSeconds || 0), probedDuration || 0);
  const chunkSeconds = clampNumber(Number(process.env.VIDEO_TRANSCRIBE_CHUNK_SECONDS || 540), 120, 1200, 540);
  const chunkCount = Math.max(1, Math.ceil(Math.max(durationSeconds, 1) / chunkSeconds));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-bible-transcribe-"));

  let language = "unknown";
  const textParts = [];
  const mergedSegments = [];

  try {
    for (let idx = 0; idx < chunkCount; idx += 1) {
      const chunkStart = idx * chunkSeconds;
      const chunkDuration = Math.max(1, Math.min(chunkSeconds, Math.max(durationSeconds - chunkStart, 1)));
      const chunkFileName = `chunk-${String(idx + 1).padStart(3, "0")}.mp3`;
      const chunkFilePath = path.join(workDir, chunkFileName);

      extractAudioChunkToMp3(absolutePath, chunkFilePath, chunkStart, chunkDuration, 32);

      const bytes = fs.statSync(chunkFilePath).size;
      const maxBytes = 24 * 1024 * 1024;
      if (bytes > maxBytes) {
        extractAudioChunkToMp3(absolutePath, chunkFilePath, chunkStart, chunkDuration, 16);
      }

      const chunkBuffer = fs.readFileSync(chunkFilePath);
      const transcript = await transcriptionAgent({
        buffer: chunkBuffer,
        mimetype: "audio/mpeg",
        originalname: `${cleanString(video.id, "video")}-${idx + 1}.mp3`
      });

      if (cleanString(transcript.language) && cleanString(transcript.language) !== "unknown") {
        language = cleanString(transcript.language);
      }
      if (cleanString(transcript.text)) {
        textParts.push(cleanString(transcript.text));
      }

      const safeSegments = Array.isArray(transcript.segments) ? transcript.segments : [];
      for (const segment of safeSegments) {
        const start = Number(segment.start || 0) + chunkStart;
        const end = Number(segment.end || segment.start || 0) + chunkStart;
        const text = cleanString(segment.text);
        if (!text) {
          continue;
        }
        mergedSegments.push({
          start: Number(start.toFixed(2)),
          end: Number(Math.max(end, start).toFixed(2)),
          text
        });
      }
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const text = cleanString(textParts.join(" ").replace(/\s+/g, " "));
  return {
    text,
    segments: mergedSegments,
    language,
    durationSeconds
  };
}

function extractAudioChunkToMp3(inputPath, outputPath, startSeconds, durationSeconds, bitrateKbps) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    Number(startSeconds || 0).toFixed(2),
    "-t",
    Number(durationSeconds || 1).toFixed(2),
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    `${Math.max(8, Number(bitrateKbps || 32))}k`,
    outputPath
  ];

  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    const reason = cleanString(result.stderr || result.stdout, "ffmpeg failed");
    throw new Error(`Audio extraction failed: ${reason}`);
  }
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
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    return 0;
  }
  const parsed = Number(cleanString(result.stdout));
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : 0;
}

function buildVideoSearchChunks(video, maxChunksPerVideo = 24) {
  const segments = Array.isArray(video.transcriptSegments) ? video.transcriptSegments : [];
  if (!segments.length) {
    return [{
      key: buildChunkKey(video.id, 0, Math.min(60, Number(video.durationSeconds || 0)), videoSearchDocument(video)),
      start: 0,
      end: Math.min(60, Number(video.durationSeconds || 0)),
      text: videoSearchDocument(video)
    }];
  }

  const chunks = [];
  let currentText = [];
  let chunkStart = Number(segments[0].start || 0);
  let chunkEnd = chunkStart;
  let wordCount = 0;
  let charCount = 0;

  const flush = () => {
    if (!currentText.length) {
      return;
    }
    const text = cleanString(currentText.join(" "));
    chunks.push({
      key: buildChunkKey(video.id, chunkStart, chunkEnd, text),
      start: Number(chunkStart.toFixed(2)),
      end: Number(Math.max(chunkEnd, chunkStart).toFixed(2)),
      text
    });
    currentText = [];
    wordCount = 0;
    charCount = 0;
  };

  for (const segment of segments) {
    const text = cleanString(segment.text);
    if (!text) {
      continue;
    }
    const start = Number(segment.start || 0);
    const end = Number(segment.end || start);
    const span = Math.max(0, end - chunkStart);
    const segmentWords = tokenize(text).length;
    const segmentChars = text.length;
    const overSize = span >= 55 || (wordCount + segmentWords) >= 165 || (charCount + segmentChars) >= 750;

    if (currentText.length && overSize) {
      flush();
      chunkStart = start;
    }

    currentText.push(text);
    chunkEnd = end;
    wordCount += segmentWords;
    charCount += segmentChars;
  }
  flush();

  return chunks.slice(0, maxChunksPerVideo);
}

function buildChunkKey(videoId, start, end, text) {
  const hash = crypto
    .createHash("sha1")
    .update(`${cleanString(videoId)}|${Number(start || 0).toFixed(2)}|${Number(end || 0).toFixed(2)}|${cleanString(text).slice(0, 700)}`)
    .digest("hex")
    .slice(0, 18);
  return `${OPENAI_EMBED_MODEL}:${hash}`;
}

async function ensureChunkEmbeddings(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) {
    return [];
  }

  const missing = [];
  const missingKeys = [];

  for (const chunk of chunks) {
    const key = cleanString(chunk.key);
    if (!key || segmentEmbeddingCache.has(key)) {
      continue;
    }
    missing.push(cleanString(chunk.text));
    missingKeys.push(key);
  }

  if (missing.length) {
    const vectors = await fetchEmbeddingsInBatches(missing, 64);
    for (let i = 0; i < missingKeys.length; i += 1) {
      segmentEmbeddingCache.set(missingKeys[i], vectors[i] || []);
    }
  }

  return chunks.map((chunk) => segmentEmbeddingCache.get(cleanString(chunk.key)) || []);
}

function safeJsonParse(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

async function transcriptionAgent(file) {
  const data = await openAIMultipartRequest("/audio/transcriptions", () => buildTranscriptionFormData(file));
  const text = cleanString(data.text);
  const segments = normalizeTranscriptionSegments(data.segments, text);
  const durationFromSegments = segments.length ? Number(segments[segments.length - 1].end || 0) : 0;

  return {
    text,
    segments,
    language: cleanString(data.language, "unknown"),
    durationSeconds: Number(data.duration || durationFromSegments || 0)
  };
}

function buildTranscriptionFormData(file) {
  const form = new FormData();
  const mimeType = cleanString(file && file.mimetype, "audio/mpeg");
  const fileName = cleanString(file && file.originalname, "sermon-audio");
  const blob = new Blob([file && file.buffer ? file.buffer : Buffer.alloc(0)], { type: mimeType });

  form.append("file", blob, fileName);
  form.append("model", OPENAI_TRANSCRIBE_MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  return form;
}

function transcriptFromManualText(text, durationSeconds) {
  const cleanText = cleanString(text);
  const sentenceParts = cleanText
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const segmentCount = Math.max(sentenceParts.length, 1);
  const totalDuration = Math.max(Number(durationSeconds) || segmentCount * 8, segmentCount * 5);
  const perSegment = totalDuration / segmentCount;

  const segments = sentenceParts.map((segmentText, idx) => ({
    start: Number((idx * perSegment).toFixed(2)),
    end: Number(((idx + 1) * perSegment).toFixed(2)),
    text: cleanString(segmentText)
  }));

  return {
    text: cleanText,
    segments,
    language: "manual",
    durationSeconds: totalDuration
  };
}

function normalizeTranscriptionSegments(rawSegments, fallbackText) {
  const segments = cleanObjectArray(rawSegments, 500)
    .map((segment) => ({
      start: Number(segment.start || 0),
      end: Number(segment.end || 0),
      text: cleanString(segment.text)
    }))
    .filter((segment) => segment.text);

  if (segments.length) {
    return segments;
  }

  const text = cleanString(fallbackText);
  if (!text) {
    return [];
  }

  return [{ start: 0, end: 10, text }];
}

function detectScriptureReferences(text) {
  const pattern = /\b(?:[1-3]\s*)?[A-Z][a-z]+\s+\d{1,3}(?::\d{1,3}(?:-\d{1,3})?)?/g;
  const matches = cleanString(text).match(pattern) || [];
  return Array.from(new Set(matches)).slice(0, 50);
}

function computePacingAnalysis(transcript, localAnalysis) {
  const transcriptText = cleanString(transcript.text);
  const segments = cleanObjectArray(transcript.segments, 600);
  const durationSeconds = Math.max(Number(transcript.durationSeconds || 0), 1);
  const wordCount = tokenize(transcriptText).length;
  const avgWpm = Number(((wordCount / durationSeconds) * 60).toFixed(1));

  const sectionWpm = segments.slice(0, 120).map((segment) => {
    const start = Number(segment.start || 0);
    const end = Number(segment.end || start + 1);
    const span = Math.max(end - start, 0.8);
    const words = tokenize(segment.text).length;
    const wpm = Number(((words / span) * 60).toFixed(1));
    return {
      start,
      end,
      wpm,
      textSample: cleanString(segment.text).slice(0, 120)
    };
  });

  const fastSections = sectionWpm.filter((section) => section.wpm >= 172).slice(0, 12);
  const slowSections = sectionWpm.filter((section) => section.wpm <= 103).slice(0, 12);
  const pauses = cleanObjectArray(localAnalysis.pauseMoments, 300);
  const pauseTimeSec = pauses.reduce((sum, pause) => sum + Number(pause.duration || 0), 0);
  const pauseRatio = pauseTimeSec / durationSeconds;

  const paceCloseness = Math.max(0, 1 - Math.abs(avgWpm - 130) / 85);
  const pauseBalance = Math.max(0, 1 - Math.abs(pauseRatio - 0.17) / 0.2);
  const rhythmScore = Number((Math.max(0, Math.min(1, (paceCloseness * 0.7) + (pauseBalance * 0.3))) * 100).toFixed(1));

  return {
    avgWpm,
    targetBandWpm: "120-150",
    sectionWpm,
    fastSections,
    slowSections,
    pauseCount: pauses.length,
    pauseTimeSec: Number(pauseTimeSec.toFixed(1)),
    rhythmScore
  };
}

function computeVocalDynamics(localAnalysis) {
  const acoustic = localAnalysis && typeof localAnalysis.acoustic === "object" ? localAnalysis.acoustic : {};
  const pitch = localAnalysis && typeof localAnalysis.pitch === "object" ? localAnalysis.pitch : {};
  const monotoneSections = cleanObjectArray(localAnalysis.monotoneSections, 40)
    .map((section) => ({
      start: Number(section.start || 0),
      end: Number(section.end || 0),
      duration: Number(section.duration || 0)
    }))
    .filter((section) => section.duration > 0);

  const dynamicRangeDb = Number(acoustic.dynamicRangeDb || 0);
  const pitchStdHz = Number(pitch.stdHz || 0);
  const pitchRangeHz = Number(pitch.rangeHz || 0);
  const varietyScore = Number(pitch.varietyScore || 0);

  const volumeRangeScore = Number((Math.max(0, Math.min(1, dynamicRangeDb / 12)) * 100).toFixed(1));
  const pitchVariationScore = Number((Math.max(0, Math.min(1, pitchStdHz / 45)) * 100).toFixed(1));
  const monotoneRiskScore = Number((Math.max(0, Math.min(1, monotoneSections.length / 8)) * 100).toFixed(1));

  return {
    avgDb: Number(acoustic.avgDb || 0),
    peakDb: Number(acoustic.peakDb || 0),
    silenceRatio: Number(acoustic.silenceRatio || 0),
    dynamicRangeDb,
    volumeStdDb: Number(acoustic.volumeStdDb || 0),
    pitchMeanHz: Number(pitch.meanHz || 0),
    pitchStdHz,
    pitchRangeHz,
    varietyScore,
    volumeRangeScore,
    pitchVariationScore,
    monotoneRiskScore,
    monotoneSections
  };
}

function bucketTranscriptSegments(segments, maxBuckets = 12) {
  const safeSegments = cleanObjectArray(segments, 500).filter((segment) => cleanString(segment.text));
  if (!safeSegments.length) {
    return [];
  }

  const bucketSize = Math.max(1, Math.ceil(safeSegments.length / maxBuckets));
  const buckets = [];

  for (let i = 0; i < safeSegments.length; i += bucketSize) {
    const chunk = safeSegments.slice(i, i + bucketSize);
    const text = chunk.map((segment) => cleanString(segment.text)).join(" ");
    buckets.push({
      id: buckets.length + 1,
      start: Number(chunk[0].start || 0),
      end: Number(chunk[chunk.length - 1].end || chunk[0].end || chunk[0].start || 0),
      text: cleanString(text).slice(0, 900)
    });
  }

  return buckets;
}

async function sermonInsightsAgent(input) {
  const started = Date.now();
  const transcriptText = cleanString(input && input.transcript && input.transcript.text);
  const buckets = bucketTranscriptSegments(input && input.transcript ? input.transcript.segments : [], 12);
  const regexReferences = detectScriptureReferences(transcriptText);
  const transcriptWordCount = tokenize(transcriptText).length;
  const emotionalFallback = buildEmotionArcFallback(buckets);

  const insightsPrompt = buildSermonInsightsPrompt({
    context: cleanString(input.context),
    goal: cleanString(input.goal),
    notes: cleanString(input.notes),
    transcriptWordCount,
    transcriptExcerpt: transcriptText.slice(0, 9000),
    transcriptBuckets: buckets,
    regexReferences,
    pacingAnalysis: {
      avgWpm: Number(input && input.pacingAnalysis && input.pacingAnalysis.avgWpm || 0),
      targetBandWpm: cleanString(input && input.pacingAnalysis && input.pacingAnalysis.targetBandWpm, "120-150"),
      fastSections: cleanObjectArray(input && input.pacingAnalysis && input.pacingAnalysis.fastSections, 8),
      slowSections: cleanObjectArray(input && input.pacingAnalysis && input.pacingAnalysis.slowSections, 8),
      pauseCount: Number(input && input.pacingAnalysis && input.pacingAnalysis.pauseCount || 0),
      pauseTimeSec: Number(input && input.pacingAnalysis && input.pacingAnalysis.pauseTimeSec || 0),
      rhythmScore: Number(input && input.pacingAnalysis && input.pacingAnalysis.rhythmScore || 0)
    },
    vocalDynamics: {
      avgDb: Number(input && input.vocalDynamics && input.vocalDynamics.avgDb || 0),
      peakDb: Number(input && input.vocalDynamics && input.vocalDynamics.peakDb || 0),
      dynamicRangeDb: Number(input && input.vocalDynamics && input.vocalDynamics.dynamicRangeDb || 0),
      pitchStdHz: Number(input && input.vocalDynamics && input.vocalDynamics.pitchStdHz || 0),
      pitchRangeHz: Number(input && input.vocalDynamics && input.vocalDynamics.pitchRangeHz || 0),
      varietyScore: Number(input && input.vocalDynamics && input.vocalDynamics.varietyScore || 0),
      monotoneRiskScore: Number(input && input.vocalDynamics && input.vocalDynamics.monotoneRiskScore || 0),
      monotoneSections: cleanObjectArray(input && input.vocalDynamics && input.vocalDynamics.monotoneSections, 10)
    }
  });
  const ai = await chatJson({
    ...insightsPrompt,
    temperature: 0.28,
    model: OPENAI_LONG_FORM_MODEL,
    maxTokens: 1600
  });

  const emotionRaw = ai && ai.emotionalArc && typeof ai.emotionalArc === "object" ? ai.emotionalArc : {};
  const contentRaw = ai && ai.contentAnalysis && typeof ai.contentAnalysis === "object" ? ai.contentAnalysis : {};
  const coachingRaw = ai && ai.coachingFeedback && typeof ai.coachingFeedback === "object" ? ai.coachingFeedback : {};
  const pointRows = cleanObjectArray(emotionRaw.arc, 20);
  const points = buckets.length
    ? buckets.map((bucket, idx) => {
      const row = pointRows.find((item) => Number(item.bucketId) === bucket.id) || pointRows[idx] || {};
      return {
        bucketId: bucket.id,
        start: bucket.start,
        end: bucket.end,
        timeSec: Number(((bucket.start + bucket.end) / 2).toFixed(2)),
        label: cleanString(row.label, "Neutral"),
        intensity: clampNumber(Number(row.intensity), 0, 100, 50),
        valence: clampNumber(Number(row.valence), -100, 100, 0),
        note: cleanString(row.note)
      };
    })
    : emotionalFallback.points;
  const mergedReferences = Array.from(new Set([
    ...regexReferences,
    ...cleanArray(contentRaw.scriptureReferences, 30)
  ])).slice(0, 30);

  return {
    durationMs: Date.now() - started,
    emotionArc: {
      points,
      summary: cleanString(emotionRaw.summary, emotionalFallback.summary)
    },
    contentAnalysis: {
      report: {
        summary: cleanString(contentRaw.summary),
        scriptureReferences: mergedReferences,
        keyThemes: cleanArray(contentRaw.keyThemes, 10),
        structureMovements: cleanArray(contentRaw.structureMovements, 10),
        illustrationTracking: cleanArray(contentRaw.illustrationTracking, 10),
        callsToAction: cleanArray(contentRaw.callsToAction, 10),
        gospelClarityScore: clampNumber(Number(contentRaw.gospelClarityScore), 0, 100, 0)
      }
    },
    coaching: {
      report: {
        executiveSummary: cleanString(coachingRaw.executiveSummary),
        strengths: cleanArray(coachingRaw.strengths, 8),
        risks: cleanArray(coachingRaw.risks, 8),
        priorityActions: cleanArray(coachingRaw.priorityActions, 8),
        practiceDrills: cleanArray(coachingRaw.practiceDrills, 10),
        nextWeekPlan: cleanArray(coachingRaw.nextWeekPlan, 10)
      }
    }
  };
}

function buildEmotionArcFallback(buckets) {
  const points = (Array.isArray(buckets) ? buckets : []).map((bucket) => ({
    bucketId: bucket.id,
    start: bucket.start,
    end: bucket.end,
    timeSec: Number(((Number(bucket.start || 0) + Number(bucket.end || bucket.start || 0)) / 2).toFixed(2)),
    label: "Neutral",
    intensity: 50,
    valence: 0,
    note: ""
  }));

  return {
    points,
    summary: points.length ? "Balanced delivery arc detected across the message." : "No emotional arc points detected."
  };
}

async function openAIRequest(endpoint, body) {
  return openAIRequestWithRetry(endpoint, async () => {
    const response = await fetch(`${OPENAI_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    return parseOpenAIResponse(response, "OpenAI request failed");
  });
}

async function openAIMultipartRequest(endpoint, formDataOrFactory) {
  return openAIRequestWithRetry(endpoint, async () => {
    const requestBody = typeof formDataOrFactory === "function"
      ? formDataOrFactory()
      : formDataOrFactory;

    const response = await fetch(`${OPENAI_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: requestBody
    });

    return parseOpenAIResponse(response, "OpenAI multipart request failed");
  });
}

async function openAIRequestWithRetry(endpoint, requestFn) {
  const maxAttempts = clampNumber(
    Number(OPENAI_RETRY_ATTEMPTS),
    1,
    8,
    4
  );
  const baseDelayMs = clampNumber(
    Number(OPENAI_RETRY_BASE_MS),
    100,
    10000,
    650
  );

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = normalizeOpenAINetworkError(error, endpoint);
      if (!isRetryableOpenAIError(lastError) || attempt >= maxAttempts) {
        break;
      }

      const jitterMs = Math.floor(Math.random() * 120);
      const delayMs = Math.min(8000, baseDelayMs * (2 ** (attempt - 1))) + jitterMs;
      await sleep(delayMs);
    }
  }

  throw lastError || new Error(`OpenAI request failed for ${endpoint}`);
}

async function parseOpenAIResponse(response, fallbackPrefix) {
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }

  if (!response.ok) {
    const err = new Error(
      (data && data.error && data.error.message)
      || `${fallbackPrefix} with status ${response.status}`
    );
    err.status = response.status;
    throw err;
  }

  return data;
}

function normalizeOpenAINetworkError(error, endpoint) {
  if (!error) {
    const unknown = new Error(`OpenAI request failed for ${endpoint}`);
    unknown.code = "UNKNOWN";
    return unknown;
  }

  const code = cleanString(
    (error && error.code)
    || (error && error.cause && error.cause.code)
  );
  if (code && !error.code) {
    error.code = code;
  }

  if (!cleanString(error.message)) {
    error.message = `OpenAI request failed for ${endpoint}`;
  }

  return error;
}

function isRetryableOpenAIError(error) {
  const status = Number(error && error.status);
  if (status === 408 || status === 409 || status === 429) {
    return true;
  }
  if (Number.isFinite(status) && status >= 500) {
    return true;
  }

  const code = cleanString(
    (error && error.code)
    || (error && error.cause && error.cause.code)
  ).toUpperCase();
  if (["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) {
    return true;
  }

  const message = cleanString(error && error.message).toLowerCase();
  return (
    message.includes("fetch failed")
    || message.includes("socket hang up")
    || message.includes("timed out")
    || message.includes("temporar")
    || message.includes("rate limit")
    || message.includes("try again")
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJsonObject(text) {
  if (typeof text !== "string") {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return {};
    }

    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return {};
    }
  }
}

function cleanString(value, fallback = "") {
  if (typeof value === "string") {
    const trimmed = sanitizeBrandingText(value).trim();
    return trimmed || fallback;
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  return sanitizeBrandingText(String(value)).trim() || fallback;
}

function sanitizeBrandingText(value) {
  return String(value || "")
    .replace(/learnlogos\.com/gi, "Bible AI Hub")
    .replace(/\blearnlogos\b/gi, "Bible AI Hub");
}

function cleanArray(value, max = 6) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => cleanString(item))
    .filter(Boolean)
    .slice(0, max);
}

function cleanObjectArray(value, max = 6) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, max);
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function tokenize(text) {
  return cleanString(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function lexicalScoreVideo(video, terms) {
  if (!terms.length) {
    return 0;
  }

  const title = cleanString(video.title).toLowerCase();
  const body = cleanString(video.transcriptText).toLowerCase();
  const tags = cleanArray(video.tags, 40).join(" ").toLowerCase();
  const category = cleanString(video.category).toLowerCase();
  const topic = cleanString(video.topic).toLowerCase();
  const difficulty = cleanString(video.difficulty).toLowerCase();
  const logosVersion = cleanString(video.logosVersion).toLowerCase();

  let score = 0;

  for (const term of terms) {
    if (title.includes(term)) score += 1.1;
    if (tags.includes(term)) score += 0.85;
    if (topic.includes(term)) score += 0.8;
    if (category.includes(term)) score += 0.55;
    if (body.includes(term)) score += 0.4;
    if (difficulty.includes(term)) score += 0.3;
    if (logosVersion.includes(term)) score += 0.35;
  }

  return Math.min(1, score / Math.max(1, terms.length * 2.45));
}

function lexicalScoreText(text, terms) {
  if (!terms.length) {
    return 0;
  }

  const lower = cleanString(text).toLowerCase();
  if (!lower) {
    return 0;
  }

  let matches = 0;
  for (const term of terms) {
    if (lower.includes(term)) {
      matches += 1;
    }
  }

  return Math.min(1, matches / Math.max(1, terms.length));
}

function resolveVideoPlaybackBaseUrl(video) {
  if (!video || typeof video !== "object") {
    return "";
  }

  return cleanString(video.hostedUrl)
    || cleanString(video.playbackUrl)
    || cleanString(video.publicUrl);
}

function buildTimestampedPlaybackUrl(baseUrl, seconds) {
  const cleanBase = cleanString(baseUrl);
  if (!cleanBase) {
    return "";
  }

  const startSeconds = Math.max(0, Math.floor(Number(seconds || 0)));
  if (/youtu\.be\/|youtube\.com\//i.test(cleanBase)) {
    return appendOrReplaceQueryParam(cleanBase, "t", `${startSeconds}s`);
  }

  if (/vimeo\.com\//i.test(cleanBase)) {
    return appendOrReplaceHashParam(cleanBase, "t", `${startSeconds}s`);
  }

  return appendOrReplaceHashParam(cleanBase, "t", String(startSeconds));
}

function appendOrReplaceQueryParam(urlValue, key, value) {
  const cleanUrl = cleanString(urlValue);
  if (!cleanUrl) {
    return "";
  }

  const hashIdx = cleanUrl.indexOf("#");
  const hash = hashIdx >= 0 ? cleanUrl.slice(hashIdx) : "";
  const base = hashIdx >= 0 ? cleanUrl.slice(0, hashIdx) : cleanUrl;
  const separator = base.includes("?") ? "&" : "?";
  const pattern = new RegExp(`([?&])${key}=[^&#]*`, "i");
  const nextBase = pattern.test(base)
    ? base.replace(pattern, `$1${key}=${encodeURIComponent(value)}`)
    : `${base}${separator}${key}=${encodeURIComponent(value)}`;

  return `${nextBase}${hash}`;
}

function appendOrReplaceHashParam(urlValue, key, value) {
  const cleanUrl = cleanString(urlValue);
  if (!cleanUrl) {
    return "";
  }

  const hashIdx = cleanUrl.indexOf("#");
  const base = hashIdx >= 0 ? cleanUrl.slice(0, hashIdx) : cleanUrl;
  const rawHash = hashIdx >= 0 ? cleanUrl.slice(hashIdx + 1) : "";

  if (!rawHash) {
    return `${base}#${key}=${encodeURIComponent(value)}`;
  }

  const hashParams = new URLSearchParams(rawHash);
  hashParams.set(key, value);
  return `${base}#${hashParams.toString()}`;
}

function buildRelatedContent(scoredRows, excludeIds, queryTerms) {
  const excluded = new Set(excludeIds || []);
  const rows = Array.isArray(scoredRows) ? scoredRows : [];
  const related = [];

  for (const row of rows) {
    if (excluded.has(row.id)) {
      continue;
    }

    const tagText = cleanArray(row.tags, 12).join(" ").toLowerCase();
    const overlap = queryTerms.filter((term) => tagText.includes(term)).length;
    const score = (Number(row.score || 0) * 0.8) + (overlap * 0.06);
    const playbackBaseUrl = resolveVideoPlaybackBaseUrl(row);

    related.push({
      id: row.id,
      title: row.title,
      category: row.category,
      topic: row.topic,
      duration: row.duration,
      difficulty: row.difficulty,
      logosVersion: row.logosVersion,
      score: Number((score * 100).toFixed(2)),
      playbackUrl: playbackBaseUrl,
      hostedUrl: cleanString(row.hostedUrl),
      sourceAvailable: row.sourceAvailable !== false,
      url: buildTimestampedPlaybackUrl(playbackBaseUrl, 0),
      tags: row.tags
    });

    if (related.length >= 6) {
      break;
    }
  }

  return related;
}

function formatMediaTimestamp(seconds) {
  const safe = Math.max(0, Number(seconds || 0));
  const rounded = Math.floor(safe);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = Math.floor(rounded % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function buildMatchReason(row, queryTerms) {
  const reasons = [];
  if (row.semantic >= 0.65) {
    reasons.push("strong semantic match");
  }
  if (row.lexical >= 0.5) {
    reasons.push("direct keyword overlap");
  }
  if (queryTerms.some((term) => cleanString(row.video && row.video.topic).toLowerCase().includes(term))) {
    reasons.push("topic alignment");
  }
  if (!reasons.length) {
    reasons.push("contextual relevance");
  }
  return reasons.join(", ");
}

function buildGuidanceFallback(query, results) {
  const top = Array.isArray(results) ? results.slice(0, 3) : [];
  if (!top.length) {
    return `No strong matches yet for "${query}". Try broadening your terms and enabling auto-transcription.`;
  }

  const steps = top
    .map((item, idx) => `${idx + 1}) ${item.title} at ${item.timestamp}`)
    .join("  ");
  return `Start with these timestamped clips: ${steps}`;
}

function buildSuggestedQueriesFallback(query, results) {
  const cleanQuery = cleanString(query);
  const suggestions = new Set();
  if (cleanQuery) {
    suggestions.add(`${cleanQuery} walkthrough`);
    suggestions.add(`${cleanQuery} step by step`);
  }

  for (const row of (results || []).slice(0, 4)) {
    const topic = cleanString(row.topic);
    const category = cleanString(row.category);
    if (topic) suggestions.add(`${topic} in Logos`);
    if (category) suggestions.add(`${category} workflow`);
  }

  return Array.from(suggestions).slice(0, 6);
}

function cosineSimilarity(vectorA, vectorB) {
  if (!Array.isArray(vectorA) || !Array.isArray(vectorB) || !vectorA.length || !vectorB.length) {
    return 0;
  }

  const length = Math.min(vectorA.length, vectorB.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < length; i += 1) {
    const a = Number(vectorA[i]) || 0;
    const b = Number(vectorB[i]) || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }

  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
