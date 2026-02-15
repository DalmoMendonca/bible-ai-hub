[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,
  [string]$Region = "us-central1",
  [string]$ServiceName = "bible-ai-hub-api",
  [string]$ArtifactRepo = "bible-ai-hub",
  [string]$DataBucketName = ""
)

$ErrorActionPreference = "Stop"

function Invoke-GCloud {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args,
    [switch]$IgnoreExitCode
  )
  & gcloud @Args
  if (-not $IgnoreExitCode -and $LASTEXITCODE -ne 0) {
    throw "gcloud command failed: gcloud $($Args -join ' ')"
  }
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  throw "gcloud CLI is not installed. Install from https://cloud.google.com/sdk/docs/install"
}

$serviceAccountEmail = "$ServiceName-run@$ProjectId.iam.gserviceaccount.com"
$apis = @(
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "secretmanager.googleapis.com"
)

Write-Host "Setting active project to $ProjectId"
Invoke-GCloud -Args @("config", "set", "project", $ProjectId)

Write-Host "Enabling required APIs"
Invoke-GCloud -Args (@("services", "enable") + $apis)

Write-Host "Ensuring Artifact Registry repo '$ArtifactRepo' exists in $Region"
Invoke-GCloud -Args @(
  "artifacts", "repositories", "describe", $ArtifactRepo,
  "--location", $Region,
  "--project", $ProjectId
) -IgnoreExitCode
if ($LASTEXITCODE -ne 0) {
  Invoke-GCloud -Args @(
    "artifacts", "repositories", "create", $ArtifactRepo,
    "--repository-format=docker",
    "--location", $Region,
    "--description", "Docker images for Bible AI Hub",
    "--project", $ProjectId
  )
}

Write-Host "Ensuring runtime service account '$serviceAccountEmail' exists"
Invoke-GCloud -Args @(
  "iam", "service-accounts", "describe", $serviceAccountEmail,
  "--project", $ProjectId
) -IgnoreExitCode
if ($LASTEXITCODE -ne 0) {
  Invoke-GCloud -Args @(
    "iam", "service-accounts", "create", "$ServiceName-run",
    "--display-name", "Bible AI Hub Cloud Run Runtime",
    "--project", $ProjectId
  )
}

Write-Host "Granting Secret Manager access to runtime service account"
Invoke-GCloud -Args @(
  "projects", "add-iam-policy-binding", $ProjectId,
  "--member", "serviceAccount:$serviceAccountEmail",
  "--role", "roles/secretmanager.secretAccessor",
  "--quiet"
)

if ($DataBucketName) {
  $bucketUrl = "gs://$DataBucketName"
  Write-Host "Ensuring Cloud Storage bucket '$bucketUrl' exists (for persistent app data)"
  Invoke-GCloud -Args @("storage", "buckets", "describe", $bucketUrl, "--project", $ProjectId) -IgnoreExitCode
  if ($LASTEXITCODE -ne 0) {
    Invoke-GCloud -Args @(
      "storage", "buckets", "create", $bucketUrl,
      "--project", $ProjectId,
      "--location", $Region,
      "--uniform-bucket-level-access"
    )
  }

  Write-Host "Granting storage.objectAdmin on $bucketUrl to runtime service account"
  Invoke-GCloud -Args @(
    "storage", "buckets", "add-iam-policy-binding", $bucketUrl,
    "--member", "serviceAccount:$serviceAccountEmail",
    "--role", "roles/storage.objectAdmin",
    "--project", $ProjectId
  )
}

Write-Host ""
Write-Host "Cloud Run bootstrap complete."
Write-Host "Next step:"
Write-Host "  ./scripts/cloudrun/deploy.ps1 -ProjectId $ProjectId -Region $Region -ServiceName $ServiceName -ArtifactRepo $ArtifactRepo -PublicBaseUrl https://bible.hiredalmo.com -OpenAiApiKey '<key>'"
if ($DataBucketName) {
  Write-Host "  (Include -DataBucketName $DataBucketName on deploy to persist app data.)"
}
