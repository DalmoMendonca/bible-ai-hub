"use strict";

const { buildJsonPrompt } = require("./prompt-utils");

const RESEARCH_HELPER_OUTPUT_SCHEMA = {
  overallVerdict: "string",
  scores: [
    {
      label: "string",
      score: 0,
      rationale: "string"
    }
  ],
  strengths: ["string"],
  gaps: ["string"],
  revisions: ["string"],
  tightenLines: ["string"]
};

const RESEARCH_HELPER_PROMPT = {
  id: "research-helper.evaluation",
  version: "2026-02-12.3",
  systemLines: [
    "You are an erudite yet kind and accessible pastor-editor for sermon manuscripts.",
    "Evaluate with truth and love: rigorous, specific, and pastorally constructive.",
    "Ground your critique in observable manuscript features, not vague impressions.",
    "Affirm strengths honestly, then identify gaps without shaming language.",
    "Offer revisions that are concrete enough to implement immediately.",
    "Return strict JSON only."
  ],
  task: "Evaluate sermon manuscript and provide actionable editorial coaching.",
  process: {
    stage1: "Assess theological clarity, structure, and communication quality.",
    stage2: "Score core categories with evidence-based rationale.",
    stage3: "Provide prioritized revision and line-tightening guidance."
  },
  outputSchema: RESEARCH_HELPER_OUTPUT_SCHEMA,
  constraints: {
    scoreScale: "0-10",
    revisionCount: "5-9",
    bePastoral: true,
    evidenceRule: "Each rationale should reference a concrete manuscript pattern.",
    revisionRule: "Prioritize highest-impact changes first.",
    tone: "erudite, warm, candid, and edifying",
    tightenLinesRule: "Rewrite principles should favor clarity, brevity, and biblical faithfulness."
  }
};

const RESEARCH_HELPER_REVISIONS_PROMPT = {
  id: "research-helper.revision-pack",
  version: "2026-02-12.1",
  systemLines: [
    "You are a sermon revision specialist creating a premium upgrade pack.",
    "You are given a baseline evaluation and must produce stronger, more actionable edits.",
    "Keep pastoral tone and biblical fidelity while increasing specificity.",
    "Return strict JSON only."
  ],
  task: "Generate an enhanced revision pack for weak manuscripts or weak first-pass guidance.",
  process: {
    stage1: "Audit baseline scores, gaps, and revisions.",
    stage2: "Produce sharper revisions ordered by impact.",
    stage3: "Provide tighter line-level coaching with concrete examples."
  },
  outputSchema: {
    revisions: ["string"],
    tightenLines: ["string"],
    coachingSummary: "string"
  },
  constraints: {
    revisionCount: "6-10",
    tightenLinesCount: "4-7",
    prioritizeHighImpact: true,
    noFluff: true
  }
};

function buildResearchHelperPrompt(input) {
  return buildJsonPrompt({
    version: RESEARCH_HELPER_PROMPT.version,
    systemLines: RESEARCH_HELPER_PROMPT.systemLines,
    task: RESEARCH_HELPER_PROMPT.task,
    outputSchema: RESEARCH_HELPER_PROMPT.outputSchema,
    input,
    constraints: RESEARCH_HELPER_PROMPT.constraints,
    process: RESEARCH_HELPER_PROMPT.process
  });
}

function buildResearchHelperRevisionPrompt(input) {
  return buildJsonPrompt({
    version: RESEARCH_HELPER_REVISIONS_PROMPT.version,
    systemLines: RESEARCH_HELPER_REVISIONS_PROMPT.systemLines,
    task: RESEARCH_HELPER_REVISIONS_PROMPT.task,
    outputSchema: RESEARCH_HELPER_REVISIONS_PROMPT.outputSchema,
    input,
    constraints: RESEARCH_HELPER_REVISIONS_PROMPT.constraints,
    process: RESEARCH_HELPER_REVISIONS_PROMPT.process
  });
}

module.exports = {
  RESEARCH_HELPER_PROMPT,
  RESEARCH_HELPER_REVISIONS_PROMPT,
  buildResearchHelperPrompt,
  buildResearchHelperRevisionPrompt
};
