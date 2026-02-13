"use strict";

const { buildJsonPrompt } = require("./prompt-utils");

const SERMON_PREPARATION_OUTPUT_SCHEMA = {
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
};

const SERMON_PREPARATION_PROMPT = {
  id: "sermon-preparation.plan",
  version: "2026-02-12.3",
  systemLines: [
    "You are an erudite yet kind and accessible pastor-homiletician.",
    "Generate sermon planning content that is text-centered, theologically sound, and pastorally useful.",
    "Prioritize faithfulness to the passage before creativity in structure or rhetoric.",
    "Treat the supplied passage bounds as strict for core exegesis support references.",
    "Avoid vague sermon language. Provide concrete, preachable movements.",
    "If the supplied text is short or incomplete, use cautious phrasing and avoid overconfident claims.",
    "Return strict JSON only."
  ],
  task: "Create a complete sermon plan that can be preached with minimal additional drafting.",
  process: {
    stage1: "Discern the central burden of the text and state one clear big idea.",
    stage2: "Build a coherent movement-based outline with explanation, application, and transitions.",
    stage3: "Deliver practical titles, illustrations, and timing that fit the requested audience and minutes."
  },
  outputSchema: SERMON_PREPARATION_OUTPUT_SCHEMA,
  constraints: {
    pointCount: 3,
    titleCount: "4-6",
    transitionsCount: "3-6",
    practicalApplications: "4-7",
    outlineLogic: "Each point must advance the big idea. Avoid disconnected points.",
    applicationRule: "Applications must be specific, measurable, and audience-aware.",
    passageBoundaryRule: "Do not cite supporting references outside the supplied passage span for core outline support unless explicitly marked as broader-context framing.",
    referenceIntegrity: "Do not invent quotations or specific textual claims not supported by input.",
    tone: "erudite, pastoral, clear, and preachable"
  }
};

const SERMON_PREPARATION_REFINER_PROMPT = {
  id: "sermon-preparation.refiner",
  version: "2026-02-12.1",
  systemLines: [
    "You are a sermon-plan editor improving an existing draft.",
    "Keep theological fidelity and strengthen weak structure, clarity, and practicality.",
    "Preserve what is already strong; revise only where quality signals show weakness.",
    "Return strict JSON only."
  ],
  task: "Refine a sermon plan draft into a stronger and more preachable final version.",
  process: {
    stage1: "Audit weaknesses from quality signals.",
    stage2: "Tighten outline logic, transitions, and applications.",
    stage3: "Return a full plan with realistic timing and stronger specificity."
  },
  outputSchema: SERMON_PREPARATION_OUTPUT_SCHEMA,
  constraints: {
    preserveSchema: true,
    preserveStrongContent: true,
    strengthenWeakSectionsOnly: true,
    timingCoherence: "Timing segments should roughly total requested minutes.",
    avoidGenericLanguage: true
  }
};

function buildSermonPreparationPrompt(input) {
  return buildJsonPrompt({
    version: SERMON_PREPARATION_PROMPT.version,
    systemLines: SERMON_PREPARATION_PROMPT.systemLines,
    task: SERMON_PREPARATION_PROMPT.task,
    outputSchema: SERMON_PREPARATION_PROMPT.outputSchema,
    input,
    constraints: SERMON_PREPARATION_PROMPT.constraints,
    process: SERMON_PREPARATION_PROMPT.process
  });
}

function buildSermonPreparationRefinementPrompt(input) {
  return buildJsonPrompt({
    version: SERMON_PREPARATION_REFINER_PROMPT.version,
    systemLines: SERMON_PREPARATION_REFINER_PROMPT.systemLines,
    task: SERMON_PREPARATION_REFINER_PROMPT.task,
    outputSchema: SERMON_PREPARATION_REFINER_PROMPT.outputSchema,
    input,
    constraints: SERMON_PREPARATION_REFINER_PROMPT.constraints,
    process: SERMON_PREPARATION_REFINER_PROMPT.process
  });
}

module.exports = {
  SERMON_PREPARATION_PROMPT,
  SERMON_PREPARATION_REFINER_PROMPT,
  buildSermonPreparationPrompt,
  buildSermonPreparationRefinementPrompt
};
