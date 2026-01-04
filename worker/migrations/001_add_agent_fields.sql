-- Migration 001: Add new fields to agent_metrics and agent_status
-- Run this against your existing D1 database

-- Add new columns to agent_metrics
ALTER TABLE agent_metrics ADD COLUMN model_id TEXT;
ALTER TABLE agent_metrics ADD COLUMN duration_ms INTEGER DEFAULT 0;
ALTER TABLE agent_metrics ADD COLUMN lines_added INTEGER DEFAULT 0;
ALTER TABLE agent_metrics ADD COLUMN lines_removed INTEGER DEFAULT 0;
ALTER TABLE agent_metrics ADD COLUMN cache_write INTEGER DEFAULT 0;
ALTER TABLE agent_metrics ADD COLUMN cache_read INTEGER DEFAULT 0;
ALTER TABLE agent_metrics ADD COLUMN context_pct INTEGER DEFAULT 0;
ALTER TABLE agent_metrics ADD COLUMN cost_usd REAL DEFAULT 0;

-- Add composite index for agent:project queries
CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent_project ON agent_metrics(agent_id, project);

-- Add new columns to agent_status
ALTER TABLE agent_status ADD COLUMN total_lines_added INTEGER DEFAULT 0;
ALTER TABLE agent_status ADD COLUMN total_lines_removed INTEGER DEFAULT 0;
ALTER TABLE agent_status ADD COLUMN total_duration_ms INTEGER DEFAULT 0;
ALTER TABLE agent_status ADD COLUMN session_count INTEGER DEFAULT 0;

-- Create rate_limit_events table
CREATE TABLE IF NOT EXISTS rate_limit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    window_type TEXT NOT NULL,
    utilization REAL NOT NULL,
    timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_timestamp ON rate_limit_events(timestamp);
