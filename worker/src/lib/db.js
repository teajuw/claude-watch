/**
 * D1 database helpers
 */

/**
 * Get a state value by key
 */
export async function getState(db, key) {
  const row = await db.prepare('SELECT value FROM state WHERE key = ?').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}

/**
 * Set a state value
 */
export async function setState(db, key, value) {
  await db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)')
    .bind(key, JSON.stringify(value))
    .run();
}

/**
 * Get a config value by key
 */
export async function getConfig(db, key) {
  const row = await db.prepare('SELECT value FROM config WHERE key = ?').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}

/**
 * Set a config value
 */
export async function setConfig(db, key, value) {
  await db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
    .bind(key, JSON.stringify(value))
    .run();
}

/**
 * Save usage snapshot to history
 */
export async function saveUsageHistory(db, usage) {
  const timestamp = new Date().toISOString();

  await db.prepare(`
    INSERT INTO usage_history
    (timestamp, five_hour_util, five_hour_resets_at, seven_day_util, seven_day_resets_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    timestamp,
    usage.five_hour?.utilization ?? 0,
    usage.five_hour?.resets_at ?? null,
    usage.seven_day?.utilization ?? 0,
    usage.seven_day?.resets_at ?? null
  ).run();

  return timestamp;
}

/**
 * Prune old history (keep last 7 days)
 */
export async function pruneHistory(db) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('DELETE FROM usage_history WHERE timestamp < ?').bind(cutoff).run();
}

/**
 * Get usage history with optional time filter
 */
export async function getUsageHistory(db, range = '7d') {
  let cutoff;
  const now = Date.now();

  switch (range) {
    case '24h':
      cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      break;
    case '30d':
      cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
      break;
    case '7d':
    default:
      cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  }

  const result = await db.prepare(`
    SELECT timestamp, five_hour_util, five_hour_resets_at, seven_day_util, seven_day_resets_at
    FROM usage_history
    WHERE timestamp >= ?
    ORDER BY timestamp ASC
  `).bind(cutoff).all();

  return result.results.map(row => ({
    timestamp: row.timestamp,
    five_hour: {
      utilization: row.five_hour_util,
      resets_at: row.five_hour_resets_at,
    },
    seven_day: {
      utilization: row.seven_day_util,
      resets_at: row.seven_day_resets_at,
    },
  }));
}

/**
 * Get latest usage entry
 */
export async function getLatestUsage(db) {
  const row = await db.prepare(`
    SELECT timestamp, five_hour_util, five_hour_resets_at, seven_day_util, seven_day_resets_at
    FROM usage_history
    ORDER BY timestamp DESC
    LIMIT 1
  `).first();

  if (!row) return null;

  return {
    timestamp: row.timestamp,
    five_hour: {
      utilization: row.five_hour_util,
      resets_at: row.five_hour_resets_at,
    },
    seven_day: {
      utilization: row.seven_day_util,
      resets_at: row.seven_day_resets_at,
    },
  };
}

/**
 * Get all sessions
 */
export async function getSessions(db) {
  const result = await db.prepare('SELECT * FROM sessions ORDER BY start_hour, start_minute').all();
  return result.results.map(row => ({
    id: row.id,
    start_hour: row.start_hour,
    start_minute: row.start_minute,
    label: row.label,
    enabled: Boolean(row.enabled),
  }));
}

/**
 * Save sessions (replaces all)
 */
export async function saveSessions(db, sessions) {
  // Delete all existing sessions
  await db.prepare('DELETE FROM sessions').run();

  // Insert new sessions
  for (const session of sessions) {
    await db.prepare(`
      INSERT INTO sessions (id, start_hour, start_minute, label, enabled)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      session.id,
      session.start_hour,
      session.start_minute || 0,
      session.label || '',
      session.enabled ? 1 : 0
    ).run();
  }
}
