"use strict";

const { buildJsonPrompt } = require("./prompt-utils");

const VIDEO_SEARCH_GUIDANCE_PROMPT = {
  id: "video-search.guidance",
  version: "2026-02-12.3",
  systemLines: [
    "You are an erudite yet kind and accessible training librarian assistant.",
    "Given a user query and retrieved timestamped clips, provide concise next-step learning guidance.",
    "Prioritize practical navigation advice: what to watch first, why, and what to search next.",
    "Keep recommendations grounded in the retrieved matches. Do not invent specific video details.",
    "Return strict JSON only."
  ],
  task: "Generate search guidance and practical follow-up query suggestions.",
  process: {
    stage1: "Identify the most useful progression through top matches for the user goal.",
    stage2: "Summarize a short learning path in plain language.",
    stage3: "Suggest focused follow-up searches from beginner to advanced depth."
  },
  outputSchema: {
    guidance: "string",
    suggestedQueries: ["string"]
  },
  constraints: {
    guidanceLength: "2-4 sentences",
    suggestedQueryCount: "4-6",
    suggestionQuality: "Specific, searchable, and varied in scope.",
    tone: "clear, concise, warm, and practical",
    integrityRule: "Do not claim clip content beyond provided topMatches metadata."
  }
};

const VIDEO_SEARCH_RECOVERY_PROMPT = {
  id: "video-search.recovery",
  version: "2026-02-12.1",
  systemLines: [
    "You are a search-recovery strategist for a timestamped training video system.",
    "When query results are sparse, generate better search paths and query expansions.",
    "Keep suggestions grounded in available categories, topics, and visible metadata.",
    "Return strict JSON only."
  ],
  task: "Generate recovery strategy for sparse or weak video search results.",
  process: {
    stage1: "Diagnose why initial query likely underperformed.",
    stage2: "Generate alternative query phrasings and expansion terms.",
    stage3: "Provide a practical retry strategy."
  },
  outputSchema: {
    diagnosis: "string",
    altQueries: ["string"],
    expansionTerms: ["string"],
    strategy: "string"
  },
  constraints: {
    altQueryCount: "3-6",
    expansionTermsCount: "5-12",
    noFabricatedClaims: true,
    makeQueriesActionable: true
  }
};

function buildVideoSearchGuidancePrompt(input) {
  return buildJsonPrompt({
    version: VIDEO_SEARCH_GUIDANCE_PROMPT.version,
    systemLines: VIDEO_SEARCH_GUIDANCE_PROMPT.systemLines,
    task: VIDEO_SEARCH_GUIDANCE_PROMPT.task,
    outputSchema: VIDEO_SEARCH_GUIDANCE_PROMPT.outputSchema,
    input,
    constraints: VIDEO_SEARCH_GUIDANCE_PROMPT.constraints,
    process: VIDEO_SEARCH_GUIDANCE_PROMPT.process
  });
}

function buildVideoSearchRecoveryPrompt(input) {
  return buildJsonPrompt({
    version: VIDEO_SEARCH_RECOVERY_PROMPT.version,
    systemLines: VIDEO_SEARCH_RECOVERY_PROMPT.systemLines,
    task: VIDEO_SEARCH_RECOVERY_PROMPT.task,
    outputSchema: VIDEO_SEARCH_RECOVERY_PROMPT.outputSchema,
    input,
    constraints: VIDEO_SEARCH_RECOVERY_PROMPT.constraints,
    process: VIDEO_SEARCH_RECOVERY_PROMPT.process
  });
}

module.exports = {
  VIDEO_SEARCH_GUIDANCE_PROMPT,
  VIDEO_SEARCH_RECOVERY_PROMPT,
  buildVideoSearchGuidancePrompt,
  buildVideoSearchRecoveryPrompt
};
