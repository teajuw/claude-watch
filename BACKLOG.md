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

## Ideas / Maybe Later

- [ ] Browser extension showing usage in toolbar
- [ ] Slack integration (alternative to Telegram)
- [ ] Multi-account support
- [ ] Usage prediction / burn rate estimation
- [ ] "Achievements" for usage milestones (embrace the goofiness)
- [ ] Sound effects on the dashboard (retro beeps)
- [ ] Export usage data to CSV
