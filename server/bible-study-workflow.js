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
    let rawCurrent = await generateStudyPayload(context, {
      chatJson,
      cleanString
    });
    let finalNormalized = normalizeStudyPayload(rawCurrent, context, {
      cleanString,
      cleanArray,
      cleanObjectArray
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const rawQuality = evaluateStudyDraftQuality(rawCurrent, context, cleanString, cleanObjectArray);
      const normalizedQuality = evaluateNormalizedStudyQuality(finalNormalized, context, cleanString, cleanArray);
      if (!rawQuality.shouldRefine && !normalizedQuality.shouldRefine) {
        return finalNormalized;
      }

      const qualitySignals = [
        ...rawQuality.signals,
        ...normalizedQuality.signals
      ];

      try {
        rawCurrent = await generateStudyRefinementPayload(context, {
          shouldRefine: qualitySignals.length > 0,
          signals: qualitySignals
        }, rawCurrent, {
          chatJson,
          cleanString
        });
      } catch (_) {
        break;
      }

      finalNormalized = normalizeStudyPayload(rawCurrent, context, {
        cleanString,
        cleanArray,
        cleanObjectArray
      });
    }

    // Last-resort quality floor for premium UX: never return blank/generic scaffolding.
    return enforceStudyQualityFloor(finalNormalized, context, {
      cleanString,
      cleanArray
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

function evaluateStudyDraftQuality(rawDraft, studyContext, cleanString, cleanObjectArray) {
  const draft = rawDraft && typeof rawDraft === "object" ? rawDraft : {};
  const signals = [];
  const summary = cleanString(draft.summary);
  const clearRows = coerceClearRows(draft.clear, cleanString, cleanObjectArray);
  const clearKeys = new Set(clearRows.map((row) => cleanString(row.key).toLowerCase()).filter(Boolean));
  const tenStepRows = cleanObjectArray(draft.tenStep, 16);
  const lensRaw = draft.passageLens && typeof draft.passageLens === "object" ? draft.passageLens : {};
  const expectedClearKeys = ["confess", "list", "exegete", "analyze", "relate"];
  const missingClear = expectedClearKeys.filter((key) => !clearKeys.has(key));
  const fallbackToken = /no ai findings were produced|use .* to advance disciplined interpretation|continue with the 10-step method/i;
  const passageReference = cleanString(studyContext && studyContext.passage && studyContext.passage.reference);
  const textAnchorTerms = topPassageTerms(studyContext && studyContext.passage && studyContext.passage.text, cleanString, 3).map((row) => row.term);

  if (summary.length < 45) {
    signals.push("Summary is too thin and should be expanded with clearer study direction.");
  }
  if (!cleanString(lensRaw.contextSummary)) {
    signals.push("Passage lens context summary is empty.");
  }
  if (!cleanString(lensRaw.pastoralAim)) {
    signals.push("Passage lens pastoral aim is empty.");
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
    const stageText = [
      ...actions,
      ...findings,
      cleanString(row.stageSummary)
    ].join(" ");
    return actions.length < 3 || findings.length < 2 || fallbackToken.test(stageText);
  });
  if (thinClearRows.length >= 2) {
    signals.push("Multiple CLEAR stages are underdeveloped in actions/findings.");
  }
  const passageAnchoredRows = clearRows.filter((row) => {
    const stageText = [
      ...(Array.isArray(row.actions) ? row.actions : []),
      ...(Array.isArray(row.aiFindings) ? row.aiFindings : []),
      cleanString(row.stageSummary)
    ].join(" ").toLowerCase();
    if (passageReference && stageText.includes(passageReference.toLowerCase())) {
      return true;
    }
    return textAnchorTerms.some((term) => term && stageText.includes(term));
  });
  if (passageAnchoredRows.length < 3) {
    signals.push("CLEAR stages are not sufficiently anchored to passage-specific language.");
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

function evaluateNormalizedStudyQuality(normalized, studyContext, cleanString, cleanArray) {
  const payload = normalized && typeof normalized === "object" ? normalized : {};
  const signals = [];
  const clear = payload.clear && typeof payload.clear === "object" ? payload.clear : {};
  const fallbackToken = /no ai findings were produced|continue with the 10-step method while verifying claims|use .* to advance disciplined interpretation/i;
  const summary = cleanString(payload.summary);
  if (!summary || /^text-centered study plan for /i.test(summary)) {
    signals.push("Summary still appears generic and should be passage-specific.");
  }
  const stageRows = CLEAR_METHOD_STAGES.map((stage) => clear[stage.key] || {});
  const sparseRows = stageRows.filter((row) => {
    const actions = cleanArray(row.actions, 12);
    const findings = cleanArray(row.aiFindings, 12);
    const sectionText = [...actions, ...findings, cleanString(row.stageSummary)].join(" ");
    return actions.length < 3 || findings.length < 3 || fallbackToken.test(sectionText);
  });
  if (sparseRows.length) {
    signals.push("One or more CLEAR stages remain sparse after normalization.");
  }

  const lens = payload.passageLens && typeof payload.passageLens === "object" ? payload.passageLens : {};
  if (!cleanString(lens.contextSummary)) {
    signals.push("Normalized context summary is empty.");
  }
  if (!cleanString(lens.pastoralAim)) {
    signals.push("Normalized pastoral aim is empty.");
  }

  const expectedReference = cleanString(studyContext && studyContext.passage && studyContext.passage.reference).toLowerCase();
  const passagesMentioned = stageRows.filter((row) => {
    const sectionText = [
      ...cleanArray(row.actions, 12),
      ...cleanArray(row.aiFindings, 12),
      cleanString(row.stageSummary)
    ].join(" ").toLowerCase();
    return expectedReference && sectionText.includes(expectedReference);
  });
  if (expectedReference && passagesMentioned.length < 2) {
    signals.push("Normalized CLEAR stages do not mention the requested passage enough.");
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

  const clear = normalizeClear(payload.clear, studyContext, deps);
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
      contextSummary: cleanString(
        lensRaw.contextSummary,
        `Read ${cleanString(studyContext.passage.reference)} in its immediate argument flow before drawing theological conclusions.`
      ),
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
      pastoralAim: cleanString(
        lensRaw.pastoralAim,
        buildPastoralAimFallback(studyContext, cleanString)
      )
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

function normalizeClear(rawClear, studyContext, deps) {
  const { cleanString, cleanArray, cleanObjectArray } = deps;
  const rows = coerceClearRows(rawClear, cleanString, cleanObjectArray);
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
    const fallback = buildClearFallback(stage, studyContext, cleanString);
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

function buildClearFallback(stage, studyContext, cleanString) {
  const reference = cleanString(studyContext && studyContext.passage && studyContext.passage.reference, "this passage");
  const focus = cleanString(studyContext && studyContext.focus);
  const anchors = topPassageTerms(studyContext && studyContext.passage && studyContext.passage.text, cleanString, 3)
    .map((row) => row.term);
  const anchorLine = anchors.length
    ? `Key repeated terms to test in ${reference}: ${anchors.join(", ")}.`
    : `Key repeated terms in ${reference} should be listed before conclusions.`;

  const stageActions = {
    confess: [
      `Pray through ${reference}, asking for humility, attentiveness, and obedience.`,
      "Write three first-observation notes before consulting external resources.",
      `State one assumption you are bringing into ${reference} and mark it for verification.`,
      focus ? `Name how your focus (${focus}) could bias interpretation.` : "Name how your ministry context could bias interpretation."
    ],
    list: [
      `List repeated words/phrases in ${reference} and note where they cluster.`,
      "Mark conjunctions, contrasts, commands, and cause-effect relationships.",
      "Sketch a preliminary movement outline using sentence-level structure.",
      anchorLine
    ],
    exegete: [
      "Identify key lexical and grammatical decisions that could change meaning.",
      "Test verb force, pronoun referents, and clause relationships before application.",
      "State the author's likely intended claim in one sentence with textual support.",
      `Record at least two interpretation questions from ${reference} that still need evidence.`
    ],
    analyze: [
      "Cross-check provisional conclusions with near-context and canonical context.",
      "Compare at least two historically representative interpretations.",
      "Separate high-confidence conclusions from open interpretive questions.",
      `Explain why your reading best fits the flow of ${reference}.`
    ],
    relate: [
      "Translate the core claim into a clear contemporary burden without flattening the text.",
      "Write one church-level and one personal-level application tied to textual logic.",
      "Draft one illustration that clarifies rather than replaces exposition.",
      `Prepare a concise call-to-response rooted in ${reference}.`
    ]
  };

  const stageFindings = {
    confess: [
      `The interpreter must approach ${reference} with repentance and attentiveness, not speed.`,
      `Initial observation should come before commentary so the text governs conclusions.`,
      focus ? `Your stated focus (${focus}) should be tested against the text, not imposed on it.` : `Your ministry focus should be tested against ${reference}, not imposed on it.`
    ],
    list: [
      `Structural patterns in ${reference} should be mapped before sermon movement decisions.`,
      `Repeated terms and contrasts in ${reference} likely indicate the author's argumentative emphasis.`,
      "Sentence relationships should determine emphasis, not only thematic preference."
    ],
    exegete: [
      `Authorial intent in ${reference} depends on clause-level and discourse-level observation.`,
      "Lexical options should be treated as hypotheses until supported by immediate context.",
      "Grammatical decisions should be documented with explicit textual evidence."
    ],
    analyze: [
      "Cross-references should confirm, not replace, the meaning established in the primary passage.",
      "Historical and theological background should clarify textual claims, not dominate them.",
      "Competing interpretations should be compared charitably and weighed by textual fit."
    ],
    relate: [
      "Application must preserve the passage's argument and redemptive intent.",
      "Illustration quality is measured by explanatory clarity, not emotional intensity.",
      "A faithful call-to-action should emerge from the text's logic and audience need."
    ]
  };

  const stageQuestions = {
    confess: [
      `Which personal assumptions could distort your reading of ${reference}?`,
      "Where are you tempted to move to application before observation?"
    ],
    list: [
      "Which repeated words, contrasts, or connectors carry the passage's movement?",
      "What sentence-level relationships must be preserved in your outline?"
    ],
    exegete: [
      "Which grammatical decisions are most determinative for meaning?",
      "What lexical claims require stronger support before preaching?"
    ],
    analyze: [
      "Which cross-references genuinely illuminate this passage and why?",
      "Which interpretation best accounts for both near and far context?"
    ],
    relate: [
      "How can this text confront and comfort your actual audience this week?",
      "Which applications are faithful, specific, and realistically actionable?"
    ]
  };

  return {
    stageSummary: `Use ${stage.label} to advance disciplined interpretation of the passage.`,
    actions: stageActions[stage.key] || [
      `Work the ${stage.label} stage directly in ${reference}.`,
      "Write conclusions only after listing textual evidence.",
      "Flag uncertain claims for verification."
    ],
    aiFindings: stageFindings[stage.key] || [
      `This stage should be anchored to ${reference}.`,
      "Claims must remain provisional until verified with textual evidence.",
      "Proceed through the full study flow before final synthesis."
    ],
    diagnosticQuestions: stageQuestions[stage.key] || [
      "What textual evidence supports this claim?",
      "Where do I still need verification?"
    ],
    microPrompts: [
      `Guide me through ${stage.code} (${stage.label}) in ${reference} with explicit textual anchors.`,
      "Identify the strongest and weakest inference in my current notes.",
      "Give one high-impact revision to improve faithfulness and clarity."
    ],
    deliverables: [
      "A concise worksheet for this stage.",
      "A short list of unresolved questions.",
      "A confidence label (high/medium/low) for each major claim."
    ],
    qualityChecks: [
      "Interpretive claims are text-anchored.",
      "Speculative conclusions are marked provisional.",
      "Applications preserve the passage's argument."
    ],
    cautions: [
      "Avoid importing assumptions into the text.",
      "Avoid unverified historical or lexical claims."
    ]
  };
}

function buildTenStepFallback(step) {
  const byStep = {
    1: {
      objective: "Complete observation with textual discipline.",
      whatToDo: [
        "Record repeated terms, commands, contrasts, and connectors before interpretation.",
        "Note paragraph flow and immediate literary context.",
        "Separate what the text says from what you infer."
      ]
    },
    2: {
      objective: "Build a provisional text-shaped outline.",
      whatToDo: [
        "Map each movement to clause/paragraph boundaries in the passage.",
        "Name each movement with a clear, textual heading.",
        "Test outline cohesion against the full passage flow."
      ]
    },
    3: {
      objective: "Run targeted word studies without overreach.",
      whatToDo: [
        "Select key words that materially affect interpretation.",
        "Compare usage in immediate context before broader corpus jumps.",
        "Document strongest lexical conclusions and open questions."
      ]
    },
    4: {
      objective: "Validate grammatical and syntactical claims.",
      whatToDo: [
        "Analyze verbs, modifiers, and clause relationships driving meaning.",
        "Check pronoun referents and argument structure transitions.",
        "Mark every grammar-dependent claim with evidence notes."
      ]
    },
    5: {
      objective: "Cross-reference for confirmation, not replacement.",
      whatToDo: [
        "Select cross-references that illuminate this passage's logic.",
        "Reject references that only echo preferred themes without textual fit.",
        "Explain how each reference confirms the primary text."
      ]
    },
    6: {
      objective: "Use historical background to clarify, not dominate.",
      whatToDo: [
        "Identify historical details that directly affect interpretation.",
        "Distinguish probable context from speculative reconstructions.",
        "Tie each background note back to explicit textual evidence."
      ]
    },
    7: {
      objective: "Synthesize theological background responsibly.",
      whatToDo: [
        "Locate where this passage fits in canonical theology.",
        "Differentiate what is explicit versus inferred.",
        "State theological conclusions with confidence levels."
      ]
    },
    8: {
      objective: "Cross-check conclusions for coherence and fidelity.",
      whatToDo: [
        "Re-test major claims against the full passage argument.",
        "Identify and resolve internal tensions in your interpretation.",
        "Flag unresolved issues for further study."
      ]
    },
    9: {
      objective: "Develop illustrations that clarify the text.",
      whatToDo: [
        "Draft illustrations that illuminate, not overshadow, exposition.",
        "Connect each illustration to one specific textual movement.",
        "Remove illustrations that do not improve understanding."
      ]
    },
    10: {
      objective: "Craft faithful and concrete application.",
      whatToDo: [
        "Derive application from the passage's argument and intent.",
        "Write specific response pathways for individuals and church life.",
        "Include one measurable action step for this week."
      ]
    }
  };
  const stage = byStep[step.stepNumber] || {
    objective: `Complete ${step.stepName.toLowerCase()} with textual discipline.`,
    whatToDo: [
      "Start with direct observations from the passage.",
      "List ambiguities and assumptions for later verification.",
      "Document concrete outputs for this step."
    ]
  };
  return {
    objective: stage.objective,
    whatToDo: stage.whatToDo,
    aiHelps: [
      `Coach me through Step ${step.stepNumber}: ${step.stepName}.`,
      "Challenge weak inferences and suggest stronger text anchors.",
      "Give one verification check before I finalize this step."
    ],
    outputArtifact: `${step.stepName} worksheet`,
    qualityChecks: [
      "Major claims are traceable to passage evidence.",
      "Uncertain claims are explicitly marked as provisional.",
      "Step output clearly feeds the next stage."
    ]
  };
}

function coerceClearRows(rawClear, cleanString, cleanObjectArray) {
  if (Array.isArray(rawClear)) {
    return cleanObjectArray(rawClear, 12);
  }
  if (!rawClear || typeof rawClear !== "object") {
    return [];
  }
  return cleanObjectArray(Object.entries(rawClear).map(([key, value]) => ({
    key,
    ...(value && typeof value === "object" ? value : {})
  })), 12);
}

function buildPastoralAimFallback(studyContext, cleanString) {
  const reference = cleanString(studyContext && studyContext.passage && studyContext.passage.reference, "this passage");
  const focus = cleanString(studyContext && studyContext.focus);
  if (focus) {
    return `Lead people through ${reference} so they respond to Scripture with faith, repentance, and concrete obedience related to ${focus}.`;
  }
  return `Lead people through ${reference} so interpretation produces faithful doctrine, worship, and practical obedience.`;
}

function enforceStudyQualityFloor(payload, studyContext, deps) {
  const { cleanString, cleanArray } = deps;
  const safe = payload && typeof payload === "object" ? payload : {};
  const clear = safe.clear && typeof safe.clear === "object" ? safe.clear : {};
  const reference = cleanString(studyContext && studyContext.passage && studyContext.passage.reference, "this passage");
  const text = cleanString(studyContext && studyContext.passage && studyContext.passage.text);
  const focus = cleanString(studyContext && studyContext.focus);
  const anchors = topPassageTerms(text, cleanString, 4).map((row) => row.term);
  const anchorText = anchors.length ? anchors.join(", ") : "the passage's key terms";

  const repairedClear = {};
  for (const stage of CLEAR_METHOD_STAGES) {
    const row = clear[stage.key] && typeof clear[stage.key] === "object" ? clear[stage.key] : {};
    const findings = cleanArray(row.aiFindings, 8);
    const actions = cleanArray(row.actions, 8);
    const hasStrongFindings = findings.length >= 3
      && !findings.some((line) => /no ai findings were produced/i.test(line));
    repairedClear[stage.key] = {
      ...row,
      actions: actions.length >= 3 ? actions : [
        `Work ${stage.label} directly in ${reference} before moving forward.`,
        `Anchor each claim to explicit textual evidence in ${reference}.`,
        "Mark uncertain conclusions for verification before preaching."
      ],
      aiFindings: hasStrongFindings ? findings : [
        `${reference} should be read with particular attention to ${anchorText}.`,
        `${stage.label} should produce evidence-based claims, not assumptions.`,
        "Interpretive confidence should be graded by textual support strength."
      ]
    };
  }

  const lens = safe.passageLens && typeof safe.passageLens === "object" ? safe.passageLens : {};
  return {
    ...safe,
    summary: cleanString(
      safe.summary,
      focus
        ? `Passage-focused study package for ${reference}, emphasizing ${focus}, with CLEAR and 10-step execution guidance.`
        : `Passage-focused study package for ${reference}, with CLEAR and 10-step execution guidance.`
    ),
    passageLens: {
      ...lens,
      contextSummary: cleanString(
        lens.contextSummary,
        `Read ${reference} in context and trace its argument before broad theological synthesis.`
      ),
      pastoralAim: cleanString(
        lens.pastoralAim,
        buildPastoralAimFallback(studyContext, cleanString)
      )
    },
    clear: repairedClear
  };
}

function topPassageTerms(text, cleanString, maxItems = 4) {
  const stop = new Set([
    "the", "and", "for", "that", "with", "this", "from", "have", "your", "you", "our",
    "are", "was", "were", "their", "will", "into", "about", "there", "what", "when",
    "where", "which", "while", "been", "being", "them", "they", "then", "than", "does",
    "did", "done", "through", "these", "those", "after", "before", "because", "under",
    "over", "within", "without", "would", "could", "should", "may", "might", "must",
    "unto", "upon", "said", "says", "his", "her", "him", "she", "has", "had", "not",
    "but", "all", "any", "each", "every", "who", "whom", "whose", "how", "why", "can",
    "also", "therefore", "thus", "it", "its", "god", "lord", "jesus", "christ", "verse"
  ]);
  const counts = new Map();
  const words = cleanString(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2 && !stop.has(item));
  for (const word of words) {
    counts.set(word, Number(counts.get(word) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
    .map(([term, count]) => ({ term, count }));
}

module.exports = {
  createBibleStudyWorkflow,
  CLEAR_METHOD_STAGES,
  TEN_STEP_STUDY_METHOD
};
