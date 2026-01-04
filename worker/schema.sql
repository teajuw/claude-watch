-- Claude Watch D1 Database Schema

-- Usage history (one row per minute from cron)
CREATE TABLE IF NOT EXISTS usage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    five_hour_util REAL,
    five_hour_resets_at TEXT,
    seven_day_util REAL,
    seven_day_resets_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_timestamp ON usage_history(timestamp);

-- Scheduled sessions (max 4)
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    start_hour INTEGER NOT NULL,
    start_minute INTEGER DEFAULT 0,
    label TEXT,
    enabled INTEGER DEFAULT 1
);

-- Key-value state (alerts_sent, last_util, etc)
CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Config (thresholds, reminder_minutes, etc)
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Per-project usage tracking (from Stop hook)
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

-- Agent metrics (from Stop hook, per-agent tracking)
CREATE TABLE IF NOT EXISTS agent_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    project TEXT NOT NULL,
    session_id TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    model_id TEXT,
    duration_ms INTEGER DEFAULT 0,
    lines_added INTEGER DEFAULT 0,
    lines_removed INTEGER DEFAULT 0,
    cache_write INTEGER DEFAULT 0,
    cache_read INTEGER DEFAULT 0,
    context_pct INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent_id ON agent_metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_timestamp ON agent_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent_project ON agent_metrics(agent_id, project);

-- Agent status (tracks active/idle state per agent:project)
CREATE TABLE IF NOT EXISTS agent_status (
    agent_id TEXT NOT NULL,
    project TEXT NOT NULL,
    last_seen TEXT,
    status TEXT DEFAULT 'active',
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_lines_added INTEGER DEFAULT 0,
    total_lines_removed INTEGER DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0,
    session_count INTEGER DEFAULT 0,
    PRIMARY KEY (agent_id, project)
);

-- Rate limit events (tracks when user hits 100%)
CREATE TABLE IF NOT EXISTS rate_limit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    window_type TEXT NOT NULL,
    utilization REAL NOT NULL,
    timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_timestamp ON rate_limit_events(timestamp);

-- Insert default config
INSERT OR IGNORE INTO config (key, value) VALUES ('thresholds', '[50, 75, 90]');
INSERT OR IGNORE INTO config (key, value) VALUES ('reminder_minutes', '15');
INSERT OR IGNORE INTO config (key, value) VALUES ('telegram_enabled', 'true');
