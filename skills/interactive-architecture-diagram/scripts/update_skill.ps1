[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$SkillsDir,
    [string]$RequiredVersion
)

$ErrorActionPreference = "Stop"
$updater = Join-Path $PSScriptRoot "update_skill.cjs"
$node = Get-Command node -ErrorAction SilentlyContinue

if (-not $node) {
    Write-Error "Node.js was not found. Install it first, or follow https://skillhub.cn/install/skillhub.md."
    exit 1
}

$updaterArgs = @($updater)
if ($DryRun) {
    $updaterArgs += "--dry-run"
}
if ($SkillsDir) {
    $updaterArgs += @("--skills-dir", $SkillsDir)
}
if ($RequiredVersion) {
    $updaterArgs += @("--required-version", $RequiredVersion)
}

& $node.Source @updaterArgs
exit $LASTEXITCODE
