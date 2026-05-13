#requires -Version 5.1
<#
.SYNOPSIS
  Downloads voidtools Everything-SDK and places Everything64.dll
  in the project root so the MCP server can load it via FFI.

.DESCRIPTION
  Idempotent. Skips download when Everything64.dll already exists
  unless -Force is passed.

.PARAMETER Force
  Re-download and overwrite an existing Everything64.dll.
#>
[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $projectRoot 'Everything64.dll'

if ((Test-Path $target) -and -not $Force) {
  Write-Host "Everything64.dll already present at $target" -ForegroundColor Green
  exit 0
}

$work = Join-Path $projectRoot '.sdk-tmp'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$zip = Join-Path $work 'Everything-SDK.zip'

Write-Host "Downloading Everything SDK from voidtools..."
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -UseBasicParsing -Uri 'https://www.voidtools.com/Everything-SDK.zip' -OutFile $zip

Write-Host "Extracting..."
Expand-Archive -Force -Path $zip -DestinationPath $work

$dll = Join-Path $work 'dll\Everything64.dll'
if (-not (Test-Path $dll)) {
  throw "Everything64.dll not found in extracted archive at $dll"
}

Copy-Item -Force -Path $dll -Destination $target
Remove-Item -Recurse -Force $work
Write-Host "Installed: $target" -ForegroundColor Green
