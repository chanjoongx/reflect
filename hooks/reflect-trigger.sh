#!/usr/bin/env bash
# reflect — PostToolUse hook (cross-platform bash, no jq/bc required)
#
# Installed via .claude/settings.json:
#   {
#     "hooks": {
#       "PostToolUse": [{
#         "matcher": "Bash|Edit|Write",
#         "hooks": [{ "type": "command", "command": "bash $CLAUDE_PROJECT_DIR/.claude/hooks/reflect-trigger.sh", "timeout": 30 }]
#       }]
#     }
#   }
#
# Behavior:
#   - Exits 0 always (never blocks tool execution)
#   - Tracks cumulative signal weight × 100 (integer arithmetic, no bc needed)
#   - Appends each tool call to .reflect/recent-calls.jsonl (trimmed to last 20)
#   - Invokes bin/reflect.ts trigger when cumulative weight ≥ threshold (default 240 = 2.4)
#
# Dependencies: bash 4+. jq optional (fast path for parsing input).
# Disable: export REFLECT_DISABLED=1

set -u

# ─── Disable check ────────────────────────────────────────────────────
if [ "${REFLECT_DISABLED:-0}" = "1" ]; then
    exit 0
fi

# ─── Config ──────────────────────────────────────────────────────────
INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$PROJECT_DIR}"
# Integer thresholds (× 100) — avoids bc dependency
# Default 240 = 2.4 weighted signals. Env override in integer × 100 form.
THRESHOLD_X100="${REFLECT_TRIGGER_THRESHOLD_X100:-240}"
COOLDOWN="${REFLECT_COOLDOWN_TURNS:-5}"
MAX_CALLS="${REFLECT_MAX_RECENT_CALLS:-20}"
STATE_DIR="$PROJECT_DIR/.reflect"
STATE_FILE="$STATE_DIR/state.json"
CALLS_FILE="$STATE_DIR/recent-calls.jsonl"

mkdir -p "$STATE_DIR" 2>/dev/null || true

# ─── Extract fields from hook input ──────────────────────────────────
HAS_JQ=false
command -v jq >/dev/null 2>&1 && HAS_JQ=true

if [ "$HAS_JQ" = true ]; then
    TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null)
    SESSION_ID=$(jq -r '.session_id // empty' <<<"$INPUT" 2>/dev/null)
    BASH_CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null)
    FILE_PATH=$(jq -r '.tool_input.file_path // .tool_input.path // empty' <<<"$INPUT" 2>/dev/null)
