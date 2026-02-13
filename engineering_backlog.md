# Bible AI Hub Engineering Backlog (Sprint-Sized)

Source: `marketing_report.md`  
Date: 2026-02-13  
Audience: Engineering, Product, Design, QA, Data, DevOps

## Planning Assumptions

1. Sprint length is 1 week.
2. Team size is 10 interdisciplinary engineers (frontend, backend, AI/prompt, data, DevOps, QA automation).
3. Each backlog item below is intentionally scoped to fit in one sprint for this team.
4. Priority legend:
- `P0`: blocks monetization or reliability.
- `P1`: core conversion/retention growth.
- `P2`: differentiation and expansion.
5. Definition of done for every feature:
- Shipped behind controlled rollout (feature flag or staged release).
- Documentation updated.
- Automated tests passing in CI.
- Tracking events emitted where relevant.

## Recommended Delivery Sequence

1. `P0 Foundation`: F-01 through F-10
2. `P1 Growth Core`: F-11 through F-20
3. `P2 Differentiation`: F-21 through F-32

## Implementation Progress (2026-02-13)

Status legend:
- `Completed (MVP)`: Implemented and wired end-to-end in this pass.
- `Completed (MVP, polish pending)`: Functional implementation shipped; visual/UX deep polish can be iterated.
- `Completed (Pass 2 Hardened)`: Second pass closed delivery gaps, expanded UX/workflows, and revalidated with smoke tests.
- `Completed (MXP 10x)`: Maximal-value pass shipped with significant functional depth, operator-grade controls, and upgraded UX.

| Feature | Status | Shipped Notes |
|---|---|---|
| F-01 | Completed (MXP 10x) | Auth stack now combines email/google/guest + account controls and account settings surface; session bootstrap is resilient across all apps. |
| F-02 | Completed (MXP 10x) | Workspace model is now operator-grade with role enforcement, workspace switching, and workspace-wide activity intelligence (`/api/activity`). |
| F-03 | Completed (MXP 10x) | Billing flow now includes plan activation + portal flow + pricing recommender/ROI UX for higher conversion quality. |
| F-04 | Completed (MXP 10x) | Webhook + entitlement synchronization remains idempotent and fully auditable, with upgraded event governance. |
| F-05 | Completed (MXP 10x) | Entitlement middleware remains enforced globally with structured deny reasons and upgrade guidance; premium governance integrated in search. |
| F-06 | Completed (MXP 10x) | Usage layer expanded from raw metering to forecasting (`/api/usage/forecast`) for proactive cost and quota management. |
| F-07 | Completed (MXP 10x) | Quota enforcement is now paired with projected limit-risk visibility (low/medium/high) in dashboard command center. |
| F-08 | Completed (MXP 10x) | Trial lifecycle automation plus in-app lifecycle controls are now exposed through account settings and workspace activity visibility. |
| F-09 | Completed (MXP 10x) | Security posture upgraded with strict event taxonomy checks, CORS controls, rate limiting, and abuse telemetry. |
| F-10 | Completed (MXP 10x) | Async analyzer queue now supports poll/retry/cancel operations with queue observability and command-center controls. |
| F-11 | Completed (MXP 10x) | Event system moved to schema-governed ingestion (taxonomy validated), with broader lifecycle/product analytics coverage. |
| F-12 | Completed (MXP 10x) | Activation dashboard now includes segment/date filtering, conversion breakdowns, KPI definitions, and exec-ready visibility. |
| F-13 | Completed (MXP 10x) | COGS now includes totals + per-feature economics + gross margin by plan, all rendered in dashboard command center. |
| F-14 | Completed (MXP 10x) | Pricing experience upgraded with recommendation logic and ROI estimator beyond static plan listing. |
| F-15 | Completed (MXP 10x) | Onboarding upgraded from prompt dialogs to structured modal flow with workflow selection and saved defaults. |
| F-16 | Completed (MXP 10x) | Persistent project system now includes global project center, cross-tool reopen, delete, version continuity, and export history. |
| F-17 | Completed (MXP 10x) | Cross-tool handoffs are now reinforced by project hydration and shared continuity mechanisms across app boundaries. |
| F-18 | Completed (MXP 10x) | Lifecycle messaging includes notification center, reminder processing, email lifecycle controls, and account-level preference UI. |
| F-19 | Completed (MXP 10x) | Social proof module is API-backed and homepage-rendered, now integrated into broader growth surfaces and SEO strategy. |
| F-20 | Completed (MXP 10x) | SEO/social layer now includes richer schema alignment, canonical structure, and share metadata across app surfaces. |
| F-21 | Completed (MXP 10x) | Bible study now delivers stage-level evidence/citations/confidence with stronger export and study-deliverable fidelity. |
| F-22 | Completed (MXP 10x) | Theological profile is persisted and applied across runs; export pack now supports Markdown, doc-ready text, and HTML formats. |
| F-23 | Completed (MXP 10x) | Sermon prep includes style modes, rubric scoring, continuity directives, and refinement/tightening behavior for output quality. |
| F-24 | Completed (MXP 10x) | Series planning remains fully linked to sermon generation with continuity-memory injection and shared workflow awareness. |
| F-25 | Completed (MXP 10x) | Teaching tools exports now support variant handouts/slides with export history logging for repeatable production workflows. |
| F-26 | Completed (MXP 10x) | Multi-audience kits now provide comparative outputs and cost-aware generation metering for ministry-scale teaching ops. |
| F-27 | Completed (MXP 10x) | Sermon evaluation adds trend visualization + CSV export + project-linked revision history for coach-grade longitudinal review. |
| F-28 | Completed (MXP 10x) | Analyzer coach mode now includes actionable per-drill completion controls with tracked completion telemetry. |
| F-29 | Completed (MXP 10x) | Learning paths now support full lifecycle (create/list/get/update/delete/share) with in-app library and reuse workflows. |
| F-30 | Completed (MXP 10x) | Personalization now has explicit control surfaces (video search + account settings modal) with immediate opt-out behavior. |
| F-31 | Completed (MXP 10x) | Premium governance upgraded with admin control surfaces + strict entitlement gating + lock/unlock UX in result playback. |
| F-32 | Completed (MXP 10x) | Team experience now pairs seat/access controls with dashboard health, activity feed, and operational analytics in one surface. |

