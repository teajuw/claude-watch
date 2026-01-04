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

-- Insert default config
INSERT OR IGNORE INTO config (key, value) VALUES ('thresholds', '[50, 75, 90]');
INSERT OR IGNORE INTO config (key, value) VALUES ('reminder_minutes', '15');
INSERT OR IGNORE INTO config (key, value) VALUES ('telegram_enabled', 'true');
