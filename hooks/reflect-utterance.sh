#!/usr/bin/env bash
# reflect — UserPromptSubmit hook for Tier 3 utterance detection
#
# Installed via .claude/settings.json:
#   {
#     "hooks": {
#       "UserPromptSubmit": [{
#         "hooks": [{ "type": "command", "command": "bash $CLAUDE_PROJECT_DIR/.claude/hooks/reflect-utterance.sh", "timeout": 5 }]
#       }]
#     }
#   }
#
# UserPromptSubmit does NOT support matchers — fires on every prompt. Filtering
# happens inside the script (conservative regex on explicit negation phrases).
#
# Behavior:
#   - Exits 0 always (never blocks prompt submission — exit 2 would erase the prompt)
#   - Never writes hookSpecificOutput.additionalContext (just observes)
#   - On Tier 3 match: appends weight 50 (×100) to cum_x100 + logs to recent-calls.jsonl
#   - Fires bin/reflect.ts trigger if cumulative weight crosses threshold
#
# Regex philosophy: false-negative > false-positive. We only match clearly directive
# negation at the start of an utterance or after strong punctuation. Bare "no" alone
# (yes/no question response) is NOT matched.
#
# Disable: export REFLECT_DISABLED=1

set -u

if [ "${REFLECT_DISABLED:-0}" = "1" ]; then
    exit 0
fi

INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$PROJECT_DIR}"
THRESHOLD_X100="${REFLECT_TRIGGER_THRESHOLD_X100:-240}"
COOLDOWN="${REFLECT_COOLDOWN_TURNS:-5}"
MAX_CALLS="${REFLECT_MAX_RECENT_CALLS:-20}"
STATE_DIR="$PROJECT_DIR/.reflect"
STATE_FILE="$STATE_DIR/state.json"
CALLS_FILE="$STATE_DIR/recent-calls.jsonl"

mkdir -p "$STATE_DIR" 2>/dev/null || true

# ─── Extract prompt from hook input ──────────────────────────────────
HAS_JQ=false
command -v jq >/dev/null 2>&1 && HAS_JQ=true

if [ "$HAS_JQ" = true ]; then
    PROMPT=$(jq -r '.prompt // empty' <<<"$INPUT" 2>/dev/null)
    SESSION_ID=$(jq -r '.session_id // empty' <<<"$INPUT" 2>/dev/null)
