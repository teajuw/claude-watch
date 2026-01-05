#!/bin/bash
# Claude Watch Stop Hook
# Fires after each Claude response
# Reads stats from statusline, sends to Worker + Telegram

# Stats directory: /mnt/claude-data/stats (sandbox) or ~/.claude/stats (host)
if [ -d "/mnt/claude-data" ]; then
  STATS_DIR="/mnt/claude-data/stats"
  # Load config from file (env vars don't persist in sandbox)
  [ -f "/mnt/claude-data/telegram.conf" ] && source /mnt/claude-data/telegram.conf
else
  STATS_DIR="$HOME/.claude/stats"
  # Load env vars from .env file
  CLAUDE_WATCH_DIR="${CLAUDE_WATCH_DIR:-$HOME/projects/claude-watch}"
  [ -f "$CLAUDE_WATCH_DIR/.env" ] && source "$CLAUDE_WATCH_DIR/.env"
fi

# Fallback worker URL
WORKER_URL="${WORKER_URL:-https://claude-watch.trevorju32.workers.dev}"

# Support both TELEGRAM_CHAT_ID and TELEGRAM_USER_ID (legacy)
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-$TELEGRAM_USER_ID}"

# Token sync - runs in background, only if credentials are newer than last sync
CREDS_FILE="$HOME/.claude/.credentials.json"
SYNC_MARKER="/tmp/claude-watch-token-sync"
if [ -f "$CREDS_FILE" ] && [ -n "$API_SECRET" ]; then
  if [ ! -f "$SYNC_MARKER" ] || [ "$CREDS_FILE" -nt "$SYNC_MARKER" ]; then
    (
      ACCESS_TOKEN=$(jq -r '.claudeAiOauth.accessToken' "$CREDS_FILE" 2>/dev/null)
      REFRESH_TOKEN=$(jq -r '.claudeAiOauth.refreshToken' "$CREDS_FILE" 2>/dev/null)
      EXPIRES_AT=$(jq -r '.claudeAiOauth.expiresAt' "$CREDS_FILE" 2>/dev/null)
      if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "null" ]; then
        curl -s -X POST "${WORKER_URL}/api/tokens/update" \
          -H "Authorization: Bearer $API_SECRET" \
          -H "Content-Type: application/json" \
          -d "{\"accessToken\":\"$ACCESS_TOKEN\",\"refreshToken\":\"$REFRESH_TOKEN\",\"expiresAt\":$EXPIRES_AT}" \
          > /dev/null 2>&1
        touch "$SYNC_MARKER"
      fi
    ) &
  fi
fi

# Read hook input from stdin
input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')

stats_file="$STATS_DIR/claude-stats-${session_id}.json"
last_file="$STATS_DIR/claude-last-${session_id}.json"

# Exit if statusline hasn't written yet
[ ! -f "$stats_file" ] && exit 0

current=$(cat "$stats_file")

# Extract current values
curr_input=$(echo "$current" | jq -r '.input_tokens // 0')
curr_output=$(echo "$current" | jq -r '.output_tokens // 0')
project=$(echo "$current" | jq -r '.project // "unknown"')
agent_id=$(echo "$current" | jq -r '.agent_id // "local"')
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
  # Agent heartbeat
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

  # Project usage log
  curl -s -X POST "${WORKER_URL}/api/usage/log" \
    -H "Content-Type: application/json" \
    -d "{
      \"session_id\": \"$session_id\",
      \"project\": \"$project\",
      \"input_tokens\": $delta_input,
      \"output_tokens\": $delta_output
    }" > /dev/null 2>&1 &

  # Activity log with quips
  total_tokens=$((delta_input + delta_output))

  QUIPS_SMALL=("A modest nibble." "Tokens well spent. Probably." "The machine hums." "Another day, another prompt." "Pocket change.")
  QUIPS_MEDIUM=("Now we're cooking." "The meter notices." "Steady consumption detected." "Claude is earning its keep." "Moderate ambition.")
  QUIPS_LARGE=("That's a chunky one." "Someone's feeling ambitious." "The tokens flow like wine." "Big prompt energy." "Opus felt that.")
  QUIPS_HUGE=("Absolute unit of a response." "The meter screams." "Did you need all those tokens?" "Claude went full novelist." "RIP your rate limit.")
  QUIPS_CODE_ADD=("Lines go brrr." "The codebase grows." "Fresh code, hot off the press." "More lines, more problems?" "Shipping features.")
  QUIPS_CODE_DELETE=("The great purge." "Less is more. Allegedly." "Code deletion is a feature." "Trimming the fat." "Negative lines shipped.")
  QUIPS_CODE_CHURN=("Refactor mode engaged." "Churning butter... er, code." "The eternal rewrite." "Two steps forward, one step back." "Evolution in progress.")

  if [ $delta_lines_added -gt 50 ] && [ $delta_lines_removed -gt 50 ]; then
    quip="${QUIPS_CODE_CHURN[$((RANDOM % ${#QUIPS_CODE_CHURN[@]}))]}"
  elif [ $delta_lines_added -gt 100 ]; then
    quip="${QUIPS_CODE_ADD[$((RANDOM % ${#QUIPS_CODE_ADD[@]}))]}"
  elif [ $delta_lines_removed -gt 50 ]; then
    quip="${QUIPS_CODE_DELETE[$((RANDOM % ${#QUIPS_CODE_DELETE[@]}))]}"
  elif [ $total_tokens -gt 50000 ]; then
    quip="${QUIPS_HUGE[$((RANDOM % ${#QUIPS_HUGE[@]}))]}"
  elif [ $total_tokens -gt 10000 ]; then
    quip="${QUIPS_LARGE[$((RANDOM % ${#QUIPS_LARGE[@]}))]}"
  elif [ $total_tokens -gt 3000 ]; then
    quip="${QUIPS_MEDIUM[$((RANDOM % ${#QUIPS_MEDIUM[@]}))]}"
  else
    quip="${QUIPS_SMALL[$((RANDOM % ${#QUIPS_SMALL[@]}))]}"
  fi

  summary="${total_tokens} tokens"
  [ $delta_lines_added -gt 0 ] && summary="$summary, +${delta_lines_added}"
  [ $delta_lines_removed -gt 0 ] && summary="$summary, -${delta_lines_removed}"
  summary="$summary | $quip"

  curl -s -X POST "${WORKER_URL}/api/logs" \
    -H "Content-Type: application/json" \
    -d "{
      \"event_type\": \"response\",
      \"agent_id\": \"$agent_id\",
      \"project\": \"$project\",
      \"session_id\": \"$session_id\",
      \"input_tokens\": $delta_input,
      \"output_tokens\": $delta_output,
      \"model\": \"$model_id\",
      \"duration_ms\": $delta_duration_ms,
      \"summary\": \"$summary\"
    }" > /dev/null 2>&1 &

  # Save for next delta
  cp "$stats_file" "$last_file"
fi

# Send Telegram notification
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$TELEGRAM_CHAT_ID" \
    -d text="${project}(${agent_id}): Claude finished" \
    > /dev/null 2>&1 &
fi
