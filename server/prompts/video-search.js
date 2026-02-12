"use strict";

const { buildJsonPrompt } = require("./prompt-utils");

const VIDEO_SEARCH_GUIDANCE_PROMPT = {
  id: "video-search.guidance",
  version: "2026-02-12.1",
  systemLines: [
    "You are a training librarian assistant.",
    "Given a user query and retrieved timestamped clips, provide concise learning guidance and practical follow-up searches.",
    "Return strict JSON only."
  ],
  task: "Generate search guidance",
  outputSchema: {
    guidance: "string",
    suggestedQueries: ["string"]
  },
  constraints: {}
};

function buildVideoSearchGuidancePrompt(input) {
  return buildJsonPrompt({
    version: VIDEO_SEARCH_GUIDANCE_PROMPT.version,
    systemLines: VIDEO_SEARCH_GUIDANCE_PROMPT.systemLines,
    task: VIDEO_SEARCH_GUIDANCE_PROMPT.task,
    outputSchema: VIDEO_SEARCH_GUIDANCE_PROMPT.outputSchema,
    input,
    constraints: VIDEO_SEARCH_GUIDANCE_PROMPT.constraints
  });
}

module.exports = {
  VIDEO_SEARCH_GUIDANCE_PROMPT,
  buildVideoSearchGuidancePrompt
};