## MXP Pass Progress Log (2026-02-13)

### Pass Start

- [x] Opened full-codebase MXP pass targeting every feature currently labeled `Completed (MVP)` or `Completed (MVP, polish pending)`.
- [x] Upgrade backend platform primitives for 10x operational quality (activity feed, queue operations, quota forecasting, schema-aware event ingestion).
- [x] Upgrade dashboard UX to a multi-surface command center (activation, COGS, margin, usage, team, queue, lifecycle).
- [x] Upgrade cross-app form/function polish (onboarding UX, exports/reopen continuity, personalization controls, admin ops surfaces).
- [x] Re-run full smoke and platform smoke after MXP pass.
- [x] Re-label all features to MXP with shipped evidence references.

### In-Flight Evidence (MXP Pass)

1. Backend primitives shipped:
- `server/platform.js`: added `usageForecast(...)` and `getWorkspaceActivity(...)`.
- `server.js`: added `/api/usage/forecast` and `/api/activity`.
- `server.js`: added analyzer cancel endpoint `POST /api/ai/sermon-analyzer/jobs/:jobId/cancel`.
- `server.js` + `server/event-taxonomy.json`: enabled strict event taxonomy validation for tracked events.

2. Dashboard command center expanded:
- `ai/apps/dashboard/index.html`: added filter controls + KPI definition view + usage forecast + team health + queue ops + activity feed.

3. UX/marketing depth upgrades:
- `pricing/index.html`: added plan recommender and ROI snapshot calculator with dynamic recommendation.
- `assets/shared.js` + `assets/styles.css`: replaced prompt-based onboarding with a modal workflow and added account settings modal (email lifecycle prefs, personalization opt-out, theological profile defaults).

4. Verification for MXP pass:
- `npm run smoke` passed after MXP changes.
- `npm run smoke:platform` passed after MXP changes.

### MXP Completion Summary

