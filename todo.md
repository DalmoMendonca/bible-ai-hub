## GENERAL

- [x] None of the tools are working right now because of "Unable to initialize session." Fix this now. Everything should work right out of the gate.
Implementation note: Hardened session bootstrap and guest provisioning (`/api/auth/guest`) and improved writable data-path handling for serverless/runtime constraints in platform + API persistence paths.

- [x] The app is not mobile-friendly. Please fix.
Implementation note: Added responsive layout refinements in `assets/styles.css` (header wrapping, form/button behavior, compact content spacing, mobile-safe shell behavior).

- [x] The app should have a dark mode toggle. Please add it.
Implementation note: Added theme state, persistence, and header toggle in `assets/shared.js`, plus dark-theme token overrides and component styles in `assets/styles.css`.

- [x] Users should be able to sign in with Google or with their email (no password for email, only magic links with 15-minute expiration). Signed-out users have 10 credits to use, each generation is 1 credit. If the user's email address is dalmomendonca@gmail.com, that's an admin account with 10,000 credits.
Implementation note: Added Google auth config/token flow, magic-link request/verify flow (15-minute TTL), guest credit defaults (10), admin auto-promotion/credit floor (10,000), and per-generation credit consumption checks.

- [x] Allow logged-in users to give feedback from a discreet button that is on every page. All feedback goes to dalmomendonca@gmail.com, and the user's email address is automatically included in the feedback. Positive feedback gets automatically queued for use in testimonials.
Implementation note: Added global feedback FAB + modal in shared UI, authenticated feedback endpoint, guest feedback block, routing metadata to `dalmomendonca@gmail.com`, and testimonial queueing on positive sentiment/ratings.

- [x] Build in google analytics to track user behavior and app usage, conversion, retention, search engine traffic, etc.
Implementation note: Added GA bootstrap from `/api/public-config` (`GA_MEASUREMENT_ID`), auto `gtag` loader, page/session context, and event forwarding from shared `trackEvent` instrumentation.

## HOME PAGE

- [x] "Proof blocks are temporarily unavailable." Why? How do I fix it?
Implementation note: Switched proof loading to public API path (no auth dependency), replaced generic failure copy with actionable configuration guidance, and added robust empty-state messaging.

- [x] You can come up with a better UI for Who Uses Bible AI Hub and Popular AI Ministry Workflows. Right now, it's a bulleted list where the text is also centered. It looks deranged. This app has to look next-level polished, and right now it looks like it was build by an amateur who just learned CSS yesterday. Please, help fix.
Implementation note: Added dedicated home layout styles for persona/workflow sections (`home-*` and `persona-*` classes), left-aligned typography, card-based structure, and responsive polish.

- [x] The accordion FAQ is nice, but I don't like the way it looks centered. Let's try left justified. And remove the little arrow in front of each question: on mobile it's rendered as an emoji and looks very unprofessional. Let's also add at least 3 more questions and answers: what AI model powers these apps? How often do these apps hallucinate answers? Is Bible AI Hub meant to be a replacement for Bible study? Answer tactfully and professionally, with an emphasis on the apps being a tool carefully calibrated by a team of ministers and AI experts to enhance Bible study, not replace it. If there are more questions that would enhance user experience and SEO, please add them. Similarly revamp all the individual app FAQs as well with more questions/answers relevant to each specific app.
Implementation note: FAQ styling is left-justified with marker arrows removed; home FAQ includes expanded professional model/hallucination/replacement guidance and app pages include targeted FAQ sections.

- [x] The Product Dashboard is stuck on "Unable to initialize session." Why? How do we fix it? Also, this looks like an admin tool that should be locked away behind a password-protected admin view, NOT linked on the home page next to pricing.
Implementation note: Dashboard APIs are admin-gated server-side; optional password header gate (`X-Admin-Dashboard-Password`) is enforced and surfaced in dashboard UI with secure input + persistence. Dashboard is not linked from home.

- [x] The Plan Recommender is a stupid idea. Please scrap it. It doesn't work anyway. Pricing should be SIMPLE and easy to understand. It should be the last section on the bottom of the home page with Disciple/Pastor/Church tiers.
Implementation note: Removed recommender UX and replaced pricing with clear three-tier cards on home and a simplified `pricing/index.html` reflecting Disciple, Pastor, and Church packaging.

## HOW IT WORKS

- [x] This page does NOT meet its intended purpose. It's supposed to show every single word of every single prompt that is sent to the AI, along with the kinds of answers the AI generates and how those answers are used to create the final output. It should be a transparent diagram of all AI interactions, like a beautiful flowchart for each app. Please, rework it now.
Implementation note: Rebuilt `how-it-works.html` as a live renderer over `/api/how-it-works`, showing per-app flow diagrams, full prompt text (system + user), response schemas/examples, and explicit output-usage mapping.

## SERMON PREPARATION

- [x] Create Series button doesn't work. Please fix. "Could not create series: Unable to initialize session."
Implementation note: Session bootstrap hardening and auth-path stability fixes now allow authenticated series creation/listing to run without initialization failures.

## TEACHING TOOLS

- [x] Get rid of STUPID workflows. Clicking the Save Kit button before a lesson has been generated should not be possible. That button should appear AFTER.
Implementation note: Save/export/copy/print controls now stay hidden until a kit is successfully generated (or loaded from a saved project).

- [x] Right now you have both an Audience dropdown and Multi-Audience Parallel Kits (optional) multiselect. This is redundant and confusing. Please remove the Audience dropdown and only an Audience field that allows for multiple selections, at least one required.
Implementation note: Removed the single Audience dropdown, kept one multi-select audience block (checkboxes), added "at least one required" client validation, and updated payload/render logic accordingly.

- [x] Critical bug. Generating kit doesn't work. "Could not generate teaching kit: Unable to initialize session." ... ENOENT mkdir in serverless path.
Implementation note: Addressed serverless write-path failure with writable fallback logic and session bootstrap hardening; teaching-kit generation now succeeds in smoke and crossfunctional runs.

## SERMON EVALUATION

- [x] Save Evaluation / Export Trend CSV should only be available options AFTER something has been generated.
Implementation note: Save/Export controls are now created hidden and only shown after a successful generation or when loading an existing generated project.

## SERMON ANALYZER

- [x] Copy Report / Save Report should only be available options AFTER something has been generated.
Implementation note: Copy/Save report controls are hidden by default and only enabled after successful analyzer output generation (or project hydration).
