# Claude Dashboard - Backlog

Future enhancements to add when Phase 1 is complete.

---

## KNOWN ISSUE: OAuth Refresh Token Expiration

**Status:** Recurring issue - tokens expire and need manual refresh.

### Root Cause (Diagnosed 2026-01-05)

The issue is a **token synchronization race condition**:

1. **Claude CLI and Worker share the same OAuth credentials** but manage them independently
2. **When Claude CLI refreshes tokens** (either automatically or via user session), Anthropic **invalidates the old refresh token**
3. **Worker still has old tokens in KV** → Worker's refresh attempt fails because its refresh token is now invalid
4. **Result:** 401 errors, "OAuth token has expired" messages

**Key insight:** OAuth refresh tokens are single-use. When a new token pair is issued, the old refresh token becomes permanently invalid. The Worker and CLI are fighting over the same token.

### Token Flow Diagram
```
[Claude CLI]                    [Cloudflare Worker KV]
     │                                    │
     │  Token A expires                   │  Has Token A (cached)
     │        │                           │
     │  CLI refreshes → Token B           │  Still has Token A
     │        │                           │
     │  Token A refresh_token INVALIDATED │
     │                                    │
     │                                    │  Worker tries Token A
     │                                    │  → 401 (expired)
     │                                    │  Worker tries refresh
     │                                    │  → FAILS (old refresh token invalid)
```

### The Problem

Claude Code uses OAuth tokens stored in `~/.claude/.credentials.json`. These tokens:
- Have a limited lifespan (~8-12 hours for access_token)
- **Refresh tokens are single-use** - once used, the old one is invalidated
- When Claude CLI refreshes, it doesn't notify the Worker
- Worker's cached refresh token becomes permanently invalid

### Symptoms
- Dashboard shows "The void stares back" error
- Worker logs show 401 errors or "invalid_grant" errors
- Local tokens are valid but KV tokens are stale
- Running `sync-credentials` fixes it temporarily

### Diagnosis Commands
```bash
# Compare local vs KV tokens
echo "=== LOCAL ===" && cat ~/.claude/.credentials.json | jq '{expires: (.claudeAiOauth.expiresAt/1000 | strftime("%Y-%m-%d %H:%M")), token: .claudeAiOauth.accessToken[0:30]}'

# Check KV tokens (requires wrangler)
export PATH="$HOME/.nvm/versions/node/v24.11.1/bin:$PATH"
wrangler kv key get oauth_tokens --namespace-id=4b55acfc702f4698b53c5f1219edf63d --remote | jq '{expires: (.expiresAt/1000 | strftime("%Y-%m-%d %H:%M")), token: .accessToken[0:30]}'

# If tokens differ, that's the problem - sync needed
```

### Current Workaround

1. **Run sync-credentials:** `cd ~/projects/claude-watch && ./bin/sync-credentials`
2. **Verify:** `curl https://claude-watch.trevorju32.workers.dev/api/usage | jq .success`

If that fails with auth error, the local token is also stale:
1. **Force re-auth:** Open Claude Code CLI (`claude`) - using it refreshes the token
2. **Then sync:** `./bin/sync-credentials`

### Files Involved
- `~/.claude/.credentials.json` - Local token storage (source of truth)
- `bin/sync-credentials` - Script to sync tokens to Cloudflare KV
- `worker/src/lib/anthropic.js` - Token refresh logic in Worker
- `worker/src/cron/poll.js` - Cron that fetches usage using stored tokens

### Long-term Fix Options (Priority Order)

1. **Hook-based auto-sync (IMPLEMENTED 2026-01-05)** - Stop hook syncs credentials every 5 minutes
   - Added to `~/.claude/hooks/stop-hook.sh`
   - Rate-limited via `/tmp/claude-creds-synced` marker file
   - Runs in background, non-blocking
   - Should prevent most desync issues during active Claude usage

2. **Local crontab sync** - Sync every 4 hours (before 8-hour expiry)
   ```bash
   0 */4 * * * $HOME/projects/claude-watch/bin/sync-credentials >/dev/null 2>&1
   ```
   - Pros: Simple, reliable, covers idle periods
   - Cons: Machine must be on
   - **Consider adding this as backup for periods when not actively using Claude**

3. **Worker-side token health check** - Endpoint that validates tokens and sends Telegram alert
   - Pros: Proactive alerting
   - Cons: Still requires manual sync

4. **Single source of truth** - Worker ONLY uses tokens, never caches
   - Requires architectural change to always read from KV
   - Complex: Would need to sync CLI → KV on every refresh

### Quick Reference Commands
```bash
# Check current token status (local)
cat ~/.claude/.credentials.json | jq '.claudeAiOauth.expiresAt' | xargs -I{} date -d @$(({}/1000))

# Sync to Cloudflare KV
cd ~/projects/claude-watch && ./bin/sync-credentials

# Test if Worker tokens work
curl -s https://claude-watch.trevorju32.workers.dev/api/usage | jq .success

# Check worker logs for errors
wrangler tail --format=pretty
```

