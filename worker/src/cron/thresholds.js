/**
 * Threshold checking and alert logic
 */

import { sendTelegram } from '../lib/telegram';
import { getState, setState, getConfig } from '../lib/db';
import { formatCountdown } from '../utils/time';

// Separate thresholds for each window type
const FIVE_HOUR_THRESHOLDS = [50, 75, 100];
const SEVEN_DAY_THRESHOLDS = [25, 50, 75, 90, 100];
const RESET_DROP_THRESHOLD = 20;

// Quips for 5-hour reset
const RESET_QUIPS = [
  "Fresh slate. Time to make questionable decisions.",
  "The meter forgives. Your code might not.",
  "New window energy. Don't waste it.",
  "Tokens respawned. Act accordingly.",
  "Rise and grind. The slate is clean.",
  "Fresh tokens just dropped.",
];

// Quips for 5-hour threshold alerts
const FIVE_HOUR_QUIPS = [
  "Pacing is for marathons. This is a sprint.",
  "The meter hungers.",
  "Opus is starting to sweat.",
  "Consider your next prompt carefully.",
  "You're built different. Unfortunately, so is the rate limit.",
  "Running hot. Just like your CPU.",
];

// Quips for 5-hour maxed (100%)
const FIVE_HOUR_MAXED_QUIPS = [
  "Congratulations, you played yourself.",
  "Achievement unlocked: Token Bankruptcy.",
  "The well is dry. Touch grass.",
  "Error 429. Go outside.",
  "Opus has left the chat.",
  "Rate limit speedrun complete. New PB?",
];

// Quips for 7-day threshold alerts
const SEVEN_DAY_QUIPS = [
  "The long game gets interesting.",
  "Weekly quota check. How's your self-control?",
  "Seven days. Many tokens. Such usage.",
  "The weekly meter watches. Always.",
  "Sustainable pace? We don't know her.",
  "Week's half gone. So are your tokens.",
];

// Quips for 7-day maxed (100%)
const SEVEN_DAY_MAXED_QUIPS = [
  "Weekly limit achieved. Impressive? Concerning? Both.",
  "You've used a week's worth. In a week. Math checks out.",
  "The weekly well is dry. See you next reset.",
  "Seven days of tokens, gone. No regrets?",
  "Achievement unlocked: Weekly Grindset.",
];

function getRandomQuip(quips) {
  return quips[Math.floor(Math.random() * quips.length)];
}

export async function checkThresholds(env, usage) {
  const telegramEnabled = await getConfig(env.DB, 'telegram_enabled');
  if (telegramEnabled === false) {
    console.log('Telegram disabled, skipping alerts');
    return;
  }

  // Check 5-hour window
  await checkFiveHourThresholds(env, usage);

  // Check 7-day window
  await checkSevenDayThresholds(env, usage);
}

async function checkFiveHourThresholds(env, usage) {
  const alertsSent = await getState(env.DB, 'five_hour_alerts') || [];
  const lastUtil = await getState(env.DB, 'five_hour_last_util') || 0;

  const currentUtil = usage.five_hour?.utilization ?? 0;
  const resetsAt = usage.five_hour?.resets_at;
  const countdown = formatCountdown(resetsAt);

  // Check for window reset (usage dropped significantly)
  if (lastUtil > RESET_DROP_THRESHOLD && currentUtil < lastUtil - RESET_DROP_THRESHOLD) {
    console.log(`5-hour reset detected: ${lastUtil}% -> ${currentUtil}%`);

    const quip = getRandomQuip(RESET_QUIPS);
    const message = `5 hour tokens reset\n\n${quip}`;

    await sendTelegram(env, message);
    await setState(env.DB, 'five_hour_alerts', []);
  }

  // Check thresholds
  const newAlertsSent = [...alertsSent];

  for (const threshold of FIVE_HOUR_THRESHOLDS) {
    const alertKey = `5h_${threshold}`;
    if (currentUtil >= threshold && !alertsSent.includes(alertKey)) {
      console.log(`5-hour threshold ${threshold}% crossed at ${currentUtil}%`);

      const quip = getRandomQuip(FIVE_HOUR_QUIPS);
      const message = `5 hour tokens at ${Math.round(currentUtil)}% (${countdown} left)\n\n${quip}`;

      await sendTelegram(env, message);
      newAlertsSent.push(alertKey);
    }
  }

  await setState(env.DB, 'five_hour_alerts', newAlertsSent);
  await setState(env.DB, 'five_hour_last_util', currentUtil);
}

async function checkSevenDayThresholds(env, usage) {
  const alertsSent = await getState(env.DB, 'seven_day_alerts') || [];

  const currentUtil = usage.seven_day?.utilization ?? 0;
  const resetsAt = usage.seven_day?.resets_at;
  const countdown = formatCountdown(resetsAt);

  // Check thresholds
  const newAlertsSent = [...alertsSent];

  for (const threshold of SEVEN_DAY_THRESHOLDS) {
    const alertKey = `7d_${threshold}`;
    if (currentUtil >= threshold && !alertsSent.includes(alertKey)) {
      console.log(`7-day threshold ${threshold}% crossed at ${currentUtil}%`);

      const quip = getRandomQuip(SEVEN_DAY_QUIPS);
      const message = `Weekly tokens at ${Math.round(currentUtil)}% (${countdown} left)\n\n${quip}`;

      await sendTelegram(env, message);
      newAlertsSent.push(alertKey);
    }
  }

  await setState(env.DB, 'seven_day_alerts', newAlertsSent);
}
