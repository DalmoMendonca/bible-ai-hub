# Bible AI Hub Support Macros

Last updated: 2026-02-13

## 1. Billing Upgrade / Downgrade

Subject: Your Bible AI Hub plan update

Template:
Hello {{name}},

Thanks for reaching out. I confirmed your current workspace plan is `{{plan_id}}`.
I can help you move to `{{target_plan}}` immediately.

What changes with this plan:
- Feature access: {{feature_summary}}
- Limits: {{limit_summary}}
- Billing: {{billing_summary}}

Reply "confirm" and I will finalize this change.

## 2. Quota Reached (Analyzer Minutes)

Subject: Sermon Analyzer monthly limit reached

Template:
Hello {{name}},

You reached your monthly Sermon Analyzer allowance for this workspace:
- Used: {{used}} minutes
- Limit: {{limit}} minutes
- Reset date: {{reset_date}}

 Options:
 1. Wait for automatic monthly reset.
2. Upgrade to a higher-cap plan from `/#homePricing`.

If you want, I can recommend the best fit based on your last 30 days of usage.

## 3. Authentication / Session Issues

Subject: Session reset instructions

Template:
Hello {{name}},

I can see authentication errors on your last attempts.
Please:
1. Sign out from account settings.
2. Refresh once.
3. Sign back in (or continue with guest session).

If the issue persists, send:
- timestamp
- app URL
- screenshot of the error message

I will trace the request immediately.

## 4. Feature Access Denied

Subject: Feature access guidance

Template:
Hello {{name}},

Your workspace role or plan currently blocks this action:
- Feature: {{feature}}
- Reason code: {{reason_code}}

Next steps:
1. Owner can grant role access in team settings.
2. Upgrade plan if feature entitlement is missing.

If you want, I can review your current role + plan and suggest the fastest fix.

## 5. Incident Acknowledgement

Subject: We are actively fixing an outage

Template:
Hello {{name}},

We have confirmed an active incident affecting {{scope}}.
Status: Investigating / Mitigating / Monitoring.

What we know:
- Start time: {{start_time}}
- Impact: {{impact_summary}}
- Next update: {{next_update_time}}

Thank you for your patience. We will share a full post-incident summary.
