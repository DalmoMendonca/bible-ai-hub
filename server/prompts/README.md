# Prompt Catalog

All production prompts live in `server/prompts/`.

## Goals

- Keep prompt engineering easy to iterate without touching route logic.
- Keep schemas and constraints visible at a glance.
- Version every prompt so output changes are traceable.
- Maintain one voice across tools: erudite, kind, accessible, pastorally useful.

## Prompt Files

- `bible-study.js`
- `sermon-preparation.js`
- `teaching-tools.js`
- `research-helper.js`
- `video-search.js`
- `sermon-analyzer.js`
- `index.js` (registry + metadata export)
- `prompt-utils.js` (shared JSON prompt builder)

## Tool Purpose + Orchestration

### Bible Study

- Primary prompt: `bible-study.package`
- Optional second pass: `bible-study.refiner`
- Runtime gate: refiner triggers only when first-pass quality signals are weak (missing CLEAR depth, incomplete 10-step coverage, thin workflow guidance).
- Output target: complete CLEAR + 10-step package with action-ready study workflow.

### Sermon Preparation

- Primary prompt: `sermon-preparation.plan`
- Optional second pass: `sermon-preparation.refiner`
- Runtime gate: refiner triggers when draft is thin (weak big idea, weak outline depth, poor timing coherence, sparse transitions/applications).
- Output target: preachable plan with coherent movements, applications, and timing.

### Teaching Tools

- Primary prompt: `teaching-tools.kit`
- Optional second pass: `teaching-tools.refiner`
- Runtime gate: refiner triggers when lesson kit lacks timeline realism, question coverage, application depth, or leader utility.
- Output target: classroom-ready teaching kit by audience/setting/length.

### Research Helper

- Primary prompt: `research-helper.evaluation`
- Optional second pass: `research-helper.revision-pack`
- Runtime gate: revision pack triggers when manuscript report is shallow (thin verdict/scores/revisions/tightening lines).
- Output target: high-impact editorial coaching plus tighter revision pack.

### Video Search

- Primary prompt: `video-search.guidance`
- Optional recovery prompt: `video-search.recovery`
- Runtime gate: recovery runs when search results are sparse.
- Output target: timestamped results + practical guidance + stronger follow-up query strategy.

### Sermon Analyzer

- Primary prompt: `sermon-analyzer.insights`
- Optional second pass: `sermon-analyzer.coaching-refiner`
- Runtime gate: refiner triggers when coaching specificity is weak (generic actions/drills, thin weekly plan).
- Output target: emotional arc + content analysis + concrete, measurable coaching plan.

## Prompt Tuning Workflow

1. Pick one tool module and edit only that module first.
2. Bump that prompt `version` string any time behavior changes.
3. Keep JSON schema stable unless app contracts are intentionally changing.
4. Run `npm run prompts:list` to verify active versions.
5. Run `npm run smoke` for full API coverage.
6. For analyzer changes, also run `npm run sermon:test-file -- --runs 1`.

## Prompt Metadata

```bash
npm run prompts:list
```

This prints every prompt id + version currently active in the registry.
