# Phase 3: Advanced Analytics & Per-Project Tracking

## Overview

This phase adds granular per-project token tracking, improved visualizations, projections, and cost estimates.

**Features:**
1. Per-project usage tracking via Claude Code hooks
2. Project breakdown pie chart
3. Fixed-window history graphs (5-hour by time, 7-day fixed width)
4. Projection toggles (None, Extrapolate, Predict)
5. Cost estimates from exact token counts
6. 7-day reset display with day of week

---

## 1. Per-Project Usage Tracking

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  ~/.claude/hooks/statusline.sh                              │
│  ├─> Runs every 300ms                                       │
│  ├─> Receives session stats via stdin                       │
│  ├─> Writes to /tmp/claude-stats-{session_id}.json          │
│  └─> Displays status line                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (on each Claude response)
┌─────────────────────────────────────────────────────────────┐
│  ~/.claude/hooks/log-usage.sh (Stop hook)                   │
│  ├─> Reads /tmp/claude-stats-{session_id}.json              │
│  ├─> Calculates delta since last POST                       │
│  ├─> POSTs to Worker /api/usage/log                         │
│  └─> Saves current stats for next delta calc                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Worker /api/usage/log                                      │
│  └─> INSERT INTO project_usage                              │
│      (session_id, project, input_tokens, output_tokens, ts) │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Dashboard                                                  │
│  ├─> GET /api/projects/summary (pie chart data)             │
│  ├─> GET /api/projects/history (time series)                │
│  └─> Visualize with Chart.js                                │
└─────────────────────────────────────────────────────────────┘
```

### Files to Create/Modify

#### 1.1 Backup existing statusline
```bash
cp /mnt/claude-data/statusline.sh /mnt/claude-data/statusline.sh.backup
```

#### 1.2 Create ~/.claude/hooks/statusline.sh
```bash
#!/bin/bash
# Claude Watch Statusline
# Writes session stats to temp file and displays status

input=$(cat)

# Extract data
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')
cwd=$(echo "$input" | jq -r '.cwd // "unknown"')
project=$(basename "$cwd")
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
input_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
output_tokens=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
cache_read=$(echo "$input" | jq -r '.context_window.current_usage.cache_read_input_tokens // 0')
cache_create=$(echo "$input" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0')

# Write stats to session-specific temp file (for Stop hook to read)
cat > "/tmp/claude-stats-${session_id}.json" << EOF
{
  "session_id": "$session_id",
  "project": "$project",
  "cwd": "$cwd",
  "input_tokens": $input_tokens,
  "output_tokens": $output_tokens,
  "cache_read_tokens": $cache_read,
  "cache_create_tokens": $cache_create,
  "cost_usd": $cost,
  "updated_at": "$(date -Iseconds)"
}
EOF

# Display status line
printf "[$project] \$%.4f | %d→%d tokens" "$cost" "$input_tokens" "$output_tokens"
```

#### 1.3 Create ~/.claude/hooks/log-usage.sh
```bash
#!/bin/bash
# Claude Watch Usage Logger
# Stop hook - fires after each Claude response
# Calculates token delta and POSTs to Worker

WORKER_URL="https://claude-watch.trevorju32.workers.dev"

input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id // "unknown"')

stats_file="/tmp/claude-stats-${session_id}.json"
last_file="/tmp/claude-last-${session_id}.json"

# Exit if no stats file (statusline hasn't run yet)
if [ ! -f "$stats_file" ]; then
  exit 0
fi

current=$(cat "$stats_file")

# Get current values
curr_input=$(echo "$current" | jq -r '.input_tokens // 0')
curr_output=$(echo "$current" | jq -r '.output_tokens // 0')
project=$(echo "$current" | jq -r '.project // "unknown"')

# Get last logged values (for delta)
if [ -f "$last_file" ]; then
  last_input=$(cat "$last_file" | jq -r '.input_tokens // 0')
  last_output=$(cat "$last_file" | jq -r '.output_tokens // 0')
else
  last_input=0
  last_output=0
fi

# Calculate deltas
delta_input=$((curr_input - last_input))
delta_output=$((curr_output - last_output))

# Only POST if there's actual new usage
if [ $delta_input -gt 0 ] || [ $delta_output -gt 0 ]; then
  # POST to Worker (background, non-blocking)
  curl -s -X POST "${WORKER_URL}/api/usage/log" \
    -H "Content-Type: application/json" \
    -d "{
      \"session_id\": \"$session_id\",
      \"project\": \"$project\",
      \"input_tokens\": $delta_input,
      \"output_tokens\": $delta_output,
      \"timestamp\": \"$(date -Iseconds)\"
    }" > /dev/null 2>&1 &

  # Save current as last (for next delta calculation)
  cp "$stats_file" "$last_file"
