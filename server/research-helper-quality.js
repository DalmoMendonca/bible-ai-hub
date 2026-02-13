"use strict";

/**
 * Factory for Research Helper quality-gating and normalization helpers.
 *
 * Keeping this logic outside `server.js` makes prompt/quality iteration safer:
 * - objective normalization is centralized
 * - revision/tighten outputs are normalized in one place
 * - quality gates can evolve independently from route handlers
 */
function createResearchHelperQualityTools(utils) {
  const cleanString = utils && typeof utils.cleanString === "function"
    ? utils.cleanString
    : (value, fallback = "") => String(value || fallback || "").trim();
  const cleanArray = utils && typeof utils.cleanArray === "function"
    ? utils.cleanArray
    : (value, max = 10) => (Array.isArray(value) ? value.map((item) => cleanString(item)).filter(Boolean).slice(0, max) : []);
  const cleanObjectArray = utils && typeof utils.cleanObjectArray === "function"
    ? utils.cleanObjectArray
    : (value, max = 10) => (Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(0, max) : []);
  const clampNumber = utils && typeof utils.clampNumber === "function"
    ? utils.clampNumber
    : (value, min, max, fallback) => {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        return fallback;
      }
      return Math.min(max, Math.max(min, number));
    };

  const ALLOWED_OBJECTIVES = new Set([
    "balanced",
    "clarity",
    "brevity",
    "warmth",
    "exegetical_precision"
  ]);

  function normalizeRevisionObjective(value) {
    const key = cleanString(value, "balanced")
      .toLowerCase()
      .replace(/[^a-z_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return ALLOWED_OBJECTIVES.has(key) ? key : "balanced";
  }

  function revisionObjectiveReason(objective, type) {
    const objectiveLabel = normalizeRevisionObjective(objective);
    const target = type === "tighten" ? "line edit" : "revision";
    if (objectiveLabel === "clarity") {
      return `This ${target} makes the message easier to follow from point to point.`;
    }
    if (objectiveLabel === "brevity") {
      return `This ${target} trims unnecessary wording so key truth lands faster.`;
    }
    if (objectiveLabel === "warmth") {
      return `This ${target} increases pastoral tone and relational connection with listeners.`;
    }
    if (objectiveLabel === "exegetical_precision") {
      return `This ${target} anchors the claim more tightly to the biblical text and argument.`;
    }
    return `This ${target} improves both faithfulness and communication impact for this sermon.`;
  }

  function normalizeResearchHelperGuidanceLine(item, objective, type) {
    const objectiveReason = revisionObjectiveReason(objective, type);
    if (typeof item === "string") {
      const text = cleanString(item);
      if (!text) {
        return "";
      }
      if (/why this helps this sermon:/i.test(text)) {
        return text;
      }
      return `${text} Why this helps this sermon: ${objectiveReason}`;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return "";
    }

    const action = cleanString(item.action || item.revision || item.change || item.line || item.text);
    const why = cleanString(item.whyThisHelps || item.why || item.rationale || item.reason);
    if (!action && !why) {
      return "";
    }

    const normalizedWhy = why || objectiveReason;
    if (!action) {
      return `Why this helps this sermon: ${normalizedWhy}`;
    }
    return `${action} Why this helps this sermon: ${normalizedWhy}`;
  }

  function normalizeResearchHelperGuidanceLines(value, options = {}) {
    if (!Array.isArray(value)) {
      return [];
    }

    const objective = normalizeRevisionObjective(options.objective);
    const max = clampNumber(Number(options.max || 10), 1, 20, 10);
    const type = options.type === "tighten" ? "tighten" : "revision";

    return value
      .map((item) => normalizeResearchHelperGuidanceLine(item, objective, type))
      .filter(Boolean)
      .slice(0, max);
  }

  function evaluateResearchHelperDraft(rawDraft, baselineScores, revisionObjective = "balanced") {
    const draft = rawDraft && typeof rawDraft === "object" ? rawDraft : {};
    const signals = [];
    const overallVerdict = cleanString(draft.overallVerdict);
    const scores = Array.isArray(baselineScores) && baselineScores.length
      ? baselineScores
      : cleanObjectArray(draft.scores, 8)
        .map((row) => ({
          label: cleanString(row.label),
          score: clampNumber(Number(row.score), 0, 10, 0),
          rationale: cleanString(row.rationale)
        }))
        .filter((row) => row.label);
    const strengths = cleanArray(draft.strengths, 12);
    const gaps = cleanArray(draft.gaps, 14);
    const revisions = normalizeResearchHelperGuidanceLines(draft.revisions, {
      objective: revisionObjective,
      max: 14,
      type: "revision"
    });
    const tightenLines = normalizeResearchHelperGuidanceLines(draft.tightenLines, {
      objective: revisionObjective,
      max: 10,
      type: "tighten"
    });

    if (overallVerdict.length < 38) {
      signals.push("Overall verdict needs clearer synthesis.");
    }
    if (scores.length) {
      const weakRationales = scores.filter((row) => cleanString(row.rationale).length < 24);
      if (weakRationales.length >= 2 && revisions.length < 7) {
        signals.push("Weak score rationale needs stronger revision guidance follow-through.");
      }
    }
    if (strengths.length < 3) {
      signals.push("Strength recognition is too sparse.");
    }
    if (gaps.length < 5) {
      signals.push("Gap analysis lacks detail.");
    }
    if (revisions.length < 6) {
      signals.push("Revision guidance is insufficient.");
    } else {
      const missingWhy = revisions.filter((line) => !/why this helps this sermon:/i.test(line));
      if (missingWhy.length >= 2) {
        signals.push("Revisions must explain why each change helps this specific sermon.");
      }
    }
    if (tightenLines.length < 3) {
      signals.push("Line-tightening guidance needs more examples.");
    } else {
      const tightenMissingWhy = tightenLines.filter((line) => !/why this helps this sermon:/i.test(line));
      if (tightenMissingWhy.length >= 1) {
        signals.push("Line-level edits must include sermon-specific rationale.");
      }
    }

    const lowScoreCount = scores.filter((row) => Number(row.score || 0) <= 6).length;
    if (lowScoreCount >= 2 && revisions.length < 8) {
      signals.push("Revision pack is too light for the detected weaknesses.");
    }

    return {
      shouldRefine: signals.length > 0,
      signals
    };
  }

  return {
    normalizeRevisionObjective,
    normalizeResearchHelperGuidanceLines,
    evaluateResearchHelperDraft
  };
}

module.exports = {
  createResearchHelperQualityTools
};

