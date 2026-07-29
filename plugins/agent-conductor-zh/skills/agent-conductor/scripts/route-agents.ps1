[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [Alias("q")]
  [string[]]$Query,

  [ValidateRange(1, 50)]
  [int]$Limit = 5,

  [ValidateSet("auto", "global", "project", "bundled")]
  [string]$Scope = "auto",

  [string]$Project,

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
  if ($Scope -eq "project" -and [string]::IsNullOrWhiteSpace($Project)) {
    throw "-Scope project requires -Project with an absolute project root."
  }
  $router = Join-Path -Path $PSScriptRoot -ChildPath "route-agents.mjs"
  if (-not (Test-Path -LiteralPath $router -PathType Leaf)) {
    throw "JavaScript router not found: $router"
  }
  $node = Resolve-NodeRuntime $NodePath
  $arguments = @($router)
  foreach ($item in $Query) {
    $arguments += "--query"
    $arguments += $item
  }
  $arguments += "--limit"
  $arguments += $Limit.ToString([System.Globalization.CultureInfo]::InvariantCulture)
  $arguments += "--scope"
  $arguments += $Scope
  if ($Project) {
    $arguments += "--project"
    $arguments += $Project
  }

  & $node @arguments
  exit $LASTEXITCODE
}
catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
