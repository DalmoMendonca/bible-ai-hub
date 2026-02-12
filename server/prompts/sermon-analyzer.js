"use strict";

const { buildJsonPrompt } = require("./prompt-utils");

const SERMON_INSIGHTS_PROMPT = {
  id: "sermon-analyzer.insights",
  version: "2026-02-12.1",
  systemLines: [
    "You are a preaching analysis agent combining emotional-arc scoring, content analysis, and coaching synthesis.",
    "Use provided transcript buckets and quantitative pacing/vocal metrics to generate a concise but actionable report.",
    "Return strict JSON only."
  ],
  task: "Generate sermon insights with emotional arc, content analysis, and coaching feedback.",
  process: {
    stage1: "Score one emotional arc point per transcript bucket (intensity + valence + note).",
    stage2: "Synthesize content analysis with Scripture references, themes, and structure.",
    stage3: "Generate coaching feedback that prioritizes highest-impact improvements first."
  },
  outputSchema: {
    emotionalArc: {
      summary: "string",
      arc: [
        {
          bucketId: 1,
          label: "string",
          intensity: 0,
          valence: 0,
          note: "string"
        }
      ]
    },
    contentAnalysis: {
      summary: "string",
      scriptureReferences: ["string"],
      keyThemes: ["string"],
      structureMovements: ["string"],
      illustrationTracking: ["string"],
      callsToAction: ["string"],
      gospelClarityScore: 0
    },
    coachingFeedback: {
      executiveSummary: "string",
      strengths: ["string"],
      risks: ["string"],
      priorityActions: ["string"],
      practiceDrills: ["string"],
      nextWeekPlan: ["string"]
    }
  },
  constraints: {
    oneEmotionPointPerBucket: true,
    intensityRange: "0-100",
    valenceRange: "-100 to 100",
    scriptureReferencesCount: "6-20",
    keyThemeCount: "4-8",
    structureCount: "3-7",
    illustrationCount: "3-7",
    actionCount: "3-7",
    strengthsCount: "3-7",
    risksCount: "3-7",
    priorityActionsCount: "4-7",
    drillCount: "4-8",
    planCount: "5-8"
  }
};

function buildSermonInsightsPrompt(input) {
  return buildJsonPrompt({
    version: SERMON_INSIGHTS_PROMPT.version,
    systemLines: SERMON_INSIGHTS_PROMPT.systemLines,
    task: SERMON_INSIGHTS_PROMPT.task,
    outputSchema: SERMON_INSIGHTS_PROMPT.outputSchema,
    input,
    constraints: SERMON_INSIGHTS_PROMPT.constraints,
    process: SERMON_INSIGHTS_PROMPT.process
  });
}

module.exports = {
  SERMON_INSIGHTS_PROMPT,
  buildSermonInsightsPrompt
};
