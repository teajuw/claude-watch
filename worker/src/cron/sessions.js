/**
 * Scheduled session checking and notifications
 */

import { sendTelegram } from '../lib/telegram';
import { getSessions, getState, setState, getConfig } from '../lib/db';
import { getPSTNow, formatHour } from '../utils/time';

export async function checkScheduledSessions(env, usage) {
  // Get sessions
  const sessions = await getSessions(env.DB);
  if (!sessions.length) return;

  // Get current time in PST
  const now = getPSTNow();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentMinutes = currentHour * 60 + currentMinute;

  // Get reminder config
  const reminderMinutes = await getConfig(env.DB, 'reminder_minutes') || 15;

  for (const session of sessions) {
    if (!session.enabled) continue;

    const sessionStart = session.start_hour * 60 + (session.start_minute || 0);
    const sessionEnd = sessionStart + 5 * 60; // 5 hour window

    // Get notification state for this session
    const stateKey = `session_${session.id}`;
    const sessionState = await getState(env.DB, stateKey) || {};

    // Today's date key to reset daily
    const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

    // Reset state at midnight or if it's a new day
    if (sessionState.date !== dateKey) {
      sessionState.date = dateKey;
      sessionState.reminded = false;
      sessionState.started = false;
      sessionState.ending = false;
    }

    // Check reminder (X min before)
    const reminderTime = sessionStart - reminderMinutes;
    if (currentMinutes >= reminderTime && currentMinutes < sessionStart && !sessionState.reminded) {
      const minsUntil = sessionStart - currentMinutes;
      const label = session.label || 'Scheduled session';

      await sendTelegram(env,
        `*Session Reminder*\n\n` +
        `"${label}" starts in ${minsUntil} minutes!\n` +
        `Starts at ${formatHour(session.start_hour)} PST`
      );

      sessionState.reminded = true;
    }

    // Check session start
    if (currentMinutes >= sessionStart && currentMinutes < sessionStart + 5 && !sessionState.started) {
      const label = session.label || 'Session';
      const endHour = (session.start_hour + 5) % 24;

      await sendTelegram(env,
        `*Session Started!*\n\n` +
        `"${label}" is now active.\n` +
        `Window ends at ${formatHour(endHour)} PST\n\n` +
        `_Go get 'em._`
      );

      sessionState.started = true;
    }

    // Check session ending (30 min before window closes)
    const endWarning = sessionEnd - 30;
    if (currentMinutes >= endWarning && currentMinutes < sessionEnd && !sessionState.ending) {
      const label = session.label || 'Session';
      const currentUtil = usage?.five_hour?.utilization ?? 0;

      await sendTelegram(env,
        `*Session Ending Soon*\n\n` +
        `"${label}" ends in 30 minutes.\n` +
        `Current usage: ${currentUtil.toFixed(1)}%`
      );

      sessionState.ending = true;
    }

    // Save state
    await setState(env.DB, stateKey, sessionState);
  }
}
