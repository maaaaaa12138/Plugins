$ErrorActionPreference = 'Stop'

$pluginRoot = Split-Path -Parent $PSCommandPath
$manifest = Get-Content -LiteralPath (Join-Path $pluginRoot 'plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$marketplace = Get-Content -LiteralPath (Join-Path $pluginRoot '.agents\plugins\marketplace.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$template = Join-Path $pluginRoot 'assets\agents\Codemao Sales Brain.toml'
if (-not (Test-Path -LiteralPath $template -PathType Leaf)) {
    throw "Missing agent template: $template"
}

$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$agentDir = Join-Path $codexHome 'agents'
$agentTarget = Join-Path $agentDir 'Codemao Sales Brain.toml'
if ((Test-Path -LiteralPath $agentTarget) -and
    ((Get-FileHash -LiteralPath $template -Algorithm SHA256).Hash -ne
     (Get-FileHash -LiteralPath $agentTarget -Algorithm SHA256).Hash)) {
    throw "A different named agent already exists: $agentTarget. Review it before replacing it."
}

$codex = (Get-Command codex -ErrorAction Stop).Source
$marketplaceOutput = & $codex plugin marketplace list --json
if ($LASTEXITCODE -ne 0) { throw 'Could not list Codex marketplaces.' }
$installedMarketplaces = ($marketplaceOutput -join "`n" | ConvertFrom-Json).marketplaces
$existing = @($installedMarketplaces | Where-Object { $_.name -eq $marketplace.name })
if ($existing.Count -gt 1) { throw "Multiple marketplaces named $($marketplace.name) exist." }
if ($existing.Count -eq 1) {
    $expected = [IO.Path]::GetFullPath($pluginRoot)
    $actual = [IO.Path]::GetFullPath($existing[0].root)
    if (-not [string]::Equals($expected, $actual, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Marketplace $($marketplace.name) points to $actual, not $expected."
    }
} else {
    & $codex plugin marketplace add $pluginRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not add the Codemao Sales marketplace.' }
}

& $codex plugin add "$($manifest.name)@$($marketplace.name)"
if ($LASTEXITCODE -ne 0) { throw 'Could not install the Codemao Sales plugin.' }

New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
if (-not (Test-Path -LiteralPath $agentTarget)) {
    Copy-Item -LiteralPath $template -Destination $agentTarget
}
Write-Output "Installed $($manifest.name) $($manifest.version) and named agent Codemao Sales Brain. Reload Codex to use the new agent."
