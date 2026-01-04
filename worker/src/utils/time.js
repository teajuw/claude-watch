/**
 * Time utilities for PST conversion and formatting
 */

// Quips categorized by usage level
const QUIPS = {
  low: [
    "Fresh window energy. The world is your oyster.",
    "Tokens for days. Live your best life.",
    "You could mass-delete your codebase and still have quota.",
    "Opus awaits your command, master.",
    "The tank is full. Floor it.",
  ],
  medium: [
    "Cruise control engaged.",
    "Perfectly balanced, as all things should be.",
    "Halfway to touching grass.",
    "The meter ticks. The code flows.",
    "Sustainable pace detected. Boring, but wise.",
  ],
  high: [
    "Opus go brrr.",
    "We're in the endgame now.",
    "Consider your next prompt carefully.",
    "The meter hungers.",
    "You're built different. Unfortunately, so is the rate limit.",
  ],
  critical: [
    "Have you considered Sonnet?",
    "The well runs dry.",
    "Opus is sweating.",
    "Your tokens. Hand them over.",
    "Rate limit speedrun any%.",
  ],
  reset: [
    "Rise and grind. The slate is clean.",
    "Fresh tokens just dropped.",
    "The soul is restored. The meter forgives.",
    "New window, new me.",
    "Tokens are back on the menu.",
  ],
};

/**
 * Get current time in PST timezone
 */
export function getPSTNow() {
  const now = new Date();
  // Convert to PST (UTC-8)
  const pstOffset = -8 * 60; // minutes
  const utcOffset = now.getTimezoneOffset(); // minutes from UTC
  const pstTime = new Date(now.getTime() + (utcOffset + pstOffset) * 60 * 1000);
  return pstTime;
}

/**
 * Format ISO timestamp to PST time string
 */
export function formatResetTime(isoString) {
  if (!isoString) return 'unknown';

  const date = new Date(isoString);
  const options = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles',
  };
  return date.toLocaleString('en-US', options) + ' PST';
}

/**
 * Format time remaining as countdown string
 */
export function formatCountdown(isoString) {
  if (!isoString) return 'unknown';

  const resetDate = new Date(isoString);
  const now = new Date();
  const diff = resetDate - now;

  if (diff <= 0) return 'now';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Format hour (0-23) to readable time
 */
export function formatHour(hour) {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${suffix}`;
}

/**
 * Get a random quip based on utilization level
 */
export function getQuip(utilization) {
  let category;
  if (utilization < 25) {
    category = 'low';
  } else if (utilization < 50) {
    category = 'medium';
  } else if (utilization < 75) {
    category = 'high';
  } else {
    category = 'critical';
  }

  const quips = QUIPS[category];
  return quips[Math.floor(Math.random() * quips.length)];
}

/**
 * Get a random reset quip
 */
export function getResetQuip() {
  return QUIPS.reset[Math.floor(Math.random() * QUIPS.reset.length)];
}
