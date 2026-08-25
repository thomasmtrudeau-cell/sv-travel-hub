import type { VercelRequest, VercelResponse } from '@vercel/node'

// SV Travel Hub — Weekly Slack recap.
//
// Triggered weekly via Vercel Cron (vercel.json) AND manually from the app's
// admin button. Composes a brief, scannable post for #travel-schedule:
//
//   - Top 3-day window in each of the next 4 weeks (starting 1 week out)
//   - Overdue T1/T2 players (per Heartbeat) with their next game inline
//   - "Open hub →" link
//
// Coverage: Pro (MLB Stats API), HS + JUCO (Schedule CSV), Summer (Summer CSV).
// NCAA games are not yet wired server-side (D1Baseball scrape lives only in
// the browser). Phase 2 will add NCAA via a build-time snapshot.
//
// Env vars (all set in Vercel):
//   SLACK_BOT_TOKEN                     — xoxb- token from the "SV Travel Hub"
//                                          Slack app (chat:write scope)
//   SLACK_CHANNEL_TRAVEL_SCHEDULE       — channel ID or name (e.g. "C01234"
//                                          or "#travel-schedule")
//   CRON_SECRET                         — shared secret to guard the endpoint
//   VITE_ROSTER_CSV_URL                 — SV roster sheet (CSV)
//   VITE_SCHEDULE_CSV_URL               — HS + JUCO schedule sheet (CSV)
//   VITE_SUMMER_CSV_URL                 — Summer placement sheet (CSV)
//
// Usage (every request needs the header `Authorization: Bearer <CRON_SECRET>`;
// Vercel's scheduled cron sends it automatically when CRON_SECRET is set):
//   GET /api/slack-recap            → posts to Slack
//   GET /api/slack-recap?dryRun=1   → returns the message JSON, no Slack post
//                                     (for previewing / the health monitor)

interface RosterPlayer {
  name: string
  tier: number
  level: 'Pro' | 'NCAA' | 'HS'
  org: string
  affiliate?: string   // the specific team the player plays for (e.g. "Tampa Tarpons")
  state?: string
}

interface HeartbeatPlayer {
  name: string
  daysSinceInPerson: number | null
  inPersonThresholdDays: number | null
}

interface Game {
  date: string         // YYYY-MM-DD
  player: string
  venueName: string
  homeOrAway: 'home' | 'away' | 'unknown'
  opponent?: string
  tier: number
  level: 'Pro' | 'HS' | 'JUCO' | 'Summer' | 'NCAA'
  lat?: number
  lng?: number
  city?: string
  state?: string       // 2-letter abbrev where known
}

interface WindowResult {
  startDate: string
  endDate: string
  regionLabel: string  // e.g. "Sacramento, CA area" — the drivable cluster this trip covers
  players: Array<{ name: string; tier: number; venueName: string; city?: string; state?: string; date: string }>
  uniquePlayerCount: number
  t1Count: number
  t2Count: number
  t3Count: number
  topVenues: string[]  // "Venue (City, ST)" ranked by player-count contribution
}

interface WeekTrips {
  trips: WindowResult[]  // up to 2 distinct-region trips, best first
  elsewhere: number      // unique players that week not covered by either shown trip
}

// ─── Handler ─────────────────────────────────────────────────────────────────

// Building the recap fans out to Google Sheets, the MLB Stats API, Heartbeat,
// and Slack — comfortably over the default 10s function limit on a slow day.
export const config = { maxDuration: 60 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth: `Authorization: Bearer <CRON_SECRET>` ONLY. Vercel's scheduled cron
  // sends this header automatically when CRON_SECRET is set; manual callers
  // (health monitor, in-app admin button, curl) must send it too. The old
  // `?secret=` query-param path was removed — secrets in query strings leak
  // into request logs and browser history.
  const expected = process.env.CRON_SECRET ?? ''
  if (!expected) {
    return res.status(500).json({ error: 'CRON_SECRET not configured' })
  }
  const headerSecret = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (headerSecret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  // Distinguish the scheduled cron (Vercel sends `user-agent: vercel-cron/1.0`)
  // from manual runs. Only the cron gets a failure alert — when a human triggers
  // the run they're right there and already see the error in the response;
  // alerting then would just be channel noise.
  const isCron = (req.headers['user-agent'] ?? '').toLowerCase().includes('vercel-cron')

  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true'

  // Paused INDEFINITELY per Kent (2026-08-25): "Can we remove these alerts
  // please?" — no more scheduled trip pings. Dry runs still execute so the
  // daily health monitor keeps validating the pipeline. Manual runs from the
  // app's admin button are also blocked unless ?force=1 is passed. To resume,
  // flip RECAP_PAUSED to false.
  const RECAP_PAUSED = true
  const force = req.query.force === '1'
  if (RECAP_PAUSED && !dryRun && !force) {
    return res.status(200).json({ skipped: true, reason: 'Recap paused indefinitely per Kent (2026-08-25)' })
  }

  const botToken = process.env.SLACK_BOT_TOKEN
  const channel = process.env.SLACK_CHANNEL_TRAVEL_SCHEDULE

  if (!dryRun && (!botToken || !channel)) {
    return res.status(500).json({ error: 'SLACK_BOT_TOKEN and SLACK_CHANNEL_TRAVEL_SCHEDULE must both be configured' })
  }

  // #sv-automation (C0BE0ELP92Q) is the org's bugs-only alert channel; the
  // recap is a team-facing digest and must never post there. The env var got
  // repointed at it once (Jul 2026) and every downstream check still passed —
  // posting succeeded, credentials probed fine — so the mis-route was silent.
  // Hold the recap and alert instead.
  if (!dryRun && channel && SV_AUTOMATION_CHANNEL.test(channel)) {
    if (isCron) {
      await notifyAutomationOfRecapFailure(
        `SLACK_CHANNEL_TRAVEL_SCHEDULE is pointed at #sv-automation (\`${channel}\`), so the recap was held — digests don't belong in the alerts channel. Set it to the #travel-schedule channel ID (C08CMDN82CT) and redeploy.`,
        true,
      )
    }
    return res.status(500).json({ error: 'SLACK_CHANNEL_TRAVEL_SCHEDULE points at #sv-automation — set it to the #travel-schedule channel ID (C08CMDN82CT) in Vercel and redeploy' })
  }

  try {
    const today = new Date()
    const players = await loadRoster()
    const heartbeat = await loadHeartbeat()
    const { games, affiliateResolved, affiliateUnresolved } = await loadAllGames(players, today)

    const weeks = nextFourWeeks(today)
    const topWindows = weeks.map((wk) => computeTopTripsInRange(games, wk.start, wk.end))

    const plannedVisits = await loadPlannedVisits(players)
    const allOverdue = computeOverduePlayers(players, heartbeat, games, today)
    // Drop players another agent has already flagged a visit for — no point
    // nagging Kent about someone who's already being covered.
    const overdue = allOverdue.filter((o) => !plannedVisits.has(o.player.name.trim().toLowerCase()))
    const covered = [...plannedVisits.values()]

    // Non-game events overlapping the recap horizon (today → last week's end).
    const horizonEnd = weeks[weeks.length - 1]!.end
    const todayStr = isoDate(today)
    const upcomingEvents = (await loadEvents())
      .filter((e) => e.travels && e.startDate && e.endDate && e.endDate >= todayStr && e.startDate <= horizonEnd)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))

    const message = composeSlackMessage(topWindows, weeks, overdue, covered, upcomingEvents, players.length)

    if (dryRun) {
      // rosterSize + gameCount let the health monitor (api/health-monitor.ts)
      // reason about silent data degradation without re-running the pipeline.
      // affiliateResolved/-Unresolved expose Pro-attribution quality: unresolved
      // players fall back to org-wide games (noisy regions but never dropped).
      return res.status(200).json({ dryRun: true, message, weeks, topWindows, overdueCount: overdue.length, coveredCount: covered.length, rosterSize: players.length, gameCount: games.length, eventCount: upcomingEvents.length, affiliateResolved, affiliateUnresolved })
    }

    // Post via chat.postMessage (modern Slack app API). Requires the bot
    // to be a member of the channel — invite it with `/invite @SV Travel Hub`
    // before the first run.
    const slackResult = await slackPostMessage(botToken!, {
      channel,
      text: message.text,
      blocks: message.blocks,
      unfurl_links: false,
      unfurl_media: false,
    })
    if (!slackResult.httpOk || !slackResult.body.ok) {
      const errStr = slackResult.body.error ?? `HTTP ${slackResult.status}`
      console.error('[slack-recap] chat.postMessage failed:', slackResult.status, JSON.stringify(slackResult.body))
      if (isCron) {
        await postFailureAlert(botToken, channel, `Slack rejected the post (${errStr}).`)
        await notifyAutomationOfRecapFailure(`Slack rejected the Monday recap post with \`${errStr}\` (after retries).`, isSlackConfigError(errStr))
      }
      return res.status(502).json({ error: 'Slack chat.postMessage failed', status: slackResult.status, body: slackResult.body })
    }
    return res.status(200).json({ posted: true, channel: slackResult.body.channel, ts: slackResult.body.ts })
  } catch (e) {
    console.error('[slack-recap] handler error:', e)
    const msg = e instanceof Error ? e.message : 'unknown error'
    if (isCron) {
      await postFailureAlert(botToken, channel, `Couldn't build the recap: ${msg}.`)
      await notifyAutomationOfRecapFailure(`The scheduled recap run crashed while building the message: ${msg}.`, false)
    }
    return res.status(500).json({ error: msg })
  }
}

