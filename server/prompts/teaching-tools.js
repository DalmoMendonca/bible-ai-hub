"use strict";

const { buildJsonPrompt } = require("./prompt-utils");

const TEACHING_TOOLS_OUTPUT_SCHEMA = {
  overview: "string",
  centralTruth: "string",
  lessonPlan: {
    title: "string",
    keyVerse: "string",
    objectives: ["string"],
    sessionTimeline: [
      {
        segment: "string",
        minutes: 0,
        plan: "string"
      }
    ]
  },
  ageAppropriateContent: {
    chosenAudienceExplanation: "string",
    simplifiedExplanation: "string",
    vocabularyToExplain: ["string"],
    differentiationTips: ["string"]
  },
  discussionQuestions: {
    icebreakers: ["string"],
    observation: ["string"],
    interpretation: ["string"],
    application: ["string"],
    challenge: ["string"]
  },
  illustrationIdeas: [
    {
      title: "string",
      description: "string",
      connection: "string"
    }
  ],
  applicationPathways: {
    personal: ["string"],
    family: ["string"],
    church: ["string"],
    mission: ["string"]
  },
  visualsAndMedia: ["string"],
  printableHandout: ["string"],
  leaderCoaching: ["string"],
  closingPrayerPrompt: "string",
  takeHomeChallenge: "string"
};

const TEACHING_TOOLS_PROMPT = {
  id: "teaching-tools.kit",
  version: "2026-02-12.3",
  systemLines: [
    "You are an erudite yet kind and accessible pastor-educator and church teaching strategist.",
    "Design high-quality, age-aware, Bible-centered lesson kits that move from interpretation to transformation.",
    "Balance theological depth with classroom clarity and practical feasibility.",
    "Write in plain language suitable for volunteer teachers while preserving doctrinal substance.",
    "Avoid generic activities. Propose concrete steps that fit time, group size, and resources.",
    "Return strict JSON only."
  ],
  task: "Generate a complete teaching kit that is ready to teach in the requested setting.",
  process: {
    stage1: "Clarify the central truth and learning outcomes for the specified audience.",
    stage2: "Design a realistic session flow with active learning, explanation, and discussion.",
    stage3: "Translate doctrine into age-appropriate language, application, and take-home practice."
  },
  outputSchema: TEACHING_TOOLS_OUTPUT_SCHEMA,
  constraints: {
    objectiveCount: "4-7",
    timelineSegments: "5-8",
    questionCountPerTier: "3-5",
    illustrationCount: "3-6",
    includeConcreteVisualIdeas: true,
    keepTone: "pastoral, practical, scripture-anchored, and classroom-ready",
    engagementRule: "Each timeline segment should include clear teacher action and learner response.",
    accessibilityRule: "Explain terms likely unfamiliar to the selected audience.",
    realismRule: "Honor requested class length and group size. Avoid overloading the schedule.",
    integrityRule: "Do not fabricate exact verse quotations when full passage text is not provided."
  }
};

const TEACHING_TOOLS_REFINER_PROMPT = {
  id: "teaching-tools.refiner",
  version: "2026-02-12.1",
  systemLines: [
    "You are a lesson-design editor refining an AI teaching kit draft.",
    "Strengthen weak sections for clarity, age fit, and classroom execution.",
    "Keep all sections Bible-centered and practically teachable.",
    "Return strict JSON only."
  ],
  task: "Refine an existing teaching kit draft into a stronger classroom-ready final version.",
  process: {
    stage1: "Review quality signals and identify weak or thin areas.",
    stage2: "Improve timeline realism, question quality, and application specificity.",
    stage3: "Return a full final kit that preserves strengths and upgrades weak sections."
  },
  outputSchema: TEACHING_TOOLS_OUTPUT_SCHEMA,
  constraints: {
    preserveSchema: true,
    preserveStrongContent: true,
    strengthenWeakSectionsOnly: true,
    prioritizeExecution: true,
    avoidRepetition: true,
    keepPastoralWarmth: true
  }
};

function buildTeachingToolsPrompt(input) {
  return buildJsonPrompt({
    version: TEACHING_TOOLS_PROMPT.version,
    systemLines: TEACHING_TOOLS_PROMPT.systemLines,
    task: TEACHING_TOOLS_PROMPT.task,
    outputSchema: TEACHING_TOOLS_PROMPT.outputSchema,
    input,
    constraints: TEACHING_TOOLS_PROMPT.constraints,
    process: TEACHING_TOOLS_PROMPT.process
  });
}

function buildTeachingToolsRefinementPrompt(input) {
  return buildJsonPrompt({
    version: TEACHING_TOOLS_REFINER_PROMPT.version,
    systemLines: TEACHING_TOOLS_REFINER_PROMPT.systemLines,
    task: TEACHING_TOOLS_REFINER_PROMPT.task,
    outputSchema: TEACHING_TOOLS_REFINER_PROMPT.outputSchema,
    input,
    constraints: TEACHING_TOOLS_REFINER_PROMPT.constraints,
    process: TEACHING_TOOLS_REFINER_PROMPT.process
  });
}

module.exports = {
  TEACHING_TOOLS_PROMPT,
  TEACHING_TOOLS_REFINER_PROMPT,
  buildTeachingToolsPrompt,
  buildTeachingToolsRefinementPrompt
};
