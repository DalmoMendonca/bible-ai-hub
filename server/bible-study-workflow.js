"use strict";

const {
  buildBibleStudyPrompt,
  buildBibleStudyRefinementPrompt
} = require("./prompts");

const CLEAR_METHOD_STAGES = [
  {
    key: "confess",
    code: "C",
    label: "Confess",
    definition: "Prepare the interpreter through prayer and initial observation, orienting heart and mind toward the biblical text."
  },
  {
    key: "list",
    code: "L",
    label: "List",
    definition: "Survey words, phrases, and sentence relationships to form a preliminary preaching structure."
  },
  {
    key: "exegete",
    code: "E",
    label: "Exegete",
    definition: "Conduct detailed textual, lexical, morphological, grammatical, syntactical, and discourse-level analysis to discern authorial intent."
  },
  {
    key: "analyze",
    code: "A",
    label: "Analyze",
    definition: "Synthesize and verify findings through Scripture cross-references, historical/theological context, and evaluation of key interpretations."
  },
  {
    key: "relate",
    code: "R",
    label: "Relate",
    definition: "Bridge the ancient text to today's audience through clear exposition, faithful application, illustration, and rhetorical strategy."
  }
];

const TEN_STEP_STUDY_METHOD = [
  { stepNumber: 1, stepName: "Observation" },
  { stepNumber: 2, stepName: "Outlining" },
  { stepNumber: 3, stepName: "Word Studies" },
  { stepNumber: 4, stepName: "Grammar Studies" },
  { stepNumber: 5, stepName: "Cross-References" },
  { stepNumber: 6, stepName: "Historical Background" },
  { stepNumber: 7, stepName: "Theological Background" },
  { stepNumber: 8, stepName: "Cross-Checking" },
  { stepNumber: 9, stepName: "Illustration" },
  { stepNumber: 10, stepName: "Application" }
];

function createBibleStudyWorkflow(deps) {
  const {
    chatJson,
    cleanString,
    cleanArray,
    cleanObjectArray
  } = deps || {};

  if (
    typeof chatJson !== "function"
    || typeof cleanString !== "function"
    || typeof cleanArray !== "function"
    || typeof cleanObjectArray !== "function"
  ) {
    throw new Error("createBibleStudyWorkflow requires chatJson, cleanString, cleanArray, and cleanObjectArray.");
  }

  async function generateStudy(studyContext) {
    const context = normalizeStudyContext(studyContext, cleanString);
    const rawDraft = await generateStudyPayload(context, {
      chatJson,
      cleanString
    });
    const quality = evaluateStudyDraftQuality(rawDraft, cleanString, cleanObjectArray);
    let rawFinal = rawDraft;

    if (quality.shouldRefine) {
      try {
        rawFinal = await generateStudyRefinementPayload(context, quality, rawDraft, {
          chatJson,
          cleanString
        });
      } catch (_) {
        rawFinal = rawDraft;
      }
    }

    return normalizeStudyPayload(rawFinal, context, {
      cleanString,
      cleanArray,
      cleanObjectArray
    });
  }

  return {
    generateStudy,
    CLEAR_METHOD_STAGES,
    TEN_STEP_STUDY_METHOD
  };
}

function normalizeStudyContext(studyContext, cleanString) {
  const passage = studyContext && studyContext.passage ? studyContext.passage : {};
  return {
    passage: {
      reference: cleanString(passage.reference, "Unknown reference"),
      text: cleanString(passage.text),
      translation: cleanString(passage.translation, "WEB")
    },
    focus: cleanString(studyContext && studyContext.focus),
    question: cleanString(studyContext && studyContext.question)
  };
}

