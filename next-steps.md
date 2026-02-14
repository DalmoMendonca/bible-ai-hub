# Bible AI Hub Next Steps (Closed)

All previously outstanding items were implemented and validated.

## Closed Items

1. Sermon Analyzer reliability hardening
- Added server-side coaching-report floor so `priorityActions`/drills/next-week plan cannot be empty.
- Added deterministic repeat-run regression guard in `scripts/user-feedback-regression.js`.

2. CI quality gates
- Added `.github/workflows/ci.yml` with:
  - `npm run test:syntax`
  - `npm run test:seo`
  - `npm run test:all`
  - Lighthouse SEO threshold checks via `.lighthouserc.json`

3. Feature flags + staged rollout controls
- Added `server/feature-flags.js`.
- Added config-driven flags in `server/data/feature-flags.json` with `internal`, `partial`, and `ga` stages.
- Added server endpoint `GET /api/feature-flags`.
- Added client helpers in `assets/shared.js` (`getFeatureFlags`, `isFeatureEnabled`).

4. Production readiness artifacts
- Added `docs/ops-runbook.md`.
- Added `docs/alert-thresholds.md`.
- Added `docs/support-macros.md`.

5. Social-proof acceptance gaps
- Added attribution validation (`source`, `sourceUrl`, `verifiedAt`) for social-proof writes in `server.js`.
- Updated `server/data/social-proof.json` with attribution metadata.
- Added role-based proof filters on homepage (`index.html`) gated by feature flag.

6. SEO validation automation
- Added `scripts/seo-structured-data-check.js`.
- Added `scripts/social-meta-snapshot.js` + snapshot file `scripts/snapshots/social-meta.snapshot.json`.
- Added npm scripts:
  - `test:seo`
  - `test:seo:update-snapshot`

7. Non-functional test suites
- Added `scripts/load-regression.js`.
- Added `scripts/security-regression.js`.
- Added `scripts/data-quality-reconciliation.js`.
- Added npm script `test:nonfunctional`.

8. Analyzer fair-use policy codified
- Updated plan limits in `server/platform.js`:
  - `sermon-analyzer-pro`: 600 minutes/month
  - `bundle-pro`: 300 minutes/month
  - `team-growth`: 1800 minutes/month
- Added overage policy model and surfaced policy in quota-denied API responses.
- Updated pricing UI copy in `pricing/index.html` to show fair-use caps.

9. PM strategy decisions encoded in product config
- Added `server/data/product-strategy.json` with:
  - primary ICP decision
  - bundle architecture decision
  - analyzer fair-use policy decision
  - proof-content governance plan
- Added endpoint `GET /api/product-strategy`.

## Validation Evidence

- `npm run test:syntax` passed.
- `npm run test:seo` passed.
- `npm run test:nonfunctional` passed.
- `npm run test:all` passed.