else
    # Grep fallback — prompt may contain JSON-escaped quotes. We only need first
    # ~200 chars for regex matching; accept some truncation.
    PROMPT=$(echo "$INPUT" | grep -oE '"prompt"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"prompt"[[:space:]]*:[[:space:]]*"(.*)"$/\1/')
    SESSION_ID=$(echo "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
fi

PROMPT="${PROMPT:-}"
SESSION_ID="${SESSION_ID:-none}"

# Truncate prompt for safety (regex + storage)
PROMPT_HEAD="${PROMPT:0:400}"

# ─── Read current state ──────────────────────────────────────────────
CURRENT_SESSION=""
CUM_X100=0
TURN=0
COOLDOWN_REMAINING=0

if [ -f "$STATE_FILE" ]; then
    CURRENT_SESSION=$(grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATE_FILE" | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
    V=$(grep -oE '"cum_x100"[[:space:]]*:[[:space:]]*[0-9]+' "$STATE_FILE" | grep -oE '[0-9]+$'); [ -n "$V" ] && CUM_X100=$V
    V=$(grep -oE '"turn_count"[[:space:]]*:[[:space:]]*[0-9]+' "$STATE_FILE" | grep -oE '[0-9]+$'); [ -n "$V" ] && TURN=$V
    V=$(grep -oE '"cooldown_remaining"[[:space:]]*:[[:space:]]*[0-9]+' "$STATE_FILE" | grep -oE '[0-9]+$'); [ -n "$V" ] && COOLDOWN_REMAINING=$V
fi

# New session → reset (coordinated with PostToolUse hook's reset)
if [ "$CURRENT_SESSION" != "$SESSION_ID" ]; then
    CUM_X100=0
    TURN=0
    COOLDOWN_REMAINING=0
    : > "$CALLS_FILE" 2>/dev/null || true
fi

# NOTE: Turn count is owned by PostToolUse hook. UserPromptSubmit is pre-turn
# and does NOT increment turn (would double-count tool calls).

# ─── Tier 3 detection — conservative regex ───────────────────────────
SIGNAL_X100=0

# Positive-negation exclusion (check first — short-circuit if present)
POSITIVE_MATCH=false
if echo "$PROMPT_HEAD" | grep -qiE "(i see why|you were right|good point|fair point|makes sense|that makes sense|i understand|i agree|nice catch)"; then
    POSITIVE_MATCH=true
fi

# Primary negation — only explicit directive phrases at utterance start, OR
# strong revert phrases anywhere. Keeps bare "no" (yes/no reply) out.
if [ "$POSITIVE_MATCH" = false ]; then
    # Start-of-prompt explicit negation
    if echo "$PROMPT_HEAD" | grep -qiE "^[[:space:]]*(no[[:space:]]+wait|no[[:space:]]+stop|no,|nope,|nah,|undo[[:space:]]+that|undo[[:space:]]+this|revert[[:space:]]+that|revert[[:space:]]+this|that.s[[:space:]]+wrong|that.s[[:space:]]+not|stop[-—,.]|don.t[[:space:]]|hold[[:space:]]+on|wait,|actually[[:space:]]+let.s[[:space:]]+not|please[[:space:]]+undo|please[[:space:]]+revert)"; then
        SIGNAL_X100=50
    # Or explicit revert language anywhere
    elif echo "$PROMPT_HEAD" | grep -qiE "(rollback[[:space:]]+that|undo[[:space:]]+my[[:space:]]+last|revert[[:space:]]+the[[:space:]]+last|back[[:space:]]+out[[:space:]]+of[[:space:]]+that)"; then
        SIGNAL_X100=50
    fi
fi

# ─── Log matched utterance to recent-calls.jsonl ─────────────────────
if [ "$SIGNAL_X100" -gt 0 ]; then
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")
    SUMMARY_ESC=$(printf '%s' "${PROMPT_HEAD:0:150}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r\t')
    printf '{"turn":%d,"tool":"UserPrompt","tier":3,"input_summary":"%s","timestamp":"%s"}\n' \
        "$TURN" "$SUMMARY_ESC" "$TIMESTAMP" \
        >> "$CALLS_FILE"
    if [ -f "$CALLS_FILE" ]; then
        tail -n "$MAX_CALLS" "$CALLS_FILE" > "$CALLS_FILE.tmp" 2>/dev/null && mv "$CALLS_FILE.tmp" "$CALLS_FILE"
    fi
    CUM_X100=$((CUM_X100 + SIGNAL_X100))
fi

write_state() {
    cat > "$STATE_FILE" <<EOF
{"session_id":"$SESSION_ID","turn_count":$TURN,"cum_x100":$CUM_X100,"cooldown_remaining":$COOLDOWN_REMAINING}
EOF
}

# ─── Threshold check ─────────────────────────────────────────────────
if [ "$SIGNAL_X100" -gt 0 ] && [ "$CUM_X100" -ge "$THRESHOLD_X100" ] && [ "$COOLDOWN_REMAINING" = "0" ]; then
    [ "${REFLECT_DEBUG:-0}" = "1" ] && \
        echo "[reflect/utterance] threshold met ($CUM_X100 >= $THRESHOLD_X100) — invoking reflect-core" >&2
    COOLDOWN_REMAINING="$COOLDOWN"
    CUM_X100=0
    write_state

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
elif [ "$SIGNAL_X100" -gt 0 ]; then
    write_state
fi

# Exit 0 — never block prompt (exit 2 would erase the user's prompt)
exit 0