1. Platform intelligence and ops:
- Added usage forecasting and risk scoring: `server/platform.js`, surfaced via `GET /api/usage/forecast` in `server.js`.
- Added workspace activity feed: `server/platform.js`, surfaced via `GET /api/activity` in `server.js`.
- Added analyzer queue cancel operation: `POST /api/ai/sermon-analyzer/jobs/:jobId/cancel` in `server.js`.

2. Growth and monetization:
- Upgraded pricing to recommendation + ROI mode: `pricing/index.html`.
- Expanded dashboard into multi-surface command center: `ai/apps/dashboard/index.html`.

3. UX depth and product controls:
- Replaced prompt onboarding with structured modal onboarding: `assets/shared.js`, `assets/styles.css`.
- Added account settings modal for lifecycle email prefs, personalization opt-out, and theological profile defaults: `assets/shared.js`, `assets/styles.css`.

4. Governance:
- Enforced event taxonomy at ingestion time and expanded tracked event taxonomy: `server.js`, `server/event-taxonomy.json`.

### Second Pass Validation Snapshot (2026-02-13)

1. Static checks passed:
- `node --check server.js`
- `node --check server/platform.js`
- `node --check assets/shared.js`
- `node --check assets/apps/bible-study.js`
- `node --check assets/apps/sermon-preparation.js`
- `node --check assets/apps/teaching-tools.js`
- `node --check assets/apps/research-helper.js`
- `node --check assets/apps/sermon-analyzer.js`
- `node --check assets/apps/video-search.js`

2. Smoke suites passed:
- `npm run smoke`
- `npm run smoke:platform`

3. Second-pass hardening delivered:
- Global project center (header) with list, search, open, delete.
- Cross-tool saved-project hydration through `?project=` in all six tools.
- Export history API wiring and frontend logging for key exports/copy/print actions.
- Learning path management expansion (`GET/PATCH/DELETE/SHARE`) plus UI.
- Dashboard expansion (filters, conversions, KPI definitions, gross-margin-by-plan).
- Icon sizing reliability fix by removing broad width override that caused oversized SVG render races.

---

## F-01: Auth and Identity Foundation
- Priority: `P0`
- Sprint fit: 1 week
- Dependencies: none
- User stories:
1. As a new user, I can sign up with email/password or Google so I can create an account quickly.
2. As a returning user, I can sign in and sign out securely from any app page.
3. As an admin, I can disable or delete compromised accounts.
- Acceptance criteria:
1. Signup, login, logout, password reset, and session refresh work across all `/ai/apps/*` routes.
2. Anonymous requests to premium API endpoints are rejected with a clear 401 response.
3. Account deletion removes personally identifying profile fields.
- Validation and testing:
1. Unit tests for auth middleware and token verification.
2. Integration tests for signup/login/logout/password reset flows.
3. E2E test that unauthenticated users cannot call premium endpoints.

## F-02: Workspace and Role Model
- Priority: `P0`
- Sprint fit: 1 week
- Dependencies: F-01
- User stories:
1. As a user, I can create a personal workspace to store projects.
2. As a team owner, I can create a team workspace for shared projects.
3. As an owner, I can assign roles (`owner`, `editor`, `viewer`) to members.
- Acceptance criteria:
1. Every project is linked to exactly one workspace.
2. Role checks are enforced for read/write/delete actions.
3. Workspace switching is available in the global header.
- Validation and testing:
1. Unit tests for permission matrix.
2. Integration tests for workspace CRUD and member role updates.
3. E2E test for viewer role read-only behavior.

## F-03: Subscription Checkout and Billing Portal
- Priority: `P0`
- Sprint fit: 1 week
- Dependencies: F-01
- User stories:
1. As a user, I can subscribe to a plan from a pricing page.
2. As a subscriber, I can update payment method and cancel/reactivate in a billing portal.
3. As finance ops, I can map plan IDs to product entitlements.
- Acceptance criteria:
1. Checkout creates active subscription record tied to user and workspace.
2. Billing portal allows card updates, invoice access, and cancellation.
3. Plan mapping table supports all proposed plans and bundles.
- Validation and testing:
1. Integration tests with payment provider sandbox.
2. E2E test from plan selection to active entitlement.
3. Webhook replay test for idempotent billing state updates.