interface SlackPostResult {
  httpOk: boolean
  status: number
  body: { ok: boolean; error?: string; ts?: string; channel?: string }
}

/** chat.postMessage with a small retry loop: up to 3 attempts, honoring
 *  Retry-After on 429 and backing off on 5xx / network errors. Slack API
 *  errors in the JSON body (invalid_auth, channel_not_found, …) are NOT
 *  retried — they won't get better on the next attempt. Never throws. */
async function slackPostMessage(botToken: string, payload: Record<string, unknown>): Promise<SlackPostResult> {
  const MAX_ATTEMPTS = 3
  let last: SlackPostResult = { httpOk: false, status: 0, body: { ok: false, error: 'not attempted' } }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let retryAfterMs: number | null = null
    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${botToken}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12_000),
      })
      let body: SlackPostResult['body'] = { ok: false, error: `unparseable response (HTTP ${res.status})` }
      try { body = await res.json() as SlackPostResult['body'] } catch { /* keep placeholder */ }
      last = { httpOk: res.ok, status: res.status, body }
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable) return last
      const ra = Number(res.headers.get('retry-after'))
      if (res.status === 429 && Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, 15_000)
    } catch (e) {
      last = { httpOk: false, status: 0, body: { ok: false, error: e instanceof Error ? e.message : String(e) } }
    }
    if (attempt < MAX_ATTEMPTS) await sleep(retryAfterMs ?? 1000 * attempt)
  }
  return last
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Slack errors that mean the token/channel config is broken (a human has to
 *  fix credentials — 👤) as opposed to a payload/code problem (🛠️). */
function isSlackConfigError(err: string): boolean {
  return /invalid_auth|token_revoked|token_expired|account_inactive|not_authed|channel_not_found|not_in_channel|is_archived|missing_scope|ekm_access_denied/i.test(err)
}

/** The shared #sv-automation channel (ID or name) — bugs/alerts only, never
 *  the recap. Matched against SLACK_CHANNEL_TRAVEL_SCHEDULE as a mis-config
 *  guard; the health monitor carries the same check. */
const SV_AUTOMATION_CHANNEL = /^C0BE0ELP92Q$|sv-automation/i

/** Best-effort plain-text failure alert so a broken Monday cron is visible
 *  instead of a silent no-post. Plain text (no blocks) so it still lands even
 *  when a block-formatting error is what killed the real recap. Never throws. */
async function postFailureAlert(botToken: string | undefined, channel: string | undefined, reason: string): Promise<void> {
  if (!botToken || !channel) return
  await slackPostMessage(botToken, {
    channel,
    text: `:warning: *Travel Hub recap didn't post this morning.* ${reason} The schedule data is unaffected — open the hub directly: https://sv-travel-hub.vercel.app`,
    unfurl_links: false,
  })
}

/** Independent-transport failure alert to #sv-automation. postFailureAlert
 *  shares the recap's own token + channel, so a revoked token or archived
 *  channel would otherwise mean a fully silent Monday — this webhook path
 *  fails independently. No-op if SV_AUTOMATION_WEBHOOK_URL isn't set. Never
 *  throws. `configIssue` picks the 👤 (fix token/channel) vs 🛠️ (fix code) tag. */
