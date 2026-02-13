"use strict";

const {
  BIBLE_STUDY_PROMPT,
  BIBLE_STUDY_REFINER_PROMPT,
  buildBibleStudyPrompt,
  buildBibleStudyRefinementPrompt
} = require("./bible-study");
const {
  SERMON_PREPARATION_PROMPT,
  SERMON_PREPARATION_REFINER_PROMPT,
  buildSermonPreparationPrompt,
  buildSermonPreparationRefinementPrompt
} = require("./sermon-preparation");
const {
  TEACHING_TOOLS_PROMPT,
  TEACHING_TOOLS_REFINER_PROMPT,
  buildTeachingToolsPrompt,
  buildTeachingToolsRefinementPrompt
} = require("./teaching-tools");
const {
  RESEARCH_HELPER_PROMPT,
  RESEARCH_HELPER_REVISIONS_PROMPT,
  buildResearchHelperPrompt,
  buildResearchHelperRevisionPrompt
} = require("./research-helper");
const {
  VIDEO_SEARCH_GUIDANCE_PROMPT,
  VIDEO_SEARCH_RECOVERY_PROMPT,
  buildVideoSearchGuidancePrompt,
  buildVideoSearchRecoveryPrompt
} = require("./video-search");
const {
  SERMON_INSIGHTS_PROMPT,
  SERMON_COACHING_REFINER_PROMPT,
  buildSermonInsightsPrompt,
  buildSermonCoachingRefinementPrompt
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

function listPromptMetadata() {
  return Object.values(PROMPT_REGISTRY).map((prompt) => ({
    id: prompt.id,
    version: prompt.version,
    task: prompt.task
  }));
}

module.exports = {
  PROMPT_REGISTRY,
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
