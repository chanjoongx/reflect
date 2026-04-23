# reflect — PostToolUse hook (PowerShell version for Windows)
#
# Installed via .claude/settings.json:
#   {
#     "hooks": {
#       "PostToolUse": [{
#         "matcher": "Bash|Edit|Write",
#         "hooks": [{ "type": "command", "command": "powershell -File $CLAUDE_PROJECT_DIR/.claude/hooks/reflect-trigger.ps1", "timeout": 30 }]
#       }]
#     }
#   }
#
# Behavior: parity with reflect-trigger.sh —
#   - Tracks cum_x100 (integer weighted signal × 100)
#   - Appends each tool call to .reflect/recent-calls.jsonl (trimmed to 20)
#   - Invokes bin/reflect.ts trigger on threshold
#
# Disable: $env:REFLECT_DISABLED = "1"

if ($env:REFLECT_DISABLED -eq "1") { exit 0 }

$ErrorActionPreference = "SilentlyContinue"

# ─── Config ──────────────────────────────────────────────────────────
$Stdin = [Console]::In.ReadToEnd()
try { $Payload = $Stdin | ConvertFrom-Json } catch { exit 0 }

$ToolName = if ($Payload.tool_name) { [string]$Payload.tool_name } else { "unknown" }
$SessionId = if ($Payload.session_id) { [string]$Payload.session_id } else { "none" }
$BashCmd = [string]$Payload.tool_input.command
$FilePath = if ($Payload.tool_input.file_path) { [string]$Payload.tool_input.file_path } else { [string]$Payload.tool_input.path }

$ProjectDir = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
$PluginRoot = if ($env:CLAUDE_PLUGIN_ROOT) { $env:CLAUDE_PLUGIN_ROOT } else { $ProjectDir }
$ThresholdX100 = if ($env:REFLECT_TRIGGER_THRESHOLD_X100) { [int]$env:REFLECT_TRIGGER_THRESHOLD_X100 } else { 240 }
$Cooldown = if ($env:REFLECT_COOLDOWN_TURNS) { [int]$env:REFLECT_COOLDOWN_TURNS } else { 5 }
$MaxCalls = if ($env:REFLECT_MAX_RECENT_CALLS) { [int]$env:REFLECT_MAX_RECENT_CALLS } else { 20 }

$StateDir = Join-Path $ProjectDir ".reflect"
$StateFile = Join-Path $StateDir "state.json"
$CallsFile = Join-Path $StateDir "recent-calls.jsonl"

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

# ─── Read current state ──────────────────────────────────────────────
$CurrentSession = ""
$CumX100 = 0
$Turn = 0
$CooldownRemaining = 0

if (Test-Path $StateFile) {
    try {
        $State = Get-Content $StateFile -Raw | ConvertFrom-Json
        $CurrentSession = [string]$State.session_id
        if ($null -ne $State.cum_x100) { $CumX100 = [int]$State.cum_x100 }
        if ($null -ne $State.turn_count) { $Turn = [int]$State.turn_count }
        if ($null -ne $State.cooldown_remaining) { $CooldownRemaining = [int]$State.cooldown_remaining }
    } catch {
        # Corrupt state — treat as new session
    }
}

# New session → reset
if ($CurrentSession -ne $SessionId) {
    $CumX100 = 0
    $Turn = 0
    $CooldownRemaining = 0
    if (Test-Path $CallsFile) { Clear-Content $CallsFile -Force }
}

$Turn++
if ($CooldownRemaining -gt 0) { $CooldownRemaining-- }

# ─── Detect signals ──────────────────────────────────────────────────
$SignalX100 = 0
$SignalTier = 0

if ($ToolName -eq "Bash" -and $BashCmd) {
    if ($BashCmd -match '^(git revert|git restore|git checkout HEAD --)') {
        $SignalX100 = 100
        $SignalTier = 1
    }
    elseif ($BashCmd -match '^(rm |unlink )') {
        if (-not ($BashCmd -match '(node_modules|dist|build|\.next|coverage)')) {
            $SignalX100 = 70
            $SignalTier = 2
        }
    }
}

# ─── Append to recent-calls.jsonl ────────────────────────────────────
if ($ToolName -eq "Bash") {
    $Summary = $BashCmd
} elseif ($FilePath) {
    $Summary = $FilePath
} else {
    $Summary = ""
}
if ($Summary.Length -gt 150) { $Summary = $Summary.Substring(0, 150) }
$Summary = $Summary -replace '\\', '\\' -replace '"', '\"' -replace '[\r\n\t]', ' '

$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$Line = '{"turn":' + $Turn + ',"tool":"' + $ToolName + '","tier":' + $SignalTier + ',"input_summary":"' + $Summary + '","timestamp":"' + $Timestamp + '"}'
Add-Content -Path $CallsFile -Value $Line -Encoding utf8

# Trim to last MaxCalls lines
if (Test-Path $CallsFile) {
    $Lines = Get-Content $CallsFile -Tail $MaxCalls
    Set-Content -Path $CallsFile -Value $Lines -Encoding utf8
}

# ─── Accumulate + write state ────────────────────────────────────────
if ($SignalX100 -gt 0) {
    $CumX100 += $SignalX100
}

function Write-State {
    $StateJson = '{"session_id":"' + $SessionId + '","turn_count":' + $Turn + ',"cum_x100":' + $CumX100 + ',"cooldown_remaining":' + $CooldownRemaining + '}'
    Set-Content -Path $StateFile -Value $StateJson -Encoding utf8
}

# ─── Threshold check + fire trigger ──────────────────────────────────
if ($CumX100 -ge $ThresholdX100 -and $CooldownRemaining -eq 0) {
    if ($env:REFLECT_DEBUG -eq "1") {
        Write-Host "[reflect] threshold met ($CumX100 >= $ThresholdX100) — invoking reflect-core" -ErrorAction SilentlyContinue
    }

    $CooldownRemaining = $Cooldown
    $CumX100 = 0
    Write-State

    $TargetDir = $null
    if (Test-Path (Join-Path $ProjectDir "bin/reflect.ts")) {
        $TargetDir = $ProjectDir
    } elseif (Test-Path (Join-Path $PluginRoot "bin/reflect.ts")) {
        $TargetDir = $PluginRoot
    }
    if ($TargetDir) {
        Start-Process -NoNewWindow -FilePath "npx" `
            -ArgumentList "tsx", "bin/reflect.ts", "trigger", "--session", $SessionId `
            -WorkingDirectory $TargetDir `
            -RedirectStandardOutput (Join-Path $StateDir "trigger.log") `
            -RedirectStandardError (Join-Path $StateDir "trigger.err.log")
    }
} else {
    Write-State
}

exit 0
