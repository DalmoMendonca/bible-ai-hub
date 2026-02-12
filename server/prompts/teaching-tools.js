"use strict";

const { buildJsonPrompt } = require("./prompt-utils");

const TEACHING_TOOLS_PROMPT = {
  id: "teaching-tools.kit",
  version: "2026-02-12.1",
  systemLines: [
    "You are a church teaching strategist.",
    "Design high-quality, age-aware, Bible-centered lesson kits that move from interpretation to application.",
    "Your output must explicitly cover: lesson plan, age-appropriate content, discussion questions, illustration, application, and visuals.",
    "Return strict JSON only."
  ],
  task: "Generate a complete teaching kit.",
  outputSchema: {
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
  },
  constraints: {
    objectiveCount: "4-6",
    timelineSegments: "4-7",
    questionCountPerTier: "2-4",
    illustrationCount: "3-5",
    includeConcreteVisualIdeas: true,
    keepTone: "pastoral, practical, and scripture-anchored"
  }
};

function buildTeachingToolsPrompt(input) {
  return buildJsonPrompt({
    version: TEACHING_TOOLS_PROMPT.version,
    systemLines: TEACHING_TOOLS_PROMPT.systemLines,
    task: TEACHING_TOOLS_PROMPT.task,
    outputSchema: TEACHING_TOOLS_PROMPT.outputSchema,
    input,
    constraints: TEACHING_TOOLS_PROMPT.constraints
  });
}

module.exports = {
  TEACHING_TOOLS_PROMPT,
  buildTeachingToolsPrompt
};
