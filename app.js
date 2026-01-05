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

function formatResetTime(resetDate, includeWeekday = false) {
    if (!resetDate) return '';

    // Format in PST
    const options = {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Los_Angeles',
    };

    // Add weekday for 7-day reset
    if (includeWeekday) {
        options.weekday = 'short';
    }

    return `(${resetDate.toLocaleString('en-US', options)} PST)`;
}

function formatTimestamp(isoString) {
    const date = new Date(isoString);
    const options = {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Los_Angeles',
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

    // Map 5h to 24h for API (we filter client-side to the window)
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

function updateLastUpdated(timestamp) {
    const el = document.getElementById('last-updated-nav');
    if (el && timestamp) {
        el.textContent = formatTimestamp(timestamp);
    }
}

function showError(message) {
    const quipEl = document.getElementById('quip');
    if (quipEl) {
        quipEl.textContent = `${getErrorQuip()} (${message})`;
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
                        maxTicksLimit: 8,
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
        timeZone: 'America/Los_Angeles',
    });
}

// Format date as "Mon 1/5"
function formatDayDate(date) {
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'numeric',
        day: 'numeric',
        timeZone: 'America/Los_Angeles',
    });
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

    let windowStart, windowEnd, isHourly;

    if (range === '5h') {
        // 5-hour window: round to 15 min intervals
        windowStart = roundToNearest15Min(fiveHourStart);
        windowEnd = roundToNearest15Min(fiveHourReset || new Date(now.getTime() + 5 * 60 * 60 * 1000));
        isHourly = true;
    } else {
        // 7-day window
        windowStart = sevenDayStart;
        windowEnd = sevenDayReset || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        isHourly = false;
    }

    // Generate slots for X-axis
    const slots = [];

    if (isHourly) {
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
    } else {
        // 7-day window: create slots for each day
        for (let d = 0; d < 7; d++) {
            const slotTime = new Date(windowStart.getTime() + d * 24 * 60 * 60 * 1000);
            slots.push({
                time: slotTime,
                label: formatDayDate(slotTime),
                fiveHour: null,
                sevenDay: null,
            });
        }
    }

    // Map history data to slots - find closest slot for each data point
    history.forEach(item => {
        const itemTime = new Date(item.timestamp);
        if (itemTime > now) return; // Skip future data

        // Find the best matching slot
        let bestSlot = null;
        let bestDiff = Infinity;

        for (const slot of slots) {
            const diff = Math.abs(itemTime - slot.time);
            // For 5h view, match within 15 min; for 7d view, match within same day
            const threshold = isHourly ? 15 * 60 * 1000 : 12 * 60 * 60 * 1000;
            if (diff < bestDiff && diff < threshold) {
                bestDiff = diff;
                bestSlot = slot;
            }
        }

        if (bestSlot) {
            bestSlot.fiveHour = item.five_hour?.utilization ?? bestSlot.fiveHour;
            bestSlot.sevenDay = item.seven_day?.utilization ?? bestSlot.sevenDay;
        }
    });

    // Mark future slots as null
    slots.forEach(slot => {
        if (slot.time > now) {
            slot.fiveHour = null;
            slot.sevenDay = null;
        }
    });

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
    projectsPieChart.data.labels = projects.map(p => p.project);
    projectsPieChart.data.datasets[0].data = projects.map(p => p.total_tokens);
    projectsPieChart.update('none');

    // Update legend
    if (legend) {
        const total = projects.reduce((sum, p) => sum + p.total_tokens, 0);
        legend.innerHTML = projects.map((p, i) => {
            const pct = ((p.total_tokens / total) * 100).toFixed(1);
            const color = PROJECT_COLORS[i % PROJECT_COLORS.length];
            return `
                <div class="legend-item">
                    <span class="legend-color" style="background: ${color}"></span>
                    <span class="legend-label">${p.project}</span>
                    <span class="legend-value">${formatTokens(p.total_tokens)}</span>
                    <span class="legend-pct">${pct}%</span>
                </div>
            `;
        }).join('');
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

    // Calculate projections
    const fiveHourData = historyChart.data.datasets[0].data;
    const sevenDayData = historyChart.data.datasets[1].data;
    const proLimitData = historyChart.data.datasets[2].data;

    // Find last valid data point for each series
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

    const fiveHourProjected = calculateProjection(fiveHourData, projectionMode, 5);
    const sevenDayProjected = calculateProjection(sevenDayData, projectionMode, 5);

    // Add projected labels
    const projectedLabels = fiveHourProjected.map((_, i) => `+${i + 1}`);

    // Pad actual data with nulls for projection zone
    const paddedFiveHour = [...fiveHourData, ...Array(fiveHourProjected.length).fill(null)];
    const paddedSevenDay = [...sevenDayData, ...Array(sevenDayProjected.length).fill(null)];
    // Extend Pro limit line across projection zone
    const extendedProLimit = [...proLimitData, ...Array(fiveHourProjected.length).fill(PRO_LIMIT_PERCENTAGE)];

    // Create projection data - include last valid point to connect the lines
    const fiveHourProjData = Array(fiveHourData.length + fiveHourProjected.length).fill(null);
    const sevenDayProjData = Array(sevenDayData.length + sevenDayProjected.length).fill(null);

    // Set the last valid actual point to connect the projection line
    if (lastValidFiveHourIdx !== -1) {
        fiveHourProjData[lastValidFiveHourIdx] = fiveHourData[lastValidFiveHourIdx];
    }
    if (lastValidSevenDayIdx !== -1) {
        sevenDayProjData[lastValidSevenDayIdx] = sevenDayData[lastValidSevenDayIdx];
    }

    // Add projected values after actual data
    for (let i = 0; i < fiveHourProjected.length; i++) {
        fiveHourProjData[fiveHourData.length + i] = fiveHourProjected[i];
        sevenDayProjData[sevenDayData.length + i] = sevenDayProjected[i];
    }

    // Update labels
    historyChart.data.labels = [...historyChart.data.labels, ...projectedLabels];

    // Update datasets (0: 5hr, 1: 7day, 2: pro limit)
    historyChart.data.datasets[0].data = paddedFiveHour;
    historyChart.data.datasets[1].data = paddedSevenDay;
    historyChart.data.datasets[2].data = extendedProLimit;

    // Add or update projection datasets (indices 3 and 4)
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

    // Fetch agents data when switching to agents tab
    if (tabName === 'agents') {
        fetchAgentsData();
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

async function fetchAgentsData() {
    const range = document.getElementById('agents-range')?.value || '7d';

    const [agents, summary] = await Promise.all([
        fetchAgentsList(),
        fetchAgentsSummary(range),
    ]);

    updateFleetStats(summary.totals);
    renderAgentGrid(agents);
    updateAgentsPieChart(summary.agents);
}

// =============================================================================
// Agents UI Updates
// =============================================================================

function updateFleetStats(totals) {
    const countEl = document.getElementById('fleet-agent-count');
    const inputEl = document.getElementById('fleet-input-tokens');
    const outputEl = document.getElementById('fleet-output-tokens');
    const messagesEl = document.getElementById('fleet-messages');

    if (countEl) countEl.textContent = totals.agent_count || 0;
    if (inputEl) inputEl.textContent = formatTokens(totals.total_input || 0);
    if (outputEl) outputEl.textContent = formatTokens(totals.total_output || 0);
    if (messagesEl) messagesEl.textContent = totals.message_count || 0;
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

    grid.innerHTML = agents.map(agent => {
        const statusClass = getAgentStatusClass(agent);
        const statusLabel = getAgentStatusLabel(agent);
        const totalTokens = (agent.total_input_tokens || 0) + (agent.total_output_tokens || 0);
        const linesAdded = agent.total_lines_added || 0;
        const linesRemoved = agent.total_lines_removed || 0;

        // Calculate velocity (lines changed per hour based on total_duration_ms)
        const durationHours = (agent.total_duration_ms || 0) / (1000 * 60 * 60);
        const totalLines = linesAdded + linesRemoved;
        const velocity = durationHours > 0 ? Math.round(totalLines / durationHours) : 0;

        return `
            <div class="agent-card ${statusClass}">
                <div class="agent-header">
                    <span class="agent-id">${agent.agent_id}</span>
                    <span class="agent-status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="agent-project">${agent.project || 'unknown'}</div>
                <div class="agent-stats">
                    <div class="agent-stat">
                        <span class="stat-label">IN</span>
                        <span class="stat-value">${formatTokens(agent.total_input_tokens || 0)}</span>
                    </div>
                    <div class="agent-stat">
                        <span class="stat-label">OUT</span>
                        <span class="stat-value">${formatTokens(agent.total_output_tokens || 0)}</span>
                    </div>
                    <div class="agent-stat">
                        <span class="stat-label">TOTAL</span>
                        <span class="stat-value">${formatTokens(totalTokens)}</span>
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

    if (!agents || agents.length === 0) {
        agentsPieChart.data.labels = [];
        agentsPieChart.data.datasets[0].data = [];
        agentsPieChart.update('none');
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

        const [currentUsage, history, projects, costs] = await Promise.all([
            fetchCurrentUsage(),
            fetchUsageHistory(range),
            fetchProjectsSummary(projectsRange),
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

        // Update projects pie chart
        updateProjectsPieChart(projects);

        // Update cost estimates (using actual costs from hooks)
        updateCostEstimates(costs);

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
    if (hash === 'agents') {
        switchTab('agents');
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
                const projects = await fetchProjectsSummary(projectsRangeSelect.value);
                updateProjectsPieChart(projects);
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
                const summary = await fetchAgentsSummary(agentsRangeSelect.value);
                updateFleetStats(summary.totals);
                updateAgentsPieChart(summary.agents);
            } catch (error) {
                console.error('Failed to update agents:', error);
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
