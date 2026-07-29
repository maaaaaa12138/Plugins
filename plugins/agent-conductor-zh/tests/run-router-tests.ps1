[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$NodePath,

  [string]$NamePattern
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

try {
  $pluginRoot = Split-Path -Parent $PSScriptRoot
  $router = Join-PathSegments $pluginRoot "skills" "agent-conductor" "scripts" "route-agents.ps1"
  $suite = Join-Path -Path $PSScriptRoot -ChildPath "router-parity.test.mjs"
  if (-not (Test-Path -LiteralPath $router -PathType Leaf)) {
    throw "Router not found: $router"
  }
  if (-not (Test-Path -LiteralPath $suite -PathType Leaf)) {
    throw "Parity suite not found: $suite"
  }

  $arguments = @("--test")
  if ($NamePattern) {
    $arguments += "--test-name-pattern"
    $arguments += $NamePattern
  }
  $arguments += $suite
  $output = & $NodePath @arguments 2>&1
  $exitCode = $LASTEXITCODE
  foreach ($line in @($output)) { Write-Output $line }
  exit $exitCode
}
catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
