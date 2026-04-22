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
# Behavior: same as reflect-trigger.sh — observes signals, invokes bin/reflect.ts on threshold.
# Disable: $env:REFLECT_DISABLED = "1"

# ─── Disable check ────────────────────────────────────────────────────
if ($env:REFLECT_DISABLED -eq "1") { exit 0 }

$ErrorActionPreference = "SilentlyContinue"

# ─── Config ──────────────────────────────────────────────────────────
$Stdin = [Console]::In.ReadToEnd()
$Payload = $Stdin | ConvertFrom-Json

$ToolName = $Payload.tool_name
$SessionId = $Payload.session_id
$BashCmd = $Payload.tool_input.command
$FilePath = if ($Payload.tool_input.file_path) { $Payload.tool_input.file_path } else { $Payload.tool_input.path }

$ProjectDir = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
$PluginRoot = if ($env:CLAUDE_PLUGIN_ROOT) { $env:CLAUDE_PLUGIN_ROOT } else { $ProjectDir }
$Threshold = if ($env:REFLECT_TRIGGER_THRESHOLD) { [double]$env:REFLECT_TRIGGER_THRESHOLD } else { 2.4 }
$Cooldown = if ($env:REFLECT_COOLDOWN_TURNS) { [int]$env:REFLECT_COOLDOWN_TURNS } else { 5 }
$Window = if ($env:REFLECT_WINDOW_SIZE) { [int]$env:REFLECT_WINDOW_SIZE } else { 10 }

$StateDir = Join-Path $ProjectDir ".reflect"
$StateFile = Join-Path $StateDir "state.json"

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

# ─── Initialize state ─────────────────────────────────────────────────
if (-not (Test-Path $StateFile)) {
    @{
        session_id = ""
        signals = @()
        cooldown_remaining = 0
        turn_count = 0
    } | ConvertTo-Json -Compress | Out-File -FilePath $StateFile -Encoding utf8
}

$State = Get-Content $StateFile -Raw | ConvertFrom-Json

# Reset on new session
if ($State.session_id -ne $SessionId) {
    $State = @{
        session_id = $SessionId
        signals = @()
        cooldown_remaining = 0
        turn_count = 0
    }
}

$State.turn_count++
if ($State.cooldown_remaining -gt 0) {
    $State.cooldown_remaining--
}

# ─── Detect signals ───────────────────────────────────────────────────
$SignalWeight = 0.0

if ($ToolName -eq "Bash" -and $BashCmd) {
    # Tier 1: git revert / restore
    if ($BashCmd -match '^(git revert|git restore|git checkout HEAD --)') {
        $SignalWeight = 1.0
    }
    # Tier 2: rm/unlink
    elseif ($BashCmd -match '^(rm |unlink )') {
        $SignalWeight = 0.7
    }
}

if ($SignalWeight -eq 0) {
    $State | ConvertTo-Json -Compress | Out-File -FilePath $StateFile -Encoding utf8
    exit 0
}

# ─── Record signal ───────────────────────────────────────────────────
$NewSignal = @{ weight = $SignalWeight; turn = $State.turn_count }
$State.signals = @($State.signals) + @($NewSignal)
# Trim to window
$State.signals = @($State.signals | Where-Object { $_.turn -gt ($State.turn_count - $Window) })

$Sum = ($State.signals | Measure-Object -Property weight -Sum).Sum
if (-not $Sum) { $Sum = 0 }

if ($env:REFLECT_DEBUG -eq "1") {
    Write-Host "[reflect] turn=$($State.turn_count) signal_weight=$SignalWeight sum=$Sum cooldown=$($State.cooldown_remaining)" -ErrorAction SilentlyContinue
}

# Trigger
if ($Sum -ge $Threshold -and $State.cooldown_remaining -eq 0) {
    if ($env:REFLECT_DEBUG -eq "1") {
        Write-Host "[reflect] threshold met — invoking reflect-core" -ErrorAction SilentlyContinue
    }

    $State.cooldown_remaining = $Cooldown
    $State.signals = @()

    # Invoke reflect-core in background
    $ReflectScript = if (Test-Path (Join-Path $ProjectDir "bin/reflect.ts")) {
        Join-Path $ProjectDir "bin/reflect.ts"
    } elseif (Test-Path (Join-Path $PluginRoot "bin/reflect.ts")) {
        Join-Path $PluginRoot "bin/reflect.ts"
    } else { $null }

    if ($ReflectScript) {
        Start-Process -NoNewWindow -FilePath "npx" -ArgumentList "tsx", $ReflectScript, "trigger", "--session", $SessionId -WorkingDirectory (Split-Path $ReflectScript -Parent | Split-Path -Parent) -RedirectStandardOutput (Join-Path $StateDir "trigger.log") -RedirectStandardError (Join-Path $StateDir "trigger.err.log")
    }
}

$State | ConvertTo-Json -Compress | Out-File -FilePath $StateFile -Encoding utf8

exit 0
