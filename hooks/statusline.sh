#!/bin/bash
# Claude Watch Statusline Hook
# Writes stats to /mnt/claude-data/stats/ AND displays status line
# Runs every 300ms during Claude Code sessions

input=$(cat)

# Extract data from stdin JSON
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')
project=$(echo "$input" | jq -r '.workspace.current_dir // "unknown"' | xargs basename)
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
input_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
output_tokens=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
model_display=$(echo "$input" | jq -r '.model.display_name // "?"')

# Extra fields for dashboard
model_id=$(echo "$input" | jq -r '.model.id // "unknown"')
duration_ms=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
lines_added=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
lines_removed=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')
context_size=$(echo "$input" | jq -r '.context_window.context_window_size // 0')
current_input=$(echo "$input" | jq -r '.context_window.current_usage.input_tokens // 0')
current_output=$(echo "$input" | jq -r '.context_window.current_usage.output_tokens // 0')
cache_write=$(echo "$input" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0')
cache_read=$(echo "$input" | jq -r '.context_window.current_usage.cache_read_input_tokens // 0')

# Calculate context usage percentage
if [ "$context_size" -gt 0 ]; then
  current_usage=$((current_input + current_output))
  context_pct=$((current_usage * 100 / context_size))
else
  context_pct=0
fi

# Agent ID: from env var (set by claude-sandbox), or "local"
agent_id="${AGENT_ID:-local}"

# Stats directory: use ~/.claude/stats always (works in both sandbox and host)
# The sandbox mounts ~/.claude/ from the host
STATS_DIR="$HOME/.claude/stats"
mkdir -p "$STATS_DIR" 2>/dev/null

cat > "$STATS_DIR/claude-stats-${session_id}.json" << EOF
{
  "session_id": "$session_id",
  "agent_id": "$agent_id",
  "project": "$project",
  "model_id": "$model_id",
  "model_display": "$model_display",
  "input_tokens": $input_tokens,
  "output_tokens": $output_tokens,
  "cost_usd": $cost,
  "duration_ms": $duration_ms,
  "lines_added": $lines_added,
  "lines_removed": $lines_removed,
  "context_size": $context_size,
  "context_pct": $context_pct,
  "cache_write": $cache_write,
  "cache_read": $cache_read,
  "updated_at": "$(date -Iseconds)"
}
EOF

# Display status line: [agent] project | Model | context%
printf "[%s] %s | %s | %d%%" "$agent_id" "$project" "$model_display" "$context_pct"