async function notifyAutomationOfRecapFailure(how: string, configIssue: boolean): Promise<void> {
  const url = process.env.SV_AUTOMATION_WEBHOOK_URL
  if (!url) return
  const tag = configIssue ? '👤 Manual' : '🛠️ Code change'
  const todo = configIssue
    ? 'Check the SV Travel Hub Slack app token and the #travel-schedule channel (token revoked? bot kicked? channel archived?), fix SLACK_BOT_TOKEN / SLACK_CHANNEL_TRAVEL_SCHEDULE in Vercel (https://vercel.com/stadium-ventures/sv-travel-hub/settings/environment-variables), then re-run the recap.'
    : 'Open `sv-travel-hub` in Claude Code and debug api/slack-recap.ts, then re-run the recap.'
  const text = [
    `:red_circle: *SV Travel Hub — the Monday recap didn't post to #travel-schedule.*  _(${tag})_`,
    `   • _How we know:_ ${how}`,
    `   • _What to do:_ ${todo}`,
  ].join('\n')
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(12_000),
    })
  } catch (e) {
    console.error('[slack-recap] automation webhook alert failed:', e)
  }
}

// ─── Data loaders ────────────────────────────────────────────────────────────

async function loadRoster(): Promise<RosterPlayer[]> {
  const url = process.env.VITE_ROSTER_CSV_URL
  if (!url) throw new Error('VITE_ROSTER_CSV_URL not configured')
  const csv = await fetchText(url)
  const rows = parseCsv(csv)
  if (rows.length < 2) return []
  const header = rows[0]!.map((h) => h.trim().toLowerCase())
  const col = (names: string[]) => names.map((n) => header.indexOf(n.toLowerCase())).find((i) => i >= 0) ?? -1
  const iName = col(['name', 'player name', 'player'])
  const iTier = col(['tier', 'player tier'])
  const iLevel = col(['level', 'player level'])
  const iOrg = col(['org', 'organization', 'team', 'school'])
  const iAffiliate = col(['affiliate', 'affiliate team'])
  const iState = col(['state', 'home state'])
  const out: RosterPlayer[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!
    const name = (row[iName] ?? '').trim()
    if (!name) continue
    const rawLevel = (row[iLevel] ?? '').toLowerCase().trim()
    const level: RosterPlayer['level'] =
      rawLevel.includes('hs') || rawLevel.includes('high school') ? 'HS' :
      rawLevel.includes('ncaa') || rawLevel.includes('college') || rawLevel.includes('juco') ? 'NCAA' :
      'Pro'
    const tier = parseInt((row[iTier] ?? '2').trim(), 10) || 2
    out.push({
      name,
      tier,
      level,
      org: (row[iOrg] ?? '').trim(),
      affiliate: (row[iAffiliate] ?? '').trim() || undefined,
      state: (row[iState] ?? '').trim() || undefined,
    })
  }
  return out
}

