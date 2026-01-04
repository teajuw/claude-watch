#!/usr/bin/env python3
"""
Claude Usage Polling Service

Fetches usage data from Claude API, stores history, and sends Telegram alerts.
Designed to run via GitHub Actions on a schedule.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# =============================================================================
# Configuration
# =============================================================================

USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage"
TOKEN_REFRESH_URL = "https://console.anthropic.com/v1/oauth/token"
TELEGRAM_API_URL = "https://api.telegram.org/bot{token}/sendMessage"

# Thresholds that trigger alerts (configurable via config.json)
DEFAULT_THRESHOLDS = [50, 75, 90]

# How much utilization must drop to detect a reset
RESET_DROP_THRESHOLD = 20

# =============================================================================
# Quips - Categorized by usage level
# =============================================================================

QUIPS = {
    "low": [  # 0-25%
        "Fresh window energy. The world is your oyster.",
        "Tokens for days. Live your best life.",
        "You could mass-delete your codebase and still have quota.",
        "Opus awaits your command, master.",
        "The tank is full. Floor it.",
    ],
    "medium": [  # 25-50%
        "Cruise control engaged.",
        "Perfectly balanced, as all things should be.",
        "Halfway to touching grass.",
        "The meter ticks. The code flows.",
        "Sustainable pace detected. Boring, but wise.",
    ],
    "high": [  # 50-75%
        "Opus go brrr.",
        "We're in the endgame now.",
        "Consider your next prompt carefully.",
        "The meter hungers.",
        "You're built different. Unfortunately, so is the rate limit.",
    ],
    "critical": [  # 75%+
        "Have you considered Sonnet?",
        "Touch grass in {reset_time}.",
        "The well runs dry.",
        "Opus is sweating.",
        "Your tokens. Hand them over.",
        "Rate limit speedrun any%.",
    ],
    "reset": [
        "Rise and grind. The slate is clean.",
        "Fresh tokens just dropped.",
        "The soul is restored. The meter forgives.",
        "New window, new me.",
        "Tokens are back on the menu.",
    ],
}

import random

def get_quip(utilization: float, reset_time: str = None) -> str:
    """Get a random quip based on utilization level."""
    if utilization < 25:
        category = "low"
    elif utilization < 50:
        category = "medium"
    elif utilization < 75:
        category = "high"
    else:
        category = "critical"

    quip = random.choice(QUIPS[category])
    if reset_time and "{reset_time}" in quip:
        quip = quip.replace("{reset_time}", reset_time)
    return quip

def get_reset_quip() -> str:
    """Get a quip for when usage resets."""
    return random.choice(QUIPS["reset"])

# =============================================================================
# Token Management
# =============================================================================

def load_credentials(creds_path: str = None) -> dict:
    """Load credentials from file or environment."""
    # Try environment variables first (for GitHub Actions)
    if os.environ.get("CLAUDE_ACCESS_TOKEN"):
        return {
            "accessToken": os.environ["CLAUDE_ACCESS_TOKEN"],
            "refreshToken": os.environ.get("CLAUDE_REFRESH_TOKEN", ""),
            "expiresAt": int(os.environ.get("CLAUDE_TOKEN_EXPIRES_AT", 0)),
        }

    # Fall back to credentials file
    if creds_path is None:
        creds_path = os.path.expanduser("~/.claude/.credentials.json")

    with open(creds_path, "r") as f:
        data = json.load(f)

    oauth = data.get("claudeAiOauth", {})
    return {
        "accessToken": oauth.get("accessToken", ""),
        "refreshToken": oauth.get("refreshToken", ""),
        "expiresAt": oauth.get("expiresAt", 0),
    }

def is_token_expired(creds: dict) -> bool:
    """Check if the access token is expired or about to expire."""
    expires_at = creds.get("expiresAt", 0)
    # Consider expired if less than 5 minutes remaining
    return (expires_at - 300000) < (time.time() * 1000)

def refresh_access_token(refresh_token: str) -> dict:
    """Refresh the access token using the refresh token."""
    data = json.dumps({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }).encode("utf-8")

    req = urllib.request.Request(
        TOKEN_REFRESH_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return {
                "accessToken": result["access_token"],
                "refreshToken": result.get("refresh_token", refresh_token),
                "expiresAt": int(time.time() * 1000) + (result.get("expires_in", 3600) * 1000),
            }
    except urllib.error.HTTPError as e:
        print(f"Token refresh failed: {e.code} - {e.read().decode()}", file=sys.stderr)
        raise

def save_credentials(creds: dict, creds_path: str = None):
    """Save updated credentials back to file."""
    if creds_path is None:
        creds_path = os.path.expanduser("~/.claude/.credentials.json")

    # Read existing file
    with open(creds_path, "r") as f:
        data = json.load(f)

    # Update OAuth section
    data["claudeAiOauth"] = {
        **data.get("claudeAiOauth", {}),
        "accessToken": creds["accessToken"],
        "refreshToken": creds["refreshToken"],
        "expiresAt": creds["expiresAt"],
    }

    # Write back
    with open(creds_path, "w") as f:
        json.dump(data, f, indent=2)

# =============================================================================
# Usage API
# =============================================================================

def fetch_usage(access_token: str) -> dict:
    """Fetch usage data from the Claude API."""
    req = urllib.request.Request(
        USAGE_API_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "anthropic-beta": "oauth-2025-04-20",
            "Accept": "application/json",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"Usage fetch failed: {e.code} - {e.read().decode()}", file=sys.stderr)
        raise

# =============================================================================
# Telegram Notifications
# =============================================================================

def send_telegram(message: str, bot_token: str = None, chat_id: str = None):
    """Send a message via Telegram."""
    bot_token = bot_token or os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = chat_id or os.environ.get("TELEGRAM_CHAT_ID")

    if not bot_token or not chat_id:
        print("Telegram not configured, skipping notification", file=sys.stderr)
        return

    url = TELEGRAM_API_URL.format(token=bot_token)
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "Markdown",
    }).encode("utf-8")

    req = urllib.request.Request(url, data=data, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"Telegram send failed: {e.code} - {e.read().decode()}", file=sys.stderr)

import urllib.parse

# =============================================================================
# Time Utilities
# =============================================================================

def parse_reset_time(iso_string: str) -> datetime:
    """Parse ISO timestamp from API response."""
    if not iso_string:
        return None
    # Handle various ISO formats
    iso_string = iso_string.replace("Z", "+00:00")
    return datetime.fromisoformat(iso_string)

def format_reset_time_pst(reset_dt: datetime) -> str:
    """Format reset time in PST for display."""
    if not reset_dt:
        return "unknown"

    # Convert to PST (UTC-8)
    from datetime import timedelta
    pst_offset = timedelta(hours=-8)
    pst_time = reset_dt.astimezone(timezone(pst_offset))
    return pst_time.strftime("%-I:%M %p PST")

def format_countdown(reset_dt: datetime) -> str:
    """Format time remaining until reset."""
    if not reset_dt:
        return "unknown"

    now = datetime.now(timezone.utc)
    delta = reset_dt - now

    if delta.total_seconds() <= 0:
        return "now"

    hours, remainder = divmod(int(delta.total_seconds()), 3600)
    minutes, _ = divmod(remainder, 60)

    if hours > 0:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"

# =============================================================================
# State Management
# =============================================================================

def load_state(state_path: str = "state.json") -> dict:
    """Load the state file tracking alerts sent."""
    if os.path.exists(state_path):
        with open(state_path, "r") as f:
            return json.load(f)
    return {
        "last_five_hour_util": 0,
        "alerts_sent": [],  # List of thresholds already alerted for current window
        "last_reset_at": None,
    }

def save_state(state: dict, state_path: str = "state.json"):
    """Save state to file."""
    with open(state_path, "w") as f:
        json.dump(state, f, indent=2)

def load_config(config_path: str = "config.json") -> dict:
    """Load configuration."""
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            return json.load(f)
    return {
        "thresholds": DEFAULT_THRESHOLDS,
        "telegram_enabled": True,
    }

# =============================================================================
# History Management
# =============================================================================

def load_history(history_path: str = "usage-history.json") -> list:
    """Load usage history."""
    if os.path.exists(history_path):
        with open(history_path, "r") as f:
            return json.load(f)
    return []

def save_history(history: list, history_path: str = "usage-history.json"):
    """Save usage history."""
    with open(history_path, "w") as f:
        json.dump(history, f, indent=2)

def append_history(usage: dict, history_path: str = "usage-history.json"):
    """Append a usage snapshot to history."""
    history = load_history(history_path)

    snapshot = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "five_hour": {
            "utilization": usage.get("five_hour", {}).get("utilization", 0),
            "resets_at": usage.get("five_hour", {}).get("resets_at"),
        },
        "seven_day": {
            "utilization": usage.get("seven_day", {}).get("utilization", 0),
            "resets_at": usage.get("seven_day", {}).get("resets_at"),
        },
    }

    history.append(snapshot)

    # Keep last 7 days of data (assuming 5-min intervals = 2016 records)
    max_records = 2016
    if len(history) > max_records:
        history = history[-max_records:]

    save_history(history, history_path)
    return snapshot

# =============================================================================
# Main Logic
# =============================================================================

def check_and_alert(usage: dict, state: dict, config: dict) -> dict:
    """Check thresholds and send alerts as needed. Returns updated state."""
    five_hour = usage.get("five_hour", {})
    current_util = five_hour.get("utilization", 0)
    last_util = state.get("last_five_hour_util", 0)
    resets_at = five_hour.get("resets_at")

    reset_dt = parse_reset_time(resets_at)
    reset_time_str = format_reset_time_pst(reset_dt)
    countdown_str = format_countdown(reset_dt)

    # Check for reset (utilization dropped significantly)
    if last_util > RESET_DROP_THRESHOLD and current_util < (last_util - RESET_DROP_THRESHOLD):
        quip = get_reset_quip()
        message = f"*Window Reset!* {quip}\n\nNew window resets at {reset_time_str}"

        if config.get("telegram_enabled", True):
            send_telegram(message)

        # Clear alerts for new window
        state["alerts_sent"] = []
        state["last_reset_at"] = datetime.now(timezone.utc).isoformat()

    # Check thresholds
    thresholds = config.get("thresholds", DEFAULT_THRESHOLDS)
    alerts_sent = state.get("alerts_sent", [])

    for threshold in sorted(thresholds):
        if current_util >= threshold and threshold not in alerts_sent:
            quip = get_quip(current_util, countdown_str)

            message = (
                f"*{threshold}% Usage Alert*\n\n"
                f"5-hour: {current_util:.1f}%\n"
                f"Resets: {reset_time_str} ({countdown_str})\n\n"
                f"_{quip}_"
            )

            if config.get("telegram_enabled", True):
                send_telegram(message)

            alerts_sent.append(threshold)

    state["last_five_hour_util"] = current_util
    state["alerts_sent"] = alerts_sent

    return state

def main():
    """Main entry point."""
    print(f"[{datetime.now().isoformat()}] Starting usage poll...")

    # Load credentials
    try:
        creds = load_credentials()
    except FileNotFoundError:
        print("Credentials not found. Set CLAUDE_ACCESS_TOKEN env var or check ~/.claude/.credentials.json", file=sys.stderr)
        sys.exit(1)

    # Refresh token if needed
    if is_token_expired(creds) and creds.get("refreshToken"):
        print("Token expired, refreshing...")
        try:
            creds = refresh_access_token(creds["refreshToken"])
            # Save if running locally (not in GitHub Actions)
            if not os.environ.get("GITHUB_ACTIONS"):
                save_credentials(creds)
            print("Token refreshed successfully")
        except Exception as e:
            print(f"Token refresh failed: {e}", file=sys.stderr)
            sys.exit(1)

    # Fetch usage
    try:
        usage = fetch_usage(creds["accessToken"])
    except Exception as e:
        print(f"Failed to fetch usage: {e}", file=sys.stderr)
        sys.exit(1)

    # Display current usage
    five_hour = usage.get("five_hour", {})
    seven_day = usage.get("seven_day", {})

    print(f"5-hour utilization: {five_hour.get('utilization', 0):.1f}%")
    print(f"7-day utilization: {seven_day.get('utilization', 0):.1f}%")

    if five_hour.get("resets_at"):
        reset_dt = parse_reset_time(five_hour["resets_at"])
        print(f"5-hour resets at: {format_reset_time_pst(reset_dt)} ({format_countdown(reset_dt)})")

    # Load state and config
    state = load_state()
    config = load_config()

    # Append to history
    snapshot = append_history(usage)
    print(f"Recorded snapshot at {snapshot['timestamp']}")

    # Check alerts
    state = check_and_alert(usage, state, config)
    save_state(state)

    print("Poll complete.")

if __name__ == "__main__":
    main()
