# Claude Usage Terminal

A retro terminal-style dashboard for tracking Claude Max subscription usage with real-time gauges, countdown timers, and Telegram notifications.

```
   _____ _                 _        _   _
  / ____| |               | |      | | | |
 | |    | | __ _ _   _  __| | ___  | | | |___  __ _  __ _  ___
 | |    | |/ _` | | | |/ _` |/ _ \ | | | / __|/ _` |/ _` |/ _ \
 | |____| | (_| | |_| | (_| |  __/ | |_| \__ \ (_| | (_| |  __/
  \_____|_|\__,_|\__,_|\__,_|\___|  \___/|___/\__,_|\__, |\___|
                                                    __/ |
                                                   |___/
```

## Features

- **Real-time usage gauges** - 5-hour window + 7-day rolling
- **ASCII progress bars** - `[████████░░░░] 67%` because we're classy
- **Countdown timers** - Know exactly when your tokens respawn (in PST)
- **Usage history graphs** - See your patterns (no judgment)
- **Telegram notifications** - Alerts at 50%, 75%, 90% thresholds
- **Witty quips** - Because rate limits should at least be entertaining
- **Retro terminal aesthetic** - Claude orange, scanlines, the works

## Quick Start

### 1. Fork/Clone this repo

```bash
git clone https://github.com/YOUR_USERNAME/claude-dashboard.git
cd claude-dashboard
```

### 2. Create the data branch

```bash
git checkout --orphan data
git rm -rf .
echo '[]' > usage-history.json
echo '{}' > state.json
echo '{"thresholds": [50, 75, 90], "telegram_enabled": true}' > config.json
git add .
git commit -m "Initialize data branch"
git push -u origin data
git checkout main
```

### 3. Get your Claude credentials

Your OAuth credentials are in `~/.claude/.credentials.json`:

```bash
cat ~/.claude/.credentials.json | jq '.claudeAiOauth'
```

You'll need:
- `accessToken` - starts with `sk-ant-oat01-`
- `refreshToken` - starts with `sk-ant-ort01-`
- `expiresAt` - timestamp in milliseconds

### 4. Configure GitHub Secrets

Go to your repo → Settings → Secrets and variables → Actions → New repository secret

Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `CLAUDE_ACCESS_TOKEN` | Your access token |
| `CLAUDE_REFRESH_TOKEN` | Your refresh token |
| `CLAUDE_TOKEN_EXPIRES_AT` | The expiresAt timestamp |
| `TELEGRAM_BOT_TOKEN` | (optional) Your bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | (optional) Your chat ID |

### 5. Update the dashboard config

Edit `app.js` and update the GitHub config:

```javascript
const CONFIG = {
    githubUser: 'YOUR_GITHUB_USERNAME',  // <-- Change this
    githubRepo: 'claude-dashboard',
    // ...
};
```

Or use URL parameters: `?user=YOUR_USERNAME&repo=claude-dashboard`

### 6. Enable GitHub Pages

Go to repo → Settings → Pages:
- Source: Deploy from a branch
- Branch: `main` / `/ (root)`
- Save

Your dashboard will be live at: `https://YOUR_USERNAME.github.io/claude-dashboard/`

### 7. Enable the workflow

The polling workflow runs every 5 minutes. Go to Actions tab and enable workflows if needed.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  GitHub Actions (every 5 min)                               │
│  └── poll-usage.py                                          │
│      ├── Fetches usage from Anthropic API                   │
│      ├── Appends to usage-history.json                      │
│      ├── Checks thresholds → Telegram alerts                │
│      └── Commits to data branch                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │  data branch            │
              │  - usage-history.json   │
              │  - state.json           │
              │  - config.json          │
              └───────────┬─────────────┘
                          │
                          ▼
              ┌─────────────────────────┐
              │  GitHub Pages (main)    │
              │  - index.html           │
              │  - style.css            │
              │  - app.js               │
              │                         │
              │  Reads from data branch │
              │  via raw.githubusercontent│
              └─────────────────────────┘
```

## Configuration

### Notification Thresholds

Edit `config.json` on the data branch:

```json
{
    "thresholds": [50, 75, 90],
    "telegram_enabled": true
}
```

### Disable Telegram

Set `telegram_enabled` to `false` in config.json, or simply don't set the secrets.

## Local Testing

Test the polling script locally:

```bash
# Uses credentials from ~/.claude/.credentials.json
python poll-usage.py

# Or with environment variables
export CLAUDE_ACCESS_TOKEN="sk-ant-oat01-..."
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_CHAT_ID="..."
python poll-usage.py
```

Preview the dashboard:

```bash
python -m http.server 8000
# Open http://localhost:8000?user=YOUR_USERNAME
```

## Quips Preview

The dashboard shows random quips based on usage level:

- **Low (0-25%)**: *"Fresh window energy. The world is your oyster."*
- **Medium (25-50%)**: *"Perfectly balanced, as all things should be."*
- **High (50-75%)**: *"Opus go brrr."*
- **Critical (75%+)**: *"Have you considered Sonnet?"*

## Roadmap

See [BACKLOG.md](BACKLOG.md) for planned features:
- Per-session token tracking (via Claude Code statusline)
- LLM-generated quips for Telegram
- Window scheduler automation

## Token Refresh

The polling script automatically refreshes expired tokens. When running in GitHub Actions, you may need to periodically update the secrets if the refresh token changes.

## Hooks Architecture

Claude Watch uses hooks to track activity in real-time:

### Local Usage
Hooks are stored in `~/.claude/hooks/` and configured in `~/.claude/settings.json`:
- `statusline.sh` - Runs every 300ms, writes stats to `/tmp/claude-stats-{session}.json`
- `stop-hook.sh` - Fires after each response, posts to `/api/logs`, `/api/agent/heartbeat`, and sends Telegram notifications

### Docker Sandbox Usage (`claude-sandbox`)

**IMPORTANT**: `docker sandbox` mounts your host `~/.claude/` directory. This means:
- Settings are read from **host** `~/.claude/settings.json`, NOT from `/mnt/claude-data/settings.json`
- Hooks run from **host** `~/.claude/hooks/`, NOT from `/mnt/claude-data/hooks/`
- The `/mnt/claude-data/` volume is only used for: `agent-id`, `telegram.conf`, and container-specific data

**When updating hooks, sync to both locations:**
```bash
# Update repo hooks
vim ~/projects/claude-watch/hooks/stop-hook.sh

# Sync to active location (used by both local and sandbox)
cp ~/projects/claude-watch/hooks/*.sh ~/.claude/hooks/
```

The `claude-sandbox` script still writes to `/mnt/claude-data/` for:
- `agent-id` file (read by statusline for agent tracking)
- `telegram.conf` (fallback for container env vars)
- `settings.json` with `bypassPermissionsModeAccepted: true`

But the actual hook execution uses the host's `~/.claude/hooks/` directory.

## License

MIT - Do whatever you want with it.

---

*"Your tokens. Hand them over."* - This dashboard, probably
