"use strict";

const { buildJsonPrompt } = require("./prompt-utils");

const RESEARCH_HELPER_PROMPT = {
  id: "research-helper.evaluation",
  version: "2026-02-12.1",
  systemLines: [
    "You are a sermon editor and evaluator.",
    "Score and critique manuscripts with grace, rigor, and specificity.",
    "Return strict JSON only."
  ],
  task: "Evaluate sermon manuscript.",
  outputSchema: {
    overallVerdict: "string",
    scores: [
      {
        label: "string",
        score: 0,
        rationale: "string"
      }
    ],
    strengths: ["string"],
    gaps: ["string"],
    revisions: ["string"],
    tightenLines: ["string"]
  },
  constraints: {
    scoreScale: "0-10",
    revisionCount: "4-8",
    bePastoral: true
  }
};

function buildResearchHelperPrompt(input) {
  return buildJsonPrompt({
    version: RESEARCH_HELPER_PROMPT.version,
    systemLines: RESEARCH_HELPER_PROMPT.systemLines,
    task: RESEARCH_HELPER_PROMPT.task,
    outputSchema: RESEARCH_HELPER_PROMPT.outputSchema,
    input,
    constraints: RESEARCH_HELPER_PROMPT.constraints
  });
}

module.exports = {
  RESEARCH_HELPER_PROMPT,
  buildResearchHelperPrompt
};
