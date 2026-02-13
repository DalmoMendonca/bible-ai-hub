# Bible AI Hub SEO Keyword Map

This map aligns each indexable page to a primary intent cluster, supporting terms, and on-page content requirements.

## Core Positioning

- Brand: `Bible AI Hub`
- Audience: pastors, preachers, Bible teachers, church leaders, seminary students
- Category: AI tools for Bible study and sermon preparation
- Primary domain: `https://bible.hiredalmo.com/`

## Page-Level Targeting

| URL | Primary Keyword | Secondary Keywords | Intent | Notes |
|---|---|---|---|---|
| `/` | ai bible study tools | ai sermon prep tools, christian ai tools, bible ai hub | Commercial investigation | Hub page should internally link to every app using descriptive anchors. |
| `/ai/apps/bible-study/` | ai bible study tool | clear method bible study, exegesis workflow, bible study assistant | Tool evaluation | Keep CLEAR + 10-step language visible in body copy and FAQ. |
| `/ai/apps/sermon-preparation/` | ai sermon preparation tool | sermon outline generator, expository sermon planning, sermon workflow assistant | Tool evaluation | Emphasize outline generation, transitions, applications, timing. |
| `/ai/apps/teaching-tools/` | ai bible lesson planner | church teaching tools, sunday school lesson generator, bible class planning ai | Tool evaluation | Emphasize age adaptation, discussion prompts, printable output. |
| `/ai/apps/research-helper/` | ai sermon evaluation | sermon manuscript review, sermon feedback ai, sermon editing tool | Tool evaluation | Emphasize diagnostics, revision guidance, readability analysis. |
| `/ai/apps/sermon-analyzer/` | ai sermon analyzer | sermon audio analysis, preaching coach ai, sermon transcription and pacing | Tool evaluation | Emphasize audio upload, metrics, coaching outputs. |
| `/ai/apps/video-search/` | ai video search bible training | timestamped video search, transcript search, semantic video search | Tool evaluation | Emphasize timestamp jumps, transcript retrieval, related content. |

## On-Page Content Brief Requirements

For every indexable page:

1. One clear H1 that includes the page's primary keyword or close variant.
2. Intro paragraph that states:
   - who the tool is for,
   - what specific output it generates,
   - why it is faster or better than manual workflow.
3. At least one supporting section with internal links to related tools.
4. FAQ section (visible HTML) with 3 practical question/answer pairs.
5. Matching FAQ JSON-LD for the visible FAQ questions.

## Internal Linking Rules

- Always link from the home page to all 6 app pages.
- Add contextual cross-links from each app page to at least 2 related pages.
- Use descriptive anchors:
  - `AI sermon preparation tool`
  - `AI Bible study assistant`
  - `AI sermon analyzer`
  - `AI video search`

## Social Sharing Rules

- Standardized 1200x630 image for all pages: `/assets/social-share.png`.
- Ensure each page has:
  - unique `og:title`
  - unique `og:description`
  - canonical URL in `og:url`
  - `twitter:card=summary_large_image`

## Publishing Checklist

1. `npm run smoke`
2. Deploy to production.
3. Submit sitemap in Google Search Console.
4. Request indexing for:
   - `/`
   - all six `/ai/apps/.../` URLs
5. Monitor Search Console:
   - coverage issues,
   - canonicalization warnings,
   - query impressions by page.


