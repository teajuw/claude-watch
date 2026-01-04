/**
 * GET /api/history - Returns usage history
 */

import { jsonResponse, errorResponse } from '../utils/cors';
import { getUsageHistory } from '../lib/db';

export async function handleHistory(request, env) {
  try {
    const url = new URL(request.url);
    const range = url.searchParams.get('range') || '7d';

    // Validate range
    if (!['24h', '7d', '30d'].includes(range)) {
      return errorResponse('Invalid range. Use 24h, 7d, or 30d', 400);
    }

    const history = await getUsageHistory(env.DB, range);

    return jsonResponse({
      success: true,
      data: history,
      count: history.length,
      range,
    });
  } catch (error) {
    console.error('History fetch error:', error);
    return errorResponse(error.message);
  }
}
