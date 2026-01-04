#!/bin/bash
# Claude Watch Stop Hook
# Fires after each Claude response
# Reads from temp file written by statusline, sends to Worker + Telegram

# Source env vars if not already set
CLAUDE_WATCH_DIR="${CLAUDE_WATCH_DIR:-$HOME/projects/claude-watch}"
[ -f "$CLAUDE_WATCH_DIR/.env" ] && source "$CLAUDE_WATCH_DIR/.env"

WORKER_URL="${WORKER_URL:-https://claude-watch.trevorju32.workers.dev}"
# Support both TELEGRAM_CHAT_ID and TELEGRAM_USER_ID (legacy)
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-$TELEGRAM_USER_ID}"

# Read hook input from stdin
input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')

stats_file="/tmp/claude-stats-${session_id}.json"
last_file="/tmp/claude-last-${session_id}.json"

# Exit if statusline hasn't written yet
[ ! -f "$stats_file" ] && exit 0

current=$(cat "$stats_file")

# Extract current values
curr_input=$(echo "$current" | jq -r '.input_tokens // 0')
curr_output=$(echo "$current" | jq -r '.output_tokens // 0')
project=$(echo "$current" | jq -r '.project // "unknown"')
agent_id=$(echo "$current" | jq -r '.agent_id // "local"')

# Get last logged values (for delta)
if [ -f "$last_file" ]; then
  last_input=$(jq -r '.input_tokens // 0' "$last_file")
  last_output=$(jq -r '.output_tokens // 0' "$last_file")
else
  last_input=0
  last_output=0
fi

# Calculate deltas
delta_input=$((curr_input - last_input))
delta_output=$((curr_output - last_output))

# POST to Worker (if new usage)
if [ $delta_input -gt 0 ] || [ $delta_output -gt 0 ]; then
  curl -s -X POST "${WORKER_URL}/api/agent/heartbeat" \
    -H "Content-Type: application/json" \
    -d "{
      \"agent_id\": \"$agent_id\",
      \"project\": \"$project\",
      \"session_id\": \"$session_id\",
      \"input_tokens\": $delta_input,
      \"output_tokens\": $delta_output,
      \"timestamp\": \"$(date -Iseconds)\"
    }" > /dev/null 2>&1 &

  # Save for next delta
  cp "$stats_file" "$last_file"
fi

# Send Telegram notification - format: project(agent): Claude finished
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$TELEGRAM_CHAT_ID" \
    -d text="${project}(${agent_id}): Claude finished" \
    > /dev/null 2>&1 &
fi