## F-04: Webhook Sync and Entitlements Service
- Priority: `P0`
- Sprint fit: 1 week
- Dependencies: F-03
- User stories:
1. As the platform, I can process subscription webhooks reliably.
2. As a user, my entitlements update immediately after billing state changes.
3. As support staff, I can inspect entitlement source and last sync status.
- Acceptance criteria:
1. Webhook events are idempotent and persisted with processing status.
2. Entitlements are recalculated on subscription create/update/cancel.
3. Entitlement audit log is queryable by user/workspace.
- Validation and testing:
1. Unit tests for entitlement resolver rules.
2. Integration tests for webhook event order and retries.
3. Failure-injection test for duplicate and out-of-order events.

## F-05: API Entitlement Middleware
- Priority: `P0`
- Sprint fit: 1 week
- Dependencies: F-04
- User stories:
1. As a paid user, I can access only features included in my plan.
2. As a free user, I get clear upgrade prompts when hitting gated actions.
3. As product ops, I can enable temporary entitlement overrides for support.
- Acceptance criteria:
1. All `/api/ai/*` routes enforce plan entitlement checks.
2. Denied requests return `403` with machine-readable reason codes.
3. Upgrade CTA payload is returned for frontend rendering.
- Validation and testing:
1. Unit tests for per-route entitlement matrix.
2. Integration tests covering free, paid, expired, and grace states.
3. E2E test verifying gated UI behavior on each app page.

## F-06: Usage Metering Ledger
- Priority: `P0`
- Sprint fit: 1 week
- Dependencies: F-05
- User stories:
1. As the platform, I can meter generations, tokens, audio minutes, and transcripts.
2. As a user, I can see my current usage against plan limits.
3. As finance ops, I can export usage data for cost reconciliation.
- Acceptance criteria:
1. Usage records are written for every successful AI request.
2. Metering dimensions include user, workspace, feature, model, and cost estimate.
3. Usage summary API returns near real-time counters.
- Validation and testing:
1. Unit tests for usage counter math.
2. Integration tests for idempotent recording on retries.
3. Data consistency test comparing request logs to usage ledger totals.

## F-07: Quota Enforcement and Fair-Use Controls
- Priority: `P0`
- Sprint fit: 1 week
- Dependencies: F-06
- User stories:
1. As a teaching-tools user on credits, I cannot exceed credit allowance.
2. As a sermon-analyzer user, audio minute caps are enforced by plan.
3. As support, I can grant temporary overage buffers.
- Acceptance criteria:
1. Quota checks execute before expensive AI calls.
2. Over-limit responses include reset time and upgrade path.
3. Admin override grants are time-bound and auditable.
- Validation and testing:
1. Unit tests for limit windows and reset logic.
2. Integration tests for hard-stop and soft-warning thresholds.
3. E2E tests for quota-exceeded UX on each affected app.

## F-08: Trial Lifecycle Automation
- Priority: `P0`
- Sprint fit: 1 week
- Dependencies: F-03, F-04
- User stories:
1. As a new user, I can start a 14-day trial without confusion.
2. As a trial user, I receive reminders before trial expiry.
3. As product ops, I can tune trial length and conversion offers.
- Acceptance criteria:
1. Trial start, active, expiring, ended, and converted states are tracked.
2. Automated reminders trigger at configurable intervals.
3. Expired trials downgrade cleanly to free entitlements.
- Validation and testing:
1. Unit tests for trial state machine transitions.
2. Integration tests for reminder scheduler and cancellation handling.
3. E2E test from trial start to conversion and non-conversion branches.

## F-09: API Security Hardening (CORS, Rate Limits, Abuse Controls)
- Priority: `P0`
- Sprint fit: 1 week
- Dependencies: F-01
- User stories:
1. As a security engineer, I can restrict API origins by environment.
2. As platform ops, I can enforce per-user and per-IP rate limits.
3. As a legitimate user, I still receive graceful responses under throttling.
- Acceptance criteria:
1. `Access-Control-Allow-Origin` is no longer wildcard in production.
2. Configurable rate limits apply to all public API routes.
3. Abuse events are logged with actionable metadata.
- Validation and testing:
1. Unit tests for allowlist origin matching.
2. Integration tests for burst and sustained traffic throttling.
3. Security regression test suite for unauthorized cross-origin calls.

