[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'manifest.json'
$artifactDirectory = Join-Path $projectRoot 'web-ext-artifacts'

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Could not find manifest.json at $manifestPath"
}

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$version = [string]$manifest.version

if ([string]::IsNullOrWhiteSpace($version)) {
  throw 'manifest.json does not contain a version.'
}

# This allowlist is the complete extension package. Files such as README.md,
# .agents, .git, privacy pages, and previous artifacts are never considered.
$packageFiles = @(
  'manifest.json'
  'new-tab.html'
  'styles.css'
  'js/app-core.js'
  'js/app-status.js'
  'js/app-tabs.js'
  'js/app-bookmarks.js'
  'js/app-tour.js'
  'js/app-init.js'
  'icons/icon-16.png'
  'icons/icon-32.png'
  'icons/icon-48.png'
  'icons/icon-128.png'
)

$missingFiles = @(
  foreach ($relativePath in $packageFiles) {
    $sourcePath = Join-Path $projectRoot ($relativePath -replace '/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      $relativePath
    }
  }
)

if ($missingFiles.Count -gt 0) {
  throw "Required package files are missing: $($missingFiles -join ', ')"
}

New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$targets = @('chrome', 'firefox')
$results = foreach ($target in $targets) {
  # Chrome exposes its cached favicon service through the Chromium-only
  # "favicon" permission. Firefox rejects that permission, so each store
  # package receives a small browser-specific manifest while sharing all
  # runtime files.
  $targetManifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  if ($target -eq 'firefox') {
    $targetManifest.permissions = @(
      $targetManifest.permissions | Where-Object { $_ -ne 'favicon' }
    )
  }
  else {
    $targetManifest.PSObject.Properties.Remove('browser_specific_settings')
  }
  $targetManifestJson = $targetManifest | ConvertTo-Json -Depth 20

  $archiveName = "vaportab-3000-$version-$target.zip"
  $archivePath = Join-Path $artifactDirectory $archiveName
  $fileStream = [IO.File]::Open($archivePath, [IO.FileMode]::Create)

  try {
    $archive = [IO.Compression.ZipArchive]::new(
      $fileStream,
      [IO.Compression.ZipArchiveMode]::Create,
      $false
    )

    try {
      foreach ($relativePath in $packageFiles) {
        if ($relativePath -eq 'manifest.json') {
          $manifestEntry = $archive.CreateEntry(
            'manifest.json',
            [IO.Compression.CompressionLevel]::Optimal
          )
          $manifestStream = $manifestEntry.Open()
          try {
            $manifestWriter = [IO.StreamWriter]::new(
              $manifestStream,
              [Text.UTF8Encoding]::new($false),
              1024,
              $true
            )
            try {
              $manifestWriter.Write($targetManifestJson)
            }
            finally {
              $manifestWriter.Dispose()
            }
          }
          finally {
            $manifestStream.Dispose()
          }
          continue
        }

        $sourcePath = Join-Path $projectRoot ($relativePath -replace '/', [IO.Path]::DirectorySeparatorChar)
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
          $archive,
          $sourcePath,
          $relativePath,
          [IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
      }
    }
    finally {
      $archive.Dispose()
    }
  }
  finally {
    $fileStream.Dispose()
  }

  $verificationArchive = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $archiveEntries = @($verificationArchive.Entries | ForEach-Object FullName)
    $unexpectedEntries = @($archiveEntries | Where-Object { $_ -notin $packageFiles })
    $absentEntries = @($packageFiles | Where-Object { $_ -notin $archiveEntries })

    if ($unexpectedEntries.Count -gt 0 -or $absentEntries.Count -gt 0) {
      throw "$archiveName failed package verification."
    }
  }
  finally {
    $verificationArchive.Dispose()
  }

  [pscustomobject]@{
    Browser = $target
    Package = $archivePath
    Files = $packageFiles.Count
    SizeKB = [math]::Round((Get-Item -LiteralPath $archivePath).Length / 1KB, 1)
  }
}

$results | Format-Table -AutoSize
