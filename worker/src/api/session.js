/**
 * POST /api/session/start - Manually start a session now
 */

import { jsonResponse, errorResponse } from '../utils/cors';
import { sendTelegram } from '../lib/telegram';
import { getLatestUsage } from '../lib/db';
import { formatResetTime, formatHour } from '../utils/time';

export async function handleSessionStart(env) {
  try {
    // Get current usage
    const latest = await getLatestUsage(env.DB);
    const currentUtil = latest?.five_hour?.utilization ?? 0;
    const resetsAt = latest?.five_hour?.resets_at;

    // Calculate when this 5-hour window ends
    const now = new Date();
    const endsAt = new Date(now.getTime() + 5 * 60 * 60 * 1000);

    // Send Telegram notification
    const message =
      `*Manual Session Started*\n\n` +
      `Current usage: ${currentUtil.toFixed(1)}%\n` +
      `Window ends: ${formatResetTime(endsAt.toISOString())}\n\n` +
      `_Go get 'em._`;

    const result = await sendTelegram(env, message);

    return jsonResponse({
      success: true,
      message: 'Session started',
      started_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      current_usage: currentUtil,
      telegram_sent: result.success,
    });
  } catch (error) {
    console.error('Session start error:', error);
    return errorResponse(error.message);
  }
}
