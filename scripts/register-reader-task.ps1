# The Reader scheduler runs as one bounded decision per invocation.
#
# It only ever reads or writes the Reader state under %LOCALAPPDATA%\SayIt\Reader
# and appends its own line to scheduler.log next to that state, so a missed or
# crashed run leaves evidence instead of disappearing.
#
# One task owns scheduled collection. The Vite development server no longer arms
# a timer, so a merely open browser window cannot duplicate or block a run.
#
# Usage (from the repository root):
#   pwsh -File scripts/register-reader-task.ps1                 # create or update
#   pwsh -File scripts/register-reader-task.ps1 -Remove         # delete
#   pwsh -File scripts/register-reader-task.ps1 -RunNow         # trigger once
param(
  [string]$TaskName = 'SayIt Reader Collection',
  [int]$RepeatMinutes = 10,
  [switch]$Remove,
  [switch]$RunNow
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
  } else {
    Write-Host "No scheduled task named '$TaskName'."
  }
  return
}

$node = (Get-Command node -ErrorAction Stop).Source

# Reader stores its state with the built-in node:sqlite module. An older runtime
# would fail inside the task, where the failure is invisible, so the version is
# checked here where a human is still watching.
$nodeMajor = [int](& $node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 24) {
  throw "Node.js 24 or newer is required (found $(& $node --version)). Reader uses the built-in node:sqlite module. Install the current Node.js 24 LTS release from https://nodejs.org/ and run this script again."
}

$viteNode = Join-Path $repo 'node_modules\vite-node\vite-node.mjs'
if (-not (Test-Path $viteNode)) {
  throw "vite-node was not found at $viteNode. Run 'npm install' first."
}

$entry = Join-Path $repo 'server\reader\scheduler-main.ts'
$arguments = "`"$viteNode`" `"$entry`" --timeout-ms 600000"

$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $RepeatMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 1)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Runs the SayIt Reader daily collection check.' `
  -Force | Out-Null

Write-Host "Registered '$TaskName' (every $RepeatMinutes minutes)."
Get-ScheduledTask -TaskName $TaskName |
  Select-Object TaskName, State |
  Format-Table -AutoSize

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Triggered '$TaskName' once."
}
