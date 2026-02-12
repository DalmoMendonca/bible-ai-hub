"use strict";

const { BIBLE_STUDY_PROMPT, buildBibleStudyPrompt } = require("./bible-study");
const { SERMON_PREPARATION_PROMPT, buildSermonPreparationPrompt } = require("./sermon-preparation");
const { TEACHING_TOOLS_PROMPT, buildTeachingToolsPrompt } = require("./teaching-tools");
const { RESEARCH_HELPER_PROMPT, buildResearchHelperPrompt } = require("./research-helper");
const { VIDEO_SEARCH_GUIDANCE_PROMPT, buildVideoSearchGuidancePrompt } = require("./video-search");
const { SERMON_INSIGHTS_PROMPT, buildSermonInsightsPrompt } = require("./sermon-analyzer");

const PROMPT_REGISTRY = Object.freeze({
  [BIBLE_STUDY_PROMPT.id]: BIBLE_STUDY_PROMPT,
  [SERMON_PREPARATION_PROMPT.id]: SERMON_PREPARATION_PROMPT,
  [TEACHING_TOOLS_PROMPT.id]: TEACHING_TOOLS_PROMPT,
  [RESEARCH_HELPER_PROMPT.id]: RESEARCH_HELPER_PROMPT,
  [VIDEO_SEARCH_GUIDANCE_PROMPT.id]: VIDEO_SEARCH_GUIDANCE_PROMPT,
  [SERMON_INSIGHTS_PROMPT.id]: SERMON_INSIGHTS_PROMPT
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
  buildSermonPreparationPrompt,
  buildTeachingToolsPrompt,
  buildResearchHelperPrompt,
  buildVideoSearchGuidancePrompt,
  buildSermonInsightsPrompt
};
