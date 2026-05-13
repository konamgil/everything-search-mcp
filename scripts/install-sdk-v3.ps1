#requires -Version 5.1
<#
.SYNOPSIS
  Downloads Everything 1.5 SDK 3 (voidtools/everything_sdk3) and places
  Everything3_x64.dll in the project root for the MCP server to load.

.PARAMETER Force
  Re-download and overwrite an existing Everything3_x64.dll.

.PARAMETER Version
  SDK version tag to fetch (default: 3.0.0.9).
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [string]$Version = '3.0.0.9'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $projectRoot 'Everything3_x64.dll'

if ((Test-Path $target) -and -not $Force) {
  Write-Host "Everything3_x64.dll already present at $target" -ForegroundColor Green
  exit 0
}

$work = Join-Path $projectRoot '.sdk3-tmp'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$zip = Join-Path $work "Everything-SDK-$Version.zip"
$url = "https://github.com/voidtools/everything_sdk3/releases/download/$Version/Everything-SDK-$Version.zip"

Write-Host "Downloading $url ..."
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip

Write-Host "Extracting..."
Expand-Archive -Force -Path $zip -DestinationPath $work

$dll = Get-ChildItem -Recurse $work -Filter 'Everything3_x64.dll' | Select-Object -First 1
if (-not $dll) {
  throw "Everything3_x64.dll not found inside the extracted archive."
}

Copy-Item -Force -Path $dll.FullName -Destination $target
Remove-Item -Recurse -Force $work
Write-Host "Installed: $target" -ForegroundColor Green
