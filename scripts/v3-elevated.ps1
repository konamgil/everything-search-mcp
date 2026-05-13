$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$query = if ($args.Count -ge 1) { $args[0] } else { 'content:ServerRegistry path:mandu' }
$outFile = Join-Path $projectRoot 'v3-out.txt'
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$script  = Join-Path $projectRoot 'dist\v3-smoke.js'

"[elevated] cwd=$projectRoot"            | Out-File -FilePath $outFile -Encoding utf8
"[elevated] node=$nodeExe"               | Out-File -FilePath $outFile -Encoding utf8 -Append
"[elevated] script=$script"              | Out-File -FilePath $outFile -Encoding utf8 -Append
"[elevated] query=$query"                | Out-File -FilePath $outFile -Encoding utf8 -Append
"[elevated] === node output begin ==="   | Out-File -FilePath $outFile -Encoding utf8 -Append

try {
  $output = & $nodeExe $script '1.5a' $query 2>&1
  $output | Out-File -FilePath $outFile -Encoding utf8 -Append
  "[elevated] === exit=$LASTEXITCODE ===" | Out-File -FilePath $outFile -Encoding utf8 -Append
} catch {
  "[elevated] EXCEPTION: $($_.Exception.Message)" | Out-File -FilePath $outFile -Encoding utf8 -Append
}

Write-Host "[elevated] done — output at $outFile"
Get-Content $outFile | Write-Host
Write-Host ""
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
