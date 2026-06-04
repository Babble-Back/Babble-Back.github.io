param(
  [switch]$Offline
)

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..')
$webOutput = Join-Path $scriptRoot 'app\src\main\assets\www'
$outputsDir = Join-Path $scriptRoot 'outputs'
$apkOutput = Join-Path $outputsDir 'BabbleBack-debug.apk'
$debugApk = Join-Path $scriptRoot 'app\build\outputs\apk\debug\app-debug.apk'

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

function Get-AndroidBuildVersion {
  if ($env:SW_VERSION) {
    return $env:SW_VERSION
  }

  $gitHash = (& git -C $repoRoot rev-parse --short HEAD 2>$null)
  if ($LASTEXITCODE -eq 0 -and $gitHash) {
    return "git-$gitHash"
  }

  return "android-$(Get-Date -Format 'yyyyMMddHHmmss')"
}

function Update-GeneratedServiceWorkerVersion {
  $serviceWorkerPath = Join-Path $webOutput 'sw.js'
  if (-not (Test-Path -LiteralPath $serviceWorkerPath)) {
    return
  }

  $buildVersion = Get-AndroidBuildVersion
  $contents = Get-Content -Raw -LiteralPath $serviceWorkerPath
  $updatedContents = [regex]::Replace(
    $contents,
    "const BUILD_VERSION = '[^']+';",
    "const BUILD_VERSION = '$buildVersion';",
    1
  )

  if ($updatedContents -eq $contents) {
    throw "Could not find BUILD_VERSION in generated service worker."
  }

  Set-Content -LiteralPath $serviceWorkerPath -Value $updatedContents -NoNewline -Encoding UTF8
}

Push-Location $repoRoot
try {
  Invoke-Checked { & .\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit }
  Invoke-Checked { & .\node_modules\.bin\vite.cmd build --outDir $webOutput --emptyOutDir }
  Update-GeneratedServiceWorkerVersion
} finally {
  Pop-Location
}

Push-Location $scriptRoot
try {
  $gradleArgs = @('--no-daemon', '--console=plain', ':app:assembleDebug')
  if ($Offline) {
    $gradleArgs = @('--offline') + $gradleArgs
  }

  Invoke-Checked { & gradle.cmd @gradleArgs }
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Force -Path $outputsDir | Out-Null
Copy-Item -LiteralPath $debugApk -Destination $apkOutput -Force

Write-Host "APK written to $apkOutput"
