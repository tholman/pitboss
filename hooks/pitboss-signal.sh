#!/bin/bash
# Signals pitboss dashboard with session status.
# Usage: called by Claude Code hooks (receives JSON on stdin)

STATUS="${1:-busy}"
SIGNALS_DIR="$HOME/.pitboss/signals"
mkdir -p "$SIGNALS_DIR"

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-unknown}"
if [ "$PROJECT_DIR" = "unknown" ]; then
    exit 0
fi

# Read stdin (hook JSON payload)
INPUT=""
if read -t 1 -r LINE 2>/dev/null; then
    INPUT="$LINE"
fi

# Extract tool_name and session_id from JSON using bash string ops
# Avoids python/jq/node dependency entirely
TOOL_NAME=""
SESSION_ID=""
if [ -n "$INPUT" ]; then
    # tool_name
    case "$INPUT" in
        *\"tool_name\"*)
            TOOL_NAME="${INPUT#*\"tool_name\"}"
            TOOL_NAME="${TOOL_NAME#*:}"
            TOOL_NAME="${TOOL_NAME#*\"}"
            TOOL_NAME="${TOOL_NAME%%\"*}"
            ;;
    esac
    # session_id
    case "$INPUT" in
        *\"session_id\"*)
            SESSION_ID="${INPUT#*\"session_id\"}"
            SESSION_ID="${SESSION_ID#*:}"
            SESSION_ID="${SESSION_ID#*\"}"
            SESSION_ID="${SESSION_ID%%\"*}"
            ;;
    esac
fi

# Walk up process tree to find terminal tty
TTY=""
PID=$$
for _ in 1 2 3 4 5; do
    INFO=$(ps -p "$PID" -o "ppid=,tty=" 2>/dev/null)
    [ -z "$INFO" ] && break
    PPID_VAL=$(echo "$INFO" | awk '{print $1}')
    TTY_VAL=$(echo "$INFO" | awk '{print $2}')
    if [ -n "$TTY_VAL" ] && [ "$TTY_VAL" != "??" ] && [ "$TTY_VAL" != "?" ]; then
        case "$TTY_VAL" in
            /dev/*) TTY="$TTY_VAL" ;;
            *) TTY="/dev/$TTY_VAL" ;;
        esac
        break
    fi
    PID="$PPID_VAL"
    [ "$PID" -le 1 ] 2>/dev/null && break
done

# Write signal file (atomic via tmp + rename)
KEY="${SESSION_ID:-${PROJECT_DIR//\//_}}"
SIGNAL_FILE="$SIGNALS_DIR/session_${KEY}.json"
TMP_FILE="${SIGNAL_FILE}.tmp"
TS=$(date +%s)

cat > "$TMP_FILE" <<ENDJSON
{"project_dir":"$PROJECT_DIR","session_id":"$SESSION_ID","tty":"$TTY","status":"$STATUS","detail":"$TOOL_NAME","ts":$TS}
ENDJSON

mv -f "$TMP_FILE" "$SIGNAL_FILE" 2>/dev/null

exit 0
