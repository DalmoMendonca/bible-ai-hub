# Bible AI Hub Ops Runbook

Last updated: 2026-02-13

## 1. Incident Triage

1. Confirm scope:
- `GET /api/health`
- Check Netlify deploy status and latest commit.
- Verify whether issue is frontend-only, API-only, or model/provider related.

2. Classify severity:
- `SEV-1`: login/auth/billing/prod-wide AI generation outage.
- `SEV-2`: one app degraded, partial failures, or elevated latency.
- `SEV-3`: non-blocking UX/reporting defects.

3. Open incident channel and assign roles:
- Incident Commander
- Comms Owner
- Mitigation Owner
- Scribe

## 2. First 10-Minute Checks

1. Verify environment basics:
- `OPENAI_API_KEY` present and valid.
- API error rates in logs.
- Rate-limit abuse spikes.

2. Verify routing:
- root `/`
- each `/ai/apps/*/`
- `/api/health`

3. Verify critical AI endpoints:
- `/api/ai/bible-study`
- `/api/ai/sermon-preparation`
- `/api/ai/teaching-tools`
- `/api/ai/research-helper`
- `/api/ai/sermon-analyzer`
- `/api/ai/video-search`

## 3. Rollback Procedure

1. Identify last known good commit SHA in `main`.
2. Re-deploy known good SHA in Netlify.
3. Confirm smoke routes return healthy responses.
4. Post rollback notice with:
- incident ID
- rollback SHA
- affected window

## 4. Safe Mitigations Before Full Rollback

1. Toggle staged flags to reduce blast radius:
- set risky flags to `off` or `internal` in `server/data/feature-flags.json`.
2. Apply temporary stricter rate limits to protect capacity.
3. Shift users to lower-risk flows (e.g., async analyzer paths).

## 5. Post-Incident Checklist

1. Root-cause analysis within 24h.
2. Add or update regression test to prevent recurrence.
3. Update this runbook if mitigation steps changed.
4. Publish customer-facing summary for SEV-1/SEV-2 incidents.

