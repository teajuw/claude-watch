# Claude Watch - Logs System Design

## Cloudflare Limits to Consider

### D1 Database (SQLite)
- **Row size:** 1MB max per row
- **Database size:** 10GB (free), 50GB (paid)
- **Reads:** 5M/day free, unlimited paid
- **Writes:** 100K/day free, unlimited paid
- **Query time:** 30s max

### KV Storage
- **Value size:** 25MB max
- **Reads:** 100K/day free
- **Writes:** 1K/day free (!)  ← This is the constraint

### Worker
- **CPU time:** 10ms free, 30s paid
- **Subrequests:** 50/request free, 1000 paid

**Conclusion:** Use D1 for logs (100K writes/day = ~70 writes/min = plenty).
Avoid KV for frequent log writes.

---

## Log Entry Design

### Compact by Default, Expandable for Detail

**Collapsed view (one line):**
```
11:42:03  coder    claude-watch  +2.1k/890  Fixing OAuth bug
```

**Expanded view (click to show):**
```
┌─────────────────────────────────────────────────────────────────┐
│ 11:42:03 PST · January 5, 2026                                  │
├─────────────────────────────────────────────────────────────────┤
│ Agent:    coder (teajuw)                                        │
│ Project:  claude-watch                                          │
│ Session:  abc123-def456                                         │
├─────────────────────────────────────────────────────────────────┤
│ Tokens:   2,100 input · 890 output · 2,990 total                │
│ Cost:     ~$0.045                                               │
│ Duration: 12.5s                                                 │
│ Model:    opus                                                  │
├─────────────────────────────────────────────────────────────────┤
│ Context:  "Fixing OAuth routing bug in worker/src/index.js"     │
│                                                                 │
│ Files touched:                                                  │
│   • worker/src/index.js (edited)                                │
│   • worker/src/lib/auth.js (read)                               │
└─────────────────────────────────────────────────────────────────┘
```

### What NOT to Store (keeps logs small)
- Full conversation content
- File contents
- Actual diffs (link to commit instead)

### What TO Store
- Timestamp
- Agent ID
- Project name
- Session ID (for grouping)
- Token counts (input, output)
- Event type (response, commit, error, start, stop)
- Summary/context (1 line, ~100 chars max)
- Model used
- Duration (ms)
- Optional: commit SHA, file list

---

## D1 Schema

```sql
-- Main logs table
CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,           -- ISO 8601
    event_type TEXT NOT NULL,          -- response, commit, error, start, stop, sync
    agent_id TEXT,                     -- nullable for system events
    project TEXT,
    session_id TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    summary TEXT,                      -- short description, max 200 chars
    model TEXT,
    duration_ms INTEGER,
    metadata TEXT,                     -- JSON blob for extra data (commit sha, files, etc)
    created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX idx_logs_timestamp ON logs(timestamp DESC);
CREATE INDEX idx_logs_project ON logs(project, timestamp DESC);
CREATE INDEX idx_logs_agent ON logs(agent_id, timestamp DESC);
CREATE INDEX idx_logs_session ON logs(session_id);
CREATE INDEX idx_logs_type ON logs(event_type);

-- Aggregated daily stats (for fast dashboard queries)
CREATE TABLE daily_stats (
    date TEXT PRIMARY KEY,             -- YYYY-MM-DD
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_events INTEGER DEFAULT 0,
    projects_active TEXT,              -- JSON array
    agents_active TEXT,                -- JSON array
    updated_at TEXT DEFAULT (datetime('now'))
);
```

---

## API Design

### GET /api/logs

**Query params:**
- `limit` - max rows (default 50, max 200)
- `offset` - pagination
- `project` - filter by project
- `agent` - filter by agent ID
- `type` - filter by event type
- `since` - ISO timestamp (logs after this time)
- `until` - ISO timestamp (logs before this time)
- `search` - full-text search on summary field
- `session` - filter by session ID

