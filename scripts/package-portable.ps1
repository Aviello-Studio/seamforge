$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$electronSource = Join-Path $projectRoot 'node_modules\electron\dist'
$releaseRoot = Join-Path $projectRoot 'release'
$builderFallback = Join-Path $releaseRoot 'win-unpacked.tmp'
$target = Join-Path $releaseRoot 'SeamForge-portable'
$appTarget = Join-Path $target 'resources\app'
$reuseExisting = $false

if (-not (Test-Path -LiteralPath (Join-Path $electronSource 'electron.exe'))) {
  if (Test-Path -LiteralPath (Join-Path $builderFallback 'electron.exe')) {
    $electronSource = $builderFallback
  } elseif (Test-Path -LiteralPath (Join-Path $target 'SeamForge.exe')) {
    $reuseExisting = $true
  } else {
    throw 'Electron runtime not found. Run npm install first.'
  }
}

if ((Test-Path -LiteralPath $target) -and -not $reuseExisting) {
  $resolvedTarget = (Resolve-Path -LiteralPath $target).Path
  $resolvedRelease = (Resolve-Path -LiteralPath $releaseRoot).Path
  if (-not $resolvedTarget.StartsWith($resolvedRelease + [IO.Path]::DirectorySeparatorChar)) {
    throw "Refusing to remove an output outside release: $resolvedTarget"
  }
  Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
}

if (-not $reuseExisting) {
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  Copy-Item -Path (Join-Path $electronSource '*') -Destination $target -Recurse -Force
  Rename-Item -LiteralPath (Join-Path $target 'electron.exe') -NewName 'SeamForge.exe'
}
if (Test-Path -LiteralPath $appTarget) {
  Remove-Item -LiteralPath $appTarget -Recurse -Force
}
New-Item -ItemType Directory -Path $appTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination $appTarget -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist-electron') -Destination $appTarget -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $appTarget

Write-Host "Portable build ready: $target"