async function generateStudyPayload(studyContext, deps) {
  const { chatJson, cleanString } = deps;

  const prompt = buildBibleStudyPrompt({
    passage: studyContext.passage,
    focus: cleanString(studyContext.focus),
    question: cleanString(studyContext.question),
    clearDefinitions: CLEAR_METHOD_STAGES.map((stage) => ({
      key: stage.key,
      code: stage.code,
      label: stage.label,
      definition: stage.definition
    })),
    tenStepMethod: TEN_STEP_STUDY_METHOD
  });

  return chatJson({
    ...prompt,
    temperature: 0.18,
    maxTokens: 1400
  });
}

async function generateStudyRefinementPayload(studyContext, quality, draft, deps) {
  const { chatJson, cleanString } = deps;

  const prompt = buildBibleStudyRefinementPrompt({
    passage: studyContext.passage,
    focus: cleanString(studyContext.focus),
    question: cleanString(studyContext.question),
    clearDefinitions: CLEAR_METHOD_STAGES.map((stage) => ({
      key: stage.key,
      code: stage.code,
      label: stage.label,
      definition: stage.definition
    })),
    tenStepMethod: TEN_STEP_STUDY_METHOD,
    draft,
    qualitySignals: quality.signals
  });

  return chatJson({
    ...prompt,
    temperature: 0.14,
    maxTokens: 1700
  });
}

function evaluateStudyDraftQuality(rawDraft, cleanString, cleanObjectArray) {
  const draft = rawDraft && typeof rawDraft === "object" ? rawDraft : {};
  const signals = [];
  const summary = cleanString(draft.summary);
  const clearRows = cleanObjectArray(draft.clear, 12);
  const clearKeys = new Set(clearRows.map((row) => cleanString(row.key).toLowerCase()).filter(Boolean));
  const tenStepRows = cleanObjectArray(draft.tenStep, 16);
  const expectedClearKeys = ["confess", "list", "exegete", "analyze", "relate"];
  const missingClear = expectedClearKeys.filter((key) => !clearKeys.has(key));

  if (summary.length < 45) {
    signals.push("Summary is too thin and should be expanded with clearer study direction.");
  }
  if (missingClear.length) {
    signals.push(`Missing CLEAR stages in draft: ${missingClear.join(", ")}.`);
  }
  if (clearRows.length < 5) {
    signals.push("CLEAR section is incomplete.");
  }
  const thinClearRows = clearRows.filter((row) => {
    const actions = Array.isArray(row.actions) ? row.actions : [];
    const findings = Array.isArray(row.aiFindings) ? row.aiFindings : [];
    return actions.length < 3 || findings.length < 2;
  });
  if (thinClearRows.length >= 2) {
    signals.push("Multiple CLEAR stages are underdeveloped in actions/findings.");
  }
  if (tenStepRows.length < 10) {
    signals.push("10-step method is incomplete.");
  } else {
    const thinTenStep = tenStepRows.filter((row) => {
      const todo = Array.isArray(row.whatToDo) ? row.whatToDo : [];
      const aiHelps = Array.isArray(row.aiHelps) ? row.aiHelps : [];
      return todo.length < 2 || aiHelps.length < 2 || !cleanString(row.objective);
    });
    if (thinTenStep.length >= 3) {
      signals.push("Several 10-step entries lack depth or clear objectives.");
    }
  }

  return {
    shouldRefine: signals.length > 0,
    signals
  };
}