**Response:**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": 12345,
        "timestamp": "2026-01-05T11:42:03-08:00",
        "event_type": "response",
        "agent_id": "teajuw",
        "project": "claude-watch",
        "session_id": "abc123",
        "input_tokens": 2100,
        "output_tokens": 890,
        "summary": "Fixing OAuth routing bug",
        "model": "opus",
        "duration_ms": 12500,
        "metadata": {"files": ["worker/src/index.js"]}
      }
    ],
    "pagination": {
      "total": 1250,
      "limit": 50,
      "offset": 0,
      "has_more": true
    },
    "aggregates": {
      "total_tokens": 125000,
      "total_events": 1250,
      "projects": ["claude-watch", "calendar"],
      "agents": ["teajuw", "local"]
    }
  }
}
```

### POST /api/logs

**For hook to send events:**
```json
{
  "event_type": "response",
  "agent_id": "teajuw",
  "project": "claude-watch",
  "session_id": "abc123",
  "input_tokens": 2100,
  "output_tokens": 890,
  "summary": "Fixing OAuth routing bug",
  "model": "opus",
  "duration_ms": 12500,
  "metadata": {
    "files": ["worker/src/index.js"]
  }
}
```

---

## Log Retention Strategy

### Keep Forever (small)
- `daily_stats` table - one row per day
- Aggregates only

### Keep 7 Days (detailed)
- Full `logs` table entries
- Pruned by cron daily

### Prune Query
```sql
DELETE FROM logs
WHERE timestamp < datetime('now', '-7 days');
```

---

## UI Components

### Search Bar (Ctrl+F style)
```
┌─────────────────────────────────────────────────────────────────┐
│ 🔍 Search logs...                          [Ctrl+F to focus]   │
└─────────────────────────────────────────────────────────────────┘
```
- Searches `summary` field
- Highlights matches in results
- Debounced (300ms) to avoid API spam

### Filter Bar
```
┌─────────────────────────────────────────────────────────────────┐
│ Project: [All ▼]  Agent: [All ▼]  Type: [All ▼]  Range: [24h ▼]│
└─────────────────────────────────────────────────────────────────┘
```

### Log Stream (Terminal Style)
```
┌─────────────────────────────────────────────────────────────────┐
│ // logs · 127 events · 45.2k tokens                    [pause] │
├─────────────────────────────────────────────────────────────────┤
│ ▸ 11:42:03  teajuw   claude-watch  +2.1k/890  OAuth fix        │
│ ▸ 11:41:15  teajuw   claude-watch  +1.8k/1.2k  Reading files   │
│ ▸ 11:38:22  teajuw   claude-watch  ● start    Session started  │
│ ▾ 11:35:10  local    calendar      +3.2k/1.1k  Add event form  │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │ Tokens: 3,200 in · 1,100 out · $0.065                   │  │
│   │ Duration: 15.2s · Model: opus                           │  │
│   │ Files: src/components/EventForm.tsx                     │  │
│   └─────────────────────────────────────────────────────────┘  │
│ ▸ 11:30:45  local    calendar      ✓ commit   "Add event form" │
│ ▸ 11:28:00  local    calendar      ● start    Session started  │
├─────────────────────────────────────────────────────────────────┤
│ [Load more...]                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Keyboard Shortcuts
- `Ctrl+F` / `Cmd+F` - Focus search
- `Esc` - Clear search, collapse all
- `↑/↓` - Navigate entries
- `Enter` - Expand/collapse selected
- `E` - Expand all visible
- `C` - Collapse all

---

## Event Types & Icons

| Type | Icon | Color | When |
|------|------|-------|------|
| `response` | ▸ | default | Claude responded |
| `start` | ● | green | Session started |
| `stop` | ○ | gray | Session ended |
| `commit` | ✓ | cyan | Git commit made |
| `error` | ✗ | red | Error occurred |
| `sync` | ↻ | orange | Credentials synced |
| `alert` | ⚠ | yellow | Threshold crossed |

---

## Grouping Views

### Flat (default)
Just chronological stream, newest first.

### By Session
```
▾ Session abc123 (teajuw · claude-watch) ──────── 12.4k tokens
    11:42:03  +2.1k/890   OAuth fix
    11:41:15  +1.8k/1.2k  Reading files
    11:38:22  ● start

▸ Session def456 (local · calendar) ──────────── 8.2k tokens
```

### By Project
```
▾ claude-watch ──────────────────────────────── 45.2k tokens
    11:42:03  teajuw   +2.1k/890   OAuth fix
    11:35:10  local    +3.2k/1.1k  Add form

▸ calendar ──────────────────────────────────── 12.8k tokens
```

### By Hour (timeline)
```
▾ 11:00 - 12:00 ─────────────────────────────── 15.3k tokens
    11:42:03  teajuw   claude-watch  +2.1k/890
    11:35:10  local    calendar      +3.2k/1.1k

▸ 10:00 - 11:00 ─────────────────────────────── 8.1k tokens
```

---

## Implementation Order

1. **D1 schema migration** - Add logs table
2. **POST /api/logs endpoint** - Accept log events
3. **Update stop-hook** - Send events to new endpoint
4. **GET /api/logs endpoint** - With filters and pagination
5. **Basic Logs UI** - Stream view, no expansion yet
6. **Search** - Ctrl+F, debounced
7. **Filters** - Dropdowns for project/agent/type
8. **Expansion** - Click to expand detail
9. **Grouping** - Toggle between flat/session/project/hour
10. **Keyboard shortcuts**

---

## Storage Estimates

**Assumptions:**
- 100 Claude responses/day average
- 500 bytes per log entry (with index overhead)
- 7 days retention

**Calculation:**
- 100 events × 500 bytes × 7 days = 350 KB
- Even at 1000 events/day = 3.5 MB/week

**D1 limit:** 10 GB free tier → **Years of headroom**

**Write limit:** 100K/day free → 100 events/day = **0.1% of limit**

We're safe.
