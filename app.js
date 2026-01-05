/**
 * Claude Usage Terminal - Dashboard Logic
 * Fetches usage data and renders the terminal interface
 */

// =============================================================================
// Configuration
// =============================================================================

// Update this to your Cloudflare Worker URL
const CONFIG = {
    // Cloudflare Worker URL (update after deployment)
    // Format: https://claude-watch.<your-subdomain>.workers.dev
    workerUrl: '', // Set during init or via ?worker= param
    refreshInterval: 60000, // 1 minute
    localMode: false, // Set via ?local=true for testing
    timezone: 'America/Los_Angeles', // Default timezone, changed via UI
};

// =============================================================================
// Quips - Because life's too short for boring dashboards
// =============================================================================

const QUIPS = {
    idle: [
        "Full capacity. The world is your oyster.",
        "Tokens gathering dust.",
        "Opus waits. Patiently.",
        "The well is full. Drink up.",
        "Ready when you are.",
        "Idle hands are the devil's workshop. Get coding.",
    ],
    low: [
        "Fresh window energy. The world is your oyster.",
        "Tokens for days. Live your best life.",
        "You could mass-delete your codebase and still have quota.",
        "Opus awaits your command, master.",
        "The tank is full. Floor it.",
        "Touch grass? Nah, touch Opus.",
        "Infinite cosmic power! ...itty bitty rate limit.",
        "The vibes are immaculate. The tokens are plentiful.",
    ],
    medium: [
        "Cruise control engaged.",
        "Perfectly balanced, as all things should be.",
        "Halfway to touching grass.",
        "The meter ticks. The code flows.",
        "Sustainable pace detected. Boring, but wise.",
        "You're pacing yourself. How responsible. How dull.",
        "The midpoint. Neither here nor there. Very liminal.",
    ],
    high: [
        "Opus go brrr.",
        "We're in the endgame now.",
        "Consider your next prompt carefully.",
        "The meter hungers.",
        "You're built different. Unfortunately, so is the rate limit.",
        "Running hot. Just like your CPU.",
        "The candle burns at both ends. Beautifully.",
        "Speed run mode activated.",
    ],
    critical: [
        "Have you considered Sonnet?",
        "The well runs dry.",
        "Opus is sweating.",
        "Your tokens. Hand them over.",
        "Rate limit speedrun any%.",
        "We've been trying to reach you about your token's extended warranty.",
        "This is fine. Everything is fine.",
        "Error 429 enters the chat.",
        "Maybe touch grass until reset?",
    ],
    maxed: [
        "Congratulations, you played yourself.",
        "Achievement unlocked: Token Bankruptcy.",
        "The well is dry. Touch grass.",
        "Error 429. Go outside.",
        "You've hit the wall. The wall won.",
        "Opus has left the chat.",
        "Rate limit speedrun complete. New PB?",
        "The meter is full. You are empty.",
    ],
    loading: [
        "Initializing snark module...",
        "Counting tokens... 1... 2... many...",
        "Consulting the Oracle of Anthropic...",
        "Warming up the sass generator...",
        "Loading witty commentary...",
    ],
    error: [
        "Something broke. Classic.",
        "The void stares back.",
        "404: Tokens not found.",
        "Have you tried turning it off and on again?",
    ],
};

const PROJECTS_QUIPS = [
    "Where the magic happens. And the bugs.",
    "Your code kingdoms, ranked by token appetite.",
    "Some projects just hit different.",
    "The token trail leads here.",
    "Every commit has a cost. Literally.",
    "Project portfolio: expensive but worth it.",
    "Code is temporary. Token usage is forever.",
    "Your projects, sorted by how much Claude loves them.",
    "The sum of all repos.",
    "Where tokens go to become features.",
];

const AGENTS_QUIPS = [
    "The fleet awaits your command.",
    "Agent swarm status: nominal.",
    "Distributed intelligence, centralized billing.",
    "Many hands make light work. Heavy token usage.",
    "Your digital workforce, reporting for duty.",
    "Agent orchestra, ready to conduct.",
    "The more agents, the merrier the token bill.",
    "Parallel processing, parallel spending.",
    "One command, many minions.",
    "Fleet admiral view activated.",
];

function getQuip(utilization, isIdle = false) {
    let category;
    if (utilization === null || utilization === undefined) {
        category = 'loading';
    } else if (isIdle || utilization === 0) {
        category = 'idle';
    } else if (utilization >= 100) {
        category = 'maxed';
    } else if (utilization < 25) {
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

function getErrorQuip() {
    return QUIPS.error[Math.floor(Math.random() * QUIPS.error.length)];
}

// =============================================================================
// ASCII Progress Bar
// =============================================================================

function generateAsciiBar(percent, width = 20) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `[${bar}]`;
}

function getStatusClass(percent) {
    if (percent < 25) return 'status-low';
    if (percent < 50) return 'status-medium';
    if (percent < 75) return 'status-high';
    return 'status-critical';
}

// =============================================================================
// Time Utilities
// =============================================================================

function parseResetTime(isoString) {
    if (!isoString) return null;
    return new Date(isoString);
}

function formatCountdown(resetDate) {
    if (!resetDate) return '--:--:--';

    const now = new Date();
    const diff = resetDate - now;

    if (diff <= 0) return '00:00:00';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return [
        hours.toString().padStart(2, '0'),
        minutes.toString().padStart(2, '0'),
        seconds.toString().padStart(2, '0'),
    ].join(':');
}

function getTimezoneAbbr() {
    const tzMap = {
        'America/Los_Angeles': 'PST',
        'America/Denver': 'MST',
        'America/Chicago': 'CST',
        'America/New_York': 'EST',
    };
    return tzMap[CONFIG.timezone] || 'PST';
}

function formatResetTime(resetDate, includeWeekday = false) {
    if (!resetDate) return '';

    const options = {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: CONFIG.timezone,
    };

    // Add weekday for 7-day reset
    if (includeWeekday) {
        options.weekday = 'short';
    }

    return `(${resetDate.toLocaleString('en-US', options)} ${getTimezoneAbbr()})`;
}

function formatTimestamp(isoString) {
    const date = new Date(isoString);
    const options = {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: CONFIG.timezone,
    };
    return date.toLocaleString('en-US', options);
}

// =============================================================================
// Data Fetching
// =============================================================================

async function fetchUsageHistory(range = '7d') {
    if (CONFIG.localMode) {
        const response = await fetch(`./usage-history.json?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch usage history: ${response.status}`);
        }
        return response.json();
    }

    // Map ranges for API
    // 5h -> 24h (we filter client-side to the 5-hour window)
    // 7d -> 7d (direct mapping)
    // 30d -> 30d (monthly view)
    const apiRange = range === '5h' ? '24h' : range;
    const response = await fetch(`${CONFIG.workerUrl}/api/history?range=${apiRange}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch usage history: ${response.status}`);
    }
    const result = await response.json();
    return result.data || [];
}

async function fetchCurrentUsage() {
    if (CONFIG.localMode) {
        // In local mode, get latest from history
        const history = await fetchUsageHistory();
        return history.length > 0 ? history[history.length - 1] : null;
    }

    const response = await fetch(`${CONFIG.workerUrl}/api/usage`);
    if (!response.ok) {
        throw new Error(`Failed to fetch current usage: ${response.status}`);
    }
    const result = await response.json();
    return {
        timestamp: result.timestamp,
        five_hour: result.data?.five_hour,
        seven_day: result.data?.seven_day,
    };
}

// TODO: Session scheduling feature paused - see BACKLOG.md Phase 4
// async function startSessionNow() {
//     if (CONFIG.localMode) {
//         showError('Session start not available in local mode');
//         return;
//     }
//
//     try {
//         const response = await fetch(`${CONFIG.workerUrl}/api/session/start`, {
//             method: 'POST',
//         });
//         const result = await response.json();
//
//         if (result.success) {
//             const endsAt = new Date(result.ends_at);
//             const quipEl = document.getElementById('quip');
//             if (quipEl) {
//                 quipEl.textContent = `Session started! Ends at ${endsAt.toLocaleTimeString()}`;
//             }
//             // Refresh data
//             await fetchData();
//         } else {
//             showError(result.error || 'Failed to start session');
//         }
//     } catch (error) {
//         console.error('Session start error:', error);
//         showError(error.message);
//     }
// }

// =============================================================================
// UI Updates
// =============================================================================