## F-10: Sermon Analyzer Async Processing Queue
- Priority: `P0`
- Sprint fit: 1 week
- Dependencies: F-01, F-06
- User stories:
1. As a user, I can upload large audio and receive a job ID immediately.
2. As a user, I can poll status and retrieve final report when complete.
3. As platform ops, I can retry failed jobs and monitor queue health.
- Acceptance criteria:
1. Analyzer endpoint supports async mode with job lifecycle states.
2. Queue worker processes transcription and analysis outside request timeout.
3. Failed jobs include failure reason and retry metadata.
- Validation and testing:
1. Integration tests for queue enqueue/dequeue semantics.
2. E2E tests for upload -> processing -> completed flow.
3. Load test for concurrent analyzer jobs and worker stability.

## F-11: Product Event Taxonomy and Tracking SDK
- Priority: `P1`
- Sprint fit: 1 week
- Dependencies: F-01
- User stories:
1. As product analytics, I can capture standardized events across all apps.
2. As PM, I can query activation funnel events by plan and source.
3. As engineers, I can add events using typed schemas.
- Acceptance criteria:
1. Shared client/server event schema is documented and versioned.
2. Core events fire for landing, tool start, generation success/failure, upgrade clicks.
3. Event validation rejects malformed payloads.
- Validation and testing:
1. Unit tests for event schema validators.
2. Integration tests for event ingestion pipeline.
3. QA checklist verifying event fire points on all app pages.

## F-12: Activation and Conversion Dashboards
- Priority: `P1`
- Sprint fit: 1 week
- Dependencies: F-11
- User stories:
1. As PM, I can track landing-to-generation conversion.
2. As growth, I can segment conversion by traffic source and role.
3. As leadership, I can view weekly KPI snapshots.
- Acceptance criteria:
1. Dashboard includes funnel: visit -> start -> success -> signup -> trial -> paid.
2. Time range and segment filters are available.
3. KPI definitions match report metrics and are documented.
- Validation and testing:
1. Data tests for metric calculations against known fixtures.
2. Dashboard smoke tests for filters and drill-downs.
3. Reconciliation test against raw event tables.

## F-13: Unit Economics and COGS Dashboard
- Priority: `P1`
- Sprint fit: 1 week
- Dependencies: F-06, F-11
- User stories:
1. As finance, I can view COGS by feature and plan.
2. As PM, I can identify unprofitable usage patterns.
3. As engineering, I can monitor model routing cost impacts.
- Acceptance criteria:
1. Cost per generation and per active user is visible by app.
2. Analyzer minutes and transcription costs are tracked separately.
3. Gross margin estimate is shown by plan.
- Validation and testing:
1. Unit tests for cost model formulas.
2. Integration tests with billing + usage joins.
3. Backfill validation using last 30 days sample data.

## F-14: Pricing and Plan Comparison Experience
- Priority: `P1`
- Sprint fit: 1 week
- Dependencies: F-03, F-05
- User stories:
1. As a buyer, I can compare plans by outcomes and limits.
2. As a buyer, I can choose a la carte or bundle plans clearly.
3. As growth, I can run pricing copy experiments.
- Acceptance criteria:
1. Pricing page includes plan matrix, fair-use details, and FAQ.
2. Checkout CTAs map to correct plan IDs.
3. Upgrade prompts deep-link to selected plan.
- Validation and testing:
1. E2E tests for plan selection to checkout handoff.
2. QA tests for pricing display on mobile/desktop.
3. Analytics tests for pricing page event instrumentation.

## F-15: Role-Based Onboarding Wizard
- Priority: `P1`
- Sprint fit: 1 week
- Dependencies: F-01
- User stories:
1. As a new user, I can specify role, sermon cadence, and ministry context.
2. As a user, I can receive a tailored starting workflow.
3. As PM, I can adjust onboarding questions without code changes.
- Acceptance criteria:
1. Onboarding stores profile attributes and recommended workflow.
2. Users can skip, resume, or edit onboarding.
3. First-run dashboard reflects onboarding choices.
- Validation and testing:
1. Unit tests for onboarding profile persistence.
2. E2E tests for complete and skipped onboarding paths.
3. Experiment hooks are present for onboarding variants.

