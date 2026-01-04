/**
 * GET/POST /api/schedule - Manage scheduled sessions
 */

import { jsonResponse, errorResponse } from '../utils/cors';
import { getSessions, saveSessions, getConfig, setConfig } from '../lib/db';

/**
 * GET /api/schedule - Get all sessions and config
 */
export async function handleScheduleGet(env) {
  try {
    const sessions = await getSessions(env.DB);
    const reminderMinutes = await getConfig(env.DB, 'reminder_minutes') || 15;

    return jsonResponse({
      success: true,
      data: {
        sessions,
        reminder_minutes: reminderMinutes,
      },
    });
  } catch (error) {
    console.error('Schedule get error:', error);
    return errorResponse(error.message);
  }
}

/**
 * POST /api/schedule - Save sessions and config
 */
export async function handleSchedulePost(request, env) {
  try {
    const body = await request.json();
    const { sessions, reminder_minutes } = body;

    // Validate sessions
    if (!Array.isArray(sessions)) {
      return errorResponse('sessions must be an array', 400);
    }

    if (sessions.length > 4) {
      return errorResponse('Maximum 4 sessions allowed', 400);
    }

    // Validate each session
    for (const session of sessions) {
      if (!session.id || typeof session.start_hour !== 'number') {
        return errorResponse('Each session must have id and start_hour', 400);
      }
      if (session.start_hour < 0 || session.start_hour > 23) {
        return errorResponse('start_hour must be 0-23', 400);
      }
    }

    // Save sessions
    await saveSessions(env.DB, sessions);

    // Save reminder config if provided
    if (typeof reminder_minutes === 'number') {
      await setConfig(env.DB, 'reminder_minutes', reminder_minutes);
    }

    return jsonResponse({
      success: true,
      message: 'Schedule saved',
      data: {
        sessions,
        reminder_minutes: reminder_minutes || await getConfig(env.DB, 'reminder_minutes'),
      },
    });
  } catch (error) {
    console.error('Schedule save error:', error);
    return errorResponse(error.message);
  }
}