function updateProgressBar(prefix, utilization) {
    const fill = document.getElementById(`${prefix}-fill`);
    const ascii = document.getElementById(`${prefix}-ascii`);
    const percent = document.getElementById(`${prefix}-percent`);

    if (!fill || !ascii || !percent) return;

    const util = utilization ?? 0;

    fill.style.width = `${util}%`;
    fill.className = `progress-fill ${getStatusClass(util)}`;
    ascii.textContent = generateAsciiBar(util);
    percent.textContent = `${util.toFixed(1)}%`;
}

function updateCountdown(prefix, resetAt, utilization = null) {
    const countdownEl = document.getElementById(`${prefix}-countdown`);
    const resetTimeEl = document.getElementById(`${prefix}-reset-time`);
    const labelEl = countdownEl?.previousElementSibling;

    if (!countdownEl) return;

    // Check if idle (no reset time or 0% utilization)
    const isIdle = !resetAt || utilization === 0;

    // Include weekday for 7-day window
    const includeWeekday = prefix === 'seven-day';

    if (isIdle) {
        // Show "AVAILABLE" instead of countdown
        if (labelEl) labelEl.textContent = '';
        countdownEl.textContent = 'AVAILABLE';
        countdownEl.classList.add('available');
        if (resetTimeEl) resetTimeEl.textContent = '';
    } else {
        // Normal countdown display
        if (labelEl) labelEl.textContent = 'RESETS IN:';
        countdownEl.classList.remove('available');
        const resetDate = parseResetTime(resetAt);
        countdownEl.textContent = formatCountdown(resetDate);
        if (resetTimeEl) {
            resetTimeEl.textContent = formatResetTime(resetDate, includeWeekday);
        }
    }
}

function updateQuip(utilization, isIdle = false) {
    const quipEl = document.getElementById('quip');
    if (quipEl) {
        quipEl.textContent = getQuip(utilization, isIdle);
    }
}

function getRandomQuip(quips) {
    return quips[Math.floor(Math.random() * quips.length)];
}

function updateProjectsQuip() {
    const quipEl = document.getElementById('projects-quip');
    if (quipEl) {
        quipEl.textContent = getRandomQuip(PROJECTS_QUIPS);
    }
}

function updateAgentsQuip() {
    const quipEl = document.getElementById('agents-quip');
    if (quipEl) {
        quipEl.textContent = getRandomQuip(AGENTS_QUIPS);
    }
}

function updateLastUpdated(timestamp) {
    const el = document.getElementById('last-updated-nav');
    if (el && timestamp) {
        el.textContent = formatTimestamp(timestamp);
    }
}

const SYNC_COMMAND = 'cd ~/projects/claude-watch && ./bin/sync-credentials';

function showError(message) {
    const quipEl = document.getElementById('quip');
    if (quipEl) {
        quipEl.textContent = `${getErrorQuip()} (${message})`;
    }

    // Check if this is an auth error (500 or 401)
    const isAuthError = message.includes('500') || message.includes('401') || message.includes('token');
    const actionContainer = document.getElementById('action-btn-container');

    if (isAuthError && actionContainer) {
        actionContainer.innerHTML = `
            <button class="action-btn sync-btn" onclick="copySyncCommand()" title="Click to copy">[ SYNC REQUIRED ]</button>
        `;
    }
}

function copySyncCommand() {
    navigator.clipboard.writeText(SYNC_COMMAND).then(() => {
        const btn = document.querySelector('.sync-btn');
        if (btn) {
            btn.textContent = '[ COPIED! ]';
            setTimeout(() => {
                btn.textContent = '[ SYNC REQUIRED ]';
            }, 2000);
        }
    });
}

function resetActionButton() {
    const actionContainer = document.getElementById('action-btn-container');
    if (actionContainer) {
        actionContainer.innerHTML = `<button class="action-btn" onclick="fetchData()">[ REFRESH ]</button>`;
    }
}

// =============================================================================
// Chart
// =============================================================================

let historyChart = null;
// Pro limit is always visible in legend, user can toggle via clicking legend

// Pro plan has 1/5 the limits of Max 5x
// So 20% usage on Max = 100% on Pro
const PRO_LIMIT_PERCENTAGE = 20;

