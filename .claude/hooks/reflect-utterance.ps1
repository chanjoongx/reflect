# reflect — UserPromptSubmit hook for Tier 3 utterance detection (PowerShell)
#
# Parity with reflect-utterance.sh. UserPromptSubmit fires on every prompt
# (no matcher support). We observe only — never emit hookSpecificOutput.
#
# Disable: $env:REFLECT_DISABLED = "1"

if ($env:REFLECT_DISABLED -eq "1") { exit 0 }

$ErrorActionPreference = "SilentlyContinue"

$Stdin = [Console]::In.ReadToEnd()
try { $Payload = $Stdin | ConvertFrom-Json } catch { exit 0 }

$Prompt = if ($Payload.prompt) { [string]$Payload.prompt } else { "" }
$SessionId = if ($Payload.session_id) { [string]$Payload.session_id } else { "none" }

$ProjectDir = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
$PluginRoot = if ($env:CLAUDE_PLUGIN_ROOT) { $env:CLAUDE_PLUGIN_ROOT } else { $ProjectDir }
$ThresholdX100 = if ($env:REFLECT_TRIGGER_THRESHOLD_X100) { [int]$env:REFLECT_TRIGGER_THRESHOLD_X100 } else { 240 }
$Cooldown = if ($env:REFLECT_COOLDOWN_TURNS) { [int]$env:REFLECT_COOLDOWN_TURNS } else { 5 }
$MaxCalls = if ($env:REFLECT_MAX_RECENT_CALLS) { [int]$env:REFLECT_MAX_RECENT_CALLS } else { 20 }

$StateDir = Join-Path $ProjectDir ".reflect"
$StateFile = Join-Path $StateDir "state.json"
$CallsFile = Join-Path $StateDir "recent-calls.jsonl"

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

# Truncate prompt for safety
$PromptHead = if ($Prompt.Length -gt 400) { $Prompt.Substring(0, 400) } else { $Prompt }

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
        # Corrupt — treat as new session
    }
}

if ($CurrentSession -ne $SessionId) {
    $CumX100 = 0
    $Turn = 0
    $CooldownRemaining = 0
    if (Test-Path $CallsFile) { Clear-Content $CallsFile -Force }
}

# NOTE: UserPromptSubmit does not increment turn (PostToolUse hook owns that).

# ─── Tier 3 detection ────────────────────────────────────────────────
$SignalX100 = 0

$PositiveMatch = $PromptHead -imatch "(i see why|you were right|good point|fair point|makes sense|that makes sense|i understand|i agree|nice catch)"

if (-not $PositiveMatch) {
    # Start-of-prompt explicit negation
    $StartNeg = $PromptHead -imatch "^\s*(no\s+wait|no\s+stop|no,|nope,|nah,|undo\s+that|undo\s+this|revert\s+that|revert\s+this|that.s\s+wrong|that.s\s+not|stop[-—,.]|don.t\s|hold\s+on|wait,|actually\s+let.s\s+not|please\s+undo|please\s+revert)"
    # Anywhere explicit revert language
    $AnyRevert = $PromptHead -imatch "(rollback\s+that|undo\s+my\s+last|revert\s+the\s+last|back\s+out\s+of\s+that)"
    if ($StartNeg -or $AnyRevert) {
        $SignalX100 = 50
    }
}

# ─── Log matched utterance ──────────────────────────────────────────
if ($SignalX100 -gt 0) {
    $Summary = if ($PromptHead.Length -gt 150) { $PromptHead.Substring(0, 150) } else { $PromptHead }
    $Summary = $Summary -replace '\\', '\\' -replace '"', '\"' -replace '[\r\n\t]', ' '
    $Timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $Line = '{"turn":' + $Turn + ',"tool":"UserPrompt","tier":3,"input_summary":"' + $Summary + '","timestamp":"' + $Timestamp + '"}'
    Add-Content -Path $CallsFile -Value $Line -Encoding utf8

    if (Test-Path $CallsFile) {
        $Lines = Get-Content $CallsFile -Tail $MaxCalls
        Set-Content -Path $CallsFile -Value $Lines -Encoding utf8
    }

    $CumX100 += $SignalX100
}

function Write-State {
    $StateJson = '{"session_id":"' + $SessionId + '","turn_count":' + $Turn + ',"cum_x100":' + $CumX100 + ',"cooldown_remaining":' + $CooldownRemaining + '}'
    Set-Content -Path $StateFile -Value $StateJson -Encoding utf8
}

# ─── Threshold check ────────────────────────────────────────────────
if ($SignalX100 -gt 0 -and $CumX100 -ge $ThresholdX100 -and $CooldownRemaining -eq 0) {
    if ($env:REFLECT_DEBUG -eq "1") {
        Write-Host "[reflect/utterance] threshold met ($CumX100 >= $ThresholdX100) — invoking reflect-core" -ErrorAction SilentlyContinue
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
} elseif ($SignalX100 -gt 0) {
    Write-State
}

exit 0
