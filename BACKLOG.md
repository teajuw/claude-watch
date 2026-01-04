# Claude Dashboard - Backlog

Future enhancements to add when Phase 1 is complete.

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

## Phase 4: Window Scheduler

**Goal:** "Rate gaming" - automatically start 5-hour windows at optimal times.

**Implementation:**
1. `schedule.json` config with preferred window start times
2. `window-scheduler.py` or GitHub Actions cron job
3. Sends minimal Claude request to start the window
4. Telegram notification: "Window started, resets at X:XX PM PST"

**UI:**
- Timeline visualization of 24-hour day
- Add/remove scheduled times
- Enable/disable automation

---

## Ideas / Maybe Later

- [ ] Browser extension showing usage in toolbar
- [ ] Slack integration (alternative to Telegram)
- [ ] Multi-account support
- [ ] Usage prediction / burn rate estimation
- [ ] "Achievements" for usage milestones (embrace the goofiness)
- [ ] Sound effects on the dashboard (retro beeps)
- [ ] Export usage data to CSV
