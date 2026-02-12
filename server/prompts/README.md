# Prompt Catalog

All production prompts live in `server/prompts/`.

## Why this exists

- Keep prompt engineering easy to iterate without touching route logic.
- Keep schemas and constraints visible at a glance.
- Version each prompt so output changes are traceable.

## Files

- `bible-study.js`
- `sermon-preparation.js`
- `teaching-tools.js`
- `research-helper.js`
- `video-search.js`
- `sermon-analyzer.js`
- `index.js` (registry + metadata)

## Workflow

1. Edit the prompt module for the app you are tuning.
2. Bump the `version` field in that module.
3. Run `npm run smoke`.
4. For sermon analyzer, also run `npm run sermon:test-file`.

## Prompt metadata

Run:

```bash
npm run prompts:list
```

This prints every prompt id + version to verify what is currently active.