async function loadHeartbeat(): Promise<Map<string, HeartbeatPlayer>> {
  const map = new Map<string, HeartbeatPlayer>()
  try {
    const res = await fetch('https://sv-heartbeat.vercel.app/api/heartbeat/summary', {
      headers: { 'User-Agent': 'SVTravelHub/Slack-Recap' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return map
    const data = await res.json() as { players?: HeartbeatPlayer[] }
    for (const p of data.players ?? []) {
      map.set(p.name.trim().toLowerCase(), p)
    }
  } catch (e) {
    console.warn('[slack-recap] heartbeat fetch failed:', e)
  }
  return map
}

interface PlannedVisit { player: string; snippet: string }

/** Cross-agent visit awareness. Reads recent #travel-schedule messages and
 *  detects when another agent (Mike/Damon/etc.) has already flagged a visit
 *  for a rostered player — so the recap can stop nagging about that player and
 *  call out who's already being covered. Avoids two agents doubling up.
 *
 *  Degrades to a no-op (empty map) if anything is missing — most importantly
 *  the Slack app needs the `channels:history` (public) or `groups:history`
 *  (private) scope added + reinstalled; until then conversations.history
 *  returns `missing_scope` and we simply skip. Matches on full player name
 *  near a visit verb, keyed by lowercased name. */
async function loadPlannedVisits(players: RosterPlayer[]): Promise<Map<string, PlannedVisit>> {
  const out = new Map<string, PlannedVisit>()
  const botToken = process.env.SLACK_BOT_TOKEN
  let channel = process.env.SLACK_CHANNEL_TRAVEL_SCHEDULE
  if (!botToken || !channel) return out
  try {
    // conversations.history needs a channel ID. If we were handed a #name,
    // resolve it (needs channels:read scope; skips gracefully if absent).
    if (!/^C[A-Z0-9]/.test(channel)) {
      const name = channel.replace(/^#/, '')
      const listRes = await fetch('https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=1000', {
        headers: { Authorization: `Bearer ${botToken}` },
        signal: AbortSignal.timeout(12_000),
      })
      const listBody = await listRes.json() as { ok: boolean; channels?: Array<{ id: string; name: string }> }
      const found = (listBody.channels ?? []).find((c) => c.name === name)
      if (!found) return out
      channel = found.id
    }
    // Last 14 days of messages. (Date.now is fine in the Vercel Node runtime.)
    const oldest = Math.floor((Date.now() - 14 * 86400 * 1000) / 1000)
    const res = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel)}&oldest=${oldest}&limit=200`, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(12_000),
    })
    const body = await res.json() as { ok: boolean; error?: string; messages?: Array<{ text?: string; bot_id?: string }> }
    if (!body.ok) { console.warn('[slack-recap] conversations.history:', body.error); return out }
    // Require a visit verb near the name to avoid matching the recap's own
    // "next game" lines or idle chatter.
    const VISIT_RE = /\b(visit|visiting|saw|seeing|see|eyes on|covered|covering|met with|meeting|going to see|catch|catching|headed to)\b/i
    for (const m of body.messages ?? []) {
      if (m.bot_id) continue // skip our own recap posts and other bots
      const text = m.text ?? ''
      if (!VISIT_RE.test(text)) continue
      const lower = text.toLowerCase()
      for (const p of players) {
        const nameLower = p.name.trim().toLowerCase()
        if (nameLower.length > 0 && lower.includes(nameLower)) {
          out.set(nameLower, { player: p.name, snippet: text.replace(/\s+/g, ' ').slice(0, 120) })
        }
      }
    }
  } catch (e) {
    console.warn('[slack-recap] loadPlannedVisits failed:', e)
  }
  return out
}

interface GameLoadResult {
  games: Game[]
  // Pro-attribution quality: how many org-mapped Pro players resolved to a
  // specific affiliate team vs fell back to org-wide game attribution.
  affiliateResolved: number
  affiliateUnresolved: number
}

/** Pull every game we can reach server-side: HS+JUCO from CSV, Summer from CSV,
 *  Pro from MLB Stats API. NCAA is skipped in Phase 1. */
async function loadAllGames(players: RosterPlayer[], today: Date): Promise<GameLoadResult> {
  const startStr = isoDate(today)
  const endDate = new Date(today); endDate.setDate(endDate.getDate() + 5 * 7)
  const endStr = isoDate(endDate)

  const games: Game[] = []
  let affiliateResolved = 0
  let affiliateUnresolved = 0

  // HS + JUCO via the Schedule CSV
  try {
    const hsGames = await loadScheduleCsv(players)
    for (const g of hsGames) if (g.date >= startStr && g.date <= endStr) games.push(g)
  } catch (e) { console.warn('[slack-recap] HS CSV failed:', e) }

  // Summer via the Summer CSV (assignments only — game-level summer requires
  // joining with MLB API for CCBL/MLBD or PrestoSports for others; for Phase 1
  // we surface "X SV players in summer leagues" via the assignment list).
  // Pro via the MLB Stats API for the 5 weeks we care about.
  try {
    const pro = await loadProGames(players, startStr, endStr)
    games.push(...pro.games)
    affiliateResolved = pro.affiliateResolved
    affiliateUnresolved = pro.affiliateUnresolved
  } catch (e) { console.warn('[slack-recap] Pro games failed:', e) }

  return { games, affiliateResolved, affiliateUnresolved }
}

async function loadScheduleCsv(players: RosterPlayer[]): Promise<Game[]> {
  const url = process.env.VITE_SCHEDULE_CSV_URL
  if (!url) return []
  const csv = await fetchText(url)
  const rows = parseCsv(csv)
  if (rows.length < 2) return []
  const header = rows[0]!.map((h) => h.trim().toLowerCase())
  const col = (names: string[]) => names.map((n) => header.indexOf(n.toLowerCase())).find((i) => i >= 0) ?? -1
  const iPlayer = col(['player', 'player name', 'name'])
  const iDate = col(['date', 'game date'])
  const iVenue = col(['venue', 'venue name', 'stadium'])
  const iOpp = col(['opponent', 'opponent team'])
  const iHomeAway = col(['home/away', 'h/a', 'home or away'])

  const playerByName = new Map<string, RosterPlayer>()
  for (const p of players) playerByName.set(p.name.trim().toLowerCase(), p)

  const out: Game[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!
    const playerName = (row[iPlayer] ?? '').trim()
    const date = (row[iDate] ?? '').trim()
    if (!playerName || !date) continue
    const p = playerByName.get(playerName.toLowerCase())
    if (!p) continue
    const ha = (row[iHomeAway] ?? '').toLowerCase()
    out.push({
      date: normalizeIsoDate(date),
      player: p.name,
      venueName: (row[iVenue] ?? '').trim() || 'Unknown venue',
      homeOrAway: ha.startsWith('h') ? 'home' : ha.startsWith('a') ? 'away' : 'unknown',
      opponent: (row[iOpp] ?? '').trim() || undefined,
      tier: p.tier,
      level: p.level === 'HS' ? 'HS' : 'JUCO',
      state: p.state, // CSV has no coords; player home state lets these cluster by region
    })
  }
  return out
}

/** Server-side Pro schedule via MLB Stats API. For each Pro player we resolve
 *  the SPECIFIC affiliate team they play for (the roster's `Affiliate` column)
 *  and attribute only that team's games — not the whole org's farm system.
 *
 *  This fixes the recap putting players in regions they're not in: org-level
 *  attribution credited e.g. a Single-A player (Tampa, FL) with his org's
 *  AAA/AA/A+ games across the country. Players whose affiliate we can't match
 *  fall back to org-wide attribution so they never silently disappear. */
async function loadProGames(players: RosterPlayer[], start: string, end: string): Promise<GameLoadResult> {
  const proPlayers = players.filter((p) => p.level === 'Pro')
  if (proPlayers.length === 0) return { games: [], affiliateResolved: 0, affiliateUnresolved: 0 }

  // Build a tiny MLB org name → teamId map. Covers the 30 MLB orgs Kent cares
  // about. (Same canonical names used in the React app's MLB_PARENT_IDS.)
  const ORG_IDS: Record<string, number> = {
    'arizona diamondbacks': 109, 'atlanta braves': 144, 'baltimore orioles': 110,
    'boston red sox': 111, 'chicago cubs': 112, 'chicago white sox': 145,
    'cincinnati reds': 113, 'cleveland guardians': 114, 'colorado rockies': 115,
    'detroit tigers': 116, 'houston astros': 117, 'kansas city royals': 118,
    'los angeles angels': 108, 'los angeles dodgers': 119, 'miami marlins': 146,
    'milwaukee brewers': 158, 'minnesota twins': 142, 'new york mets': 121,
    'new york yankees': 147, 'oakland athletics': 133, 'athletics': 133,
    'philadelphia phillies': 143, 'pittsburgh pirates': 134, 'san diego padres': 135,
    'san francisco giants': 137, 'seattle mariners': 136, 'st. louis cardinals': 138,
    'tampa bay rays': 139, 'texas rangers': 140, 'toronto blue jays': 141,
    'washington nationals': 120,
  }

  // Group SV players by their parent org. Then for each org, fetch the
  // schedule once (with affiliates) and attribute games to those players.
  const playersByOrgId = new Map<number, RosterPlayer[]>()
  for (const p of proPlayers) {
    const id = ORG_IDS[p.org.toLowerCase().trim()]
    if (!id) continue
    const list = playersByOrgId.get(id) ?? []
    list.push(p)
    playersByOrgId.set(id, list)
  }

  // Normalize a team name for fuzzy matching: lowercase, strip punctuation.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  const out: Game[] = []
  let affiliateResolved = 0
  let affiliateUnresolved = 0
  // Fetch parent + 11=AAA + 12=AA + 13=A+ + 14=A schedules in parallel.
  await Promise.all(Array.from(playersByOrgId.entries()).map(async ([orgId, orgPlayers]) => {
    try {
      const sportIds = [1, 11, 12, 13, 14].join(',')
      // First get this org's affiliate teams (id + name).
      const affResp = await fetch(`https://statsapi.mlb.com/api/v1/teams/affiliates?teamIds=${orgId}&sportIds=${sportIds}`, {
        signal: AbortSignal.timeout(12_000),
      })
      if (!affResp.ok) return
      const affData = await affResp.json() as { teams?: Array<{ id: number; name?: string }> }
      const affiliates = affData.teams ?? []
      if (affiliates.length === 0) return

      // Resolve each SV player to the team id of their actual affiliate. We
      // match the roster's `Affiliate` value against the org's affiliate names:
      // exact normalized first, then one-way containment — the roster value must
      // be a SUBSTRING of the official affiliate name ("Tarpons" → "Tampa
      // Tarpons"). The reverse direction ("Rays" ⊃… no) was removed: the
      // affiliates list includes the MLB parent club (sportIds has 1), so a
      // roster cell like "Rays" containment-matched "Tampa Bay Rays" and the
      // player's actual MiLB games were silently dropped. For the same reason a
      // match that lands ON the parent club is treated as unresolved.
      // Unresolved → null, meaning "fall back to the whole org" so the player
      // still surfaces.
      const teamIdByPlayer = new Map<string, number | null>()
      for (const p of orgPlayers) {
        const want = norm(p.affiliate ?? '')
        let teamId: number | null = null
        if (want) {
          const exact = affiliates.find((t) => norm(t.name ?? '') === want)
          const match = exact ?? affiliates.find((t) => {
            const n = norm(t.name ?? '')
            return n.length > 0 && n.includes(want)
          })
          if (match && match.id !== orgId) teamId = match.id
        }
        teamIdByPlayer.set(p.name, teamId)
        if (teamId != null) affiliateResolved++
        else affiliateUnresolved++
      }

      // Which teams do we actually need schedules for? If every player resolved,
      // fetch only their affiliate teams; if any fell back to org-wide, we still
      // need the full affiliate set so that player gets their games.
      const resolvedIds = new Set<number>()
      let needAll = false
      for (const p of orgPlayers) {
        const id = teamIdByPlayer.get(p.name)
        if (id == null) needAll = true
        else resolvedIds.add(id)
      }
      const teamIds = needAll ? affiliates.map((t) => t.id) : [...resolvedIds]
      if (teamIds.length === 0) return

      // hydrate=venue(location) gives coordinates + city/state so the recap can
      // cluster games into a real drivable trip and label each venue.
      const schedResp = await fetch(`https://statsapi.mlb.com/api/v1/schedule?teamId=${teamIds.join(',')}&startDate=${start}&endDate=${end}&sportId=${sportIds}&hydrate=venue(location)`, {
        signal: AbortSignal.timeout(12_000),
      })
      if (!schedResp.ok) return
      const schedData = await schedResp.json() as { dates?: Array<{ date: string; games?: Array<{ teams?: { home?: { team?: { id?: number; name?: string } }; away?: { team?: { id?: number; name?: string } } }; venue?: { name?: string; location?: { city?: string; stateAbbrev?: string; state?: string; defaultCoordinates?: { latitude?: number; longitude?: number } } } }> }> }
      for (const day of schedData.dates ?? []) {
        for (const g of day.games ?? []) {
          const venueName = g.venue?.name ?? 'Unknown'
          const loc = g.venue?.location
          const coords = loc?.defaultCoordinates
          const homeId = g.teams?.home?.team?.id
          const awayId = g.teams?.away?.team?.id
          const home = g.teams?.home?.team?.name ?? ''
          const away = g.teams?.away?.team?.name ?? ''
          for (const p of orgPlayers) {
            const wantId = teamIdByPlayer.get(p.name) ?? null
            // Resolved player: only their affiliate's own games (home or away).
            // Unresolved (null): org-wide fallback — attribute every game.
            if (wantId != null && wantId !== homeId && wantId !== awayId) continue
            out.push({
              date: day.date,
              player: p.name,
              venueName,
              homeOrAway: 'unknown', // we don't track which team a player is on at the schedule level
              opponent: away !== home ? `${away} @ ${home}` : '',
              tier: p.tier,
              level: 'Pro',
              lat: coords?.latitude,
              lng: coords?.longitude,
              city: loc?.city,
              state: loc?.stateAbbrev ?? loc?.state,
            })
          }
        }
      }
    } catch (e) {
      console.warn(`[slack-recap] Pro schedule fetch failed for org ${orgId}:`, e)
    }
  }))
  return { games: out, affiliateResolved, affiliateUnresolved }
}

