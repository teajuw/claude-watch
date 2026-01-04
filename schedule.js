/**
 * Claude Watch - Schedule Page
 * 24-hour timeline for scheduling Claude sessions
 */

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
    workerUrl: '', // Set during init
    maxSessions: 4,
    sessionDurationHours: 5,
};

// =============================================================================
// State
// =============================================================================

let sessions = [];
let reminderMinutes = 15;
let editingSessionId = null;

// =============================================================================
// Utilities
// =============================================================================

function generateId() {
    return Math.random().toString(36).substring(2, 10);
}

function formatHour(hour) {
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}${suffix}`;
}

function formatTime(hour, minute = 0) {
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    const displayMinute = minute.toString().padStart(2, '0');
    return `${displayHour}:${displayMinute} ${suffix}`;
}

function getEndHour(startHour) {
    return (startHour + CONFIG.sessionDurationHours) % 24;
}

// =============================================================================
// Timeline Rendering
// =============================================================================

function renderTimeline() {
    const timeline = document.getElementById('timeline');
    const hoursContainer = document.getElementById('timeline-hours');

    if (!timeline || !hoursContainer) return;

    // Clear existing content
    timeline.innerHTML = '';
    hoursContainer.innerHTML = '';

    // Create hour segments (24 hours)
    for (let hour = 0; hour < 24; hour++) {
        // Hour segment (clickable)
        const segment = document.createElement('div');
        segment.className = 'timeline-segment';
        segment.dataset.hour = hour;
        segment.onclick = () => openModal(hour);
        timeline.appendChild(segment);

        // Hour label
        const label = document.createElement('div');
        label.className = 'timeline-hour-label';
        label.textContent = formatHour(hour);
        hoursContainer.appendChild(label);
    }

    // Render sessions on timeline
    renderSessionBlocks();
}

function renderSessionBlocks() {
    const container = document.getElementById('timeline-sessions');
    if (!container) return;

    container.innerHTML = '';

    sessions.forEach(session => {
        if (!session.enabled) return;

        const block = document.createElement('div');
        block.className = 'session-block';

        // Calculate position (each hour is 100/24 = 4.167% of width)
        const startPercent = ((session.start_hour + (session.start_minute || 0) / 60) / 24) * 100;
        const widthPercent = (CONFIG.sessionDurationHours / 24) * 100;

        block.style.left = `${startPercent}%`;
        block.style.width = `${widthPercent}%`;

        block.innerHTML = `
            <span class="session-block-label">${session.label || formatTime(session.start_hour, session.start_minute)}</span>
        `;

        block.onclick = (e) => {
            e.stopPropagation();
            openModal(session.start_hour, session);
        };

        container.appendChild(block);
    });
}

// =============================================================================
// Sessions List Rendering
// =============================================================================

function renderSessionsList() {
    const list = document.getElementById('session-list');
    const countEl = document.getElementById('session-count');

    if (!list) return;

    // Update count
    if (countEl) {
        countEl.textContent = sessions.length;
    }

    // Empty state
    if (sessions.length === 0) {
        list.innerHTML = '<div class="no-sessions">No sessions scheduled. Click on the timeline to add one.</div>';
        return;
    }

    // Sort by start time
    const sorted = [...sessions].sort((a, b) => {
        const aTime = a.start_hour * 60 + (a.start_minute || 0);
        const bTime = b.start_hour * 60 + (b.start_minute || 0);
        return aTime - bTime;
    });

    list.innerHTML = sorted.map(session => {
        const startTime = formatTime(session.start_hour, session.start_minute);
        const endHour = getEndHour(session.start_hour);
        const endTime = formatTime(endHour, session.start_minute);

        return `
            <div class="session-item ${session.enabled ? '' : 'disabled'}">
                <div class="session-time">
                    <span class="session-start">${startTime}</span>
                    <span class="session-arrow">→</span>
                    <span class="session-end">${endTime}</span>
                </div>
                <div class="session-label">${session.label || 'Untitled session'}</div>
                <div class="session-actions">
                    <button class="action-btn small" onclick="openModal(${session.start_hour}, getSessionById('${session.id}'))">[ EDIT ]</button>
                    <button class="action-btn small" onclick="toggleSession('${session.id}')">${session.enabled ? '[ DISABLE ]' : '[ ENABLE ]'}</button>
                </div>
            </div>
        `;
    }).join('');
}

function getSessionById(id) {
    return sessions.find(s => s.id === id);
}

function toggleSession(id) {
    const session = getSessionById(id);
    if (session) {
        session.enabled = !session.enabled;
        renderSessionBlocks();
        renderSessionsList();
    }
}

// =============================================================================
// Modal
// =============================================================================

function openModal(hour, existingSession = null) {
    const modal = document.getElementById('session-modal');
    const titleEl = document.getElementById('modal-title');
    const hourSelect = document.getElementById('session-hour');
    const minuteSelect = document.getElementById('session-minute');
    const labelInput = document.getElementById('session-label');
    const deleteBtn = document.getElementById('delete-session-btn');
    const endTimeEl = document.getElementById('session-end-time');

    if (!modal) return;

    // Check if we can add more sessions
    if (!existingSession && sessions.length >= CONFIG.maxSessions) {
        alert(`Maximum ${CONFIG.maxSessions} sessions allowed. Delete one to add another.`);
        return;
    }

    // Populate hour select if empty
    if (hourSelect.options.length === 0) {
        for (let h = 0; h < 24; h++) {
            const opt = document.createElement('option');
            opt.value = h;
            opt.textContent = formatHour(h);
            hourSelect.appendChild(opt);
        }
    }

    // Set values
    if (existingSession) {
        titleEl.textContent = 'Edit Session';
        hourSelect.value = existingSession.start_hour;
        minuteSelect.value = existingSession.start_minute || 0;
        labelInput.value = existingSession.label || '';
        editingSessionId = existingSession.id;
        deleteBtn.classList.remove('hidden');
    } else {
        titleEl.textContent = 'Add Session';
        hourSelect.value = hour;
        minuteSelect.value = 0;
        labelInput.value = '';
        editingSessionId = null;
        deleteBtn.classList.add('hidden');
    }

    // Update end time display
    updateEndTimeDisplay();

    // Add change listeners for end time
    hourSelect.onchange = updateEndTimeDisplay;
    minuteSelect.onchange = updateEndTimeDisplay;

    // Show modal
    modal.classList.remove('hidden');
}

function updateEndTimeDisplay() {
    const hourSelect = document.getElementById('session-hour');
    const minuteSelect = document.getElementById('session-minute');
    const endTimeEl = document.getElementById('session-end-time');

    if (!hourSelect || !minuteSelect || !endTimeEl) return;

    const startHour = parseInt(hourSelect.value);
    const startMinute = parseInt(minuteSelect.value);
    const endHour = getEndHour(startHour);

    endTimeEl.textContent = `${formatTime(endHour, startMinute)} PST`;
}

function closeModal() {
    const modal = document.getElementById('session-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    editingSessionId = null;
}

function saveSession() {
    const hourSelect = document.getElementById('session-hour');
    const minuteSelect = document.getElementById('session-minute');
    const labelInput = document.getElementById('session-label');

    const startHour = parseInt(hourSelect.value);
    const startMinute = parseInt(minuteSelect.value);
    const label = labelInput.value.trim();

    if (editingSessionId) {
        // Update existing session
        const session = getSessionById(editingSessionId);
        if (session) {
            session.start_hour = startHour;
            session.start_minute = startMinute;
            session.label = label;
        }
    } else {
        // Add new session
        sessions.push({
            id: generateId(),
            start_hour: startHour,
            start_minute: startMinute,
            label: label,
            enabled: true,
        });
    }

    closeModal();
    renderTimeline();
    renderSessionsList();
}

function deleteSession() {
    if (editingSessionId) {
        sessions = sessions.filter(s => s.id !== editingSessionId);
        closeModal();
        renderTimeline();
        renderSessionsList();
    }
}

// =============================================================================
// API
// =============================================================================

async function loadSchedule() {
    if (!CONFIG.workerUrl || CONFIG.workerUrl.includes('YOUR_SUBDOMAIN')) {
        console.log('Worker URL not configured, using empty schedule');
        renderTimeline();
        renderSessionsList();
        return;
    }

    try {
        const response = await fetch(`${CONFIG.workerUrl}/api/schedule`);
        if (!response.ok) {
            throw new Error(`Failed to load schedule: ${response.status}`);
        }

        const result = await response.json();
        if (result.success) {
            sessions = result.data.sessions || [];
            reminderMinutes = result.data.reminder_minutes || 15;

            // Update reminder select
            const reminderSelect = document.getElementById('reminder-minutes');
            if (reminderSelect) {
                reminderSelect.value = reminderMinutes;
            }
        }
    } catch (error) {
        console.error('Failed to load schedule:', error);
    }

    renderTimeline();
    renderSessionsList();
}

async function saveSchedule() {
    const statusEl = document.getElementById('save-status');
    const reminderSelect = document.getElementById('reminder-minutes');

    if (!CONFIG.workerUrl || CONFIG.workerUrl.includes('YOUR_SUBDOMAIN')) {
        if (statusEl) {
            statusEl.textContent = 'Worker URL not configured';
            statusEl.className = 'label error';
        }
        return;
    }

    if (statusEl) {
        statusEl.textContent = 'Saving...';
        statusEl.className = 'label';
    }

    try {
        const response = await fetch(`${CONFIG.workerUrl}/api/schedule`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sessions: sessions,
                reminder_minutes: parseInt(reminderSelect?.value || 15),
            }),
        });

        const result = await response.json();

        if (result.success) {
            if (statusEl) {
                statusEl.textContent = 'Saved!';
                statusEl.className = 'label success';
                setTimeout(() => {
                    statusEl.textContent = '';
                }, 3000);
            }
        } else {
            throw new Error(result.error || 'Save failed');
        }
    } catch (error) {
        console.error('Failed to save schedule:', error);
        if (statusEl) {
            statusEl.textContent = `Error: ${error.message}`;
            statusEl.className = 'label error';
        }
    }
}

// =============================================================================
// Init
// =============================================================================

function init() {
    console.log('Initializing Schedule page...');

    // Check for config in URL params
    const params = new URLSearchParams(window.location.search);

    if (params.get('worker')) {
        CONFIG.workerUrl = params.get('worker');
    } else {
        // Default worker URL
        CONFIG.workerUrl = 'https://claude-watch.trevorju32.workers.dev';
    }

    console.log(`Worker URL: ${CONFIG.workerUrl}`);

    // Load schedule from API
    loadSchedule();

    // Close modal on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });

    // Close modal on backdrop click
    const modal = document.getElementById('session-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
    }

    console.log('Schedule page initialized.');
}

// Start the app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