function initChart() {
    const ctx = document.getElementById('history-chart');
    if (!ctx) return;

    historyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: '5-Hour Window',
                    data: [],
                    borderColor: '#E07A3E',
                    backgroundColor: 'rgba(224, 122, 62, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#E07A3E',
                    order: 1,
                },
                {
                    label: '7-Day Rolling',
                    data: [],
                    borderColor: '#5BA3D9',
                    backgroundColor: 'rgba(91, 163, 217, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#5BA3D9',
                    order: 2,
                },
                {
                    label: 'Pro Limit (20%)',
                    data: [],
                    borderColor: '#FACC15',
                    borderWidth: 1,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false,
                    tension: 0,
                    hidden: false,
                    order: 0,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#808080',
                        font: { family: 'monospace', size: 11 },
                        boxWidth: 12,
                    },
                },
                tooltip: {
                    backgroundColor: '#1A1A1A',
                    titleColor: '#E07A3E',
                    bodyColor: '#E0E0E0',
                    borderColor: '#E07A3E',
                    borderWidth: 1,
                    titleFont: { family: 'monospace' },
                    bodyFont: { family: 'monospace' },
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`,
                    },
                },
            },
            scales: {
                x: {
                    display: true,
                    grid: { color: 'rgba(128, 128, 128, 0.1)' },
                    ticks: {
                        color: '#808080',
                        font: { family: 'monospace', size: 10 },
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 12, // Show more labels for 24h view
                    },
                },
                y: {
                    display: true,
                    min: 0,
                    max: 100,
                    grid: { color: 'rgba(128, 128, 128, 0.1)' },
                    ticks: {
                        color: '#808080',
                        font: { family: 'monospace', size: 10 },
                        callback: (value) => `${value}%`,
                    },
                },
            },
        },
    });
}

// Round time to nearest 15 minutes
function roundToNearest15Min(date) {
    const ms = 15 * 60 * 1000;
    return new Date(Math.round(date.getTime() / ms) * ms);
}

// Format time as "4:15 PM"
function formatTime(date) {
    return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: CONFIG.timezone,
    });
}

// Format date as "Mon 1/5"
function formatDayDate(date) {
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'numeric',
        day: 'numeric',
        timeZone: CONFIG.timezone,
    });
}

// Format date as "1/5" (shorter for monthly view)
function formatMonthDay(date) {
    return date.toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
        timeZone: CONFIG.timezone,
    });
}

// Get calendar day string for comparison (YYYY-MM-DD in selected timezone)
function getDayKey(date) {
    return date.toLocaleDateString('en-CA', { timeZone: CONFIG.timezone });
}

// Get start of day (midnight) in selected timezone
function startOfDay(date) {
    const dateStr = date.toLocaleDateString('en-CA', { timeZone: CONFIG.timezone });
    // Parse as local midnight - JS will interpret based on local system
    // For display purposes, we just need consistent day boundaries
    return new Date(dateStr + 'T00:00:00');
}

// Get end of day (23:59:59) in selected timezone
function endOfDay(date) {
    const dateStr = date.toLocaleDateString('en-CA', { timeZone: CONFIG.timezone });
    return new Date(dateStr + 'T23:59:59');
}

function updateChart(history, range) {
    if (!historyChart || !history || history.length === 0) return;

    // Get reset times from latest data to calculate window boundaries
    const latest = history[history.length - 1];
    const fiveHourReset = latest?.five_hour?.resets_at ? new Date(latest.five_hour.resets_at) : null;
    const sevenDayReset = latest?.seven_day?.resets_at ? new Date(latest.seven_day.resets_at) : null;

    const now = new Date();

    // Calculate window boundaries based on reset times
    const fiveHourStart = fiveHourReset ? new Date(fiveHourReset - 5 * 60 * 60 * 1000) : new Date(now - 5 * 60 * 60 * 1000);
    const sevenDayStart = sevenDayReset ? new Date(sevenDayReset - 7 * 24 * 60 * 60 * 1000) : new Date(now - 7 * 24 * 60 * 60 * 1000);

    let windowStart, windowEnd, slotMode;

    if (range === '5h') {
        // 5-hour window: round to 15 min intervals
        windowStart = roundToNearest15Min(fiveHourStart);
        windowEnd = roundToNearest15Min(fiveHourReset || new Date(now.getTime() + 5 * 60 * 60 * 1000));
        slotMode = 'hourly';
    } else if (range === '24h') {
        // 24-hour window: show current day (midnight to midnight) in selected timezone
        windowStart = startOfDay(now);
        windowEnd = endOfDay(now);
        slotMode = '24h';
    } else if (range === '30d') {
        // Monthly view: align to calendar month (billing cycle)
        // Start from 1st of current month, end at last day of month
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of month
        windowStart = startOfDay(monthStart);
        windowEnd = startOfDay(monthEnd);
        slotMode = 'monthly';
    } else {
        // 7-day window: normalize to PST calendar days (midnight to midnight)
        windowStart = startOfDay(sevenDayStart);
        windowEnd = startOfDay(sevenDayReset || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
        slotMode = 'daily';
    }

    // Generate slots for X-axis
    const slots = [];

    if (slotMode === 'hourly') {
        // 5-hour window: create slots every 30 minutes (11 slots total)
        const slotInterval = 30 * 60 * 1000; // 30 min
        for (let t = windowStart.getTime(); t <= windowEnd.getTime(); t += slotInterval) {
            const slotTime = new Date(t);
            slots.push({
                time: slotTime,
                label: formatTime(slotTime),
                fiveHour: null,
                sevenDay: null,
            });
        }
    } else if (slotMode === '24h') {
        // 24-hour window: create slots every hour (25 slots)
        const slotInterval = 60 * 60 * 1000; // 1 hour
        for (let t = windowStart.getTime(); t <= windowEnd.getTime(); t += slotInterval) {
            const slotTime = new Date(t);
            slots.push({
                time: slotTime,
                label: formatTime(slotTime),
                hourKey: slotTime.toISOString().slice(0, 13), // "2025-01-05T01" for matching
                fiveHour: null,
                sevenDay: null,
            });
        }
    } else if (slotMode === 'monthly') {
        // Monthly view: create slots for each day from 1st to today
        const daysInView = Math.ceil((windowEnd - windowStart) / (24 * 60 * 60 * 1000)) + 1;
        for (let d = 0; d < daysInView; d++) {
            const slotTime = new Date(windowStart.getTime() + d * 24 * 60 * 60 * 1000);
            if (slotTime > windowEnd) break;
            slots.push({
                time: slotTime,
                label: formatMonthDay(slotTime), // Shorter format: "1/5"
                dayKey: getDayKey(slotTime),
                fiveHour: null,
                sevenDay: null,
            });
        }
    } else {
        // 7-day window: create slots for each day (8 slots to cover full window including end day)
        // Window spans from start to reset, so we need slots for both boundary days
        for (let d = 0; d <= 7; d++) {
            const slotTime = new Date(windowStart.getTime() + d * 24 * 60 * 60 * 1000);
            // Stop if we've passed the window end
            if (slotTime > windowEnd) break;
            slots.push({
                time: slotTime,
                label: formatDayDate(slotTime),
                dayKey: getDayKey(slotTime), // PST calendar day for matching
                fiveHour: null,
                sevenDay: null,
            });
        }
    }

    // Map history data to slots
    history.forEach(item => {
        const itemTime = new Date(item.timestamp);
        if (itemTime > now) return; // Skip future data

        let bestSlot = null;

        if (slotMode === 'hourly') {
            // 5-hour view: find closest slot within 15 min threshold
            let bestDiff = Infinity;
            for (const slot of slots) {
                const diff = Math.abs(itemTime - slot.time);
                if (diff < bestDiff && diff < 15 * 60 * 1000) {
                    bestDiff = diff;
                    bestSlot = slot;
                }
            }
        } else if (slotMode === '24h') {
            // 24-hour view: match by hour
            const itemHourKey = itemTime.toISOString().slice(0, 13);
            bestSlot = slots.find(slot => slot.hourKey === itemHourKey);
        } else {
            // 7-day or monthly view: match by PST calendar day
            const itemDayKey = getDayKey(itemTime);
            bestSlot = slots.find(slot => slot.dayKey === itemDayKey);
        }

        if (bestSlot) {
            bestSlot.fiveHour = item.five_hour?.utilization ?? bestSlot.fiveHour;
            bestSlot.sevenDay = item.seven_day?.utilization ?? bestSlot.sevenDay;
        }
    });

    // For slots with no data:
    // - 5-hour: gaps mean idle time (0%) - reset every 5 hours
    // - 7-day: should carry forward last known value (cumulative)
    // - Future slots stay null so they don't plot
    let runningSevenDay = null;
    slots.forEach(slot => {
        if (slot.time > now) {
            // Future: don't plot
            slot.fiveHour = null;
            slot.sevenDay = null;
        } else {
            // Track running 7-day value
            if (slot.sevenDay !== null) {
                runningSevenDay = slot.sevenDay;
            }

            // 5-hour gaps = idle (0%)
            if (slot.fiveHour === null) {
                slot.fiveHour = 0;
            }

            // 7-day gaps = carry forward last known value
            if (slot.sevenDay === null && runningSevenDay !== null) {
                slot.sevenDay = runningSevenDay;
            }
        }
    });

    // Extend to current time with latest data
    if (history.length > 0) {
        const latestData = history[history.length - 1];

        // For 24h mode, find current hour slot
        if (slotMode === '24h') {
            const nowHourKey = now.toISOString().slice(0, 13);
            const currentSlot = slots.find(slot => slot.hourKey === nowHourKey);
            if (currentSlot && currentSlot.time <= now) {
                if (latestData.five_hour?.utilization !== undefined) {
                    currentSlot.fiveHour = latestData.five_hour.utilization;
                }
                if (latestData.seven_day?.utilization !== undefined) {
                    currentSlot.sevenDay = latestData.seven_day.utilization;
                }
            }
        }
    }

    // Update chart data
    historyChart.data.labels = slots.map(s => s.label);
    historyChart.data.datasets[0].data = slots.map(s => s.fiveHour);
    historyChart.data.datasets[1].data = slots.map(s => s.sevenDay);

    // Pro limit line - horizontal line at 20%
    historyChart.data.datasets[2].data = slots.map(() => PRO_LIMIT_PERCENTAGE);

    // Configure chart to not connect across null gaps
    historyChart.options.spanGaps = false;

    historyChart.update('none');
}

// =============================================================================
// Projects Pie Chart
// =============================================================================

const PROJECT_COLORS = [
    '#E07A3E',  // Claude orange
    '#5BA3D9',  // Blue
    '#4ADE80',  // Green
    '#FACC15',  // Yellow
    '#FB923C',  // Orange
    '#A78BFA',  // Purple
    '#F472B6',  // Pink
    '#22D3D2',  // Cyan
];

let projectsPieChart = null;

function initProjectsPieChart() {
    const ctx = document.getElementById('projects-pie');
    if (!ctx) return;

    projectsPieChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: PROJECT_COLORS,
                borderColor: '#1A1A1A',
                borderWidth: 2,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1A1A1A',
                    titleColor: '#E07A3E',
                    bodyColor: '#E0E0E0',
                    borderColor: '#E07A3E',
                    borderWidth: 1,
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.raw / total) * 100).toFixed(1);
                            return `${ctx.raw.toLocaleString()} tokens (${pct}%)`;
                        },
                    },
                },
            },
        },
    });
}

async function fetchProjectsSummary(range = '7d') {
    if (CONFIG.localMode) {
        return []; // No project data in local mode
    }

    try {
        const response = await fetch(`${CONFIG.workerUrl}/api/projects/summary?range=${range}`);
        if (!response.ok) return [];
        const result = await response.json();
        return result.data || [];
    } catch (error) {
        console.error('Failed to fetch projects summary:', error);
        return [];
    }
}

function updateProjectsPieChart(projects) {
    if (!projectsPieChart) return;

    const legend = document.getElementById('projects-legend');

    if (!projects || projects.length === 0) {
        projectsPieChart.data.labels = [];
        projectsPieChart.data.datasets[0].data = [];
        projectsPieChart.update('none');
        if (legend) {
            legend.innerHTML = '<div class="legend-empty">No project data yet</div>';
        }
        return;
    }

    // Update chart
    projectsPieChart.data.labels = projects.map(p => p.project || p.name);
    projectsPieChart.data.datasets[0].data = projects.map(p => p.total_tokens || p.tokens?.total || 0);
    projectsPieChart.update('none');

    // Update legend
    if (legend) {
        const total = projects.reduce((sum, p) => sum + (p.total_tokens || p.tokens?.total || 0), 0);
        legend.innerHTML = projects.map((p, i) => {
            const tokens = p.total_tokens || p.tokens?.total || 0;
            const pct = total > 0 ? ((tokens / total) * 100).toFixed(1) : '0.0';
            const color = PROJECT_COLORS[i % PROJECT_COLORS.length];
            return `
                <div class="legend-item">
                    <span class="legend-color" style="background: ${color}"></span>
                    <span class="legend-label">${p.project || p.name}</span>
                    <span class="legend-value">${formatTokens(tokens)}</span>
                    <span class="legend-pct">${pct}%</span>
                </div>
            `;
        }).join('');
    }
}

// Store current projects data for detail view
let currentProjectsData = [];

async function fetchProjectsDetails(range = '7d') {
    if (CONFIG.localMode) {
        return { projects: [], totals: {} };
    }

    try {
        const response = await fetch(`${CONFIG.workerUrl}/api/projects/details?range=${range}`);
        if (!response.ok) return { projects: [], totals: {} };
        const result = await response.json();
        return result.data || { projects: [], totals: {} };
    } catch (error) {
        console.error('Failed to fetch projects details:', error);
        return { projects: [], totals: {} };
    }
}

function updateProjectsOverview(totals) {
    const countEl = document.getElementById('projects-count');
    const tokensEl = document.getElementById('projects-total-tokens');
    const costEl = document.getElementById('projects-total-cost');
    const timeEl = document.getElementById('projects-total-time');

    if (countEl) countEl.textContent = totals.project_count || 0;
    if (tokensEl) tokensEl.textContent = formatTokens(totals.total_tokens || 0);
    if (costEl) costEl.textContent = `$${(totals.total_cost || 0).toFixed(2)}`;
    if (timeEl) timeEl.textContent = totals.duration_formatted || '0s';
}

function updateProjectsTable(projects) {
    const tbody = document.getElementById('projects-table-body');
    if (!tbody) return;

    currentProjectsData = projects;

    if (!projects || projects.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No project data yet</td></tr>';
        return;
    }

    tbody.innerHTML = projects.map((p, idx) => `
        <tr onclick="showProjectDetail(${idx})">
            <td class="project-name">${p.name}</td>
            <td>${formatTokens(p.tokens?.total || 0)}</td>
            <td>$${(p.cost || 0).toFixed(2)}</td>
            <td>${p.duration_formatted || '0s'}</td>
            <td>
                <span class="lines-added">+${p.lines?.added || 0}</span>
                <span class="lines-removed">-${p.lines?.removed || 0}</span>
            </td>
            <td>${p.sessions || 0}</td>
            <td class="agent-count">${p.agent_count || 0}</td>
            <td class="last-active">${formatTimeAgo(p.last_activity)}</td>
        </tr>
    `).join('');
}

function showProjectDetail(idx) {
    const project = currentProjectsData[idx];
    if (!project) return;

    const detailSection = document.getElementById('project-detail');
    const nameEl = document.getElementById('project-detail-name');
    const contentEl = document.getElementById('project-detail-content');

    if (!detailSection || !contentEl) return;

    nameEl.textContent = project.name;

    contentEl.innerHTML = `
        <div class="project-detail-grid">
            <div class="project-detail-stat">
                <div class="stat-value">${formatTokens(project.tokens?.input || 0)}</div>
                <div class="stat-label">Input Tokens</div>
            </div>
            <div class="project-detail-stat">
                <div class="stat-value">${formatTokens(project.tokens?.output || 0)}</div>
                <div class="stat-label">Output Tokens</div>
            </div>
            <div class="project-detail-stat">
                <div class="stat-value">$${(project.cost || 0).toFixed(2)}</div>
                <div class="stat-label">Cost</div>
            </div>
            <div class="project-detail-stat">
                <div class="stat-value">${project.duration_formatted || '0s'}</div>
                <div class="stat-label">Claude Time</div>
            </div>
            <div class="project-detail-stat">
                <div class="stat-value">+${project.lines?.added || 0}</div>
                <div class="stat-label">Lines Added</div>
            </div>
            <div class="project-detail-stat">
                <div class="stat-value">-${project.lines?.removed || 0}</div>
                <div class="stat-label">Lines Removed</div>
            </div>
            <div class="project-detail-stat">
                <div class="stat-value">${project.sessions || 0}</div>
                <div class="stat-label">Sessions</div>
            </div>
            <div class="project-detail-stat">
                <div class="stat-value">${project.messages || 0}</div>
                <div class="stat-label">Messages</div>
            </div>
        </div>
        <div class="project-agents-list">
            <div class="label">AGENTS:</div>
            <div class="agents">
                ${(project.agents || []).map(a => `<span class="agent-tag">${a}</span>`).join('')}
            </div>
        </div>
    `;

    detailSection.style.display = 'block';
    detailSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeProjectDetail() {
    const detailSection = document.getElementById('project-detail');
    if (detailSection) {
        detailSection.style.display = 'none';
    }
}

function formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return n.toString();
}

// =============================================================================
// Cost Estimates
// =============================================================================

// Opus pricing (per 1M tokens)
const PRICING = {
    input: 15.00,   // $15 per 1M input tokens
    output: 75.00,  // $75 per 1M output tokens
};

const MAX_SUBSCRIPTION = 100; // $100/month

async function fetchTokensSummary(range = '7d') {
    if (CONFIG.localMode) {
        return { total_input: 0, total_output: 0, total_tokens: 0 };
    }

    try {
        const response = await fetch(`${CONFIG.workerUrl}/api/tokens/summary?range=${range}`);
        if (!response.ok) return { total_input: 0, total_output: 0, total_tokens: 0 };
        const result = await response.json();
        return result.data || { total_input: 0, total_output: 0, total_tokens: 0 };
    } catch (error) {
        console.error('Failed to fetch tokens summary:', error);
        return { total_input: 0, total_output: 0, total_tokens: 0 };
    }
}

async function fetchCostsSummary() {
    if (CONFIG.localMode) {
        return { total_cost: 0, projected_monthly: 0 };
    }

    try {
        const response = await fetch(`${CONFIG.workerUrl}/api/costs/summary?range=month`);
        if (!response.ok) return { total_cost: 0, projected_monthly: 0 };
        const result = await response.json();
        return result.data || { total_cost: 0, projected_monthly: 0 };
    } catch (error) {
        console.error('Failed to fetch costs summary:', error);
        return { total_cost: 0, projected_monthly: 0 };
    }
}

// Store current cost data for plan toggle updates
let currentCostData = { total_cost: 0, daily_rate: 0 };

function updateCostEstimates(costData) {
    const costEl = document.getElementById('cost-estimate');
    const dailyAvgEl = document.getElementById('daily-average');
    const savingsEl = document.getElementById('savings');

    if (!costEl) return;

    currentCostData = costData;
    const { total_cost, daily_rate } = costData;

    // This month's actual cost (from statusline cost_usd)
    costEl.textContent = `$${(total_cost || 0).toFixed(2)}`;

    // Daily average
    if (dailyAvgEl) {
        dailyAvgEl.textContent = `$${(daily_rate || 0).toFixed(2)}/day`;
    }

    // Calculate savings based on selected plan
    updateSavings();
}

function updateSavings() {
    const savingsEl = document.getElementById('savings');
    const planSelect = document.getElementById('plan-select');

    if (!savingsEl || !planSelect) return;

    const planCost = parseInt(planSelect.value) || 200;
    const savings = planCost - (currentCostData.total_cost || 0);

    if (savings > 0) {
        savingsEl.textContent = `-$${savings.toFixed(2)}`;
        savingsEl.className = 'cost-value positive';
    } else {
        savingsEl.textContent = `+$${Math.abs(savings).toFixed(2)}`;
        savingsEl.className = 'cost-value negative';
    }
}

// =============================================================================
// Projections
// =============================================================================

function linearRegression(data) {
    // Filter out null/undefined values and keep track of original indices
    const validPoints = [];
    data.forEach((point, i) => {
        if (point !== null && point !== undefined && !isNaN(point)) {
            validPoints.push({ x: i, y: point });
        }
    });

    const n = validPoints.length;
    if (n < 2) return { slope: 0, intercept: 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    validPoints.forEach(({ x, y }) => {
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
    });

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) return { slope: 0, intercept: sumY / n };

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
}

function calculateProjection(data, mode, stepsAhead = 10) {
    if (mode === 'none' || !data || data.length < 2) {
        return [];
    }

    // Filter out null/undefined values for processing
    const validData = data.filter(d => d !== null && d !== undefined && !isNaN(d));
    if (validData.length < 2) {
        return [];
    }

    let sourceData;
    if (mode === 'extrapolate') {
        // Use last 20% of valid data for recent trend
        const recentCount = Math.max(2, Math.floor(validData.length * 0.2));
        sourceData = validData.slice(-recentCount);
    } else {
        // 'predict' - use all valid data
        sourceData = validData;
    }

    const { slope, intercept } = linearRegression(sourceData);

    // Get the last valid data point for extrapolation
    const lastValidValue = validData[validData.length - 1];
    const lastValidIndex = data.lastIndexOf(lastValidValue);

    // Project forward
    const projected = [];

    for (let i = 1; i <= stepsAhead; i++) {
        let value;
        if (mode === 'extrapolate') {
            // Continue from last valid point with recent slope
            value = lastValidValue + slope * i;
        } else {
            // Use full regression from last valid index
            value = slope * (lastValidIndex + i) + intercept;
        }
        // Clamp to 0-100
        projected.push(Math.min(100, Math.max(0, value)));
    }

    return projected;
}

function updateChartWithProjection(history, range, projectionMode) {
    if (!historyChart || !history || history.length === 0) return;

    // First, update regular chart data (this also updates Pro limit at index 2)
    updateChart(history, range);

    // If no projection, remove projection datasets (keep first 3: 5hr, 7day, pro limit)
    if (projectionMode === 'none') {
        // Remove projection datasets if they exist (keep indices 0, 1, 2)
        if (historyChart.data.datasets.length > 3) {
            historyChart.data.datasets = historyChart.data.datasets.slice(0, 3);
            historyChart.update('none');
        }
        return;
    }

    const fiveHourData = historyChart.data.datasets[0].data;
    const sevenDayData = historyChart.data.datasets[1].data;

    // Find last valid data point index for each series (this is "now")
    let lastValidFiveHourIdx = -1;
    let lastValidSevenDayIdx = -1;
    for (let i = fiveHourData.length - 1; i >= 0; i--) {
        if (lastValidFiveHourIdx === -1 && fiveHourData[i] !== null && !isNaN(fiveHourData[i])) {
            lastValidFiveHourIdx = i;
        }
        if (lastValidSevenDayIdx === -1 && sevenDayData[i] !== null && !isNaN(sevenDayData[i])) {
            lastValidSevenDayIdx = i;
        }
        if (lastValidFiveHourIdx !== -1 && lastValidSevenDayIdx !== -1) break;
    }

    // Count remaining slots after last valid point (these are future slots within the window)
    const remainingFiveHourSlots = fiveHourData.length - 1 - lastValidFiveHourIdx;
    const remainingSevenDaySlots = sevenDayData.length - 1 - lastValidSevenDayIdx;

    // Calculate projections for remaining slots within the window
    const fiveHourProjected = calculateProjection(fiveHourData, projectionMode, remainingFiveHourSlots);
    const sevenDayProjected = calculateProjection(sevenDayData, projectionMode, remainingSevenDaySlots);

    // Create projection data arrays (same length as original data - no extension)
    const fiveHourProjData = Array(fiveHourData.length).fill(null);
    const sevenDayProjData = Array(sevenDayData.length).fill(null);

    // Set the last valid actual point to connect the projection line
    if (lastValidFiveHourIdx !== -1) {
        fiveHourProjData[lastValidFiveHourIdx] = fiveHourData[lastValidFiveHourIdx];
    }
    if (lastValidSevenDayIdx !== -1) {
        sevenDayProjData[lastValidSevenDayIdx] = sevenDayData[lastValidSevenDayIdx];
    }

    // Fill in projected values for remaining slots within the window
    for (let i = 0; i < fiveHourProjected.length; i++) {
        const idx = lastValidFiveHourIdx + 1 + i;
        if (idx < fiveHourData.length) {
            fiveHourProjData[idx] = fiveHourProjected[i];
        }
    }
    for (let i = 0; i < sevenDayProjected.length; i++) {
        const idx = lastValidSevenDayIdx + 1 + i;
        if (idx < sevenDayData.length) {
            sevenDayProjData[idx] = sevenDayProjected[i];
        }
    }

    // Add or update projection datasets (indices 3 and 4)
    // No need to modify labels - projections stay within existing window
    if (historyChart.data.datasets.length === 3) {
        historyChart.data.datasets.push({
            label: '5-Hour Projected',
            data: fiveHourProjData,
            borderColor: '#E07A3E',
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
            tension: 0,
            order: 3,
        });
        historyChart.data.datasets.push({
            label: '7-Day Projected',
            data: sevenDayProjData,
            borderColor: '#5BA3D9',
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
            tension: 0,
            order: 4,
        });
    } else {
        historyChart.data.datasets[3].data = fiveHourProjData;
        historyChart.data.datasets[4].data = sevenDayProjData;
    }

    historyChart.update('none');
}

// =============================================================================
// Logs Tab
// =============================================================================

let logsData = [];
let logsPaused = false;
let logsOffset = 0;
let logsLastId = 0;
let logsRefreshInterval = null;
const LOGS_PAGE_SIZE = 50;
const LOGS_REFRESH_MS = 10000; // 10 seconds

async function fetchLogs(append = false) {
    if (CONFIG.localMode) return;
    if (logsPaused && append) return;

    try {
        const params = new URLSearchParams();

        // Filters
        const project = document.getElementById('logs-filter-project')?.value;
        const agent = document.getElementById('logs-filter-agent')?.value;
        const type = document.getElementById('logs-filter-type')?.value;
        const range = document.getElementById('logs-filter-range')?.value || '24h';
        const search = document.getElementById('logs-search')?.value;

        if (project) params.set('project', project);
        if (agent) params.set('agent', agent);
        if (type) params.set('type', type);
        if (search) params.set('search', search);

        // Calculate time range
        const now = new Date();
        let since;
        if (range === '1h') {
            since = new Date(now - 60 * 60 * 1000);
        } else if (range === '24h') {
            since = new Date(now - 24 * 60 * 60 * 1000);
        } else if (range === '7d') {
            since = new Date(now - 7 * 24 * 60 * 60 * 1000);
        }
        if (since) params.set('since', since.toISOString());

        // Pagination
        params.set('limit', LOGS_PAGE_SIZE);
        if (append) {
            params.set('offset', logsOffset);
        } else {
            logsOffset = 0;
        }

        const response = await fetch(`${CONFIG.workerUrl}/api/logs?${params}`);
        if (!response.ok) {
            console.error('Failed to fetch logs:', response.status);
            return;
        }

        const result = await response.json();
        const data = result.data || {};
        const newLogs = data.logs || [];

        if (append) {
            logsData = [...logsData, ...newLogs];
        } else {
            logsData = newLogs;
        }

        logsOffset = logsData.length;

        // Check for new logs (compare first log ID)
        const hadNewLogs = !append && newLogs.length > 0 && logsLastId > 0 && newLogs[0].id > logsLastId;

        if (newLogs.length > 0) {
            logsLastId = newLogs[0].id;
        }

        renderLogs(hadNewLogs ? newLogs[0].id : null);
        updateLogsSummary(data.aggregates);
        updateLogsFiltersFromAPI(data.filters);

        // Show notification for new logs
        if (hadNewLogs && !append) {
            showLogsNotification(newLogs.filter(l => l.id > logsLastId).length || 1);
        }

        // Show/hide load more button
        const loadMoreEl = document.getElementById('logs-load-more');
        if (loadMoreEl) {
            loadMoreEl.style.display = data.pagination?.has_more ? 'block' : 'none';
        }

    } catch (error) {
        console.error('Failed to fetch logs:', error);
    }
}

function renderLogs(highlightId = null) {
    const container = document.getElementById('logs-stream');
    if (!container) return;

    if (logsData.length === 0) {
        container.innerHTML = '<div class="logs-empty">No logs yet. Activity will appear here as hooks fire.</div>';
        return;
    }

    const searchTerm = document.getElementById('logs-search')?.value?.toLowerCase() || '';

    container.innerHTML = logsData.map((log, idx) => {
        const isNew = highlightId && log.id >= highlightId;
        const time = formatLogTime(log.timestamp);
        const type = log.event_type || 'unknown';
        const agent = log.agent_id || '';
        const project = log.project || '';
        const summary = log.summary || generateLogSummary(log);
        const inputTokens = log.input_tokens || 0;
        const outputTokens = log.output_tokens || 0;

        const isMatch = searchTerm && (
            summary.toLowerCase().includes(searchTerm) ||
            agent.toLowerCase().includes(searchTerm) ||
            project.toLowerCase().includes(searchTerm)
        );

        const highlightedSummary = searchTerm
            ? summary.replace(new RegExp(`(${escapeRegex(searchTerm)})`, 'gi'), '<mark>$1</mark>')
            : summary;

        return `
            <div class="log-entry ${isMatch ? 'search-match' : ''} ${isNew ? 'new-entry' : ''}" onclick="toggleLogDetail(${idx})" data-idx="${idx}">
                <div class="log-entry-header">
                    <span class="log-time">${time}</span>
                    <span class="log-type ${type}">${type}</span>
                    ${agent ? `<span class="log-agent">${agent}</span>` : ''}
                    ${project ? `<span class="log-project">${project}</span>` : ''}
                    <span class="log-summary">${highlightedSummary}</span>
                    ${inputTokens || outputTokens ? `
                        <span class="log-tokens">
                            <span class="input">↓${formatTokens(inputTokens)}</span>
                            <span class="output">↑${formatTokens(outputTokens)}</span>
                        </span>
                    ` : ''}
                </div>
                <div class="log-entry-detail">
                    ${renderLogDetail(log)}
                </div>
            </div>
        `;
    }).join('');
}

function renderLogDetail(log) {
    const details = [];

    if (log.id) details.push({ label: 'ID', value: log.id });
    if (log.timestamp) details.push({ label: 'Timestamp', value: new Date(log.timestamp).toLocaleString() });
    if (log.session_id) details.push({ label: 'Session', value: log.session_id });
    if (log.model) details.push({ label: 'Model', value: log.model });
    if (log.input_tokens) details.push({ label: 'Input', value: `${log.input_tokens.toLocaleString()} tokens` });
    if (log.output_tokens) details.push({ label: 'Output', value: `${log.output_tokens.toLocaleString()} tokens` });
    if (log.duration_ms) details.push({ label: 'Duration', value: `${(log.duration_ms / 1000).toFixed(1)}s` });
    if (log.metadata) {
        try {
            const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
            Object.entries(meta).forEach(([k, v]) => {
                details.push({ label: k, value: typeof v === 'object' ? JSON.stringify(v) : v });
            });
        } catch {}
    }

    return details.map(d => `
        <div class="log-detail-row">
            <span class="log-detail-label">${d.label}:</span>
            <span class="log-detail-value">${d.value}</span>
        </div>
    `).join('');
}

function toggleLogDetail(idx) {
    const entry = document.querySelector(`.log-entry[data-idx="${idx}"]`);
    if (entry) {
        entry.classList.toggle('expanded');
    }
}

function generateLogSummary(log) {
    const type = log.event_type;
    const tokens = (log.input_tokens || 0) + (log.output_tokens || 0);

    switch (type) {
        case 'response':
            return tokens > 0 ? `${formatTokens(tokens)} tokens used` : 'Response received';
        case 'start':
            return 'Session started';
        case 'stop':
            return 'Session ended';
        case 'commit':
            return log.summary || 'Code committed';
        case 'sync':
            return 'Credentials synced';
        case 'error':
            return log.summary || 'Error occurred';
        case 'alert':
            return log.summary || 'Alert triggered';
        default:
            return log.summary || type || 'Activity';
    }
}

function formatLogTime(isoString) {
    if (!isoString) return '--:--';
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: CONFIG.timezone,
    });
}

function updateLogsSummary(aggregates) {
    const eventCountEl = document.getElementById('logs-event-count');
    const totalTokensEl = document.getElementById('logs-total-tokens');
    const projectCountEl = document.getElementById('logs-project-count');
    const agentCountEl = document.getElementById('logs-agent-count');

    if (aggregates) {
        if (eventCountEl) eventCountEl.textContent = aggregates.total_events || 0;
        if (totalTokensEl) totalTokensEl.textContent = formatTokens(aggregates.total_tokens || 0);
    } else {
        if (eventCountEl) eventCountEl.textContent = logsData.length;
        const totalTokens = logsData.reduce((sum, log) =>
            sum + (log.input_tokens || 0) + (log.output_tokens || 0), 0);
        if (totalTokensEl) totalTokensEl.textContent = formatTokens(totalTokens);
    }

    const projects = new Set(logsData.map(l => l.project).filter(Boolean));
    if (projectCountEl) projectCountEl.textContent = projects.size;

    const agents = new Set(logsData.map(l => l.agent_id).filter(Boolean));
    if (agentCountEl) agentCountEl.textContent = agents.size;
}

function updateLogsFiltersFromAPI(filters) {
    // Populate project filter from API
    const projectSelect = document.getElementById('logs-filter-project');
    if (projectSelect && filters?.projects) {
        const currentValue = projectSelect.value;
        const options = ['<option value="">All</option>'];
        filters.projects.forEach(p => {
            options.push(`<option value="${p}" ${p === currentValue ? 'selected' : ''}>${p}</option>`);
        });
        projectSelect.innerHTML = options.join('');
    }

    // Populate agent filter from API
    const agentSelect = document.getElementById('logs-filter-agent');
    if (agentSelect && filters?.agents) {
        const currentValue = agentSelect.value;
        const options = ['<option value="">All</option>'];
        filters.agents.forEach(a => {
            options.push(`<option value="${a}" ${a === currentValue ? 'selected' : ''}>${a}</option>`);
        });
        agentSelect.innerHTML = options.join('');
    }
}

function toggleLogsPause() {
    logsPaused = !logsPaused;
    const btn = document.getElementById('logs-pause-btn');
    const indicator = document.getElementById('logs-live-indicator');

    if (btn) {
        btn.textContent = logsPaused ? '[ ▶ resume ]' : '[ ⏸ pause ]';
        btn.classList.toggle('paused', logsPaused);
    }

    if (indicator) {
        indicator.textContent = logsPaused ? 'PAUSED' : 'LIVE';
        indicator.classList.toggle('paused', logsPaused);
    }

    // Stop/start auto-refresh based on pause state
    if (logsPaused) {
        stopLogsAutoRefresh();
    } else {
        startLogsAutoRefresh();
    }
}

function startLogsAutoRefresh() {
    if (logsRefreshInterval) return;
    logsRefreshInterval = setInterval(() => {
        if (!logsPaused) {
            fetchLogs();
        }
    }, LOGS_REFRESH_MS);
}

function stopLogsAutoRefresh() {
    if (logsRefreshInterval) {
        clearInterval(logsRefreshInterval);
        logsRefreshInterval = null;
    }
}

function showLogsNotification(count) {
    // Remove existing notification
    const existing = document.querySelector('.logs-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = 'logs-notification';
    notification.innerHTML = `<span>↑ ${count} new log${count > 1 ? 's' : ''}</span>`;
    notification.onclick = () => {
        notification.remove();
        // Scroll to top of logs
        const stream = document.getElementById('logs-stream');
        if (stream) stream.scrollTop = 0;
    };

    const streamSection = document.querySelector('.logs-stream-section');
    if (streamSection) {
        streamSection.insertBefore(notification, streamSection.querySelector('.logs-stream'));
    }

    // Auto-dismiss after 5 seconds
    setTimeout(() => notification.remove(), 5000);
}

function loadMoreLogs() {
    fetchLogs(true);
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keyboard shortcut for search
document.addEventListener('keydown', (e) => {
    // Ctrl+F or Cmd+F when on logs tab
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        const logsTab = document.getElementById('tab-logs');
        if (logsTab && logsTab.classList.contains('active')) {
            e.preventDefault();
            const searchInput = document.getElementById('logs-search');
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
        }
    }
});

// =============================================================================
// Tab Switching
// =============================================================================

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });

    // Fetch data when switching tabs
    if (tabName === 'agents') {
        fetchAgentsData();
        stopLogsAutoRefresh();
    } else if (tabName === 'logs') {
        fetchLogs();
        if (!logsPaused) startLogsAutoRefresh();
    } else {
        stopLogsAutoRefresh();
    }

    // Update URL hash for bookmarking
    window.location.hash = tabName;
}

// =============================================================================
// Agents Data Fetching
// =============================================================================

async function fetchAgentsList() {
    if (CONFIG.localMode) return [];

    try {
        const response = await fetch(`${CONFIG.workerUrl}/api/agents`);
        if (!response.ok) return [];
        const result = await response.json();
        return result.data || [];
    } catch (error) {
        console.error('Failed to fetch agents list:', error);
        return [];
    }
}

async function fetchAgentsSummary(range = '7d') {
    if (CONFIG.localMode) {
        return { agents: [], totals: { agent_count: 0, total_input: 0, total_output: 0, message_count: 0 } };
    }

    try {
        const response = await fetch(`${CONFIG.workerUrl}/api/agents/summary?range=${range}`);
        if (!response.ok) {
            return { agents: [], totals: { agent_count: 0, total_input: 0, total_output: 0, message_count: 0 } };
        }
        const result = await response.json();
        return result.data || { agents: [], totals: {} };
    } catch (error) {
        console.error('Failed to fetch agents summary:', error);
        return { agents: [], totals: { agent_count: 0, total_input: 0, total_output: 0, message_count: 0 } };
    }
}

// Store current agents data for detail view
let currentAgentsData = [];

async function fetchAgentsDetails(range = '7d') {
    if (CONFIG.localMode) {
        return { agents: [], totals: {} };
    }

    try {
        const response = await fetch(`${CONFIG.workerUrl}/api/agents/details?range=${range}`);
        if (!response.ok) return { agents: [], totals: {} };
        const result = await response.json();
        return result.data || { agents: [], totals: {} };
    } catch (error) {
        console.error('Failed to fetch agents details:', error);
        return { agents: [], totals: {} };
    }
}

async function fetchAgentsData() {
    const range = document.getElementById('agents-range')?.value || '7d';

    const [agentsDetails, summary] = await Promise.all([
        fetchAgentsDetails(range),
        fetchAgentsSummary(range),
    ]);

    const agents = agentsDetails.agents || [];
    const totals = agentsDetails.totals || {};

    currentAgentsData = agents;
    updateFleetStats(totals);
    renderAgentGrid(agents);
    updateAgentsPieChart(summary.agents);
}

// =============================================================================
// Agents UI Updates
// =============================================================================

function updateFleetStats(totals) {
    const countEl = document.getElementById('fleet-agent-count');
    const tokensEl = document.getElementById('fleet-total-tokens');
    const costEl = document.getElementById('fleet-total-cost');
    const timeEl = document.getElementById('fleet-total-time');

    if (countEl) countEl.textContent = totals.agent_count || 0;
    if (tokensEl) tokensEl.textContent = formatTokens(totals.total_tokens || 0);
    if (costEl) costEl.textContent = `$${(totals.total_cost || 0).toFixed(2)}`;
    if (timeEl) timeEl.textContent = totals.duration_formatted || '0s';
}

function getAgentStatusClass(agent) {
    const lastSeen = new Date(agent.last_seen);
    const now = new Date();
    const diffMinutes = (now - lastSeen) / (1000 * 60);

    if (diffMinutes < 5) return 'status-active';
    if (diffMinutes < 60) return 'status-idle';
    return 'status-inactive';
}

function getAgentStatusLabel(agent) {
    const lastSeen = new Date(agent.last_seen);
    const now = new Date();
    const diffMinutes = (now - lastSeen) / (1000 * 60);

    if (diffMinutes < 5) return 'ACTIVE';
    if (diffMinutes < 60) return 'IDLE';
    return 'INACTIVE';
}

function formatTimeAgo(isoString) {
    if (!isoString) return 'Never';

    const date = new Date(isoString);
    const now = new Date();
    const diffSeconds = Math.floor((now - date) / 1000);

    if (diffSeconds < 60) return 'Just now';
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
    return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function renderAgentGrid(agents) {
    const grid = document.getElementById('agents-grid');
    if (!grid) return;

    if (!agents || agents.length === 0) {
        grid.innerHTML = '<div class="agent-empty">No agents connected yet. Run \'claude-sandbox\' to spawn an agent.</div>';
        return;
    }

    grid.innerHTML = agents.map((agent, idx) => {
        // Support both old and new data formats
        const agentId = agent.id || agent.agent_id;
        const status = agent.status || 'inactive';
        const statusClass = `status-${status}`;
        const statusLabel = status.toUpperCase();
        const totalTokens = agent.tokens?.total || (agent.total_input_tokens || 0) + (agent.total_output_tokens || 0);
        const linesAdded = agent.lines?.added || agent.total_lines_added || 0;
        const linesRemoved = agent.lines?.removed || agent.total_lines_removed || 0;
        const durationMs = agent.duration_ms || agent.total_duration_ms || 0;
        const projects = agent.projects || [agent.project || 'unknown'];

        // Calculate velocity (lines changed per hour)
        const durationHours = durationMs / (1000 * 60 * 60);
        const totalLines = linesAdded + linesRemoved;
        const velocity = durationHours > 0 ? Math.round(totalLines / durationHours) : 0;

        return `
            <div class="agent-card ${statusClass}" onclick="showAgentDetail(${idx})">
                <div class="agent-header">
                    <span class="agent-id">${agentId}</span>
                    <span class="agent-status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="agent-project">${projects[0]}</div>
                <div class="agent-stats">
                    <div class="agent-stat">
                        <span class="stat-label">TOKENS</span>
                        <span class="stat-value">${formatTokens(totalTokens)}</span>
                    </div>
                    <div class="agent-stat">
                        <span class="stat-label">COST</span>
                        <span class="stat-value">$${(agent.cost || 0).toFixed(2)}</span>
                    </div>
                    <div class="agent-stat">
                        <span class="stat-label">TIME</span>
                        <span class="stat-value">${agent.duration_formatted || '0s'}</span>
                    </div>
                </div>
                <div class="agent-meta">
                    <span class="agent-lines">
                        <span class="lines-added">+${linesAdded}</span>
                        <span class="lines-removed">-${linesRemoved}</span>
                    </span>
                    <span class="agent-velocity">${velocity} Δ/hr</span>
                </div>
                <div class="agent-footer">
                    <span class="agent-last-seen">Last seen: ${formatTimeAgo(agent.last_seen)}</span>
                </div>
            </div>
        `;
    }).join('');
}

function showAgentDetail(idx) {
    const agent = currentAgentsData[idx];
    if (!agent) return;

    const detailSection = document.getElementById('agent-detail');
    const nameEl = document.getElementById('agent-detail-name');
    const contentEl = document.getElementById('agent-detail-content');

    if (!detailSection || !contentEl) return;

    const agentId = agent.id || agent.agent_id;
    nameEl.textContent = agentId;

    contentEl.innerHTML = `
        <div class="agent-detail-grid">
            <div class="agent-detail-stat">
                <div class="stat-value">${formatTokens(agent.tokens?.input || 0)}</div>
                <div class="stat-label">Input Tokens</div>
            </div>
            <div class="agent-detail-stat">
                <div class="stat-value">${formatTokens(agent.tokens?.output || 0)}</div>
                <div class="stat-label">Output Tokens</div>
            </div>
            <div class="agent-detail-stat">
                <div class="stat-value">$${(agent.cost || 0).toFixed(2)}</div>
                <div class="stat-label">Cost</div>
            </div>
            <div class="agent-detail-stat">
                <div class="stat-value">${agent.duration_formatted || '0s'}</div>
                <div class="stat-label">Claude Time</div>
            </div>
            <div class="agent-detail-stat">
                <div class="stat-value">+${agent.lines?.added || 0}</div>
                <div class="stat-label">Lines Added</div>
            </div>
            <div class="agent-detail-stat">
                <div class="stat-value">-${agent.lines?.removed || 0}</div>
                <div class="stat-label">Lines Removed</div>
            </div>
            <div class="agent-detail-stat">
                <div class="stat-value">${agent.sessions || 0}</div>
                <div class="stat-label">Sessions</div>
            </div>
            <div class="agent-detail-stat">
                <div class="stat-value">${agent.messages || 0}</div>
                <div class="stat-label">Messages</div>
            </div>
        </div>
        <div class="agent-projects-list">
            <div class="label">PROJECTS:</div>
            <div class="projects">
                ${(agent.projects || []).map(p => `<span class="project-tag">${p}</span>`).join('')}
            </div>
        </div>
    `;

    detailSection.style.display = 'block';
    detailSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeAgentDetail() {
    const detailSection = document.getElementById('agent-detail');
    if (detailSection) {
        detailSection.style.display = 'none';
    }
}

// =============================================================================
// Agents Pie Chart
// =============================================================================

let agentsPieChart = null;

function initAgentsPieChart() {
    const ctx = document.getElementById('agents-pie');
    if (!ctx) return;

    agentsPieChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: PROJECT_COLORS,
                borderColor: '#1A1A1A',
                borderWidth: 2,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'right',
                    labels: {
                        color: '#808080',
                        font: { family: 'monospace', size: 11 },
                        boxWidth: 12,
                    },
                },
                tooltip: {
                    backgroundColor: '#1A1A1A',
                    titleColor: '#E07A3E',
                    bodyColor: '#E0E0E0',
                    borderColor: '#E07A3E',
                    borderWidth: 1,
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.raw / total) * 100).toFixed(1);
                            return `${formatTokens(ctx.raw)} tokens (${pct}%)`;
                        },
                    },
                },
            },
        },
    });
}

function updateAgentsPieChart(agents) {
    if (!agentsPieChart) return;

    const legend = document.getElementById('agents-legend');

    if (!agents || agents.length === 0) {
        agentsPieChart.data.labels = [];
        agentsPieChart.data.datasets[0].data = [];
        agentsPieChart.update('none');
        if (legend) {
            legend.innerHTML = '<div class="legend-empty">No agent data yet</div>';
        }
        return;
    }

    // Calculate total tokens per agent
    const agentData = agents.map(a => ({
        id: a.agent_id,
        tokens: (a.total_input || 0) + (a.total_output || 0),
    })).filter(a => a.tokens > 0);

    agentsPieChart.data.labels = agentData.map(a => a.id);
    agentsPieChart.data.datasets[0].data = agentData.map(a => a.tokens);
    agentsPieChart.update('none');

    // Update legend
    if (legend) {
        const total = agentData.reduce((sum, a) => sum + a.tokens, 0);
        legend.innerHTML = agentData.map((a, i) => {
            const pct = total > 0 ? ((a.tokens / total) * 100).toFixed(1) : '0.0';
            const color = PROJECT_COLORS[i % PROJECT_COLORS.length];
            return `
                <div class="legend-item">
                    <span class="legend-color" style="background: ${color}"></span>
                    <span class="legend-label">${a.id}</span>
                    <span class="legend-value">${formatTokens(a.tokens)}</span>
                    <span class="legend-pct">${pct}%</span>
                </div>
            `;
        }).join('');
    }
}

// =============================================================================
// Main
// =============================================================================

let countdownInterval = null;
let latestData = null;

async function fetchData() {
    console.log('Fetching usage data...');

    try {
        // Fetch current usage, history, projects, and costs in parallel
        const range = document.getElementById('history-range')?.value || '7d';
        const projectsRange = document.getElementById('projects-range')?.value || '7d';
        const projectionMode = document.getElementById('projection-mode')?.value || 'none';

        const [currentUsage, history, projectsDetails, costs] = await Promise.all([
            fetchCurrentUsage(),
            fetchUsageHistory(range),
            fetchProjectsDetails(projectsRange),
            fetchCostsSummary(),
        ]);

        if (!currentUsage && history.length === 0) {
            showError('No data yet');
            return;
        }

        // Use current usage if available, fall back to latest history entry
        latestData = currentUsage || history[history.length - 1];

        // Update UI
        const fiveHour = latestData.five_hour || {};
        const sevenDay = latestData.seven_day || {};

        updateProgressBar('five-hour', fiveHour.utilization);
        updateProgressBar('seven-day', sevenDay.utilization);

        updateCountdown('five-hour', fiveHour.resets_at, fiveHour.utilization);
        updateCountdown('seven-day', sevenDay.resets_at, sevenDay.utilization);

        // Use idle quip if 5-hour is at 0%
        const isIdle = !fiveHour.resets_at || fiveHour.utilization === 0;
        updateQuip(fiveHour.utilization, isIdle);
        updateLastUpdated(latestData.timestamp);

        // Update chart with projections
        updateChartWithProjection(history, range, projectionMode);

        // Update projects tab
        const projects = projectsDetails.projects || [];
        const totals = projectsDetails.totals || {};
        updateProjectsPieChart(projects);
        updateProjectsOverview(totals);
        updateProjectsTable(projects);
        updateProjectsQuip();

        // Update agents tab
        await fetchAgentsData();
        updateAgentsQuip();

        // Update cost estimates (using actual costs from hooks)
        updateCostEstimates(costs);

        // Reset action button to REFRESH on success
        resetActionButton();

        console.log('Data updated successfully');
    } catch (error) {
        console.error('Failed to fetch data:', error);
        showError(error.message);
    }
}

function startCountdownTimer() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }

    countdownInterval = setInterval(() => {
        if (latestData) {
            updateCountdown('five-hour', latestData.five_hour?.resets_at, latestData.five_hour?.utilization);
            updateCountdown('seven-day', latestData.seven_day?.resets_at, latestData.seven_day?.utilization);
        }
    }, 1000);
}

function init() {
    console.log('Initializing Claude Usage Terminal...');

    // Check for config in URL params (for easy setup)
    const params = new URLSearchParams(window.location.search);

    // Worker URL - required for production
    if (params.get('worker')) {
        CONFIG.workerUrl = params.get('worker');
    } else {
        // Default worker URL
        CONFIG.workerUrl = 'https://claude-watch.trevorju32.workers.dev';
    }

    // Local mode for testing
    if (params.get('local') === 'true') {
        CONFIG.localMode = true;
        console.log('Local mode enabled - fetching from local files');
    }

    console.log(`Worker URL: ${CONFIG.workerUrl}`);

    // Initialize charts
    initChart();
    initProjectsPieChart();
    initAgentsPieChart();

    // Start countdown timer
    startCountdownTimer();

    // Fetch initial data
    fetchData();

    // Set up auto-refresh
    setInterval(fetchData, CONFIG.refreshInterval);

    // Handle URL hash for tab switching
    const hash = window.location.hash.replace('#', '');
    if (hash === 'agents' || hash === 'logs') {
        switchTab(hash);
    }

    // History range select handler
    const rangeSelect = document.getElementById('history-range');
    if (rangeSelect) {
        rangeSelect.addEventListener('change', async () => {
            try {
                const projectionMode = document.getElementById('projection-mode')?.value || 'none';
                const history = await fetchUsageHistory(rangeSelect.value);
                updateChartWithProjection(history, rangeSelect.value, projectionMode);
            } catch (error) {
                console.error('Failed to update chart:', error);
            }
        });
    }

    // Projection mode handler
    const projectionSelect = document.getElementById('projection-mode');
    if (projectionSelect) {
        projectionSelect.addEventListener('change', async () => {
            try {
                const range = document.getElementById('history-range')?.value || '7d';
                const history = await fetchUsageHistory(range);
                updateChartWithProjection(history, range, projectionSelect.value);
            } catch (error) {
                console.error('Failed to update projection:', error);
            }
        });
    }

    // Timezone select handler
    const timezoneSelect = document.getElementById('timezone-select');
    if (timezoneSelect) {
        timezoneSelect.addEventListener('change', () => {
            CONFIG.timezone = timezoneSelect.value;
            // Refresh all data with new timezone
            fetchData();
        });
    }

    // Plan select handler for savings comparison
    const planSelect = document.getElementById('plan-select');
    if (planSelect) {
        planSelect.addEventListener('change', updateSavings);
    }

    // Projects range select handler
    const projectsRangeSelect = document.getElementById('projects-range');
    if (projectsRangeSelect) {
        projectsRangeSelect.addEventListener('change', async () => {
            try {
                const projectsDetails = await fetchProjectsDetails(projectsRangeSelect.value);
                const projects = projectsDetails.projects || [];
                const totals = projectsDetails.totals || {};
                updateProjectsPieChart(projects);
                updateProjectsOverview(totals);
                updateProjectsTable(projects);
                closeProjectDetail(); // Hide detail when range changes
            } catch (error) {
                console.error('Failed to update projects:', error);
            }
        });
    }

    // Agents range select handler
    const agentsRangeSelect = document.getElementById('agents-range');
    if (agentsRangeSelect) {
        agentsRangeSelect.addEventListener('change', async () => {
            try {
                const [agentsDetails, summary] = await Promise.all([
                    fetchAgentsDetails(agentsRangeSelect.value),
                    fetchAgentsSummary(agentsRangeSelect.value),
                ]);
                const agents = agentsDetails.agents || [];
                const totals = agentsDetails.totals || {};
                currentAgentsData = agents;
                updateFleetStats(totals);
                renderAgentGrid(agents);
                updateAgentsPieChart(summary.agents);
                closeAgentDetail(); // Hide detail when range changes
            } catch (error) {
                console.error('Failed to update agents:', error);
            }
        });
    }

    // Logs filter handlers
    const logsFilterProject = document.getElementById('logs-filter-project');
    const logsFilterAgent = document.getElementById('logs-filter-agent');
    const logsFilterType = document.getElementById('logs-filter-type');
    const logsFilterRange = document.getElementById('logs-filter-range');
    const logsSearch = document.getElementById('logs-search');

    [logsFilterProject, logsFilterAgent, logsFilterType, logsFilterRange].forEach(el => {
        if (el) {
            el.addEventListener('change', () => fetchLogs());
        }
    });

    // Debounced search
    let searchTimeout;
    if (logsSearch) {
        logsSearch.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                renderLogs(); // Re-render with search highlighting
            }, 200);
        });
        logsSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                fetchLogs(); // Full fetch on Enter
            }
        });
    }

    console.log('Terminal initialized.');
}

// Start the app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
