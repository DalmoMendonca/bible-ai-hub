# Bible AI Hub Alert Thresholds

Last updated: 2026-02-13

## Core API Health

1. `GET /api/health`
- alert if non-200 for 3 consecutive minutes.

2. 5xx error rate (all `/api/*`)
- warn at `>= 2%` for 5 minutes.
- critical at `>= 5%` for 3 minutes.

3. p95 latency (all `/api/ai/*`)
- warn at `>= 20s` for 10 minutes.
- critical at `>= 40s` for 5 minutes.

## Feature-Specific Alerts

1. Sermon Analyzer queue (`/api/ai/sermon-analyzer/queue-status`)
- warn if queue depth `>= 10` for 10 minutes.
- critical if queue depth `>= 25` for 5 minutes.
- critical if job failure ratio `>= 10%` over rolling 15 minutes.

2. Video Search (`/api/ai/video-search`)
- warn if p95 latency `>= 12s` for 10 minutes.
- critical if p95 latency `>= 20s` for 5 minutes.

3. Billing and entitlement routes
- alert if any 5xx persists for 3 minutes on:
  - `/api/billing/checkout`
  - `/api/billing/webhook`
  - `/api/entitlements`

## Abuse and Quota Signals

1. Rate limiting
- warn when `429` responses exceed 50/min.
- critical when `429` responses exceed 150/min.

2. Quota-denied spikes
- warn when quota denials jump >200% above 7-day baseline.

## Alert Routing

1. `SEV-1`:
- Pager + Slack incident channel
- immediate incident commander assignment

2. `SEV-2`:
- Slack + ticket escalation
- mitigation owner within 30 minutes