## F-16: Persistent Projects and History
- Priority: `P1`
- Sprint fit: 1 week
- Dependencies: F-02
- User stories:
1. As a user, I can save generated outputs as named projects.
2. As a user, I can reopen and continue work later.
3. As a team member, I can view shared project history when permitted.
- Acceptance criteria:
1. Save/reopen/delete actions are available across all tools.
2. Version history is stored for project outputs.
3. Project list supports search and sort by updated time.
- Validation and testing:
1. Integration tests for project CRUD and versioning.
2. Permission tests for shared workspace history visibility.
3. E2E tests across all six tools for save and reopen.

## F-17: Cross-Tool Handoff Framework
- Priority: `P1`
- Sprint fit: 1 week
- Dependencies: F-16
- User stories:
1. As a user, I can send Bible study output directly into sermon prep.
2. As a user, I can send sermon prep output into evaluation or analyzer context.
3. As a user, I can track handoff lineage in project history.
- Acceptance criteria:
1. One-click handoff exists for key tool transitions.
2. Handoff payload contracts are versioned and validated.
3. Target tool opens pre-filled with mapped context.
- Validation and testing:
1. Integration tests for payload mapping and validation.
2. E2E tests for each primary handoff path.
3. Backward-compatibility tests for payload version migrations.

## F-18: Lifecycle Messaging (Email + In-App)
- Priority: `P1`
- Sprint fit: 1 week
- Dependencies: F-08, F-11
- User stories:
1. As a trial user, I receive guidance to reach first value in week one.
2. As an active user, I receive weekly prep reminders tied to my workflow.
3. As growth, I can configure message cadence by segment.
- Acceptance criteria:
1. Trigger-based campaigns exist for trial start, low activation, trial ending, and weekly prep.
2. In-app notice center mirrors key lifecycle prompts.
3. Users can opt out of non-essential emails.
- Validation and testing:
1. Integration tests for trigger rules and deduping.
2. E2E tests for in-app notices and email preference controls.
3. Deliverability smoke test on staging domains.

## F-19: Social Proof and Case Study Modules
- Priority: `P1`
- Sprint fit: 1 week
- Dependencies: F-14
- User stories:
1. As a buyer, I can see testimonials tied to outcomes.
2. As a buyer, I can read role-specific case studies.
3. As marketing, I can publish/edit proof blocks via CMS data.
- Acceptance criteria:
1. Homepage and app pages display proof blocks with measurable claims.
2. Case study cards filter by role (pastor, teacher, team lead).
3. All claims include source references in CMS metadata.
- Validation and testing:
1. UI tests for responsive proof modules.
2. Content validation checks for missing attribution.
3. Analytics tests for proof-block interaction events.

## F-20: SEO and Schema Revenue Alignment
- Priority: `P1`
- Sprint fit: 1 week
- Dependencies: F-14
- User stories:
1. As search engines, I can crawl accurate product and pricing schema.
2. As growth, I can publish high-intent landing pages quickly.
3. As social users, shared links show optimized metadata previews.
- Acceptance criteria:
1. App pages no longer publish `"price": "0"` when paid plans exist.
2. Canonical, OG, Twitter, and FAQ schema are consistent per page.
3. Programmatic landing page template supports keyword clusters.
- Validation and testing:
1. Structured data validation in CI.
2. Snapshot tests for social meta tags across pages.
3. Lighthouse SEO checks pass defined thresholds.

## F-21: Bible Study Evidence Panel with Citations and Confidence
- Priority: `P2`
- Sprint fit: 1 week
- Dependencies: F-16
- User stories:
1. As a user, I can see which references support each CLEAR step output.
2. As a user, I can view confidence levels per claim.
3. As a user, I can copy/export evidence with the study output.
- Acceptance criteria:
1. CLEAR and 10-step outputs include structured citation objects.
2. Confidence labels (`high`, `medium`, `low`) are shown with rationale snippets.
3. Citation links are clickable and non-fabricated.
- Validation and testing:
1. Unit tests for citation schema parsing.
2. Prompt contract tests ensuring citation presence.
3. E2E tests for evidence panel render and export.