// ─── Computations ────────────────────────────────────────────────────────────

function nextFourWeeks(today: Date): Array<{ label: string; start: string; end: string }> {
  // Each "week" is Mon-Sun. Start a week from today's Monday.
  // Today is Mon ~6 AM ET (5 AM in winter — cron is 10:00 UTC) when cron fires;
  // we want the FOLLOWING Mon + 3 more.
  const monday = new Date(today)
  const dayOfWeek = monday.getUTCDay() // 0=Sun, 1=Mon
  // Go to next Monday (always at least 1 week away)
  const daysToNextMonday = ((1 - dayOfWeek + 7) % 7) || 7
  monday.setUTCDate(monday.getUTCDate() + daysToNextMonday)
  const weeks: Array<{ label: string; start: string; end: string }> = []
  for (let i = 0; i < 4; i++) {
    const start = new Date(monday); start.setUTCDate(start.getUTCDate() + i * 7)
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6)
    weeks.push({
      label: `Week of ${shortDate(start)}`,
      start: isoDate(start),
      end: isoDate(end),
    })
  }
  return weeks
}

const tierWeight = (tier: number) => (tier === 1 ? 5 : tier === 2 ? 3 : tier === 3 ? 1 : 0)

/** Great-circle distance in miles. */
function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 3958.8
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Max distance between ANY two venues in one trip (~3h drive). Complete-linkage
// (below) enforces this as the cluster DIAMETER, so a 3-day trip can't sprawl
// across an entire region.
const CLUSTER_RADIUS_MILES = 175

/** Group a window's games into drivable regions via complete-linkage: a game
 *  joins a cluster only if its venue is within CLUSTER_RADIUS_MILES of EVERY
 *  game already in that cluster. This caps the cluster's diameter at the radius
 *  — unlike centroid clustering, which let a trip "chain" outward (Boston →
 *  Baltimore was landing in one cluster). Coordinate-less games (e.g. HS from
 *  the CSV) fall back to one cluster per home state so they still surface. */
function clusterGames(games: Game[]): Game[][] {
  const coordGames = games.filter((g) => typeof g.lat === 'number' && typeof g.lng === 'number')
  const noCoord = games.filter((g) => typeof g.lat !== 'number' || typeof g.lng !== 'number')

  const clusters: Game[][] = []
  for (const g of coordGames) {
    const pt = { lat: g.lat!, lng: g.lng! }
    let target: Game[] | undefined
    for (const c of clusters) {
      if (c.every((m) => haversineMiles({ lat: m.lat!, lng: m.lng! }, pt) <= CLUSTER_RADIUS_MILES)) {
        target = c
        break
      }
    }
    if (!target) { target = []; clusters.push(target) }
    target.push(g)
  }

  // State-bucket the coordinate-less games.
  const byState = new Map<string, Game[]>()
  for (const g of noCoord) {
    const key = g.state || 'Unknown'
    const list = byState.get(key) ?? []
    list.push(g)
    byState.set(key, list)
  }
  for (const list of byState.values()) clusters.push(list)

  return clusters
}

