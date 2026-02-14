# Bible AI Hub

This project provides six production-ready Bible AI Hub apps with real OpenAI-powered workflows.

## Local setup

1. Ensure `.env` contains:

```env
OPENAI_API_KEY=your_key_here
# Optional but recommended:
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GA_MEASUREMENT_ID=G-XXXXXXXXXX
ADMIN_DASHBOARD_PASSWORD=your_admin_dashboard_password
# Optional for real magic-link emails (Resend):
RESEND_API_KEY=re_xxxxxxxxxxxxx
MAGIC_LINK_FROM_EMAIL=Bible AI Hub <no-reply@yourdomain.com>
PUBLIC_BASE_URL=https://bible.hiredalmo.com
```

2. Install deps:

```bash
npm install
```

3. Start server:

```bash
npm start
```

4. Open:

- `http://localhost:3000/ai/`

If you open files directly with `file://`, API calls will fail unless the local server is running.

## Smoke testing

Run an end-to-end API smoke test (all six apps):

```bash
npm run smoke
```

Run a platform/governance smoke test (auth, billing, entitlements, projects, handoffs, team/reporting APIs):

```bash
npm run smoke:platform
```

This script starts a temporary local server on port `3199`, validates each AI route, and exits with a non-zero code if any app contract fails.

Run the user-feedback regression pack (targeted scenarios from QA findings):

```bash
npm run test:user-feedback
```

Run the crossfunctional system suite (pages, assets, platform + all tool APIs):

```bash
node scripts/crossfunctional-test.js
```

Run a real file-upload sermon analyzer test:

```bash
npm run sermon:test-file -- --runs 3 --file "ai/videos/your-sermon.mp3"
```

Run full syntax + SEO checks:

```bash
npm run test:syntax
npm run test:seo
```

If metadata intentionally changed, refresh social-meta snapshots:

```bash
npm run test:seo:update-snapshot
```

Run non-functional regression suites (load, security, data-quality reconciliation):

```bash
npm run test:nonfunctional
```

## Prompt engineering workflow

Prompts are centralized in `server/prompts/` so you can iterate without digging through route code.

- `server/prompts/bible-study.js`
- `server/prompts/sermon-preparation.js`
- `server/prompts/teaching-tools.js`
- `server/prompts/research-helper.js`
- `server/prompts/video-search.js`
- `server/prompts/sermon-analyzer.js`

List active prompt IDs + versions:

```bash
npm run prompts:list
```

## Server architecture notes

- `server.js` is the API composition root and route layer.
- Prompt specs and versions live in `server/prompts/`.
- Bible study orchestration and quality floor logic lives in `server/bible-study-workflow.js`.
- Research helper output normalization/quality gates live in `server/research-helper-quality.js`.
- Video-search confidence scoring and uncertainty behavior live in `server/video-search-confidence.js`.

## Video ingestion workflow (local-first)

1. Put raw videos in `ai/videos/`.
2. Run ingestion locally (this uses your real `OPENAI_API_KEY` and writes transcripts/timestamps to `server/data/video-library-index.json`):

```bash
npm run videos:ingest
```

Useful flags:

```bash
npm run videos:ingest -- --batch-size 1 --max-rounds 500
npm run videos:ingest -- --dry-run
```

3. Upload the video files to your hosting/CDN/object storage (for example: S3 + CloudFront, R2, Bunny, etc.).
4. Stamp hosted playback URLs into the video index:

```bash
npm run videos:hosted-urls -- --base-url https://cdn.example.com/videos
```

Optional flags:

```bash
npm run videos:hosted-urls -- --base-url https://cdn.example.com/videos --mode relative
npm run videos:hosted-urls -- --base-url https://cdn.example.com/videos --mode basename
npm run videos:hosted-urls -- --base-url https://cdn.example.com/videos --overwrite
npm run videos:hosted-urls -- --base-url https://cdn.example.com/videos --dry-run
```

`relative` mode keeps folder paths (default) and strips `ai/videos` by default.
`basename` mode uses only the filename.

You can also derive hosted URLs at runtime with environment variables:

```env
VIDEO_PUBLIC_BASE_URL=https://cdn.example.com/videos
VIDEO_PUBLIC_PATH_MODE=relative
VIDEO_PUBLIC_STRIP_PREFIX=ai/videos
```

Optional model/performance overrides:

```env
OPENAI_CHAT_MODEL=gpt-4.1-mini
OPENAI_BIBLE_STUDY_MODEL=gpt-4.1-nano
OPENAI_BIBLE_STUDY_MAX_TOKENS=1800
OPENAI_LONG_FORM_MODEL=gpt-4.1-nano
OPENAI_RETRY_ATTEMPTS=4
OPENAI_RETRY_BASE_MS=650
```

5. Deploy the site. Production can now search transcripts/timestamps from `server/data/video-library-index.json` and play hosted videos from your `hostedUrl` links.

## App routes

- `/#homePricing` (pricing section on home)
- `/ai/apps/bible-study/`
- `/ai/apps/sermon-preparation/`
- `/ai/apps/teaching-tools/`
- `/ai/apps/research-helper/`
- `/ai/apps/sermon-analyzer/`
- `/ai/apps/video-search/`

Legacy links like `/ai/video-search/` still redirect to the new `/ai/apps/...` routes.

## Notes

- OpenAI API key is used server-side only (`server.js`).
- Platform layer now includes auth, workspaces, entitlement gating, usage metering, quota enforcement, events, projects/history, handoffs, team seats, and async analyzer queue jobs.
- API auth is session-token based (`Authorization: Bearer <token>` and `X-Workspace-Id`), and the frontend auto-provisions a local guest session for first-time users.
- Video Search auto-discovers videos in `ai/videos/`, supports OpenAI transcription ingestion, and returns timestamped semantic results.
- Video Search automatically falls back to lexical ranking if embeddings are temporarily unavailable.
- If source video files are not present in production, the app still serves indexed transcript search and uses `hostedUrl` playback links.
- Sermon Analyzer combines local DSP metrics with AI coaching feedback.
- Sermon Analyzer auto-optimizes oversized browser audio uploads (downsampled mono WAV) to stay within serverless payload limits.
- Feature flags and staged rollout config live in `server/data/feature-flags.json`, evaluated by `server/feature-flags.js`.
- Product strategy decisions are codified in `server/data/product-strategy.json`.
- Production operations docs:
  - `docs/ops-runbook.md`
  - `docs/alert-thresholds.md`
  - `docs/support-macros.md`



