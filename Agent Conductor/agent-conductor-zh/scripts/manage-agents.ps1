[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("status", "install", "update", "uninstall")]
  [string]$Action,

  [ValidateSet("global", "project")]
  [string]$Scope = "global",

  [string]$Project,

  [switch]$DryRun,

  [switch]$Json,

  [string]$NodePath
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Join-PathSegments {
  param(
    [Parameter(Mandatory = $true)][string]$Base,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Segments
  )
  $result = $Base
  foreach ($segment in $Segments) {
    $result = Join-Path -Path $result -ChildPath $segment
  }
  return $result
}

function Test-NodeRuntime([string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate)) { return $false }
  try {
    $version = & $Candidate --version 2>$null
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.') { return $false }
    return [int]$Matches[1] -ge 18
  }
  catch {
    return $false
  }
}

function Resolve-NodeRuntime([string]$ExplicitPath) {
  $candidates = @()
  if ($ExplicitPath) { $candidates += $ExplicitPath }
  if ($env:AGENT_CONDUCTOR_NODE) { $candidates += $env:AGENT_CONDUCTOR_NODE }
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { $candidates += $command.Source }
  $candidates += Join-PathSegments $HOME ".cache" "codex-runtimes" "codex-primary-runtime" "dependencies" "node" "bin" "node.exe"

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if (Test-NodeRuntime $candidate) { return $candidate }
  }
  throw "Node.js 18 or newer was not found. Set AGENT_CONDUCTOR_NODE or pass -NodePath."
}

try {
  $manager = Join-Path -Path $PSScriptRoot -ChildPath "manage-agents.mjs"
  if (-not (Test-Path -LiteralPath $manager -PathType Leaf)) {
    throw "JavaScript manager not found: $manager"
  }

  $node = Resolve-NodeRuntime $NodePath
  $arguments = @($manager, $Action, "--scope", $Scope)
  if ($Project) {
    $arguments += "--project"
    $arguments += $Project
  }
  if ($DryRun) { $arguments += "--dry-run" }
  if ($Json) { $arguments += "--json" }

  & $node @arguments
  exit $LASTEXITCODE
}
catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
