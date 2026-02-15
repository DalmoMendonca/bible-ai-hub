[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,
  [string]$Region = "us-central1",
  [string]$ServiceName = "bible-ai-hub-api",
  [string]$ArtifactRepo = "bible-ai-hub",
  [string]$ImageName = "api",
  [string]$Tag = "",
  [Parameter(Mandatory = $true)]
  [string]$PublicBaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$OpenAiApiKey,
  [string]$GoogleClientId = "",
  [string]$GaMeasurementId = "",
  [string]$MagicLinkFromEmail = "",
  [string]$AdminDashboardPassword = "",
  [string]$AuthTokenSigningSecret = "",
  [string]$ResendApiKey = "",
  [string]$DataBucketName = "",
  [int]$TimeoutSeconds = 900,
  [string]$Memory = "2Gi",
  [string]$Cpu = "1",
  [int]$Concurrency = 40,
  [int]$MaxInstances = 1,
  [int]$MinInstances = 0
)

$ErrorActionPreference = "Stop"
$gcloudExe = ""

function Resolve-GCloudExecutable {
  $cmd = Get-Command gcloud.cmd -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) {
    return $cmd.Source
  }
  $generic = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($generic -and $generic.Source) {
    return $generic.Source
  }
  return ""
}

function Invoke-GCloud {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  & $gcloudExe @Args
  if ($LASTEXITCODE -ne 0) {
    throw "gcloud command failed: gcloud $($Args -join ' ')"
  }
}

function Invoke-GCloudOptional {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  & $gcloudExe @Args
  return ($LASTEXITCODE -eq 0)
}

function Ensure-SecretVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SecretName,
    [Parameter(Mandatory = $true)]
    [string]$SecretValue
  )
  if (-not $SecretValue) {
    return $false
  }

  $exists = $false
  try {
    & $gcloudExe secrets describe $SecretName --project $ProjectId *> $null
    $exists = ($LASTEXITCODE -eq 0)
  } catch {
    $exists = $false
  }
  if (-not $exists) {
    Invoke-GCloud -Args @(
      "secrets", "create", $SecretName,
      "--replication-policy", "automatic",
      "--project", $ProjectId
    )
  }

  $tmpFile = [System.IO.Path]::GetTempFileName()
  try {
    Set-Content -Path $tmpFile -NoNewline -Value $SecretValue -Encoding UTF8
    & $gcloudExe secrets versions add $SecretName "--data-file=$tmpFile" --project $ProjectId *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to add secret version for $SecretName"
    }
  } finally {
    Remove-Item -Path $tmpFile -Force -ErrorAction SilentlyContinue
  }
  return $true
}

function Ensure-ServicesEnabled {
  $apis = @(
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com"
  )
  Write-Host "Ensuring required APIs are enabled"
  Invoke-GCloud -Args (@("services", "enable") + $apis + @("--project", $ProjectId))
}

function Ensure-ArtifactRepo {
  Write-Host "Ensuring Artifact Registry repo '$ArtifactRepo' exists in $Region"
  $repoOk = Invoke-GCloudOptional -Args @(
    "artifacts", "repositories", "describe", $ArtifactRepo,
    "--location", $Region,
    "--project", $ProjectId
  )
  if (-not $repoOk) {
    Invoke-GCloud -Args @(
      "artifacts", "repositories", "create", $ArtifactRepo,
      "--repository-format=docker",
      "--location", $Region,
      "--description", "Docker images for Bible AI Hub",
      "--project", $ProjectId
    )
  }
}

function Ensure-CloudBuildCanPush {
  Write-Host "Ensuring Cloud Build can push images to Artifact Registry"
  $projectNumber = (& $gcloudExe projects describe $ProjectId --format "value(projectNumber)" 2>$null).Trim()
  if (-not $projectNumber) {
    throw "Unable to resolve project number for $ProjectId"
  }
  $cloudBuildSa = "$projectNumber@cloudbuild.gserviceaccount.com"
  Invoke-GCloud -Args @(
    "projects", "add-iam-policy-binding", $ProjectId,
    "--member", "serviceAccount:$cloudBuildSa",
    "--role", "roles/artifactregistry.writer",
    "--quiet"
  )
}

$gcloudExe = Resolve-GCloudExecutable
if (-not $gcloudExe) {
  throw "gcloud CLI is not installed. Install from https://cloud.google.com/sdk/docs/install"
}
if (-not $OpenAiApiKey) {
  throw "OpenAiApiKey is required."
}

$activeAccount = (& $gcloudExe config get-value account 2>$null).Trim()
if (-not $activeAccount) {
  throw "gcloud is not authenticated. Run: gcloud auth login"
}

if (-not $Tag) {
  $Tag = Get-Date -Format "yyyyMMdd-HHmmss"
}

$timeoutClamped = [Math]::Min([Math]::Max($TimeoutSeconds, 1), 3600)
$serviceAccountEmail = "$ServiceName-run@$ProjectId.iam.gserviceaccount.com"
$imageUri = "$Region-docker.pkg.dev/$ProjectId/$ArtifactRepo/${ImageName}:$Tag"
$dataMountPath = "/var/bible-ai-hub-data"
$dataDir = if ($DataBucketName) { $dataMountPath } else { "/tmp/bible-ai-hub-data" }

Write-Host "Setting active project to $ProjectId"
Invoke-GCloud -Args @("config", "set", "project", $ProjectId)