---

## Phase 2: Per-Session Token Tracking

**Goal:** Add granular per-session token usage to the dashboard.

### Option A: JSONL Parsing (like ccusage)

Claude Code stores session data in `~/.claude/projects/{project}/{uuid}.jsonl`

**Implementation:**
1. Script to parse JSONL files and extract token counts
2. Aggregate by session/day/model
3. Sync to dashboard storage
4. Display per-session breakdown

**Data available:**
- `input_tokens`, `output_tokens` per message
- `cache_creation_input_tokens`, `cache_read_input_tokens`
- Model used, timestamps

**Reference:** https://github.com/ryoppippi/ccusage

### Option B: Statusline Integration (real-time)

**Implementation:**
1. Create statusline script that logs to `/mnt/claude-data/sessions.json`
2. Deploy script to Docker Claude Code environments
3. Polling service reads session logs and syncs to dashboard storage
4. Dashboard shows per-session breakdown alongside account utilization

**Data available:**
- `total_input_tokens` / `total_output_tokens` per session
- `context_window_size` and current usage
- `total_cost_usd` per session
- `total_duration_ms`
- Lines added/removed

**Reference:** https://code.claude.com/docs/en/statusline

### Option C: stats-cache.json (investigate)

User mentioned `stats-cache.json` - need to investigate:
- Where is this file located?
- What tool/config generates it?
- What data structure does it contain?

**TODO:** Find stats-cache.json location and document structure

---

## Phase 3: LLM-Generated Quips

**Goal:** Use Claude to generate context-aware quips for Telegram notifications.

**Implementation:**
1. On threshold crossing, call Claude API with context (usage %, time of day, reset time)
2. Generate a witty, contextual notification message
3. Send via Telegram

**Example prompt:**
```
Generate a short, witty notification (under 100 chars) for someone who just hit {percent}% of their Claude usage at {time}. Their window resets at {reset_time}. Be playful and slightly sarcastic.
```

**Considerations:**
- Only for Telegram (not dashboard - need instant load)
- ~1 API call per threshold crossing (infrequent)
- Could use Haiku for cost efficiency

---

## Phase 4: Window Scheduler (Paused)

**Goal:** "Rate gaming" - schedule sessions and get reminders at optimal times.

**Status:** Partially implemented, paused for refinement.

**What exists (commented out / unused):**
- `schedule.html` + `schedule.js` - 24-hour timeline UI
- Worker endpoints: `GET/POST /api/schedule`, `POST /api/session/start`
- Cron handler for session reminders in `worker/src/cron/sessions.js`
- D1 table for sessions

**TODO before enabling:**
- [ ] Refine the "Start Session" concept - what should it actually do?
- [ ] Better UX for the timeline (drag to create sessions?)
- [ ] Test session reminder notifications
- [ ] Add SCHEDULE button back to index.html footer
- [ ] Consider: auto-start windows vs just reminders?

---

---

## Phase 5: Claudomate - Agent Management Tool

**Goal:** Full agent orchestration and management platform.

### 5.1 Daily Token Sync Cron

Automatic credential sync to prevent dashboard auth failures.

**Options:**
- Cloudflare Worker cron (proactive refresh via API)
- GitHub Actions cron (runs sync-credentials script)
- Local crontab (machine must be on)

**Implementation:**
```bash
# Local crontab option
0 8 * * * $HOME/projects/claude-watch/bin/sync-credentials >/dev/null 2>&1
```

### 5.2 Telegram Notification on Agent Spawn

Notify when new agents come online.

**Implementation:**
```bash
# In claude-sandbox, after setting up hooks:
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="$TELEGRAM_CHAT_ID" \
      -d text="🚀 Agent $AGENT_ID spawned on $PROJECT" &>/dev/null &
fi
```

### 5.3 Desktop Notification on Rate Limit Warning

Push notifications when approaching rate limits.

**Options:**
- Worker calls webhook → local notification daemon
- Browser push notifications from dashboard
- Native desktop app (Electron/Tauri)

### 5.4 Agent Orchestrator

Central control for spawning/managing multiple agents.

**Features:**
- Spawn agents from web UI
- Monitor all agents in real-time
- Kill/restart agents remotely
- Queue tasks for agents
- Load balancing across containers

---

## Ideas / Maybe Later

- [ ] Browser extension showing usage in toolbar
- [ ] Slack integration (alternative to Telegram)
- [ ] Multi-account support
- [ ] Usage prediction / burn rate estimation
- [ ] "Achievements" for usage milestones (embrace the goofiness)
- [ ] Sound effects on the dashboard (retro beeps)
- [ ] Export usage data to CSV