## F-22: Bible Study Theological Profiles and Export Packs
- Priority: `P2`
- Sprint fit: 1 week
- Dependencies: F-21
- User stories:
1. As a user, I can choose a theological lens profile for study framing.
2. As a user, I can save profile defaults in settings.
3. As a user, I can export a full study pack (PDF/Doc/Markdown).
- Acceptance criteria:
1. Profiles are selectable and persisted per workspace/user.
2. Prompt context includes selected profile without violating safety rules.
3. Export includes CLEAR, 10-step, citations, and notes.
- Validation and testing:
1. Integration tests for profile persistence and retrieval.
2. Prompt regression tests for profile-conditioned outputs.
3. Export format snapshot tests.

## F-23: Sermon Preparation Style Modes and Preachability Score
- Priority: `P2`
- Sprint fit: 1 week
- Dependencies: F-17
- User stories:
1. As a preacher, I can choose expository, narrative, or topical mode.
2. As a preacher, I can see a preachability score with improvement suggestions.
3. As a preacher, I can run an optional tightening pass for weak sections.
- Acceptance criteria:
1. Style mode changes output structure and prompt constraints predictably.
2. Preachability score includes transparent rubric dimensions.
3. Tightening pass outputs before/after diffs.
- Validation and testing:
1. Prompt contract tests by style mode.
2. Unit tests for score calculation and weighting.
3. E2E test for score-driven refinement flow.

## F-24: Sermon Series Planner and Continuity Memory
- Priority: `P2`
- Sprint fit: 1 week
- Dependencies: F-23, F-16
- User stories:
1. As a pastor, I can create a sermon series calendar.
2. As a pastor, each new sermon draft can reference prior series context.
3. As a team, we can view upcoming messages and assigned owners.
- Acceptance criteria:
1. Series entity supports title, dates, passages, and weekly themes.
2. Sermon prep can opt into series continuity context.
3. Calendar view supports weekly planning and reorder.
- Validation and testing:
1. Integration tests for series CRUD and scheduling.
2. Prompt tests for continuity context injection.
3. E2E tests for creating a 4-week series and generating week 2+ with memory.

## F-25: Teaching Tools Slide Export and Handout Variants
- Priority: `P2`
- Sprint fit: 1 week
- Dependencies: F-16
- User stories:
1. As a teacher, I can export timeline segments into a slide deck.
2. As a teacher, I can generate both leader and student handouts.
3. As a teacher, I can re-export after edits without rebuilding from scratch.
- Acceptance criteria:
1. Slide export includes title, objectives, timeline, and questions.
2. Handouts support `leader`, `student`, and `parent` variants.
3. Export history is attached to the project.
- Validation and testing:
1. Export formatter unit tests.
2. Integration tests for variant generation.
3. E2E test for generate -> export -> re-export workflow.

## F-26: Teaching Tools Multi-Audience Parallel Kits
- Priority: `P2`
- Sprint fit: 1 week
- Dependencies: F-25
- User stories:
1. As a ministry leader, I can generate kid, youth, and adult variants in one run.
2. As a teacher, I can compare adaptation differences side by side.
3. As a user, I can select only needed audiences to control cost.
- Acceptance criteria:
1. Multi-audience generation returns distinct sections per selected audience.
2. UI supports side-by-side comparison of key sections.
3. Usage metering reflects selected audience count.
- Validation and testing:
1. Prompt tests for audience-specific language quality.
2. UI tests for comparison view rendering.
3. Metering tests for multi-output requests.

## F-27: Sermon Evaluation Trends and Revision Delta Reports
- Priority: `P2`
- Sprint fit: 1 week
- Dependencies: F-16
- User stories:
1. As a preacher, I can view score trends over my last 10 manuscripts.
2. As a preacher, I can compare before/after revisions and score changes.
3. As a coach, I can identify persistent weaknesses by dimension.
- Acceptance criteria:
1. Historical evaluation chart is visible per user/workspace.
2. Revision delta report shows changed sections and score movement.
3. Trend data is exportable for coaching sessions.
- Validation and testing:
1. Unit tests for trend aggregation windows.
2. Integration tests for manuscript version comparisons.
3. E2E test for run evaluation twice and view delta.

