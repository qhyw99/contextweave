$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$PrivateEnvFile = Join-Path $ScriptDir "set_env.private.sh"

if (-not (Test-Path $PrivateEnvFile)) {
    Write-Host "未找到私有配置文件: $PrivateEnvFile" -ForegroundColor Red
    Write-Host "请将 set_env.private.example.sh 复制为 set_env.private.sh 并填写私有值" -ForegroundColor Yellow
    exit 1
}

# 解析 .sh 文件中的变量 (直接复用原有的 .sh 配置，用户无需维护两份)
$apiKey = ""
$protocol = ""

Get-Content $PrivateEnvFile | ForEach-Object {
    if ($_ -match 'CONTEXTWEAVE_MCP_API_KEY_VALUE="(.*)"') {
        $apiKey = $Matches[1]
    }
    if ($_ -match 'CONTEXTWEAVE_EDITOR_PROTOCOL_VALUE="(.*)"') {
        $protocol = $Matches[1]
    }
}

if ([string]::IsNullOrWhiteSpace($apiKey) -or [string]::IsNullOrWhiteSpace($protocol)) {
    Write-Host "私有配置文件缺少 CONTEXTWEAVE_MCP_API_KEY_VALUE 或 CONTEXTWEAVE_EDITOR_PROTOCOL_VALUE" -ForegroundColor Red
    exit 1
}

# 设置当前会话的环境变量
$env:CONTEXTWEAVE_MCP_API_KEY = $apiKey
$env:CONTEXTWEAVE_EDITOR_PROTOCOL = $protocol

# 获取 PowerShell 配置文件路径
$ProfilePath = $PROFILE.CurrentUserAllHosts
if (-not $ProfilePath) {
    $ProfilePath = $PROFILE
}

# 确保配置文件的目录和文件存在
$ProfileDir = Split-Path $ProfilePath -Parent
if (-not (Test-Path $ProfileDir)) {
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
}
if (-not (Test-Path $ProfilePath)) {
    New-Item -ItemType File -Force -Path $ProfilePath | Out-Null
}

# 替换或追加环境变量到 Profile
function Upsert-EnvVar {
    param($Key, $Value, $Path)
    $content = if (Test-Path $Path) { Get-Content $Path -Raw } else { "" }
    $regex = "(?m)^\s*\$env:$Key\s*=.*$"
    $newLine = "`$env:$Key = `"$Value`""
    
    if ($content -match $regex) {
        $content = $content -replace $regex, $newLine
        Set-Content -Path $Path -Value $content
    } else {
        Add-Content -Path $Path -Value $newLine
    }
}

Upsert-EnvVar -Key "CONTEXTWEAVE_MCP_API_KEY" -Value $apiKey -Path $ProfilePath
Upsert-EnvVar -Key "CONTEXTWEAVE_EDITOR_PROTOCOL" -Value $protocol -Path $ProfilePath

Write-Host "✅ 已写入 PowerShell 配置 ($ProfilePath) 并在当前会话生效。" -ForegroundColor Green
Write-Host "💡 新开终端也将自动加载这些配置。" -ForegroundColor Green