// Friendly metro names for the busiest city in a cluster, so the recap reads
// "LA area" instead of "Anaheim, CA area". Keyed by lowercased "city, st".
const CITY_METRO: Record<string, string> = {
  // LA
  'los angeles, ca': 'LA area', 'anaheim, ca': 'LA area', 'long beach, ca': 'LA area',
  'inglewood, ca': 'LA area', 'pasadena, ca': 'LA area', 'rancho cucamonga, ca': 'LA area',
  'lake elsinore, ca': 'LA area', 'san bernardino, ca': 'LA area',
  // Bay Area
  'san francisco, ca': 'Bay Area', 'oakland, ca': 'Bay Area', 'san jose, ca': 'Bay Area',
  // Phoenix (incl. spring training towns)
  'phoenix, az': 'Phoenix area', 'mesa, az': 'Phoenix area', 'tempe, az': 'Phoenix area',
  'scottsdale, az': 'Phoenix area', 'glendale, az': 'Phoenix area', 'surprise, az': 'Phoenix area',
  'peoria, az': 'Phoenix area', 'goodyear, az': 'Phoenix area',
  // Tampa Bay
  'tampa, fl': 'Tampa Bay area', 'st. petersburg, fl': 'Tampa Bay area', 'st petersburg, fl': 'Tampa Bay area',
  'clearwater, fl': 'Tampa Bay area', 'bradenton, fl': 'Tampa Bay area', 'dunedin, fl': 'Tampa Bay area',
  // South Florida
  'miami, fl': 'South Florida', 'fort lauderdale, fl': 'South Florida', 'jupiter, fl': 'South Florida',
  'west palm beach, fl': 'South Florida',
  // DFW
  'dallas, tx': 'DFW area', 'arlington, tx': 'DFW area', 'fort worth, tx': 'DFW area', 'frisco, tx': 'DFW area',
  // NYC
  'new york, ny': 'NYC area', 'bronx, ny': 'NYC area', 'brooklyn, ny': 'NYC area', 'queens, ny': 'NYC area',
  'newark, nj': 'NYC area', 'jersey city, nj': 'NYC area',
  // Chicago
  'chicago, il': 'Chicago area', 'schaumburg, il': 'Chicago area',
  // A few common MiLB towns → their recognizable metro
  'moosic, pa': 'Scranton area', 'allentown, pa': 'Lehigh Valley',
  'wappingers falls, ny': 'Hudson Valley', 'sacramento, ca': 'Sacramento area',
}

/** "City, ST" → friendly metro name, or `${city} area` fallback. */
function cityAreaLabel(cityState: string): string {
  return CITY_METRO[cityState.toLowerCase()] ?? `${cityState} area`
}