Ensure-ServicesEnabled
Ensure-ArtifactRepo
Ensure-CloudBuildCanPush

Write-Host "Building image: $imageUri"
Invoke-GCloud -Args @("builds", "submit", "--tag", $imageUri, "--project", $ProjectId, ".")

Write-Host "Ensuring runtime service account '$serviceAccountEmail' exists"
$serviceAccountExists = $false
try {
  & $gcloudExe iam service-accounts describe $serviceAccountEmail --project $ProjectId *> $null
  $serviceAccountExists = ($LASTEXITCODE -eq 0)
} catch {
  $serviceAccountExists = $false
}
if (-not $serviceAccountExists) {
  Invoke-GCloud -Args @(
    "iam", "service-accounts", "create", "$ServiceName-run",
    "--display-name", "Bible AI Hub Cloud Run Runtime",
    "--project", $ProjectId
  )
}

Write-Host "Ensuring runtime service account can read secrets"
Invoke-GCloud -Args @(
  "projects", "add-iam-policy-binding", $ProjectId,
  "--member", "serviceAccount:$serviceAccountEmail",
  "--role", "roles/secretmanager.secretAccessor",
  "--quiet"
)

$secretMappings = New-Object System.Collections.Generic.List[string]

Write-Host "Syncing required secrets to Secret Manager"
if (Ensure-SecretVersion -SecretName "OPENAI_API_KEY" -SecretValue $OpenAiApiKey) {
  $secretMappings.Add("OPENAI_API_KEY=OPENAI_API_KEY:latest")
}
if (Ensure-SecretVersion -SecretName "ADMIN_DASHBOARD_PASSWORD" -SecretValue $AdminDashboardPassword) {
  $secretMappings.Add("ADMIN_DASHBOARD_PASSWORD=ADMIN_DASHBOARD_PASSWORD:latest")
}
if (Ensure-SecretVersion -SecretName "AUTH_TOKEN_SIGNING_SECRET" -SecretValue $AuthTokenSigningSecret) {
  $secretMappings.Add("AUTH_TOKEN_SIGNING_SECRET=AUTH_TOKEN_SIGNING_SECRET:latest")
}
if (Ensure-SecretVersion -SecretName "RESEND_API_KEY" -SecretValue $ResendApiKey) {
  $secretMappings.Add("RESEND_API_KEY=RESEND_API_KEY:latest")
}

$envVars = New-Object "System.Collections.Specialized.OrderedDictionary"
$envVars["NODE_ENV"] = "production"
$envVars["PUBLIC_BASE_URL"] = $PublicBaseUrl
$envVars["BIBLE_AI_DATA_DIR"] = $dataDir
$envVars["OPENAI_REQUEST_TIMEOUT_MS"] = "110000"
if ($GoogleClientId) {
  $envVars["GOOGLE_CLIENT_ID"] = $GoogleClientId
}
if ($GaMeasurementId) {
  $envVars["GA_MEASUREMENT_ID"] = $GaMeasurementId
}
if ($MagicLinkFromEmail) {
  $envVars["MAGIC_LINK_FROM_EMAIL"] = $MagicLinkFromEmail
}

$envVarPairs = @()
foreach ($key in $envVars.Keys) {
  $envVarPairs += "$key=$($envVars[$key])"
}

$deployArgs = @(
  "run", "deploy", $ServiceName,
  "--image", $imageUri,
  "--project", $ProjectId,
  "--region", $Region,
  "--platform", "managed",
  "--port", "8080",
  "--service-account", $serviceAccountEmail,
  "--execution-environment", "gen2",
  "--memory", $Memory,
  "--cpu", $Cpu,
  "--timeout", "${timeoutClamped}s",
  "--concurrency", "$Concurrency",
  "--max-instances", "$MaxInstances",
  "--min-instances", "$MinInstances",
  "--allow-unauthenticated"
)

if ($DataBucketName) {
  $bucketUrl = "gs://$DataBucketName"
  Write-Host "Ensuring Cloud Storage bucket '$bucketUrl' exists"
  $bucketExists = $false
  try {
    & $gcloudExe storage buckets describe $bucketUrl --project $ProjectId *> $null
    $bucketExists = ($LASTEXITCODE -eq 0)
  } catch {
    $bucketExists = $false
  }
  if (-not $bucketExists) {
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

  $deployArgs += @("--add-volume", "name=app-data,type=cloud-storage,bucket=$DataBucketName,mount-options=implicit-dirs=true")
  $deployArgs += @("--add-volume-mount", "volume=app-data,mount-path=$dataMountPath")
}

if ($envVarPairs.Count -gt 0) {
  $deployArgs += @("--set-env-vars", ($envVarPairs -join ","))
}
if ($secretMappings.Count -gt 0) {
  $deployArgs += @("--set-secrets", ($secretMappings -join ","))
}

Write-Host "Deploying Cloud Run service '$ServiceName'"
Invoke-GCloud -Args $deployArgs

$serviceUrl = (& $gcloudExe run services describe $ServiceName --project $ProjectId --region $Region --format "value(status.url)").Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Deployed, but failed to fetch service URL."
}

Write-Host ""
Write-Host "Cloud Run deploy complete."
Write-Host "Service URL: $serviceUrl"
Write-Host "Health check: $serviceUrl/api/health"
Write-Host "If this will replace Netlify for the main domain, map your custom domain to this service in Cloud Run > Domain mappings."
