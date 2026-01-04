#!/bin/bash
# Claude Watch Statusline Hook
# Writes stats to temp file (for stop hook) AND displays status line
# Runs every 300ms during Claude Code sessions

input=$(cat)

# Extract data from stdin JSON
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')
project=$(echo "$input" | jq -r '.workspace.current_dir // "unknown"' | xargs basename)
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
input_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
output_tokens=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')

# Use AGENT_ID from env (injected by spawn script), fallback to "local"
agent_id="${AGENT_ID:-local}"

# Write stats to temp file (for stop hook to read)
cat > "/tmp/claude-stats-${session_id}.json" << EOF
{
  "session_id": "$session_id",
  "agent_id": "$agent_id",
  "project": "$project",
  "input_tokens": $input_tokens,
  "output_tokens": $output_tokens,
  "cost_usd": $cost,
  "updated_at": "$(date -Iseconds)"
}
EOF

# Format tokens (K/M) using awk for portability
format_num() {
  local n=$1
  if [ "$n" -ge 1000000 ]; then
    awk "BEGIN {printf \"%.1fM\", $n/1000000}"
  elif [ "$n" -ge 1000 ]; then
    awk "BEGIN {printf \"%.1fK\", $n/1000}"
  else
    echo "$n"
  fi
}

# Display status line
printf "[%s] %s | \$%.4f | %s->%s" "$agent_id" "$project" "$cost" "$(format_num $input_tokens)" "$(format_num $output_tokens)"