/** Pick a human region label for a cluster from its venues' cities/states. */
function regionLabel(games: Game[]): string {
  const cityCounts = new Map<string, number>()   // "City, ST"
  const stateCounts = new Map<string, number>()
  for (const g of games) {
    if (g.city && g.state) cityCounts.set(`${g.city}, ${g.state}`, (cityCounts.get(`${g.city}, ${g.state}`) ?? 0) + 1)
    if (g.state) stateCounts.set(g.state, (stateCounts.get(g.state) ?? 0) + 1)
  }
  // Prefer a recognizable metro if ANY venue in the cluster maps to one — so a
  // cluster anchored by Yankee Stadium reads "NYC area", not "Bridgewater, NJ".
  const metroCounts = new Map<string, number>()
  for (const [cs, n] of cityCounts) {
    const metro = CITY_METRO[cs.toLowerCase()]
    if (metro) metroCounts.set(metro, (metroCounts.get(metro) ?? 0) + n)
  }
  const topMetro = [...metroCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topMetro) return topMetro[0]
  const topCity = [...cityCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const topState = [...stateCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topCity) return cityAreaLabel(topCity[0])
  if (topState) return topState[0]
  // No location info at all — fall back to the venue with the most games.
  const venueCounts = new Map<string, number>()
  for (const g of games) venueCounts.set(g.venueName, (venueCounts.get(g.venueName) ?? 0) + 1)
  const topVenue = [...venueCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  return topVenue ? topVenue[0] : 'Unknown region'
}

function venueWithCity(g: Game): string {
  return g.city && g.state ? `${g.venueName} (${g.city}, ${g.state})` : g.venueName
}

/** Turn one drivable cluster (already date-windowed) into a scored trip. */
function clusterToTrip(cluster: Game[], wStart: string, wEnd: string): { trip: WindowResult; score: number; players: Set<string> } {
  // Earliest in-cluster game per player; tier = best (lowest) tier seen.
  const earliest = new Map<string, Game>()
  const tierByPlayer = new Map<string, number>()
  const venueCounts = new Map<string, number>()
  for (const g of cluster) {
    const cur = earliest.get(g.player)
    if (!cur || g.date < cur.date) earliest.set(g.player, g)
    const t = tierByPlayer.get(g.player)
    if (t === undefined || g.tier < t) tierByPlayer.set(g.player, g.tier)
    venueCounts.set(venueWithCity(g), (venueCounts.get(venueWithCity(g)) ?? 0) + 1)
  }
  let score = 0, t1 = 0, t2 = 0, t3 = 0
  const players: WindowResult['players'] = []
  for (const [name, g] of earliest) {
    const tier = tierByPlayer.get(name)!
    players.push({ name, tier, venueName: g.venueName, city: g.city, state: g.state, date: g.date })
    score += tierWeight(tier)
    if (tier === 1) t1++; else if (tier === 2) t2++; else if (tier === 3) t3++
  }
  players.sort((a, b) => (a.tier - b.tier) || a.date.localeCompare(b.date))
  const topVenues = [...venueCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0])
  return {
    trip: {
      startDate: wStart, endDate: wEnd, regionLabel: regionLabel(cluster),
      players, uniquePlayerCount: earliest.size, t1Count: t1, t2Count: t2, t3Count: t3, topVenues,
    },
    score,
    players: new Set(earliest.keys()),
  }
}

function computeTopTripsInRange(games: Game[], start: string, end: string): WeekTrips {
  // Slide a 3-day window through [start, end]. Within each window, cluster
  // games into drivable regions and score each region by tier-weighted unique
  // players. Surface the best TWO distinct-region trips of the week (a real
  // itinerary Kent can pick from), not a nationwide headcount no trip covers.
  const inRange = games.filter((g) => g.date >= start && g.date <= end)
  if (inRange.length === 0) return { trips: [], elsewhere: 0 }
  const days: string[] = []
  for (let d = new Date(start + 'T00:00:00Z'); isoDate(d) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(isoDate(d))
  }

  const candidates: Array<{ trip: WindowResult; score: number; players: Set<string> }> = []
  for (let i = 0; i < days.length - 2; i++) {
    const wStart = days[i]!, wEnd = days[i + 2]!
    const inWin = inRange.filter((g) => g.date >= wStart && g.date <= wEnd)
    if (inWin.length === 0) continue
    for (const cluster of clusterGames(inWin)) candidates.push(clusterToTrip(cluster, wStart, wEnd))
  }
  if (candidates.length === 0) return { trips: [], elsewhere: 0 }

  // Best candidate per region (a region can recur across overlapping windows).
  const bestByRegion = new Map<string, { trip: WindowResult; score: number; players: Set<string> }>()
  for (const c of candidates) {
    const prev = bestByRegion.get(c.trip.regionLabel)
    if (!prev || c.score > prev.score) bestByRegion.set(c.trip.regionLabel, c)
  }
  const ranked = [...bestByRegion.values()].sort((a, b) => b.score - a.score).slice(0, 2)

  const covered = new Set<string>()
  for (const c of ranked) for (const p of c.players) covered.add(p)
  const weekPlayers = new Set(inRange.map((g) => g.player))
  const elsewhere = weekPlayers.size - covered.size

  return { trips: ranked.map((c) => c.trip), elsewhere }
}

function computeOverduePlayers(
  players: RosterPlayer[],
  heartbeat: Map<string, HeartbeatPlayer>,
  games: Game[],
  today: Date,
): Array<{ player: RosterPlayer; daysSince: number; nextGame: Game | null }> {
  const todayStr = isoDate(today)
  const upcomingByPlayer = new Map<string, Game>()
  for (const g of games) {
    if (g.date < todayStr) continue
    const existing = upcomingByPlayer.get(g.player)
    if (!existing || g.date < existing.date) upcomingByPlayer.set(g.player, g)
  }
  const out: Array<{ player: RosterPlayer; daysSince: number; nextGame: Game | null }> = []
  for (const p of players) {
    if (p.tier > 2 || p.tier === 4) continue
    const hb = heartbeat.get(p.name.trim().toLowerCase())
    if (!hb || hb.daysSinceInPerson == null || hb.inPersonThresholdDays == null) continue
    if (hb.daysSinceInPerson <= hb.inPersonThresholdDays) continue
    out.push({
      player: p,
      daysSince: hb.daysSinceInPerson,
      nextGame: upcomingByPlayer.get(p.name) ?? null,
    })
  }
  out.sort((a, b) => {
    if (a.player.tier !== b.player.tier) return a.player.tier - b.player.tier
    return b.daysSince - a.daysSince
  })
  return out
}

// ─── Message composition ────────────────────────────────────────────────────

// ─── Non-game events (Combine, showcases, industry meetings) ──────────────────
// Maintained by the team in the "Events" tab of the schedule sheet. Published
// to CSV per-tab; URL overridable via env, defaults to the live published tab
// (public-by-URL, same posture as the other sheets — no secret here).

interface EventRow {
  event: string
  tier: number | null
  city: string
  state: string
  startDate: string
  endDate: string
  staff: string    // SV Staff — who's attending (also feeds cross-agent awareness)
  clients: string  // SV Clients Attending — raw comma list
  travels: boolean // SV is physically traveling (staff assigned, not "Stream"/empty)
}

// Source: the team's maintained "SV Summer Coverage" sheet (published CSV).
// It already carries who's attending AND which clients will be there — so the
// recap gets client-level "who can I see" with zero extra upkeep. Summer-scoped
// for now; winter/industry events (ABCA, Winter Meetings) are a future add.
const EVENTS_CSV_URL = process.env.VITE_EVENTS_CSV_URL
  ?? 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSWoPys4nn-twC2weVoG-DlOHu9JhzXZgYVMJXNmJwPFbNbsLPgzjMzHVK2nUNfLbp7h10itgnAlTPU/pub?output=csv'

/** "Atlanta GA" → {city:'Atlanta', state:'GA'}; "West Palm FL" → {city:'West
 *  Palm', state:'FL'}; "Philly" → {city:'Philly', state:''}. */
function splitLocation(loc: string): { city: string; state: string } {
  const t = loc.trim().split(/\s+/)
  if (t.length >= 2 && /^[A-Z]{2}$/.test(t[t.length - 1]!)) {
    return { city: t.slice(0, -1).join(' '), state: t[t.length - 1]! }
  }
  return { city: loc.trim(), state: '' }
}

async function loadEvents(): Promise<EventRow[]> {
  try {
    const csv = await fetchText(EVENTS_CSV_URL)
    const rows = parseCsv(csv)
    if (rows.length < 2) return []
    const header = rows[0]!.map((h) => h.trim().toLowerCase())
    const col = (name: string) => header.indexOf(name)
    const iTier = col('tier'), iEvent = col('event'), iLoc = col('location'),
      iStart = col('start date'), iEnd = col('end date'),
      iStaff = col('sv staff'), iClients = col('sv clients attending')
    const out: EventRow[] = []
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]!
      const event = (row[iEvent] ?? '').trim()
      if (!event) continue
      const { city, state } = splitLocation(row[iLoc] ?? '')
      const staff = (row[iStaff] ?? '').trim()
      const staffLower = staff.toLowerCase()
      const tierNum = parseInt((row[iTier] ?? '').trim(), 10)
      out.push({
        event,
        tier: Number.isFinite(tierNum) ? tierNum : null,
        city,
        state,
        startDate: normalizeIsoDate((row[iStart] ?? '').trim()),
        endDate: normalizeIsoDate((row[iEnd] ?? '').trim()),
        staff,
        clients: (row[iClients] ?? '').trim(),
        // "Stream" = watching remotely (no travel); empty staff = not covered.
        // This also auto-handles Damon's "might not attend" events.
        travels: staff !== '' && staffLower !== 'stream',
      })
    }
    return out
  } catch (e) {
    console.warn('[slack-recap] loadEvents failed:', e)
    return []
  }
}