fi
```

#### 1.4 Update ~/.claude/settings.json
```json
{
  "hooks": {
    "Stop": [
      {
        "type": "command",
        "command": "~/.claude/hooks/log-usage.sh"
      }
    ]
  },
  "statusLine": {
    "type": "command",
    "command": "~/.claude/hooks/statusline.sh"
  }
}
```

#### 1.5 Add D1 Schema (worker/schema.sql addition)
```sql
-- Per-project usage tracking
CREATE TABLE IF NOT EXISTS project_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  project TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_usage_project ON project_usage(project);
CREATE INDEX IF NOT EXISTS idx_project_usage_timestamp ON project_usage(timestamp);
```

#### 1.6 Add Worker Endpoints

**POST /api/usage/log** - Receive usage data from hooks
```javascript
export async function handleUsageLog(request, env) {
  const body = await request.json();
  const { session_id, project, input_tokens, output_tokens, timestamp } = body;

  await env.DB.prepare(`
    INSERT INTO project_usage (session_id, project, input_tokens, output_tokens, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).bind(session_id, project, input_tokens, output_tokens, timestamp).run();

  return jsonResponse({ success: true });
}
```

**GET /api/projects/summary** - Get project breakdown for pie chart
```javascript
export async function handleProjectsSummary(request, env) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || '7d';

  // Calculate cutoff
  const days = range === '24h' ? 1 : range === '30d' ? 30 : 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const result = await env.DB.prepare(`
    SELECT
      project,
      SUM(input_tokens) as total_input,
      SUM(output_tokens) as total_output,
      SUM(input_tokens + output_tokens) as total_tokens,
      COUNT(*) as message_count
    FROM project_usage
    WHERE timestamp >= ?
    GROUP BY project
    ORDER BY total_tokens DESC
  `).bind(cutoff).all();

  return jsonResponse({
    success: true,
    data: result.results,
    range
  });
}
```

**GET /api/projects/history** - Get project usage over time
```javascript
export async function handleProjectsHistory(request, env) {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || '7d';
  const project = url.searchParams.get('project'); // optional filter

  const days = range === '24h' ? 1 : range === '30d' ? 30 : 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = `
    SELECT
      project,
      DATE(timestamp) as date,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens
    FROM project_usage
    WHERE timestamp >= ?
  `;

  if (project) {
    query += ` AND project = ?`;
  }

  query += ` GROUP BY project, DATE(timestamp) ORDER BY date`;

  const stmt = project
    ? env.DB.prepare(query).bind(cutoff, project)
    : env.DB.prepare(query).bind(cutoff);

  const result = await stmt.all();

  return jsonResponse({
    success: true,
    data: result.results,
    range
  });
}
```

---

## 2. Project Breakdown Pie Chart

### UI Location
Add new section between status cards and history:

```html
<!-- Project Breakdown -->
<section class="projects-section">
    <div class="section-header">
        <span class="prompt">$</span> ./projects --breakdown
        <select id="projects-range" class="range-select">
            <option value="24h">24h</option>
            <option value="7d" selected>7d</option>
            <option value="30d">30d</option>
        </select>
    </div>
    <div class="projects-container">
        <div class="pie-chart-container">
            <canvas id="projects-pie"></canvas>
        </div>
        <div class="projects-legend" id="projects-legend">
            <!-- Generated by JS -->
        </div>
    </div>
</section>
```

### Chart.js Config
```javascript
const projectsPie = new Chart(ctx, {
  type: 'doughnut',
  data: {
    labels: ['claude-watch', 'other-project', 'misc'],
    datasets: [{
      data: [45000, 30000, 15000],
      backgroundColor: [
        '#E07A3E',  // Claude orange
        '#5BA3D9',  // Blue
        '#4ADE80',  // Green
        '#FACC15',  // Yellow
        '#FB923C',  // Orange
        '#A78BFA',  // Purple
      ],
      borderColor: '#1A1A1A',
      borderWidth: 2
    }]
  },
  options: {
    responsive: true,
    plugins: {
      legend: { display: false }, // Custom legend
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const total = ctx.dataset.data.reduce((a, b) => a + b);
            const pct = ((ctx.raw / total) * 100).toFixed(1);
            return `${ctx.label}: ${ctx.raw.toLocaleString()} tokens (${pct}%)`;
          }
        }
      }
    }
  }
});
```

### Custom Legend (shows tokens + percentage)
```javascript
function renderProjectsLegend(data) {
  const total = data.reduce((sum, p) => sum + p.total_tokens, 0);
  const legend = document.getElementById('projects-legend');

  legend.innerHTML = data.map((p, i) => {
    const pct = ((p.total_tokens / total) * 100).toFixed(1);
    const color = COLORS[i % COLORS.length];
    return `
      <div class="legend-item">
        <span class="legend-color" style="background: ${color}"></span>
        <span class="legend-label">${p.project}</span>
        <span class="legend-value">${p.total_tokens.toLocaleString()}</span>
        <span class="legend-pct">${pct}%</span>
      </div>
    `;
  }).join('');
}
```

---

## 3. Fixed-Window History Graphs

### 3.1 Five-Hour Graph (by time within window)

**Current:** Shows 5-hour data points by date (confusing)
**New:** Shows exactly 5 hours, X-axis = "0h, 1h, 2h, 3h, 4h, 5h"

```javascript
function updateFiveHourGraph(history, resetsAt) {
  const resetTime = new Date(resetsAt);
  const windowStart = new Date(resetTime - 5 * 60 * 60 * 1000);

  // Filter to current 5-hour window
  const windowData = history.filter(h => {
    const t = new Date(h.timestamp);
    return t >= windowStart && t <= resetTime;
  });

  // Map to hours since window start
  const labels = [];
  const data = [];

  for (let h = 0; h <= 5; h += 0.5) {
    labels.push(`${h}h`);
    const targetTime = new Date(windowStart.getTime() + h * 60 * 60 * 1000);
    // Find closest data point
    const closest = findClosest(windowData, targetTime);
    data.push(closest?.five_hour?.utilization ?? null);
  }

  // Show previous window as faded
  // ... (get previous window data, render with opacity 0.3)
}
```

### 3.2 Seven-Day Graph (fixed width)

**Current:** Expands as data comes in
**New:** Always shows 7 days, blank/dashed for future

```javascript
function updateSevenDayGraph(history, resetsAt) {
  const resetTime = new Date(resetsAt);
  const windowStart = new Date(resetTime - 7 * 24 * 60 * 60 * 1000);

  // Create 7 day labels
  const labels = [];
  const data = [];

  for (let d = 0; d < 7; d++) {
    const day = new Date(windowStart.getTime() + d * 24 * 60 * 60 * 1000);
    labels.push(day.toLocaleDateString('en-US', { weekday: 'short' }));

    if (day <= new Date()) {
      // Past day - show data
      const dayData = history.filter(h => isSameDay(h.timestamp, day));
      const avg = average(dayData.map(d => d.seven_day?.utilization ?? 0));
      data.push(avg);
    } else {
      // Future day - null (shows as gap)
      data.push(null);
    }
  }

  // Configure chart to handle nulls gracefully
  chart.options.spanGaps = false;
}
```

### 3.3 Previous Window Indicator
```css
.previous-window {
  opacity: 0.3;
  border-style: dashed;
}
```

---

## 4. Projection Toggles

### UI Toggle (matches range selector style)
```html
<div class="projection-toggle">
    <span class="label">PROJECTION:</span>
    <select id="projection-mode" class="range-select">
        <option value="none">None</option>
        <option value="extrapolate" selected>Extrapolate</option>
        <option value="predict">Predict</option>
    </select>
</div>
```

### Projection Logic

**None:** Just show raw data

**Extrapolate:** Linear regression on last 1 hour, extend forward
```javascript
function extrapolate(data, hoursAhead = 2) {
  // Get last 1 hour of data
  const recentData = data.filter(d =>
    new Date(d.timestamp) > new Date(Date.now() - 60 * 60 * 1000)
  );

  if (recentData.length < 2) return null;

  // Simple linear regression
  const { slope, intercept } = linearRegression(recentData);

  // Project forward
  const projected = [];
  for (let h = 0; h <= hoursAhead; h += 0.5) {
    const futureTime = Date.now() + h * 60 * 60 * 1000;
    const value = slope * futureTime + intercept;
    projected.push({ timestamp: futureTime, value: Math.min(100, Math.max(0, value)) });
  }

  return projected;
}
```

**Predict:** Linear regression on full dataset
```javascript
function predict(data, hoursAhead = 2) {
  if (data.length < 2) return null;

  const { slope, intercept } = linearRegression(data);

  // Project forward
  const projected = [];
  for (let h = 0; h <= hoursAhead; h += 0.5) {
    const futureTime = Date.now() + h * 60 * 60 * 1000;
    const value = slope * futureTime + intercept;
    projected.push({ timestamp: futureTime, value: Math.min(100, Math.max(0, value)) });
  }

  return projected;
}
```

### Visual Styling
```javascript
// Add projection as second dataset
datasets: [
  {
    label: 'Actual',
    data: actualData,
    borderColor: '#E07A3E',
    borderWidth: 2,
  },
  {
    label: 'Projected',
    data: projectedData,
    borderColor: '#E07A3E',
    borderWidth: 2,
    borderDash: [5, 5],  // Dotted line
    pointRadius: 0,
    backgroundColor: 'transparent',
  }
]
```

---

## 5. Cost Estimates

### Data Source
Use exact token counts from `project_usage` table.

### API Pricing (as of 2024)
```javascript
const PRICING = {
  'claude-3-opus': { input: 15.00, output: 75.00 },     // per 1M tokens
  'claude-3-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-3.5-sonnet': { input: 3.00, output: 15.00 },
};

// Default to Opus pricing (Max uses Opus primarily)
const DEFAULT_PRICING = PRICING['claude-3-opus'];
```

### Calculation
```javascript
function calculateCost(inputTokens, outputTokens) {
  const inputCost = (inputTokens / 1_000_000) * DEFAULT_PRICING.input;
  const outputCost = (outputTokens / 1_000_000) * DEFAULT_PRICING.output;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}
```

### Display
```html
<section class="cost-section">
    <div class="section-header">
        <span class="prompt">$</span> ./cost --estimate
    </div>
    <div class="cost-container">
        <div class="cost-card">
            <div class="cost-label">THIS WEEK'S API EQUIVALENT</div>
            <div class="cost-value" id="cost-estimate">$0.00</div>
            <div class="cost-math" id="cost-math">
                <!-- 15,234 input × $15/1M = $0.23 -->
                <!-- 4,521 output × $75/1M = $0.34 -->
            </div>
        </div>
        <div class="cost-card">
            <div class="cost-label">MONTHLY PROJECTION</div>
            <div class="cost-value" id="monthly-estimate">$0.00</div>
        </div>
        <div class="cost-card savings">
            <div class="cost-label">SAVED VS API</div>
            <div class="cost-value" id="savings">$0.00</div>
            <div class="cost-note">Max subscription: $100/mo</div>
        </div>
    </div>
</section>
```

---

## 6. Seven-Day Reset Display

### Current
```
RESETS IN: 98:49:36
(12:00 AM PST)
```

### New
```
RESETS IN: 98:49:36
(Mon 12:00 AM PST)
```

### Implementation
```javascript
function formatResetTime(resetDate) {
  if (!resetDate) return '';

  const options = {
    weekday: 'short',  // Add this
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles',
  };
  return `(${resetDate.toLocaleString('en-US', options)} PST)`;
}
```

---

## Implementation Order

### Step 1: Per-Project Tracking (Foundation)
1. Backup existing statusline
2. Create ~/.claude/hooks/ directory
3. Create statusline.sh
4. Create log-usage.sh
5. Update ~/.claude/settings.json
6. Add D1 schema (project_usage table)
7. Add Worker endpoints (/api/usage/log, /api/projects/summary, /api/projects/history)
8. Deploy Worker
9. Test with a few messages

### Step 2: Pie Chart
1. Add projects-section to index.html
2. Add CSS for pie chart container
3. Add Chart.js doughnut chart
4. Add custom legend
5. Fetch from /api/projects/summary
6. Test

### Step 3: Fixed-Window Graphs
1. Update updateChart() to handle fixed windows
2. Add previous window fading
3. Add 7-day fixed width with blanks
4. Update X-axis labels
5. Test

### Step 4: Projections
1. Add projection toggle UI
2. Implement linearRegression helper
3. Implement extrapolate()
4. Implement predict()
5. Add projected dataset to charts
6. Style with dotted lines
7. Test

### Step 5: Cost Estimates
1. Add /api/tokens/summary endpoint (totals from project_usage)
2. Add cost-section to index.html
3. Add cost calculation logic
4. Add CSS styling
5. Test

### Step 6: Polish
1. Update 7-day reset format to include weekday
2. Test all features together
3. Push to GitHub

---

## Testing Checklist

- [ ] StatusLine displays correctly
- [ ] Stop hook fires after each message
- [ ] Worker receives usage data
- [ ] D1 stores project_usage entries
- [ ] /api/projects/summary returns data
- [ ] Pie chart renders correctly
- [ ] 5-hour graph shows time-based X-axis
- [ ] 7-day graph shows fixed width with blanks
- [ ] Previous window shows faded
- [ ] Projection toggle works
- [ ] Extrapolate shows dotted line
- [ ] Predict shows dotted line
- [ ] Cost estimates calculate correctly
- [ ] Savings vs $100 shows correctly
- [ ] 7-day reset shows weekday

---

## Files Changed

| File | Action |
|------|--------|
| `~/.claude/hooks/statusline.sh` | CREATE |
| `~/.claude/hooks/log-usage.sh` | CREATE |
| `~/.claude/settings.json` | MODIFY |
| `/mnt/claude-data/statusline.sh` | BACKUP |
| `worker/schema.sql` | MODIFY (add table) |
| `worker/src/index.js` | MODIFY (add routes) |
| `worker/src/api/projects.js` | CREATE |
| `worker/src/api/usage-log.js` | CREATE |
| `index.html` | MODIFY (add sections) |
| `app.js` | MODIFY (add charts, projections) |
| `style.css` | MODIFY (add styles) |