function normalizeStudyPayload(raw, studyContext, deps) {
  const { cleanString, cleanArray, cleanObjectArray } = deps;
  const payload = raw && typeof raw === "object" ? raw : {};
  const lensRaw = payload.passageLens && typeof payload.passageLens === "object"
    ? payload.passageLens
    : {};

  const clear = normalizeClear(payload.clear, deps);
  const tenStepPlan = normalizeTenStep(payload.tenStep, deps);
  const workflowRaw = payload.studyWorkflow && typeof payload.studyWorkflow === "object"
    ? payload.studyWorkflow
    : {};

  const assistantFallback = [
    `Begin with a focused reading of ${cleanString(studyContext.passage.reference)} before external research.`,
    "Document textual observations first, then move into interpretation.",
    "Track unresolved questions for verification in later steps."
  ];
  const nextActionsFallback = [
    "Complete CLEAR stage notes in order: Confess, List, Exegete, Analyze, Relate.",
    "Work through all ten study steps before final sermon/application synthesis.",
    "Mark uncertain claims as provisional and verify with trusted resources."
  ];
  const prayerFallback = [
    "Pray for humility, clarity, and obedience while handling the text.",
    "Ask the Lord to expose assumptions that distort interpretation.",
    "Pray for faithful application that serves your people."
  ];

  return {
    summary: cleanString(payload.summary, `Text-centered study plan for ${cleanString(studyContext.passage.reference)}.`),
    passageLens: {
      contextSummary: cleanString(lensRaw.contextSummary),
      textualHorizon: valueOrFallbackArray(lensRaw.textualHorizon, [
        "Immediate literary flow and argument.",
        "Key repeated terms, contrasts, and progression.",
        "Canonical connections worth testing."
      ], cleanArray, 6),
      interpretiveRisks: valueOrFallbackArray(lensRaw.interpretiveRisks, [
        "Reading assumptions into the text.",
        "Skipping grammatical or structural observation.",
        "Applying conclusions before verifying meaning."
      ], cleanArray, 6),
      pastoralAim: cleanString(lensRaw.pastoralAim)
    },
    clear,
    tenStep: tenStepPlan.steps,
    studyWorkflow: {
      assistantResponse: valueOrFallbackArray(workflowRaw.assistantResponse, assistantFallback, cleanArray, 8),
      nextActions: valueOrFallbackArray(workflowRaw.nextActions, nextActionsFallback, cleanArray, 8),
      prayerPrompts: valueOrFallbackArray(workflowRaw.prayerPrompts, prayerFallback, cleanArray, 6),
      integrationNotes: valueOrFallbackArray(workflowRaw.integrationNotes, tenStepPlan.integrationNotes, cleanArray, 7)
    }
  };
}

function normalizeClear(rawClear, deps) {
  const { cleanString, cleanArray, cleanObjectArray } = deps;
  const rows = cleanObjectArray(rawClear, 10);
  const byKey = new Map();

  for (const row of rows) {
    const key = normalizeClearStageKey(row, cleanString);
    if (key) {
      byKey.set(key, row);
    }
  }

  const clear = {};
  for (const stage of CLEAR_METHOD_STAGES) {
    const row = byKey.get(stage.key) || {};
    const fallback = buildClearFallback(stage);
    clear[stage.key] = {
      code: cleanString(row.code, stage.code),
      label: cleanString(row.label, stage.label),
      definition: cleanString(row.definition, stage.definition),
      stageSummary: cleanString(row.stageSummary, fallback.stageSummary),
      actions: valueOrFallbackArray(row.actions, fallback.actions, cleanArray, 8),
      aiFindings: valueOrFallbackArray(row.aiFindings, fallback.aiFindings, cleanArray, 8),
      diagnosticQuestions: valueOrFallbackArray(row.diagnosticQuestions, fallback.diagnosticQuestions, cleanArray, 7),
      microPrompts: valueOrFallbackArray(row.microPrompts, fallback.microPrompts, cleanArray, 6),
      deliverables: valueOrFallbackArray(row.deliverables, fallback.deliverables, cleanArray, 6),
      qualityChecks: valueOrFallbackArray(row.qualityChecks, fallback.qualityChecks, cleanArray, 6),
      cautions: valueOrFallbackArray(row.cautions, fallback.cautions, cleanArray, 5)
    };
  }

  return clear;
}

