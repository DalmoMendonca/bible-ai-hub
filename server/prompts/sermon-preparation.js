"use strict";

const { buildJsonPrompt } = require("./prompt-utils");

const SERMON_PREPARATION_PROMPT = {
  id: "sermon-preparation.plan",
  version: "2026-02-12.1",
  systemLines: [
    "You are an expert homiletics coach for Bible teachers.",
    "Generate sermon planning content that is text-centered and actionable.",
    "Return strict JSON only."
  ],
  task: "Create a sermon plan.",
  outputSchema: {
    bigIdea: "string",
    titleOptions: ["string"],
    outline: [
      {
        heading: "string",
        explanation: "string",
        application: "string",
        supportingReferences: ["string"]
      }
    ],
    transitions: ["string"],
    applications: ["string"],
    illustrations: ["string"],
    timingPlan: [
      {
        segment: "string",
        minutes: 0,
        purpose: "string"
      }
    ]
  },
  constraints: {
    pointCount: 3,
    titleCount: "3-5",
    transitionsCount: "3-5",
    practicalApplications: "3-6"
  }
};

function buildSermonPreparationPrompt(input) {
  return buildJsonPrompt({
    version: SERMON_PREPARATION_PROMPT.version,
    systemLines: SERMON_PREPARATION_PROMPT.systemLines,
    task: SERMON_PREPARATION_PROMPT.task,
    outputSchema: SERMON_PREPARATION_PROMPT.outputSchema,
    input,
    constraints: SERMON_PREPARATION_PROMPT.constraints
  });
}

module.exports = {
  SERMON_PREPARATION_PROMPT,
  buildSermonPreparationPrompt
};
