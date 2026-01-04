/**
 * Main cron handler - runs every minute
 */

import { getValidAccessToken, fetchUsage } from '../lib/anthropic';
import { saveUsageHistory, pruneHistory } from '../lib/db';
import { checkThresholds } from './thresholds';
import { checkScheduledSessions } from './sessions';

export async function runCron(env) {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Cron starting...`);

  try {
    // 1. Get valid access token (refresh if needed)
    console.log('Getting access token...');
    const accessToken = await getValidAccessToken(env);

    // 2. Fetch current usage from Anthropic
    console.log('Fetching usage from Anthropic...');
    const usage = await fetchUsage(accessToken);

    console.log(`5-hour: ${usage.five_hour?.utilization?.toFixed(1)}%`);
    console.log(`7-day: ${usage.seven_day?.utilization?.toFixed(1)}%`);

    // 3. Save to D1
    console.log('Saving to D1...');
    const timestamp = await saveUsageHistory(env.DB, usage);

    // 4. Prune old data (keep 7 days)
    await pruneHistory(env.DB);

    // 5. Check thresholds and send alerts
    console.log('Checking thresholds...');
    await checkThresholds(env, usage);

    // 6. Check scheduled sessions
    console.log('Checking scheduled sessions...');
    await checkScheduledSessions(env, usage);

    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] Cron complete in ${duration}ms`);

  } catch (error) {
    console.error('Cron error:', error);
    // Don't rethrow - let cron complete even on error
  }
}
