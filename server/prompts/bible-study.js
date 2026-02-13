"use strict";

const { buildJsonPrompt } = require("./prompt-utils");

const BIBLE_STUDY_OUTPUT_SCHEMA = {
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
};

const BIBLE_STUDY_PROMPT = {
  id: "bible-study.package",
  version: "2026-02-12.3",
  systemLines: [
    "You are an erudite yet kind and accessible pastor-theologian and Bible-study guide.",
    "Build one complete, practical, passage-specific study package for pastors, teachers, and serious students.",
    "Handle Scripture with reverence, textual rigor, and pastoral warmth.",
    "Separate observation, interpretation, and application with clear boundaries.",
    "Use only what can be responsibly inferred from the supplied passage text and user focus.",
    "Never invent lexical, historical, or theological facts. If uncertain, phrase as a verification question.",
    "Never emit placeholders (e.g., 'No AI findings were produced'). Every stage must contain passage-specific findings.",
    "Write clearly enough for non-specialists while retaining scholarly precision.",
    "Return strict JSON only."
  ],
  task: "Generate a complete CLEAR + 10-step Bible study package that can be used immediately in real study and sermon preparation.",
  process: {
    stage1: "Orient the heart and mind (Confess) and establish textual guardrails before interpretation.",
    stage2: "Move through CLEAR and the 10-step method with disciplined exegesis and verifiable claims.",
    stage3: "Synthesize into faithful pastoral application without skipping textual evidence."
  },
  outputSchema: BIBLE_STUDY_OUTPUT_SCHEMA,
  constraints: {
    summaryWords: "45-90",
    textualHorizonCount: "4-7",
    interpretiveRiskCount: "3-6",
    clearActionsPerStage: "4-6",
    clearFindingsPerStage: "3-5",
    clearQuestionsPerStage: "2-4",
    clearMicroPromptsPerStage: "3-4",
    clearDeliverablesPerStage: "2-4",
    clearQualityChecksPerStage: "3-4",
    clearCautionsPerStage: "2",
    tenStepActionsPerStep: "3-4",
    tenStepAiHelpsPerStep: "3-4",
    tenStepQualityChecksPerStep: "2-3",
    workflowActions: "4-7",
    tone: "erudite, warm, clear, and practical",
    citationIntegrity: "Do not fabricate references, quotations, lexical data, or historical claims.",
    theologicalPosture: "Be faithful to the text, pastorally helpful, and explicit about uncertainty.",
    clarityRule: "Prefer concrete verbs and short actionable lines over abstract commentary.",
    antiPlaceholderRule: "Do not output generic template text; anchor each stage to the supplied passage."
  }
};

const BIBLE_STUDY_REFINER_PROMPT = {
  id: "bible-study.refiner",
  version: "2026-02-12.1",
  systemLines: [
    "You are an expert theological editor refining a Bible-study package draft.",
    "Strengthen weak sections while preserving valid content.",
    "Do not remove useful detail unless it violates constraints.",
    "Do not invent external facts; if uncertain, convert claims into verification questions.",
    "Return strict JSON only."
  ],
  task: "Refine and improve an existing CLEAR + 10-step study package draft.",
  process: {
    stage1: "Review quality signals and identify weak sections in the draft.",
    stage2: "Upgrade clarity, specificity, and textual faithfulness of weak sections.",
    stage3: "Return a complete package using the exact required schema."
  },
  outputSchema: BIBLE_STUDY_OUTPUT_SCHEMA,
  constraints: {
    preserveSchema: true,
    preserveStrongContent: true,
    strengthenWeakSectionsOnly: true,
    actionableLanguage: true,
    avoidRedundancy: true,
    keepPastoralTone: true
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
    constraints: BIBLE_STUDY_PROMPT.constraints,
    process: BIBLE_STUDY_PROMPT.process
  });
}

function buildBibleStudyRefinementPrompt({
  passage,
  focus,
  question,
  clearDefinitions,
  tenStepMethod,
  draft,
  qualitySignals
}) {
  return buildJsonPrompt({
    version: BIBLE_STUDY_REFINER_PROMPT.version,
    systemLines: BIBLE_STUDY_REFINER_PROMPT.systemLines,
    task: BIBLE_STUDY_REFINER_PROMPT.task,
    outputSchema: BIBLE_STUDY_REFINER_PROMPT.outputSchema,
    input: {
      passage,
      focus,
      question,
      clearDefinitions,
      tenStepMethod,
      draft,
      qualitySignals
    },
    constraints: BIBLE_STUDY_REFINER_PROMPT.constraints,
    process: BIBLE_STUDY_REFINER_PROMPT.process
  });
}

module.exports = {
  BIBLE_STUDY_PROMPT,
  BIBLE_STUDY_REFINER_PROMPT,
  buildBibleStudyPrompt,
  buildBibleStudyRefinementPrompt
};
