/**
 * Threshold checking and alert logic
 */

import { sendTelegram } from '../lib/telegram';
import { getState, setState, getConfig } from '../lib/db';
import { formatResetTime, formatCountdown, getQuip, getResetQuip } from '../utils/time';

const DEFAULT_THRESHOLDS = [50, 75, 90];
const RESET_DROP_THRESHOLD = 20;

export async function checkThresholds(env, usage) {
  // Get state
  const alertsSent = await getState(env.DB, 'alerts_sent') || [];
  const lastUtil = await getState(env.DB, 'last_util') || 0;

  const currentUtil = usage.five_hour?.utilization ?? 0;
  const resetsAt = usage.five_hour?.resets_at;

  // Check for window reset (usage dropped significantly)
  if (lastUtil > RESET_DROP_THRESHOLD && currentUtil < lastUtil - RESET_DROP_THRESHOLD) {
    console.log(`Window reset detected: ${lastUtil}% -> ${currentUtil}%`);

    const quip = getResetQuip();
    const message =
      `*Window Reset!*\n\n` +
      `${quip}\n\n` +
      `New window ends at ${formatResetTime(resetsAt)}`;

    await sendTelegram(env, message);

    // Clear alerts for new window
    await setState(env.DB, 'alerts_sent', []);
  }

  // Get thresholds from config
  const thresholds = await getConfig(env.DB, 'thresholds') || DEFAULT_THRESHOLDS;
  const telegramEnabled = await getConfig(env.DB, 'telegram_enabled');

  // Only send alerts if Telegram is enabled
  if (telegramEnabled === false) {
    console.log('Telegram disabled, skipping threshold alerts');
    await setState(env.DB, 'last_util', currentUtil);
    return;
  }

  // Check each threshold
  const newAlertsSent = [...alertsSent];

  for (const threshold of thresholds.sort((a, b) => a - b)) {
    if (currentUtil >= threshold && !alertsSent.includes(threshold)) {
      console.log(`Threshold ${threshold}% crossed at ${currentUtil}%`);

      const quip = getQuip(currentUtil);
      const message =
        `*${threshold}% Usage Alert*\n\n` +
        `5-hour: ${currentUtil.toFixed(1)}%\n` +
        `Resets: ${formatResetTime(resetsAt)} (${formatCountdown(resetsAt)})\n\n` +
        `_${quip}_`;

      await sendTelegram(env, message);
      newAlertsSent.push(threshold);
    }
  }

  // Save state
  await setState(env.DB, 'alerts_sent', newAlertsSent);
  await setState(env.DB, 'last_util', currentUtil);
}
