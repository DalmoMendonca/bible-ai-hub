# Google Cloud Run Setup (Bible AI Hub)

This repo now includes Cloud Run deployment scripts so you can move off Netlify function timeouts.

## What this setup gives you

- Runs the existing Node/Express app (`server.js`) as a long-lived service on Cloud Run.
- Supports request timeouts up to 60 minutes (instead of Netlify function 30s hard timeout).
- Supports persistent writable app data via `BIBLE_AI_DATA_DIR` and optional Cloud Storage mount.
- Keeps the same `/api/*` routes and static pages behavior.

## Files added for Cloud Run

- `Dockerfile`
- `.dockerignore`
- `scripts/cloudrun/setup.ps1`
- `scripts/cloudrun/deploy.ps1`

## Values you need

- `ProjectId`: your Google Cloud project ID.
- `Region`: recommended `us-central1` (or your preferred region).
- `PublicBaseUrl`: canonical app URL, for example `https://bible.hiredalmo.com`.
- `OpenAiApiKey`: your OpenAI API key.
- Optional:
  - `GoogleClientId`
  - `GaMeasurementId`
  - `MagicLinkFromEmail`
  - `AdminDashboardPassword`
  - `AuthTokenSigningSecret`
  - `ResendApiKey`
  - `DataBucketName` (recommended for persistent project/auth/app state)

## One-time bootstrap

Run in PowerShell from repo root:

```powershell
./scripts/cloudrun/setup.ps1 `
  -ProjectId "YOUR_GCP_PROJECT_ID" `
  -Region "us-central1" `
  -ServiceName "bible-ai-hub-api" `
  -ArtifactRepo "bible-ai-hub" `
  -DataBucketName "YOUR_UNIQUE_BUCKET_NAME"
```

What this does:

- Enables required APIs.
- Ensures Artifact Registry exists.
- Ensures Cloud Run runtime service account exists.
- Grants Secret Manager access to that service account.
- Optionally creates/grants a Cloud Storage bucket for persistent app data.

## Deploy command

```powershell
./scripts/cloudrun/deploy.ps1 `
  -ProjectId "YOUR_GCP_PROJECT_ID" `
  -Region "us-central1" `
  -ServiceName "bible-ai-hub-api" `
  -ArtifactRepo "bible-ai-hub" `
  -PublicBaseUrl "https://bible.hiredalmo.com" `
  -OpenAiApiKey "sk-..." `
  -GoogleClientId "..." `
  -GaMeasurementId "G-..." `
  -MagicLinkFromEmail "Bible AI Hub <no-reply@yourdomain.com>" `
  -AdminDashboardPassword "..." `
  -AuthTokenSigningSecret "..." `
  -ResendApiKey "re_..." `
  -DataBucketName "YOUR_UNIQUE_BUCKET_NAME"
```

This script:

- Builds and pushes a container image using Cloud Build.
- Upserts secrets in Secret Manager.
- Deploys Cloud Run with high timeout (`900s` default, configurable).
- Mounts your data bucket if provided and sets `BIBLE_AI_DATA_DIR`.

## Verify

After deploy, call:

- `https://<your-cloud-run-url>/api/health`

Then test:

- Sign-in persistence across refresh
- Magic-link login
- AI generation endpoints
- Project save/open flow

## Domain options

1. Replace Netlify entirely (recommended for simplest behavior): map `bible.hiredalmo.com` directly to Cloud Run.
2. Keep Netlify static frontend and proxy `/api/*` to Cloud Run (requires Netlify redirect changes).

## Important note on state

This app currently stores auth/session/workspace/project state in JSON files. For reliable persistence in Cloud Run:

- Use `-DataBucketName` and keep `max-instances=1` initially.
- If traffic grows, migrate platform state to a real database (Firestore/Cloud SQL) before increasing instance count.