function composeSlackMessage(
  windows: WeekTrips[],
  weeks: Array<{ label: string; start: string; end: string }>,
  overdue: Array<{ player: RosterPlayer; daysSince: number; nextGame: Game | null }>,
  covered: PlannedVisit[],
  events: EventRow[],
  rosterSize: number,
): { text: string; blocks: any[] } {
  const lines: string[] = []
  lines.push(`*🗓️ Travel Hub recap*`)
  lines.push('')

  lines.push('*Best 3-day trip each week:*')
  for (let i = 0; i < weeks.length; i++) {
    const wk = weeks[i]!, week = windows[i]!
    if (!week || week.trips.length === 0) {
      lines.push(`• ${wk.label} — no SV games`)
      continue
    }
    // One scannable line per week: dates · region — N players · marquee names.
    // The full who/where/when breakdown lives in the app (link below).
    const w = week.trips[0]!
    const dateRange = `${shortDate(new Date(w.startDate + 'T00:00:00Z'))}–${shortDate(new Date(w.endDate + 'T00:00:00Z'))}`
    // List EVERY player in the area (Kent asked for the full roster per trip,
    // not a "+N" truncation). Players are already sorted T1-first by date.
    const names = w.players.map((p) => p.name).join(', ')
    const t1Str = w.t1Count > 0 ? ` · ${w.t1Count} T1` : ''
    lines.push(`• *${dateRange}* · *${w.regionLabel}* — ${w.uniquePlayerCount} players${t1Str}`)
    lines.push(`     ${names}`)
  }
  lines.push('')

  // Non-game events in the same horizon (Combine, showcases, meetings) with
  // who's attending — so trips can be planned around them.
  if (events.length > 0) {
    lines.push('*📌 Events SV is traveling to — next 4 weeks:*')
    const shown = events.slice(0, 6)
    for (const e of shown) {
      const dr = e.startDate === e.endDate
        ? shortDate(new Date(e.startDate + 'T00:00:00Z'))
        : `${shortDate(new Date(e.startDate + 'T00:00:00Z'))}–${shortDate(new Date(e.endDate + 'T00:00:00Z'))}`
      const loc = e.city && e.state ? `${e.city}, ${e.state}` : (e.city || '')
      const locStr = loc ? ` · ${loc}` : ''
      const who = e.staff ? ` — ${e.staff}` : ''
      // Short client list (the "who can I see" payoff).
      let cl = ''
      const names = e.clients.split(',').map((s) => s.trim()).filter(Boolean)
      if (names.length > 0) cl = ` · _${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}_`
      lines.push(`• *${dr}* · ${e.event}${locStr}${who}${cl}`)
    }
    if (events.length > shown.length) lines.push(`     _+${events.length - shown.length} more — see hub_`)
    lines.push('')
  }

  if (overdue.length > 0) {
    lines.push(`*🔥 Overdue T1/T2 with upcoming games (${overdue.length}):*`)
    for (const r of overdue.slice(0, 6)) {
      const tierTag = r.player.tier === 1 ? 'T1' : 'T2'
      const ng = r.nextGame
      const ngLoc = ng ? (ng.city && ng.state ? `${ng.venueName}, ${ng.city}, ${ng.state}` : ng.venueName) : ''
      const nextStr = ng
        ? ` — next ${shortDate(new Date(ng.date + 'T00:00:00Z'))} (${weekday(new Date(ng.date + 'T00:00:00Z'))}) at ${ngLoc}`
        : ' — no game in next 5 weeks'
      lines.push(`• ${tierTag} *${r.player.name}* (${r.daysSince}d since visit)${nextStr}`)
    }
    if (overdue.length > 6) lines.push(`+${overdue.length - 6} more`)
    lines.push('')
  } else {
    lines.push('_No overdue T1/T2 players. Nice work._')
    lines.push('')
  }

  // Cross-agent awareness: players another agent has already flagged a visit
  // for in #travel-schedule. Surfaced so trips don't double up coverage.
  if (covered.length > 0) {
    lines.push(`*🤝 Already being covered (${covered.length}):*`)
    for (const c of covered.slice(0, 6)) {
      lines.push(`• *${c.player}* — flagged in #travel-schedule`)
    }
    if (covered.length > 6) lines.push(`+${covered.length - 6} more`)
    lines.push('')
  }

  lines.push(`<https://sv-travel-hub.vercel.app|Open Travel Hub →>`)
  lines.push(`_${rosterSize} clients · NCAA coverage coming in a follow-up_`)

  const text = lines.join('\n')
  return { text, blocks: buildBlocks(text) }
}

/** Split a long message into multiple Slack section blocks. A single section's
 *  mrkdwn text is capped at 3000 chars by Slack (exceeding it → invalid_blocks,
 *  which is what broke the verbose recap). We chunk on line boundaries, keeping
 *  each block comfortably under the limit; a single line longer than the limit
 *  (e.g. a mega roster line) is hard-split mid-line so invalid_blocks can never
 *  recur. */
function buildBlocks(text: string): Array<{ type: 'section'; text: { type: 'mrkdwn'; text: string } }> {
  const MAX = 2900
  const blocks: Array<{ type: 'section'; text: { type: 'mrkdwn'; text: string } }> = []
  let buf = ''
  for (const rawLine of text.split('\n')) {
    // Hard-split oversized lines first so every piece fits in a block on its own.
    const pieces: string[] = []
    if (rawLine.length <= MAX) {
      pieces.push(rawLine)
    } else {
      for (let i = 0; i < rawLine.length; i += MAX) pieces.push(rawLine.slice(i, i + MAX))
    }
    for (const line of pieces) {
      if (buf.length > 0 && (buf.length + 1 + line.length) > MAX) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: buf } })
        buf = line
      } else {
        buf = buf ? `${buf}\n${line}` : line
      }
    }
  }
  if (buf.length > 0) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: buf } })
  return blocks
}

// ─── Utilities ───────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  // Google's published-CSV endpoint intermittently stalls a single request
  // while healthy — retry so one blip doesn't drop a recap section.
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500))
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SVTravelHub/Slack-Recap' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`fetchText ${url}: HTTP ${res.status}`)
      return res.text()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

/** Tiny RFC-4180-ish CSV parser. Handles quoted fields with commas and
 *  doubled-quote escapes. Skips empty trailing rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') { inQuote = false }
      else { cur += c }
    } else {
      if (c === '"') { inQuote = true }
      else if (c === ',') { row.push(cur); cur = '' }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
      else { cur += c }
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function normalizeIsoDate(s: string): string {
  // Accepts YYYY-MM-DD, M/D/YYYY, MM/DD/YYYY → YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const mm = m[1]!.padStart(2, '0')
    const dd = m[2]!.padStart(2, '0')
    return `${m[3]}-${mm}-${dd}`
  }
  return s
}

function shortDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

function weekday(d: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]!
}
