# User Test Remediation Plan

Generated: 2026-02-13  
Source feedback: `qa_user_feedback_log.md`

## Objective
Address every actionable finding from the user-test pass and document implementation details and verification evidence.

## Workstream Map

### W1. Bible Study quality floor (Critical)
- Problem:
  - CLEAR/10-step payloads can fall back to generic templates with missing passage-specific findings.
- Plan:
  - Add stronger draft quality scoring and hard failover logic in `server/bible-study-workflow.js`.
  - Add a second-pass rescue generation when the first refined payload still looks generic.
  - Detect and reject fallback-like lines (e.g., "No AI findings were produced...") in quality checks.
  - Enforce minimum stage depth and non-empty `passageLens.contextSummary` and `passageLens.pastoralAim`.
  - Improve evidence/export generation to use normalized output and prevent "unknown confidence" drift.
- Acceptance criteria:
  - CLEAR stages include passage-specific findings and no fallback markers.
  - `contextSummary` and `pastoralAim` are non-empty.
  - Exports reflect normalized/evidence-augmented data.

### W2. Sermon Analyzer payload robustness + provenance (Critical/High)
- Problem:
  - `priorityActions` can surface as `"[object Object]"`.
  - Transcript-only mode can present audio-like precision without provenance context.
- Plan:
  - Normalize coaching arrays to support both strings and object-shaped action rows.
  - Add explicit metric provenance metadata in analyzer API response:
    - `audio`, `transcript_estimate`, `unavailable`.
  - Replace transcript-only acoustic zeros with nullable semantics + explanatory notes.
  - Update analyzer frontend to render structured action objects and show provenance badges/notes.
- Acceptance criteria:
  - No `"[object Object]"` in API/UI.
  - Transcript-only runs clearly label metric source and do not imply measured acoustics.

### W3. Video Search confidence calibration (High)
- Problem:
  - Weak-match queries still produce confident guidance and recommendations.
- Plan:
  - Compute quality diagnostics (top score, mean top-K score, lexical overlap, corpus coverage).
  - Add confidence tiers (`high`, `medium`, `low`) + reason codes in API payload.
  - Add low-confidence behavior:
    - cautionary guidance prefix
    - query-clarification suggestions
    - avoid over-assertive learning-path language.
  - Render confidence diagnostics in video-search UI.
- Acceptance criteria:
  - Low-confidence queries visibly surface uncertainty and safer next steps.
  - Guidance tone aligns with confidence tier.

### W4. Sermon Preparation passage-boundary guardrails (High)
- Problem:
  - Outline may drift outside user-provided passage bounds.
- Plan:
  - Strengthen sermon-preparation prompts with strict passage-boundary instructions.
  - Add server-side boundary checker for supporting references versus requested span.
  - Preserve out-of-bound refs as explicitly flagged contextual notes/warnings.
  - Return boundary diagnostics in response for transparent UX.
- Acceptance criteria:
  - Out-of-range references are flagged and excluded from core exegesis support lists.
  - Payload includes diagnostics for any boundary drift.

### W5. QA script reliability (Medium)
- Problem:
  - `scripts/test-sermon-analyzer-file.js` fails with auth-required API.
- Plan:
  - Add guest-session bootstrap and auth headers to script before analyzer POSTs.
- Acceptance criteria:
  - Script runs successfully against auth-protected analyzer endpoint.

### W6. Research Helper revision objective + rationale depth (Medium)
- Problem:
  - Revision suggestions can be stylistic/editorially shallow.
- Plan:
  - Add `revisionObjective` input (`balanced`, `clarity`, `brevity`, `warmth`, `exegetical_precision`) in UI + API.
  - Align prompts to objective focus.
  - Require each revision/line-tightening recommendation to include explicit `Why this helps this sermon:` rationale.
  - Add server-side normalization/quality checks so rationale remains present even when model output is mixed-shape.
- Acceptance criteria:
  - User can choose a revision objective in Research Helper.
  - API echoes normalized objective and returns revision lines with explicit why-this-helps rationale.

## Execution Log
- Status legend:
  - `[ ]` planned
  - `[x]` complete

- [x] W1 implemented
  - `server/bible-study-workflow.js`
    - Added stronger quality gates and retry/refinement flow (`generateStudy`, `evaluateStudyDraftQuality`, `evaluateNormalizedStudyQuality`, `enforceStudyQualityFloor`).
    - Replaced generic fallback rows with stage-specific, passage-aware fallback scaffolding.
    - Enforced non-empty `passageLens.contextSummary` and `passageLens.pastoralAim`.
  - `server/prompts/bible-study.js`
    - Added anti-placeholder constraints and passage-anchoring requirements.
  - `server.js`
    - `attachBibleStudyEvidence(...)` export paths now use evidence-augmented payload, fixing confidence/citation drift in exports.

