$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $projectRoot 'src-tauri\target\release\seamforge.exe'
$releaseRoot = Join-Path $projectRoot 'release'
$portableDir = Join-Path $releaseRoot 'SeamForge-portable'
$archivePath = Join-Path $releaseRoot 'SeamForge-portable.zip'

if (-not (Test-Path -LiteralPath $binary)) {
  throw "Release binary not found at $binary. Run 'npm run tauri:build' first."
}

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null

if (Test-Path -LiteralPath $portableDir) {
  $resolvedPortable = (Resolve-Path -LiteralPath $portableDir).Path
  $resolvedRelease = (Resolve-Path -LiteralPath $releaseRoot).Path
  if (-not $resolvedPortable.StartsWith($resolvedRelease + [IO.Path]::DirectorySeparatorChar)) {
    throw "Refusing to remove directory outside release: $resolvedPortable"
  }
  Remove-Item -LiteralPath $resolvedPortable -Recurse -Force
}

New-Item -ItemType Directory -Path $portableDir -Force | Out-Null
Copy-Item -LiteralPath $binary -Destination (Join-Path $portableDir 'SeamForge.exe') -Force
foreach ($doc in @('LICENSE', 'THIRD_PARTY_LICENSES.md')) {
  $docPath = Join-Path $projectRoot $doc
  if (Test-Path -LiteralPath $docPath) {
    Copy-Item -LiteralPath $docPath -Destination (Join-Path $portableDir $doc) -Force
  }
}

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}

Compress-Archive -Path (Join-Path $portableDir '*') -DestinationPath $archivePath -CompressionLevel Optimal

$exeMb = [math]::Round((Get-Item -LiteralPath (Join-Path $portableDir 'SeamForge.exe')).Length / 1MB, 2)
$zipMb = [math]::Round((Get-Item -LiteralPath $archivePath).Length / 1MB, 2)
Write-Host "Portable folder: $portableDir\SeamForge.exe ($exeMb MB)"
Write-Host "Portable archive: $archivePath ($zipMb MB)"
