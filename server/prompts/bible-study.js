"use strict";

const { buildJsonPrompt } = require("./prompt-utils");

const BIBLE_STUDY_PROMPT = {
  id: "bible-study.package",
  version: "2026-02-12.1",
  systemLines: [
    "You are a senior Bible-study strategist and pastoral research assistant.",
    "Build one complete, practical, passage-specific study package.",
    "Use only what can be responsibly inferred from the supplied passage text.",
    "If a claim is uncertain, frame it as a verification question.",
    "Return strict JSON only."
  ],
  task: "Generate a complete CLEAR + 10-step Bible study package in a single response.",
  outputSchema: {
    summary: "string",
    passageLens: {
      contextSummary: "string",
      textualHorizon: ["string"],
      interpretiveRisks: ["string"],
      pastoralAim: "string"
    },
    clear: [
      {
        key: "confess|list|exegete|analyze|relate",
        code: "string",
        label: "string",
        definition: "string",
        stageSummary: "string",
        actions: ["string"],
        aiFindings: ["string"],
        diagnosticQuestions: ["string"],
        microPrompts: ["string"],
        deliverables: ["string"],
        qualityChecks: ["string"],
        cautions: ["string"]
      }
    ],
    tenStep: [
      {
        stepNumber: 1,
        stepName: "string",
        objective: "string",
        whatToDo: ["string"],
        aiHelps: ["string"],
        outputArtifact: "string",
        qualityChecks: ["string"]
      }
    ],
    studyWorkflow: {
      assistantResponse: ["string"],
      nextActions: ["string"],
      prayerPrompts: ["string"],
      integrationNotes: ["string"]
    }
  },
  constraints: {
    summaryWords: "35-70",
    textualHorizonCount: "3-6",
    interpretiveRiskCount: "3-6",
    clearActionsPerStage: "3-5",
    clearFindingsPerStage: "3-4",
    clearQuestionsPerStage: "2-3",
    clearMicroPromptsPerStage: "2-3",
    clearDeliverablesPerStage: "2-3",
    clearQualityChecksPerStage: "2-3",
    clearCautionsPerStage: "2",
    tenStepActionsPerStep: "2-3",
    tenStepAiHelpsPerStep: "2-3",
    tenStepQualityChecksPerStep: "2",
    workflowActions: "3-6"
  }
};

function buildBibleStudyPrompt({
  passage,
  focus,
  question,
  clearDefinitions,
  tenStepMethod
}) {
  return buildJsonPrompt({
    version: BIBLE_STUDY_PROMPT.version,
    systemLines: BIBLE_STUDY_PROMPT.systemLines,
    task: BIBLE_STUDY_PROMPT.task,
    outputSchema: BIBLE_STUDY_PROMPT.outputSchema,
    input: {
      passage,
      focus,
      question,
      clearDefinitions,
      tenStepMethod
    },
    constraints: BIBLE_STUDY_PROMPT.constraints
  });
}

module.exports = {
  BIBLE_STUDY_PROMPT,
  buildBibleStudyPrompt
};
