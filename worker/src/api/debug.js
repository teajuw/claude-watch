/**
 * Debug API - View and reset internal state
 */

import { corsHeaders } from '../utils/cors';
import { getState, setState } from '../lib/db';

/**
 * GET /api/debug/state - View alert state
 */
export async function handleDebugState(request, env) {
  const fiveHourAlerts = await getState(env.DB, 'five_hour_alerts') || [];
  const fiveHourLastUtil = await getState(env.DB, 'five_hour_last_util') || 0;
  const sevenDayAlerts = await getState(env.DB, 'seven_day_alerts') || [];

  return new Response(JSON.stringify({
    success: true,
    state: {
      five_hour_alerts: fiveHourAlerts,
      five_hour_last_util: fiveHourLastUtil,
      seven_day_alerts: sevenDayAlerts,
    },
  }), { headers: corsHeaders });
}

/**
 * POST /api/debug/reset-alerts - Clear alert state
 * Body: { window: "5h" | "7d" | "all" }
 */
export async function handleResetAlerts(request, env) {
  const body = await request.json().catch(() => ({}));
  const window = body.window || 'all';

  if (window === '5h' || window === 'all') {
    await setState(env.DB, 'five_hour_alerts', []);
    await setState(env.DB, 'five_hour_last_util', 0);
  }

  if (window === '7d' || window === 'all') {
    await setState(env.DB, 'seven_day_alerts', []);
  }

  return new Response(JSON.stringify({
    success: true,
    message: `Reset alerts for: ${window}`,
  }), { headers: corsHeaders });
}
