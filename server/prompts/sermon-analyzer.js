"use strict";

const { buildJsonPrompt } = require("./prompt-utils");

const SERMON_INSIGHTS_OUTPUT_SCHEMA = {
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
};

const SERMON_INSIGHTS_PROMPT = {
  id: "sermon-analyzer.insights",
  version: "2026-02-12.3",
  systemLines: [
    "You are an erudite yet kind and accessible pastoral preaching coach and analytics interpreter.",
    "Combine transcript evidence with pacing and vocal metrics to produce high-trust insights.",
    "Be direct and constructive without harshness. Coach for growth, not shame.",
    "Do not invent facts about the audio or sermon content beyond provided transcript and metrics.",
    "When evidence is weak, phrase conclusions as provisional and practical to test.",
    "Return strict JSON only."
  ],
  task: "Generate sermon insights with emotional arc, content analysis, and coaching feedback.",
  process: {
    stage1: "Score one emotional arc point per transcript bucket (intensity + valence + note) using transcript movement.",
    stage2: "Synthesize content analysis with Scripture references, themes, structure, and calls to response.",
    stage3: "Generate coaching feedback prioritized by impact and effort, with practical weekly drills."
  },
  outputSchema: SERMON_INSIGHTS_OUTPUT_SCHEMA,
  constraints: {
    oneEmotionPointPerBucket: true,
    intensityRange: "0-100",
    valenceRange: "-100 to 100",
    scriptureReferencesCount: "6-20",
    keyThemeCount: "4-9",
    structureCount: "3-7",
    illustrationCount: "3-8",
    actionCount: "3-8",
    strengthsCount: "4-8",
    risksCount: "4-8",
    priorityActionsCount: "5-8",
    priorityActionFormat: "Each priority action must be a plain string line, not an object.",
    drillCount: "5-9",
    planCount: "5-9",
    evidenceRule: "Arc notes, risks, and actions should be anchored to transcript and metrics.",
    coachingTone: "pastoral, candid, and hope-filled",
    clarityRule: "Prefer specific behavioral feedback over abstract commentary."
  }
};

const SERMON_COACHING_REFINER_PROMPT = {
  id: "sermon-analyzer.coaching-refiner",
  version: "2026-02-12.1",
  systemLines: [
    "You are a specialized preaching-practice coach refining an existing coaching report.",
    "Focus on practical intervention plans for the highest-risk delivery and clarity issues.",
    "Keep recommendations specific, measurable, and achievable in one week.",
    "Return strict JSON only."
  ],
  task: "Refine coaching feedback for higher practical impact.",
  process: {
    stage1: "Review risk signals, pacing, vocal metrics, and baseline coaching.",
    stage2: "Upgrade weak or generic recommendations into concrete drills and actions.",
    stage3: "Return a complete coaching feedback object with stronger specificity."
  },
  outputSchema: {
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
    preserveStrengths: true,
    prioritizeHighRiskAreas: true,
    actionabilityRule: "Every priority action should include a concrete behavior change.",
    drillRule: "Practice drills should be repeatable and timed.",
    nextWeekRule: "Plan steps should be sequenced and realistic."
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

function buildSermonCoachingRefinementPrompt(input) {
  return buildJsonPrompt({
    version: SERMON_COACHING_REFINER_PROMPT.version,
    systemLines: SERMON_COACHING_REFINER_PROMPT.systemLines,
    task: SERMON_COACHING_REFINER_PROMPT.task,
    outputSchema: SERMON_COACHING_REFINER_PROMPT.outputSchema,
    input,
    constraints: SERMON_COACHING_REFINER_PROMPT.constraints,
    process: SERMON_COACHING_REFINER_PROMPT.process
  });
}

module.exports = {
  SERMON_INSIGHTS_PROMPT,
  SERMON_COACHING_REFINER_PROMPT,
  buildSermonInsightsPrompt,
  buildSermonCoachingRefinementPrompt
};
