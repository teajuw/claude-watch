/**
 * GET /api/usage - Returns current usage data
 */

import { jsonResponse, errorResponse } from '../utils/cors';
import { getValidAccessToken, fetchUsage } from '../lib/anthropic';
import { getLatestUsage, saveUsageHistory } from '../lib/db';

export async function handleUsage(env) {
  try {
    // Check if we have recent data (less than 1 minute old)
    const latest = await getLatestUsage(env.DB);

    if (latest) {
      const age = Date.now() - new Date(latest.timestamp).getTime();
      if (age < 60000) {
        // Return cached data
        return jsonResponse({
          success: true,
          data: {
            five_hour: latest.five_hour,
            seven_day: latest.seven_day,
          },
          timestamp: latest.timestamp,
          cached: true,
        });
      }
    }

    // Fetch fresh data from Anthropic
    const accessToken = await getValidAccessToken(env);
    const usage = await fetchUsage(accessToken);

    // Save to history
    const timestamp = await saveUsageHistory(env.DB, usage);

    return jsonResponse({
      success: true,
      data: {
        five_hour: usage.five_hour,
        seven_day: usage.seven_day,
      },
      timestamp,
      cached: false,
    });
  } catch (error) {
    console.error('Usage fetch error:', error);
    return errorResponse(error.message);
  }
}
