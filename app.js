/**
 * Claude Usage Terminal - Dashboard Logic
 * Fetches usage data and renders the terminal interface
 */

// =============================================================================
// Configuration
// =============================================================================

// Update this to your GitHub username and repo name
const CONFIG = {
    // GitHub raw URL for data branch
    // Format: https://raw.githubusercontent.com/{user}/{repo}/data/{file}
    dataBaseUrl: '', // Set during init
    githubUser: 'teajuw',
    githubRepo: 'claude-watch',
    refreshInterval: 60000, // 1 minute
    localMode: false, // Set via ?local=true for testing
};

// =============================================================================
// Quips - Because life's too short for boring dashboards
// =============================================================================

const QUIPS = {
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

function getQuip(utilization) {
    let category;
    if (utilization === null || utilization === undefined) {
        category = 'loading';
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

function formatResetTime(resetDate) {
    if (!resetDate) return '';

    // Format in PST
    const options = {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Los_Angeles',
    };
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

async function fetchUsageHistory() {
    let url;
    if (CONFIG.localMode) {
        url = `./usage-history.json?t=${Date.now()}`;
    } else {
        url = `https://raw.githubusercontent.com/${CONFIG.githubUser}/${CONFIG.githubRepo}/data/usage-history.json?t=${Date.now()}`;
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch usage history: ${response.status}`);
    }
    return response.json();
}

async function fetchState() {
    let url;
    if (CONFIG.localMode) {
        url = `./state.json?t=${Date.now()}`;
    } else {
        url = `https://raw.githubusercontent.com/${CONFIG.githubUser}/${CONFIG.githubRepo}/data/state.json?t=${Date.now()}`;
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch state: ${response.status}`);
    }
    return response.json();
}

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

function updateCountdown(prefix, resetAt) {
    const countdownEl = document.getElementById(`${prefix}-countdown`);
    const resetTimeEl = document.getElementById(`${prefix}-reset-time`);

    if (!countdownEl) return;

    const resetDate = parseResetTime(resetAt);
    countdownEl.textContent = formatCountdown(resetDate);

    if (resetTimeEl) {
        resetTimeEl.textContent = formatResetTime(resetDate);
    }
}

function updateQuip(utilization) {
    const quipEl = document.getElementById('quip');
    if (quipEl) {
        quipEl.textContent = getQuip(utilization);
    }
}

function updateLastUpdated(timestamp) {
    const el = document.getElementById('last-updated');
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

function updateChart(history, range) {
    if (!historyChart || !history || history.length === 0) return;

    // Filter by range
    const now = new Date();
    let cutoff;
    switch (range) {
        case '24h':
            cutoff = new Date(now - 24 * 60 * 60 * 1000);
            break;
        case '30d':
            cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000);
            break;
        case '7d':
        default:
            cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000);
    }

    const filtered = history.filter((item) => new Date(item.timestamp) >= cutoff);

    // Downsample if too many points
    const maxPoints = 200;
    const step = Math.max(1, Math.floor(filtered.length / maxPoints));
    const sampled = filtered.filter((_, i) => i % step === 0);

    // Update chart data
    historyChart.data.labels = sampled.map((item) => {
        const date = new Date(item.timestamp);
        if (range === '24h') {
            return date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: 'America/Los_Angeles',
            });
        }
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            timeZone: 'America/Los_Angeles',
        });
    });

    historyChart.data.datasets[0].data = sampled.map((item) => item.five_hour?.utilization ?? 0);
    historyChart.data.datasets[1].data = sampled.map((item) => item.seven_day?.utilization ?? 0);

    historyChart.update('none');
}

// =============================================================================
// Main
// =============================================================================

let countdownInterval = null;
let latestData = null;

async function fetchData() {
    console.log('Fetching usage data...');

    try {
        const history = await fetchUsageHistory();

        if (history.length === 0) {
            showError('No data yet');
            return;
        }

        // Get latest entry
        latestData = history[history.length - 1];

        // Update UI
        const fiveHour = latestData.five_hour || {};
        const sevenDay = latestData.seven_day || {};

        updateProgressBar('five-hour', fiveHour.utilization);
        updateProgressBar('seven-day', sevenDay.utilization);

        updateCountdown('five-hour', fiveHour.resets_at);
        updateCountdown('seven-day', sevenDay.resets_at);

        updateQuip(fiveHour.utilization);
        updateLastUpdated(latestData.timestamp);

        // Update chart
        const range = document.getElementById('history-range')?.value || '7d';
        updateChart(history, range);

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
            updateCountdown('five-hour', latestData.five_hour?.resets_at);
            updateCountdown('seven-day', latestData.seven_day?.resets_at);
        }
    }, 1000);
}

function init() {
    console.log('Initializing Claude Usage Terminal...');

    // Check for config in URL params (for easy setup)
    const params = new URLSearchParams(window.location.search);
    if (params.get('user')) {
        CONFIG.githubUser = params.get('user');
    }
    if (params.get('repo')) {
        CONFIG.githubRepo = params.get('repo');
    }
    if (params.get('local') === 'true') {
        CONFIG.localMode = true;
        console.log('Local mode enabled - fetching from local files');
    }

    // Initialize chart
    initChart();

    // Start countdown timer
    startCountdownTimer();

    // Fetch initial data
    fetchData();

    // Set up auto-refresh
    setInterval(fetchData, CONFIG.refreshInterval);

    // Range select handler
    const rangeSelect = document.getElementById('history-range');
    if (rangeSelect) {
        rangeSelect.addEventListener('change', async () => {
            try {
                const history = await fetchUsageHistory();
                updateChart(history, rangeSelect.value);
            } catch (error) {
                console.error('Failed to update chart:', error);
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
