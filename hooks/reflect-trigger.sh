#!/usr/bin/env bash
# reflect — PostToolUse hook
#
# Observes tool calls, detects revert signal clusters, invokes
# bin/reflect.ts when threshold met.
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
#   - Always exits 0 (never blocks tool execution)
#   - Increments signal count in .reflect/state.json
#   - When sum of weighted signals in last 10 tool calls >= 2.4, invokes bin/reflect.ts
#   - Cooldown: 5 turns post-trigger
#
# Dependencies: bash 4+. jq optional (falls back to grep parsing).
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
THRESHOLD="${REFLECT_TRIGGER_THRESHOLD:-2.4}"
COOLDOWN="${REFLECT_COOLDOWN_TURNS:-5}"
WINDOW="${REFLECT_WINDOW_SIZE:-10}"
STATE_DIR="$PROJECT_DIR/.reflect"
STATE_FILE="$STATE_DIR/state.json"

mkdir -p "$STATE_DIR" 2>/dev/null || true

# ─── JSON parsing ────────────────────────────────────────────────────
HAS_JQ=false
command -v jq >/dev/null 2>&1 && HAS_JQ=true

extract() {
    if [ "$HAS_JQ" = true ]; then
        echo "$INPUT" | jq -r "$1 // empty" 2>/dev/null
    else
        local field=$(echo "$1" | sed 's|^\.||' | sed 's|\.| |g' | awk '{print $NF}')
        echo "$INPUT" | grep -oE "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | \
            sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/'
    fi
}

# ─── Parse hook input ────────────────────────────────────────────────
TOOL_NAME=$(extract ".tool_name")
SESSION_ID=$(extract ".session_id")
BASH_CMD=$(extract ".tool_input.command")
FILE_PATH=$(extract ".tool_input.file_path")
[ -z "$FILE_PATH" ] && FILE_PATH=$(extract ".tool_input.path")

# ─── Initialize state ─────────────────────────────────────────────────
if [ ! -f "$STATE_FILE" ]; then
    echo '{"session_id":"","signals":[],"cooldown_remaining":0,"turn_count":0}' > "$STATE_FILE"
fi

# Read current state
if [ "$HAS_JQ" = true ]; then
    CURRENT_SESSION=$(jq -r '.session_id' "$STATE_FILE")
    COOLDOWN_REMAINING=$(jq -r '.cooldown_remaining' "$STATE_FILE")
    TURN_COUNT=$(jq -r '.turn_count' "$STATE_FILE")
else
    CURRENT_SESSION=$(grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')
    COOLDOWN_REMAINING=$(grep -oE '"cooldown_remaining"[[:space:]]*:[[:space:]]*[0-9]+' "$STATE_FILE" | grep -oE '[0-9]+$' || echo "0")
    TURN_COUNT=$(grep -oE '"turn_count"[[:space:]]*:[[:space:]]*[0-9]+' "$STATE_FILE" | grep -oE '[0-9]+$' || echo "0")
fi

# Reset state on new session
if [ "$CURRENT_SESSION" != "$SESSION_ID" ]; then
    echo "{\"session_id\":\"$SESSION_ID\",\"signals\":[],\"cooldown_remaining\":0,\"turn_count\":0}" > "$STATE_FILE"
    COOLDOWN_REMAINING=0
    TURN_COUNT=0
fi

# Increment turn count
TURN_COUNT=$((TURN_COUNT + 1))

# Decrement cooldown
if [ "$COOLDOWN_REMAINING" -gt 0 ]; then
    COOLDOWN_REMAINING=$((COOLDOWN_REMAINING - 1))
fi

# ─── Detect revert signals ────────────────────────────────────────────
SIGNAL_WEIGHT=0

# Tier 1 (hard): git revert / git restore / explicit /undo
if [ "$TOOL_NAME" = "Bash" ] && [ -n "$BASH_CMD" ]; then
    if echo "$BASH_CMD" | grep -qE "^(git revert|git restore|git checkout HEAD --)"; then
        SIGNAL_WEIGHT="1.0"
    fi
fi

# Tier 2 (inferred): file delete after recent write — rough heuristic
# (More sophisticated semantic-inversion detection is in src/revert-detector.ts)
if [ "$TOOL_NAME" = "Bash" ] && [ -n "$BASH_CMD" ]; then
    if echo "$BASH_CMD" | grep -qE "^(rm |unlink )"; then
        SIGNAL_WEIGHT="0.7"
    fi
fi

# Tier 3 is detected from user_message events (different hook), not Bash/Edit/Write
# This shell hook handles tier 1 & 2 only

# ─── If no signal, just update turn count ────────────────────────────
if [ "$SIGNAL_WEIGHT" = "0" ]; then
    if [ "$HAS_JQ" = true ]; then
        jq ".turn_count = $TURN_COUNT | .cooldown_remaining = $COOLDOWN_REMAINING" "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
    fi
    exit 0
fi

# ─── Record signal ───────────────────────────────────────────────────
if [ "$HAS_JQ" = true ]; then
    jq ".signals += [{\"weight\":$SIGNAL_WEIGHT,\"turn\":$TURN_COUNT}] | .signals = (.signals | map(select(.turn > $TURN_COUNT - $WINDOW))) | .turn_count = $TURN_COUNT | .cooldown_remaining = $COOLDOWN_REMAINING" "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"

    # Check threshold
    SUM=$(jq '.signals | map(.weight) | add // 0' "$STATE_FILE")
    [ "${REFLECT_DEBUG:-0}" = "1" ] && echo "[reflect] turn=$TURN_COUNT signal_weight=$SIGNAL_WEIGHT sum=$SUM cooldown=$COOLDOWN_REMAINING" >&2

    # Trigger if threshold met AND not in cooldown
    if (( $(echo "$SUM >= $THRESHOLD" | bc -l 2>/dev/null || echo 0) )) && [ "$COOLDOWN_REMAINING" = "0" ]; then
        [ "${REFLECT_DEBUG:-0}" = "1" ] && echo "[reflect] threshold met — invoking reflect-core" >&2

        # Reset cooldown
        jq ".cooldown_remaining = $COOLDOWN | .signals = []" "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"

        # Invoke reflect-core (background to not block hook)
        if [ -f "$PROJECT_DIR/bin/reflect.ts" ]; then
            (cd "$PROJECT_DIR" && nohup npx tsx bin/reflect.ts trigger --session "$SESSION_ID" >> "$STATE_DIR/trigger.log" 2>&1 &)
        elif [ -f "$PLUGIN_ROOT/bin/reflect.ts" ]; then
            (cd "$PLUGIN_ROOT" && nohup npx tsx bin/reflect.ts trigger --session "$SESSION_ID" >> "$STATE_DIR/trigger.log" 2>&1 &)
        fi
    fi
fi

# ─── Always exit 0 — never block tool execution ─────────────────────
exit 0