else
    # Pure bash/grep fallback. Good enough for our top-level fields.
    TOOL_NAME=$(echo "$INPUT" | grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
    SESSION_ID=$(echo "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
    BASH_CMD=$(echo "$INPUT" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
    FILE_PATH=$(echo "$INPUT" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
    [ -z "$FILE_PATH" ] && FILE_PATH=$(echo "$INPUT" | grep -oE '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"path"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
fi

TOOL_NAME="${TOOL_NAME:-unknown}"
SESSION_ID="${SESSION_ID:-none}"
BASH_CMD="${BASH_CMD:-}"
FILE_PATH="${FILE_PATH:-}"

# ─── Read current state (grep/sed — jq-free path) ────────────────────
CURRENT_SESSION=""
CUM_X100=0
TURN=0
COOLDOWN_REMAINING=0

if [ -f "$STATE_FILE" ]; then
    CURRENT_SESSION=$(grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
    V=$(grep -oE '"cum_x100"[[:space:]]*:[[:space:]]*[0-9]+' "$STATE_FILE" | grep -oE '[0-9]+$')
    [ -n "$V" ] && CUM_X100=$V
    V=$(grep -oE '"turn_count"[[:space:]]*:[[:space:]]*[0-9]+' "$STATE_FILE" | grep -oE '[0-9]+$')
    [ -n "$V" ] && TURN=$V
    V=$(grep -oE '"cooldown_remaining"[[:space:]]*:[[:space:]]*[0-9]+' "$STATE_FILE" | grep -oE '[0-9]+$')
    [ -n "$V" ] && COOLDOWN_REMAINING=$V
fi

# New session → reset state and recent-calls log
if [ "$CURRENT_SESSION" != "$SESSION_ID" ]; then
    CUM_X100=0
    TURN=0
    COOLDOWN_REMAINING=0
    : > "$CALLS_FILE" 2>/dev/null || true
fi

TURN=$((TURN + 1))
[ "$COOLDOWN_REMAINING" -gt 0 ] && COOLDOWN_REMAINING=$((COOLDOWN_REMAINING - 1))

# ─── Detect revert signals (Tier 1 + Tier 2 — utterance Tier 3 is UserPromptSubmit) ───
SIGNAL_X100=0
SIGNAL_TIER=0

if [ "$TOOL_NAME" = "Bash" ] && [ -n "$BASH_CMD" ]; then
    if echo "$BASH_CMD" | grep -qE "^(git revert|git restore|git checkout HEAD --)"; then
        SIGNAL_X100=100
        SIGNAL_TIER=1
    elif echo "$BASH_CMD" | grep -qE "^(rm |unlink )"; then
        # Avoid flagging common build-artifact cleanup as revert
        if ! echo "$BASH_CMD" | grep -qE "(node_modules|dist|build|\.next|coverage)"; then
            SIGNAL_X100=70
            SIGNAL_TIER=2
        fi
    fi
fi

# ─── Append to recent-calls.jsonl (pure bash, no jq) ─────────────────
# Summary is truncated + JSON-escaped for safety.
if [ "$TOOL_NAME" = "Bash" ]; then
    SUMMARY="${BASH_CMD:0:150}"
elif [ -n "$FILE_PATH" ]; then
    SUMMARY="$FILE_PATH"
else
    SUMMARY=""
fi
# Escape backslash then double-quote; strip newlines
SUMMARY_ESC=$(printf '%s' "$SUMMARY" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r\t')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")

printf '{"turn":%d,"tool":"%s","tier":%d,"input_summary":"%s","timestamp":"%s"}\n' \
    "$TURN" "$TOOL_NAME" "$SIGNAL_TIER" "$SUMMARY_ESC" "$TIMESTAMP" \
    >> "$CALLS_FILE"

# Trim to last MAX_CALLS lines
if [ -f "$CALLS_FILE" ]; then
    tail -n "$MAX_CALLS" "$CALLS_FILE" > "$CALLS_FILE.tmp" 2>/dev/null && mv "$CALLS_FILE.tmp" "$CALLS_FILE"
fi

# ─── Accumulate signal + write state ─────────────────────────────────
if [ "$SIGNAL_X100" -gt 0 ]; then
    CUM_X100=$((CUM_X100 + SIGNAL_X100))
fi

write_state() {
    cat > "$STATE_FILE" <<EOF
{"session_id":"$SESSION_ID","turn_count":$TURN,"cum_x100":$CUM_X100,"cooldown_remaining":$COOLDOWN_REMAINING}
EOF
}

# ─── Threshold check + fire trigger ──────────────────────────────────
if [ "$CUM_X100" -ge "$THRESHOLD_X100" ] && [ "$COOLDOWN_REMAINING" = "0" ]; then
    [ "${REFLECT_DEBUG:-0}" = "1" ] && \
        echo "[reflect] threshold met ($CUM_X100 >= $THRESHOLD_X100) — invoking reflect-core" >&2

    # Reset cumulative + start cooldown BEFORE firing (idempotency)
    COOLDOWN_REMAINING="$COOLDOWN"
    CUM_X100=0
    write_state

    # Invoke bin/reflect.ts trigger (background so hook returns fast)
    TARGET_DIR=""
    if [ -f "$PROJECT_DIR/bin/reflect.ts" ]; then
        TARGET_DIR="$PROJECT_DIR"
    elif [ -f "$PLUGIN_ROOT/bin/reflect.ts" ]; then
        TARGET_DIR="$PLUGIN_ROOT"
    fi
    if [ -n "$TARGET_DIR" ]; then
        (cd "$TARGET_DIR" && nohup npx tsx bin/reflect.ts trigger --session "$SESSION_ID" \
            >> "$STATE_DIR/trigger.log" 2>&1 &) 2>/dev/null || true
    fi
else
    write_state
fi

# ─── Always exit 0 ───────────────────────────────────────────────────
exit 0