function normalizeClearStageKey(row, cleanString) {
  if (!row || typeof row !== "object") {
    return "";
  }

  const key = cleanString(row.key).toLowerCase();
  if (CLEAR_METHOD_STAGES.some((stage) => stage.key === key)) {
    return key;
  }

  const code = cleanString(row.code).toLowerCase();
  const label = cleanString(row.label).toLowerCase();
  const byCode = CLEAR_METHOD_STAGES.find((stage) => stage.code.toLowerCase() === code);
  if (byCode) {
    return byCode.key;
  }

  const byLabel = CLEAR_METHOD_STAGES.find((stage) => stage.label.toLowerCase() === label);
  if (byLabel) {
    return byLabel.key;
  }

  return "";
}

function normalizeTenStep(rawSteps, deps) {
  const { cleanString, cleanArray, cleanObjectArray } = deps;
  const rows = cleanObjectArray(rawSteps, 16);
  const byNumber = new Map();

  for (const row of rows) {
    const stepNumber = Number(row.stepNumber);
    if (Number.isFinite(stepNumber)) {
      byNumber.set(stepNumber, row);
    }
  }

  const steps = TEN_STEP_STUDY_METHOD.map((base) => {
    const row = byNumber.get(base.stepNumber) || {};
    const fallback = buildTenStepFallback(base);
    return {
      stepNumber: base.stepNumber,
      stepName: cleanString(row.stepName, base.stepName),
      objective: cleanString(row.objective, fallback.objective),
      whatToDo: valueOrFallbackArray(row.whatToDo, fallback.whatToDo, cleanArray, 7),
      aiHelps: valueOrFallbackArray(row.aiHelps, fallback.aiHelps, cleanArray, 6),
      outputArtifact: cleanString(row.outputArtifact, fallback.outputArtifact),
      qualityChecks: valueOrFallbackArray(row.qualityChecks, fallback.qualityChecks, cleanArray, 6)
    };
  });

  return {
    steps,
    integrationNotes: [
      "Move sequentially through all ten steps before final application.",
      "Treat unresolved claims as research questions, not conclusions."
    ]
  };
}

function valueOrFallbackArray(value, fallback, cleanArray, maxItems) {
  const rows = cleanArray(value, maxItems);
  if (rows.length) {
    return rows;
  }
  return cleanArray(fallback, maxItems);
}

function buildClearFallback(stage) {
  return {
    stageSummary: `Use ${stage.label} to advance disciplined interpretation of the passage.`,
    actions: [
      "Read the passage slowly at least three times.",
      "Record observations before conclusions.",
      "Flag assumptions that require verification."
    ],
    aiFindings: [
      "No AI findings were produced for this stage.",
      "Continue with the 10-step method while verifying claims."
    ],
    diagnosticQuestions: [
      "What textual evidence supports this claim?",
      "Where do I still need verification?"
    ],
    microPrompts: [
      `Help me execute ${stage.code} (${stage.label}) on this passage.`,
      "Surface the highest-priority next move."
    ],
    deliverables: [
      "A concise worksheet for this stage.",
      "A short list of unresolved questions."
    ],
    qualityChecks: [
      "Interpretive claims are text-anchored.",
      "Speculative conclusions are marked provisional."
    ],
    cautions: [
      "Avoid importing assumptions into the text.",
      "Avoid unverified historical or lexical claims."
    ]
  };
}

function buildTenStepFallback(step) {
  return {
    objective: `Complete ${step.stepName.toLowerCase()} with textual discipline.`,
    whatToDo: [
      "Start with direct observations from the passage.",
      "List ambiguities and assumptions for later verification.",
      "Document concrete outputs for this step."
    ],
    aiHelps: [
      `Coach me through Step ${step.stepNumber}: ${step.stepName}.`,
      "Challenge weak inferences and suggest stronger text anchors."
    ],
    outputArtifact: `${step.stepName} worksheet`,
    qualityChecks: [
      "Major claims are traceable to passage evidence.",
      "Uncertain claims are explicitly marked as provisional."
    ]
  };
}

module.exports = {
  createBibleStudyWorkflow,
  CLEAR_METHOD_STAGES,
  TEN_STEP_STUDY_METHOD
};