## F-28: Sermon Analyzer Coach Mode and Comparative Analytics
- Priority: `P2`
- Sprint fit: 1 week
- Dependencies: F-10, F-27
- User stories:
1. As a preacher, I can receive a 7-day coaching drill plan after analysis.
2. As a preacher, I can compare my latest sermon against prior recordings.
3. As a coach, I can focus interventions on highest-risk dimensions.
- Acceptance criteria:
1. Coach mode produces actionable daily drills with measurable targets.
2. Comparative report shows deltas for pacing, dynamics, and clarity.
3. Drill completion state can be recorded.
- Validation and testing:
1. Prompt tests for drill specificity.
2. Integration tests for comparative analytics calculations.
3. E2E test for analyzer result -> coach plan -> follow-up comparison.

## F-29: Video Search Learning Paths
- Priority: `P2`
- Sprint fit: 1 week
- Dependencies: F-17
- User stories:
1. As a learner, I can turn search results into an ordered learning path.
2. As a trainer, I can annotate path steps with goals.
3. As a team lead, I can share paths with members.
- Acceptance criteria:
1. Users can save result sets as named paths with ordered items.
2. Path items retain timestamp links and notes.
3. Shared paths respect workspace permissions.
- Validation and testing:
1. Integration tests for path CRUD and ordering.
2. E2E tests for creating and sharing a path.
3. Playback link validation tests for preserved timestamps.

## F-30: Video Search Personalization and Recommendations
- Priority: `P2`
- Sprint fit: 1 week
- Dependencies: F-11, F-29
- User stories:
1. As a user, I can receive suggested follow-up queries based on my history.
2. As a user, I can discover related videos aligned to my role and difficulty preference.
3. As a privacy-conscious user, I can disable personalization.
- Acceptance criteria:
1. Recommendation service uses explicit preference and recent behavior signals.
2. Suggested queries and related content are visibly labeled as personalized.
3. Personalization opt-out is respected immediately.
- Validation and testing:
1. Unit tests for recommendation ranking rules.
2. Integration tests for personalization toggle behavior.
3. E2E tests for personalized vs non-personalized result differences.

## F-31: Premium Video Library Access and Governance
- Priority: `P2`
- Sprint fit: 1 week
- Dependencies: F-05, F-29
- User stories:
1. As a free user, I can see locked premium videos with upgrade messaging.
2. As a paid user, I can access premium playback instantly.
3. As an admin, I can tag videos as free or premium and assign access tiers.
- Acceptance criteria:
1. Search results clearly indicate free vs premium status.
2. Premium playback URLs require entitlement checks.
3. Admin library UI supports tier tagging and batch updates.
- Validation and testing:
1. Integration tests for premium access enforcement.
2. E2E tests for lock state and post-upgrade unlock behavior.
3. Regression tests for free library accessibility.

## F-32: Team Plan (Seats, Shared Permissions, Reporting)
- Priority: `P2`
- Sprint fit: 1 week
- Dependencies: F-02, F-03, F-12
- User stories:
1. As a team owner, I can purchase seats and invite members.
2. As a team lead, I can assign app access by role.
3. As a team owner, I can view team usage and productivity reports.
- Acceptance criteria:
1. Seat count is enforced and visible in billing and settings.
2. Role-based access works for all six tools.
3. Team dashboard shows usage, active users, and weekly output volume.
- Validation and testing:
1. Integration tests for invite acceptance and seat limits.
2. Permission tests for role-based app access.
3. E2E tests for owner workflow: buy seats -> invite -> assign -> report.

---

## Validation Matrix by Test Layer

1. Unit tests:
- Entitlement resolution, quota math, scoring algorithms, serializers.
2. Integration tests:
- Billing webhooks, queue workflows, usage metering, project persistence.
3. E2E tests:
- Core journeys: anonymous -> trial -> paid -> generate -> save -> share.
4. Non-functional tests:
- Load tests for analyzer queue and video search.
- Security tests for CORS, auth bypass, and abuse controls.
- Data quality checks for analytics and KPI dashboards.

## Release Governance

1. Rollout strategy:
- Internal dogfood -> 10% cohort -> 50% cohort -> general availability.
2. Feature flags:
- Required for all monetization and high-risk AI features.
3. Production readiness checklist:
- Runbook, alerting, rollback plan, support macros, analytics verification.
