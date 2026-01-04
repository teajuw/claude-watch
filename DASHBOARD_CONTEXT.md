# Claude Usage Dashboard - Implementation Context

Transfer this document to a new Claude instance to continue implementation.

## Project Goal

Build a web dashboard (GitHub Pages) + always-on polling service to track Claude Max subscription usage with:
- Real-time usage gauges (5-hour window + 7-day rolling)
- Reset countdown timers (PST timezone)
- Historical usage graphs
- Telegram notifications at configurable thresholds (e.g., 50%)
- Window scheduling automation ("rate gaming" - send scheduled "hello" to start 5-hour windows at optimal times)

## User Context

- **Subscription:** Claude Max 5x
- **Primary model:** Opus (consumes ~5x faster than Sonnet)
- **Timezone:** PST
- **Existing setup:** Docker-based Claude Code environments with Telegram notifications on task completion

## Key Technical Discovery: Usage API

The `/usage` command in Claude Code CLI pulls from this endpoint:

```
GET https://api.anthropic.com/api/oauth/usage
Headers:
  - Authorization: Bearer <access_token>
  - anthropic-beta: oauth-2025-04-20
  - Accept: application/json
```

**Response format:**
```json
{
  "five_hour": {
    "utilization": 54.0,
    "resets_at": "2026-01-04T00:00:00.055798+00:00"
  },
  "seven_day": {
    "utilization": 6.0,
    "resets_at": "2026-01-08T08:00:00.055815+00:00"
  },
  "seven_day_opus": {
    "utilization": 0.0,
    "resets_at": null
  },
  "extra_usage": {
    "is_enabled": false,
    "monthly_limit": null,
    "used_credits": null,
    "utilization": null
  }
}
```

**Credentials location:** `~/.claude/.credentials.json`
```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1767510085893,
    "subscriptionType": "max",
    "rateLimitTier": "default_claude_max_5x"
  }
}
```

Note: Token may need refresh - check `expiresAt` timestamp.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Always-On Polling Service (GitHub Actions or fly.io)       │
│                                                             │
│  poll-usage.py (every 1-5 min)                              │
│  ├── Calls usage API                                        │
│  ├── Appends to usage-history (GitHub Gist)                 │
│  ├── Checks thresholds → Telegram alert                     │
│  └── Detects reset → Telegram "Window open!"                │
│                                                             │
│  window-scheduler.py                                        │
│  ├── Runs at scheduled times (user-configured)              │
│  ├── Sends minimal Claude request to start window           │
│  └── Telegram: "Window started, resets at X:XX PM PST"      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │  GitHub Gist (storage)  │
              │  - usage-history.json   │
              │  - config.json          │
              │  - schedule.json        │
              └───────────┬─────────────┘
                          │
                          ▼
              ┌─────────────────────────┐
              │  GitHub Pages Dashboard │
              │  - index.html           │
              │  - Main: usage gauges   │
              │  - Countdown (PST)      │
              │  - History graph        │
              │  - Settings page        │
              │  - Window scheduler UI  │
              └─────────────────────────┘
```

## Storage: GitHub Gist

Use GitHub Gist as a lightweight JSON database:
- `usage-history.json` - Array of timestamped usage snapshots
- `config.json` - User preferences (thresholds, polling interval, Telegram settings)
- `schedule.json` - Window scheduling configuration

Dashboard reads from Gist via public URL. Polling service writes via Gist API with PAT.

## Telegram Integration

Already configured:
- **Bot Token:** `8448374682:AAHtILgwkgVXZk1w862T1OAbNF1Up9mHL5M`
- **Chat ID:** `8476903521`

Current Stop hook (in settings.json):
```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST 'https://api.telegram.org/bot.../sendMessage' -d chat_id=... -d text=\"$(basename $PWD): Claude finished\""
      }]
    }]
  }
}
```

## Features to Build

### 1. Polling Service (`poll-usage.py`)
- Configurable interval (default 1 min, can use 5 min for GitHub Actions)
- Reads credentials from `~/.claude/.credentials.json`
- Calls usage API
- Appends to `usage-history.json` in Gist
- Threshold detection:
  - Configurable alerts (e.g., 50%, 75%)
  - Send only once per threshold crossing
  - Telegram notification with current % and reset time (PST)
- Reset detection:
  - When utilization drops significantly, send "Window reset!" notification

### 2. Dashboard (GitHub Pages)
- **Main view:**
  - Two circular/bar gauges: 5-hour % and 7-day %
  - Countdown timer to next reset (converted to PST)
  - Current utilization numbers
- **History view:**
  - Line graph showing usage over time
  - Selectable time range (24h, 7d, 30d)
- **Settings page:**
  - Notification thresholds (checkboxes: 25%, 50%, 75%, 90%)
  - Polling interval (if user-controllable)
  - Telegram enable/disable
- **Window Scheduler page:**
  - Timeline visualization of 24-hour day
  - Add/remove scheduled window starts
  - Shows when windows will reset
  - Enable/disable automation

### 3. Window Scheduler (`window-scheduler.py`)
- Reads schedule from `schedule.json`
- At scheduled times, sends minimal Claude request
- Updates Gist with window start time
- Telegram: "Window started at X:XX AM, resets at Y:YY PM PST"

## Design Inspiration

From `Claude-Code-Usage-Monitor`:
- Color-coded progress bars
- Burn rate predictions
- Clean, readable metrics
- Automatic theme detection

## Polling Interval Considerations

- 1 min: Ideal for real-time, may need always-on host
- 5 min: GitHub Actions minimum, still reasonable
- User preference: Make configurable

## 5-Hour Window Mechanics

- Timer starts on first message of session
- Rounds to top of hour (9:47 AM → window started at 9:00 AM, resets 2:00 PM)
- Rolling window - not fixed schedule
- "Gaming" strategy: Start window early with dummy message to align resets with schedule

## Files in Current Directory

- `/home/jut/.claude-agent/settings.json` - Claude Code hooks (Telegram notification)
- `/home/jut/.claude-agent/.claude/settings.json` - Same (symlinked area)
- `/home/jut/.claude-agent/telegram-bot/bot.py` - Two-way Telegram bot (WIP)
- `/home/jut/.claude-agent/docker-compose.yml` - Docker setup
- `/mnt/claude-data/` - Shared volume across containers

## Next Steps

1. Create GitHub repo: `claude-dashboard`
2. Set up Gist for data storage
3. Build polling script
4. Build static dashboard (HTML/JS/CSS)
5. Deploy polling to GitHub Actions or fly.io
6. Test end-to-end

## Questions Resolved

- Polling uses no tokens (just account info endpoint)
- Usage is account-wide, not per-project
- 5-min interval acceptable (GitHub Actions compatible)
- GitHub Gist for storage (user's preference)
