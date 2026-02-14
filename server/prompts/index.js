"use strict";

const {
  BIBLE_STUDY_PROMPT,
  BIBLE_STUDY_REFINER_PROMPT,
  buildBibleStudyPrompt: buildBibleStudyPromptBase,
  buildBibleStudyRefinementPrompt: buildBibleStudyRefinementPromptBase
} = require("./bible-study");
const {
  SERMON_PREPARATION_PROMPT,
  SERMON_PREPARATION_REFINER_PROMPT,
  buildSermonPreparationPrompt: buildSermonPreparationPromptBase,
  buildSermonPreparationRefinementPrompt: buildSermonPreparationRefinementPromptBase
} = require("./sermon-preparation");
const {
  TEACHING_TOOLS_PROMPT,
  TEACHING_TOOLS_REFINER_PROMPT,
  buildTeachingToolsPrompt: buildTeachingToolsPromptBase,
  buildTeachingToolsRefinementPrompt: buildTeachingToolsRefinementPromptBase
} = require("./teaching-tools");
const {
  RESEARCH_HELPER_PROMPT,
  RESEARCH_HELPER_REVISIONS_PROMPT,
  buildResearchHelperPrompt: buildResearchHelperPromptBase,
  buildResearchHelperRevisionPrompt: buildResearchHelperRevisionPromptBase
} = require("./research-helper");
const {
  VIDEO_SEARCH_GUIDANCE_PROMPT,
  VIDEO_SEARCH_RECOVERY_PROMPT,
  buildVideoSearchGuidancePrompt: buildVideoSearchGuidancePromptBase,
  buildVideoSearchRecoveryPrompt: buildVideoSearchRecoveryPromptBase
} = require("./video-search");
const {
  SERMON_INSIGHTS_PROMPT,
  SERMON_COACHING_REFINER_PROMPT,
  buildSermonInsightsPrompt: buildSermonInsightsPromptBase,
  buildSermonCoachingRefinementPrompt: buildSermonCoachingRefinementPromptBase
} = require("./sermon-analyzer");

const PROMPT_REGISTRY = Object.freeze({
  [BIBLE_STUDY_PROMPT.id]: BIBLE_STUDY_PROMPT,
  [BIBLE_STUDY_REFINER_PROMPT.id]: BIBLE_STUDY_REFINER_PROMPT,
  [SERMON_PREPARATION_PROMPT.id]: SERMON_PREPARATION_PROMPT,
  [SERMON_PREPARATION_REFINER_PROMPT.id]: SERMON_PREPARATION_REFINER_PROMPT,
  [TEACHING_TOOLS_PROMPT.id]: TEACHING_TOOLS_PROMPT,
  [TEACHING_TOOLS_REFINER_PROMPT.id]: TEACHING_TOOLS_REFINER_PROMPT,
  [RESEARCH_HELPER_PROMPT.id]: RESEARCH_HELPER_PROMPT,
  [RESEARCH_HELPER_REVISIONS_PROMPT.id]: RESEARCH_HELPER_REVISIONS_PROMPT,
  [VIDEO_SEARCH_GUIDANCE_PROMPT.id]: VIDEO_SEARCH_GUIDANCE_PROMPT,
  [VIDEO_SEARCH_RECOVERY_PROMPT.id]: VIDEO_SEARCH_RECOVERY_PROMPT,
  [SERMON_INSIGHTS_PROMPT.id]: SERMON_INSIGHTS_PROMPT,
  [SERMON_COACHING_REFINER_PROMPT.id]: SERMON_COACHING_REFINER_PROMPT
});

let promptOverrideResolver = null;

function cleanString(value, fallback = "") {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  const asText = String(value).trim();
  return asText || fallback;
}

function setPromptOverrideResolver(resolver) {
  promptOverrideResolver = typeof resolver === "function"
    ? resolver
    : null;
}

function applyPromptOverride(promptId, builtPrompt) {
  const base = builtPrompt && typeof builtPrompt === "object"
    ? builtPrompt
    : {};
  if (typeof promptOverrideResolver !== "function") {
    return base;
  }

  try {
    const resolved = promptOverrideResolver(promptId, base);
    if (!resolved || typeof resolved !== "object") {
      return base;
    }
    return {
      ...base,
      system: cleanString(resolved.system, cleanString(base.system)),
      user: cleanString(resolved.user, cleanString(base.user))
    };
  } catch (_) {
    return base;
  }
}

function buildBibleStudyPrompt(input) {
  return applyPromptOverride(BIBLE_STUDY_PROMPT.id, buildBibleStudyPromptBase(input));
}

function buildBibleStudyRefinementPrompt(input) {
  return applyPromptOverride(BIBLE_STUDY_REFINER_PROMPT.id, buildBibleStudyRefinementPromptBase(input));
}

function buildSermonPreparationPrompt(input) {
  return applyPromptOverride(SERMON_PREPARATION_PROMPT.id, buildSermonPreparationPromptBase(input));
}

function buildSermonPreparationRefinementPrompt(input) {
  return applyPromptOverride(SERMON_PREPARATION_REFINER_PROMPT.id, buildSermonPreparationRefinementPromptBase(input));
}

function buildTeachingToolsPrompt(input) {
  return applyPromptOverride(TEACHING_TOOLS_PROMPT.id, buildTeachingToolsPromptBase(input));
}

function buildTeachingToolsRefinementPrompt(input) {
  return applyPromptOverride(TEACHING_TOOLS_REFINER_PROMPT.id, buildTeachingToolsRefinementPromptBase(input));
}

function buildResearchHelperPrompt(input) {
  return applyPromptOverride(RESEARCH_HELPER_PROMPT.id, buildResearchHelperPromptBase(input));
}

function buildResearchHelperRevisionPrompt(input) {
  return applyPromptOverride(RESEARCH_HELPER_REVISIONS_PROMPT.id, buildResearchHelperRevisionPromptBase(input));
}

function buildVideoSearchGuidancePrompt(input) {
  return applyPromptOverride(VIDEO_SEARCH_GUIDANCE_PROMPT.id, buildVideoSearchGuidancePromptBase(input));
}

function buildVideoSearchRecoveryPrompt(input) {
  return applyPromptOverride(VIDEO_SEARCH_RECOVERY_PROMPT.id, buildVideoSearchRecoveryPromptBase(input));
}

function buildSermonInsightsPrompt(input) {
  return applyPromptOverride(SERMON_INSIGHTS_PROMPT.id, buildSermonInsightsPromptBase(input));
}

function buildSermonCoachingRefinementPrompt(input) {
  return applyPromptOverride(SERMON_COACHING_REFINER_PROMPT.id, buildSermonCoachingRefinementPromptBase(input));
}

function listPromptMetadata() {
  return Object.values(PROMPT_REGISTRY).map((prompt) => ({
    id: prompt.id,
    version: prompt.version,
    task: prompt.task
  }));
}

module.exports = {
  PROMPT_REGISTRY,
  setPromptOverrideResolver,
  listPromptMetadata,
  buildBibleStudyPrompt,
  buildBibleStudyRefinementPrompt,
  buildSermonPreparationPrompt,
  buildSermonPreparationRefinementPrompt,
  buildTeachingToolsPrompt,
  buildTeachingToolsRefinementPrompt,
  buildResearchHelperPrompt,
  buildResearchHelperRevisionPrompt,
  buildVideoSearchGuidancePrompt,
  buildVideoSearchRecoveryPrompt,
  buildSermonInsightsPrompt,
  buildSermonCoachingRefinementPrompt
};
