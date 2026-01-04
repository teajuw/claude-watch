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

# Extract new fields for enhanced tracking
model_id=$(echo "$current" | jq -r '.model_id // "unknown"')
duration_ms=$(echo "$current" | jq -r '.duration_ms // 0')
lines_added=$(echo "$current" | jq -r '.lines_added // 0')
lines_removed=$(echo "$current" | jq -r '.lines_removed // 0')
cache_write=$(echo "$current" | jq -r '.cache_write // 0')
cache_read=$(echo "$current" | jq -r '.cache_read // 0')
context_pct=$(echo "$current" | jq -r '.context_pct // 0')
cost_usd=$(echo "$current" | jq -r '.cost_usd // 0')

# Get last logged values (for delta)
if [ -f "$last_file" ]; then
  last_input=$(jq -r '.input_tokens // 0' "$last_file")
  last_output=$(jq -r '.output_tokens // 0' "$last_file")
  last_lines_added=$(jq -r '.lines_added // 0' "$last_file")
  last_lines_removed=$(jq -r '.lines_removed // 0' "$last_file")
  last_duration_ms=$(jq -r '.duration_ms // 0' "$last_file")
else
  last_input=0
  last_output=0
  last_lines_added=0
  last_lines_removed=0
  last_duration_ms=0
fi

# Calculate deltas
delta_input=$((curr_input - last_input))
delta_output=$((curr_output - last_output))
delta_lines_added=$((lines_added - last_lines_added))
delta_lines_removed=$((lines_removed - last_lines_removed))
delta_duration_ms=$((duration_ms - last_duration_ms))

# POST to Worker (if new usage)
if [ $delta_input -gt 0 ] || [ $delta_output -gt 0 ]; then
  # Agent heartbeat (for agents dashboard) - with all fields
  curl -s -X POST "${WORKER_URL}/api/agent/heartbeat" \
    -H "Content-Type: application/json" \
    -d "{
      \"agent_id\": \"$agent_id\",
      \"project\": \"$project\",
      \"session_id\": \"$session_id\",
      \"input_tokens\": $delta_input,
      \"output_tokens\": $delta_output,
      \"model_id\": \"$model_id\",
      \"duration_ms\": $delta_duration_ms,
      \"lines_added\": $delta_lines_added,
      \"lines_removed\": $delta_lines_removed,
      \"cache_write\": $cache_write,
      \"cache_read\": $cache_read,
      \"context_pct\": $context_pct,
      \"cost_usd\": $cost_usd,
      \"timestamp\": \"$(date -Iseconds)\"
    }" > /dev/null 2>&1 &

  # Project usage log (for projects pie chart)
  curl -s -X POST "${WORKER_URL}/api/usage/log" \
    -H "Content-Type: application/json" \
    -d "{
      \"session_id\": \"$session_id\",
      \"project\": \"$project\",
      \"input_tokens\": $delta_input,
      \"output_tokens\": $delta_output
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
