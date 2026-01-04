-- Migration 002: Fix agent_status to use composite primary key (agent_id, project)
-- This recreates the table since SQLite doesn't support ALTER TABLE for PKs

-- 1. Rename old table
ALTER TABLE agent_status RENAME TO agent_status_old;

-- 2. Create new table with composite PK
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

-- 3. Copy data from old table (aggregate by agent_id, project)
INSERT INTO agent_status (
    agent_id, project, last_seen, status,
    total_input_tokens, total_output_tokens,
    total_lines_added, total_lines_removed,
    total_duration_ms, session_count
)
SELECT
    agent_id,
    project,
    MAX(last_seen) as last_seen,
    'active' as status,
    SUM(total_input_tokens) as total_input_tokens,
    SUM(total_output_tokens) as total_output_tokens,
    SUM(total_lines_added) as total_lines_added,
    SUM(total_lines_removed) as total_lines_removed,
    SUM(total_duration_ms) as total_duration_ms,
    SUM(session_count) as session_count
FROM agent_status_old
GROUP BY agent_id, project;

-- 4. Drop old table
DROP TABLE agent_status_old;