- [x] W2 implemented
  - `server.js`
    - Added metric provenance plumbing (`resolveAnalyzerMetricProvenance`, `meta.metricProvenance`).
    - `computePacingAnalysis` and `computeVocalDynamics` now return `source` + `sourceNote`.
    - Transcript-only acoustic metrics now return `null` (not synthetic zero) when unavailable.
    - Normalized coaching list parsing with `normalizeCoachingListItems(...)` to prevent `[object Object]` defects.
    - Fixed coaching drill metric key mismatches (`avgWpm`, `gospelClarityScore`).
  - `server/prompts/sermon-analyzer.js`
    - Tightened output contract so priority actions are plain strings.
  - `assets/apps/sermon-analyzer.js`
    - Added robust list normalization and null-safe metric rendering (`N/A` + provenance notes).

- [x] W3 implemented
  - `server.js`
    - Added confidence diagnostics pipeline (`assessVideoSearchConfidence`, `shouldUseLowConfidenceGuidancePrefix`, `buildLowConfidenceGuidancePrefix`).
    - Tightened low-confidence thresholding (including low score + weak overlap combinations).
    - Added caution-prefix behavior for weak medium states (not only hard-low).
    - Returned `confidence` object in `/api/ai/video-search`.
  - `server/prompts/video-search.js`
    - Added explicit uncertainty behavior for low-confidence outputs.
  - `assets/apps/video-search.js`
    - Added confidence card and switched per-row label from “AI confidence” to “Match score”.

- [x] W4 implemented
  - `server.js`
    - Added passage-bound parser + enforcement (`parsePrimaryPassageBounds`, `enforceSupportingReferenceBounds`, helpers).
    - Out-of-scope references are removed from `supportingReferences`, preserved in `contextualReferences`, and surfaced in `passageBoundary` diagnostics.
  - `server/prompts/sermon-preparation.js`
    - Added strict passage-boundary constraints.
  - `assets/apps/sermon-preparation.js`
    - Renders contextual references + boundary diagnostics section.

- [x] W5 implemented
  - `scripts/test-sermon-analyzer-file.js`
    - Added guest auth bootstrap and auth headers for analyzer upload requests.

- [x] W6 implemented
  - `ai/apps/research-helper/index.html`
    - Added `Revision Objective` selector.
  - `assets/apps/research-helper.js`
    - Sends `revisionObjective` to API, persists in project payload, and displays objective in AI verdict panel.
  - `server/prompts/research-helper.js`
    - Prompt now enforces objective-aware coaching and explicit `Why this helps this sermon:` rationale.
  - `server.js`
    - Added `normalizeRevisionObjective(...)`.
    - Added `normalizeResearchHelperGuidanceLines(...)` to support string/object LLM outputs and enforce rationale line format.
    - Added rationale depth checks in `evaluateResearchHelperDraft(...)`.
    - API now returns normalized `revisionObjective` and rationale-rich revisions.
  - `server/prompts/README.md`
    - Updated orchestration documentation to reflect objective-aware revision behavior.
  - `scripts/user-feedback-regression.js` (new)
    - Added end-to-end regression suite for all user-test findings, including Research Helper objective rationale checks.

## Verification Command Log
- `node --check server.js` -> passed
- `node --check scripts/user-feedback-regression.js` -> passed
- `node --check assets/apps/research-helper.js` -> passed
- `npm run test:user-feedback` -> passed
  - Bible Study quality floor: passed
  - Sermon Analyzer transcript-mode provenance: passed
  - Video Search low-confidence behavior: passed
  - Sermon Preparation passage bounds: passed
  - Research Helper objective rationale: passed
  - Sermon Analyzer file script (auth + upload): passed
- `node scripts/crossfunctional-test.js` -> passed
- `npm run smoke` -> passed
- `npm run smoke:platform` -> passed

## Verification Checklist
- [x] Targeted regression: Bible Study scenario from QA log.
- [x] Targeted regression: Sermon Analyzer transcript-only and file-upload scenarios.
- [x] Targeted regression: Video Search weak-match query behavior.
- [x] Targeted regression: Sermon Preparation bounded passage reference behavior.
- [x] Broad regression: `node scripts/crossfunctional-test.js`
- [x] Broad regression: `npm run smoke`
- [x] Broad regression: `npm run smoke:platform`
