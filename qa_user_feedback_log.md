# QA User-Journey Feedback Log (Tough but Fair)

Generated: 2026-02-13  
Tester mode: Paying ministry user evaluating full-value readiness across all apps.  
Data source: Real API outputs from end-to-end scenarios in `tmp_user_journey_outputs.json`.

## Scope and method
- Ran each app with realistic pastoral/teaching inputs (not smoke-test toy payloads).
- Reviewed output quality for usefulness, theological reliability, specificity, and production readiness.
- Checked practical UX contracts where possible from output behavior (not visual pixel QA).
- Stress-tested likely user behavior:
  - passage-based and topic-based generation
  - transcript-override analyzer run
  - real MP3 analyzer run
  - in-domain and out-of-domain video search queries

## Executive summary
- Current product has promising parts, but quality is uneven.
- Best-performing app: `teaching-tools` (useful, structured, mostly classroom-ready).
- Biggest risk to paid retention: `bible-study` and `video-search` outputs often feel generic/low-confidence while presented as authoritative.
- One user-facing formatting defect exists in `sermon-analyzer` (`[object Object]` actions in certain flows).

## Scorecard (paying-user lens)
- Bible Study: **2/10**
- Sermon Preparation: **7/10**
- Teaching Tools: **8/10**
- Research Helper: **7/10**
- Sermon Analyzer: **5/10**
- Video Search: **3/10**
- Platform/Telemetry plumbing: **8/10**

## Critical findings

### 1) Bible Study output is mostly template fallback, not true passage-specific help
- Severity: **Critical**
- Repro input:
  - Passage: `James 1:19-27`
  - Focus: `Spiritual maturity in speech, anger, and obedience`
  - Question: `How do I preach this passage so people move from hearing to doing?`
- Observed:
  - CLEAR stages returned generic repeated actions.
  - `aiFindings` repeatedly: `"No AI findings were produced for this stage."`
  - `passageLens.contextSummary` empty.
  - `passageLens.pastoralAim` empty.
  - Export pack confidence appears as `unknown` and citations empty.
- Why this is bad:
  - This fails the core value proposition of premium guided exegesis.
  - A paying user will perceive this as placeholder quality.
- Fix requirements:
  - Hard-gate output quality: if stage-specific findings are empty, auto-run refinement pass before responding.
  - Enforce minimum per-stage payload quality:
    - >= 3 passage-specific findings
    - >= 2 concrete interpretive tensions
    - >= 2 citations tied to claims
  - Add rejection criteria in server sanitizer for "generic repeated checklist" outputs.
- Acceptance criteria:
  - For 10 random passages, no CLEAR stage contains fallback text.
  - Context summary and pastoral aim are non-empty and passage-specific.

### 2) Sermon Analyzer can emit broken action text (`[object Object]`)
- Severity: **Critical**
- Repro input:
  - `asyncMode: true`, transcript override sermon text (no file), localAnalysis object.
- Observed:
  - `coachingFeedback.priorityActions` became:
    - `"[object Object]"`
    - `"[object Object]"`
    - `"[object Object]"`
- Why this is bad:
  - Directly visible broken UX in a premium analyzer product.
  - Indicates schema normalization gap between prompt output and renderer expectations.
- Fix requirements:
  - Normalize `priorityActions` robustly:
    - accept string OR object (`{action, rationale, priority, metric}`).
  - Render structured actions (not flattening objects with `String(obj)`).
  - Add contract tests for both shapes.
- Acceptance criteria:
  - No `[object Object]` in output payload or UI under any analyzer mode.

## High findings

### 3) Sermon Preparation drifted outside requested passage boundaries
- Severity: **High**
- Repro input:
  - Passage: `Luke 15:11-24`
- Observed:
  - Outline point includes "older brother's heart," which is verse 25+ (outside provided scope).
- Why this matters:
  - Expository users expect strict text boundaries unless explicitly asked for wider context.
- Fix requirements:
  - Add "passage boundary discipline" constraint:
    - block claims based on verses outside supplied passage unless flagged as "broader context inference."
  - Return explicit `out_of_scope_references` if model expands context.
- Acceptance criteria:
  - For bounded passage inputs, outline references stay inside bounds unless tagged as optional context.

### 4) Video Search returns low-relevance matches with high-confidence tone
- Severity: **High**
- Repro queries:
  - `How do I run a Greek word study in Logos 10?`
  - `How do I counsel trauma victims with Logos workflows?`
- Observed:
  - Results mainly from "How To Write A Research Paper Using Logo."
  - Guidance sounds confident despite weak semantic fit.
  - No "low-confidence / insufficient corpus" user warning.
- Why this matters:
  - Paying users lose trust quickly when search appears confidently wrong.
- Fix requirements:
  - Add confidence calibration:
    - if top score below threshold, show "insufficient confidence" state.
  - Add no/low-match behavior:
    - ask follow-up clarification
    - suggest nearest in-domain topics
    - optionally trigger ingest/transcribe queue.
  - Show reason transparency:
    - semantic score, transcript coverage, corpus size.
- Acceptance criteria:
  - Off-topic queries do not return confident "watch this" guidance unless confidence threshold is met.

### 5) Sermon Analyzer metrics can be misleading in transcript-only runs
- Severity: **High**
- Repro:
  - Transcript override without uploaded audio.
- Observed:
  - `vocalDynamics` all zero values.
  - Pacing derived from synthetic segmentation; may look precise but is not audio-backed.
- Why this matters:
  - Users may make coaching decisions from fabricated precision.
- Fix requirements:
  - Explicit metric provenance flags:
    - `source: "audio" | "transcript_estimate" | "unavailable"`.
  - Replace zeroed acoustic metrics with `null` + explanatory note when no audio signal available.
  - Gate coaching advice that depends on unavailable signals.
- Acceptance criteria:
  - No audio-derived metric is shown as numeric when underlying audio analysis was not run.

## Medium findings

### 6) QA script regression: `scripts/test-sermon-analyzer-file.js` fails with auth required
- Severity: **Medium**
- Observed:
  - Script now returns `401 Authentication required.`
- Impact:
  - Makes local QA less reliable for a key premium feature.
- Fix:
  - Update script to create guest session and include auth headers.

### 7) Research Helper revision suggestions are good but occasionally editorially shallow
- Severity: **Medium**
- Observed:
  - Some line-tightening is useful; some suggestions are stylistic and not clearly tied to sermon goals.
- Fix:
  - Add revision-mode objective selection (`clarity`, `brevity`, `warmth`, `exegetical precision`).
  - Require each revision suggestion to include "why this helps this sermon."

## Positive findings (keep and build on)
- `teaching-tools` handled topic input well and generated practical, age-adapted content.
- Multi-audience generation produced meaningfully different kits (kids vs youth).
- `sermon-preparation` produced strong big idea, transitions, applications, and timing plan.
- Platform usage/activity tracking appears coherent and useful for product analytics.

## Recommended next sprint priorities
- P0
  - Fix Bible Study fallback-quality issue with hard quality gates + refinement retries.
  - Fix Sermon Analyzer action-shape normalization (`[object Object]` defect).
  - Implement video search confidence threshold and low-match UX.
- P1
  - Add passage-boundary enforcement to Sermon Preparation.
  - Add metric provenance and null-safe handling in Sermon Analyzer.
  - Repair auth flow in analyzer file QA script.
- P2
  - Add user-facing confidence panels and "why this output" transparency across all apps.

## Bottom line
- The platform is technically functional, but two flagship value areas (`bible-study`, `video-search`) are not yet at "paying-user wow" level.
- Fixing the critical/high issues above will materially increase trust, retention, and willingness to pay full price.

