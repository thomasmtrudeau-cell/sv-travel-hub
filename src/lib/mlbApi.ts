import type { Coordinates } from '../types/roster'
import { fetchWithTimeout } from './fetchWithTimeout'

const MLB_BASE = 'https://statsapi.mlb.com/api/v1'

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_RETRY_ATTEMPTS = 3

// Wraps fetchWithTimeout with retry + exponential backoff for transient failures
async function fetchWithRetry(
  url: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(url, options)
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) {
        return res
      }
      // Retryable HTTP status — fall through to backoff
      lastError = new Error(`HTTP ${res.status}`)
    } catch (e) {
      // Network error or timeout — retryable
      lastError = e
    }
    if (attempt < MAX_RETRY_ATTEMPTS - 1) {
      const delayMs = 1000 * Math.pow(2, attempt) // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastError
}

// MiLB sport IDs: 11=AAA, 12=AA, 13=High-A, 14=A, 1=MLB
const MILB_SPORT_IDS = [1, 11, 12, 13, 14]

export interface MLBAffiliate {
  teamId: number
  teamName: string
  sportId: number
  sportName: string
  parentOrgId: number
}

export interface MLBGameRaw {
  gamePk: number
  gameDate: string
  /** Venue-local calendar date (YYYY-MM-DD). gameDate is UTC, so a West
   *  Coast night game's UTC date is the NEXT day — never derive the
   *  schedule date from gameDate. */
  officialDate?: string
  teams: {
    away: {
      team: { id: number; name: string }
      probablePitcher?: { id: number; fullName: string }
    }
    home: {
      team: { id: number; name: string }
      probablePitcher?: { id: number; fullName: string }
    }
  }
  venue: {
    id: number
    name: string
    location?: {
      defaultCoordinates?: {
        latitude: number
        longitude: number
      }
    }
    timeZone?: { id?: string }
  }
  status: { detailedState: string }
}

// Fetch all MiLB/MLB affiliates for a parent org
export async function fetchAffiliates(parentTeamId: number): Promise<MLBAffiliate[]> {
  const sportIds = MILB_SPORT_IDS.join(',')
  const url = `${MLB_BASE}/teams/affiliates?teamIds=${parentTeamId}&sportIds=${sportIds}`
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new Error(`MLB affiliates fetch failed: ${res.status}`)
  const data = await res.json()

  return (data.teams ?? []).map((t: Record<string, unknown>) => ({
    teamId: t.id as number,
    teamName: t.name as string,
    sportId: (t.sport as Record<string, unknown>).id as number,
    sportName: (t.sport as Record<string, unknown>).name as string,
    parentOrgId: parentTeamId,
  }))
}

// Fetch schedule for a specific team within a date range
export async function fetchSchedule(
  teamId: number,
  sportId: number,
  startDate: string, // YYYY-MM-DD
  endDate: string,
): Promise<MLBGameRaw[]> {
  const url = `${MLB_BASE}/schedule?sportId=${sportId}&teamId=${teamId}&startDate=${startDate}&endDate=${endDate}&hydrate=venue(location,timezone),probablePitcher`
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new Error(`MLB schedule fetch failed: ${res.status}`)
  const data = await res.json()

  const games: MLBGameRaw[] = []
  for (const date of data.dates ?? []) {
    for (const game of date.games ?? []) {
      games.push(game)
    }
  }
  return games
}

// Extract venue coordinates from an MLB game
export function extractVenueCoords(game: MLBGameRaw): Coordinates | null {
  const loc = game.venue?.location?.defaultCoordinates
  if (!loc) return null
  return { lat: loc.latitude, lng: loc.longitude }
}

// Fetch current roster for a team (returns player IDs and names)
export interface MLBRosterEntry {
  playerId: number
  fullName: string
  teamId: number
  teamName: string
  sportId: number
  /** Position code from the roster API. "P" = pitcher; otherwise position player. */
  positionCode?: string
  /** Roster status code from the API: "A" active, "D10"/"D15"/"D60" injured
   *  list, "RM" reassigned to minors, etc. Only populated for 40Man fetches. */
  statusCode?: string
}

export async function fetchTeamRoster(teamId: number, sportId: number, season?: number, rosterType: string = 'fullRoster'): Promise<MLBRosterEntry[]> {
  const url = `${MLB_BASE}/teams/${teamId}/roster?rosterType=${rosterType}${season ? `&season=${season}` : ''}`
  const res = await fetchWithRetry(url, { timeoutMs: 10000 })
  if (res.status === 404) {
    // Some teams legitimately have no roster available — not a fetch failure
    return []
  }
  if (!res.ok) {
    throw new Error(`Roster fetch failed for team ${teamId}: HTTP ${res.status}`)
  }
  const data = await res.json()

  return (data.roster ?? []).map((entry: Record<string, unknown>) => {
    const person = entry.person as Record<string, unknown> | undefined
    const position = entry.position as Record<string, unknown> | undefined
    const status = entry.status as Record<string, unknown> | undefined
    return {
      playerId: (person?.id as number) ?? 0,
      fullName: (person?.fullName as string) ?? '',
      teamId,
      teamName: '', // Will be filled in by caller
      sportId,
      positionCode: (position?.code as string) ?? undefined,
      statusCode: (status?.code as string) ?? undefined,
    }
  })
}

// Batch fetch rosters for multiple teams
export interface RosterFetchResult {
  entries: MLBRosterEntry[]
  /** Teams whose roster fetch failed outright (network / HTTP error after retries). */
  failedTeams: Array<{ teamId: number; sportId: number; teamName: string }>
}

export async function fetchAllRosters(
  teams: Array<{ teamId: number; sportId: number; teamName: string }>,
  onProgress?: (completed: number, total: number) => void,
  season?: number,
  rosterType: string = 'fullRoster',
): Promise<RosterFetchResult> {
  const all: MLBRosterEntry[] = []
  const failedTeams: RosterFetchResult['failedTeams'] = []
  const concurrency = 5
  let completed = 0

  for (let i = 0; i < teams.length; i += concurrency) {
    const batch = teams.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          const roster = await fetchTeamRoster(t.teamId, t.sportId, season, rosterType)
          return { team: t, entries: roster.map((r) => ({ ...r, teamName: t.teamName })), failed: false }
        } catch (e) {
          console.warn(`Roster fetch failed for team ${t.teamId} after retries:`, e)
          return { team: t, entries: [] as MLBRosterEntry[], failed: true }
        }
      }),
    )
    for (const r of results) {
      all.push(...r.entries)
      if (r.failed) failedTeams.push(r.team)
    }
    completed += batch.length
    onProgress?.(completed, teams.length)
  }

  return { entries: all, failedTeams }
}

// Batch fetch all affiliates for multiple parent orgs
// Rate limited to 5 concurrent requests
export async function fetchAllAffiliates(
  parentTeamIds: number[],
  onProgress?: (completed: number, total: number) => void,
): Promise<MLBAffiliate[]> {
  const all: MLBAffiliate[] = []
  const concurrency = 5
  let completed = 0

  for (let i = 0; i < parentTeamIds.length; i += concurrency) {
    const batch = parentTeamIds.slice(i, i + concurrency)
    const results = await Promise.all(batch.map((id) => fetchAffiliates(id)))
    for (const affiliates of results) {
      all.push(...affiliates)
    }
    completed += batch.length
    onProgress?.(completed, parentTeamIds.length)
  }

  return all
}

// Batch fetch schedules for multiple teams.
// Failed teams are NOT added to the map (no silently-empty schedules) —
// they're reported in failedTeamIds, same pattern as fetchAllTransactions.
export interface ScheduleFetchResult {
  schedules: Map<number, MLBGameRaw[]>
  failedTeamIds: number[]
}

export async function fetchAllSchedules(
  teams: Array<{ teamId: number; sportId: number }>,
  startDate: string,
  endDate: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<ScheduleFetchResult> {
  const schedules = new Map<number, MLBGameRaw[]>()
  const failedTeamIds: number[] = []
  const concurrency = 5
  let completed = 0

  for (let i = 0; i < teams.length; i += concurrency) {
    const batch = teams.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          const games = await fetchSchedule(t.teamId, t.sportId, startDate, endDate)
          return { teamId: t.teamId, games, failed: false }
        } catch (e) {
          console.warn(`Schedule fetch failed for team ${t.teamId} after retries:`, e)
          return { teamId: t.teamId, games: [] as MLBGameRaw[], failed: true }
        }
      }),
    )
    for (const r of results) {
      if (r.failed) failedTeamIds.push(r.teamId)
      else schedules.set(r.teamId, r.games)
    }
    completed += batch.length
    onProgress?.(completed, teams.length)
    // Yield to browser event loop between batches
    if (i + concurrency < teams.length) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  return { schedules, failedTeamIds }
}

// --- Transactions API ---

export interface MLBTransaction {
  player: { id: number; fullName: string }
  fromTeam?: { id: number; name: string }
  toTeam?: { id: number; name: string }
  typeDesc: string          // "Recalled", "Optioned", "Traded", etc.
  date: string              // "2026-03-01"
  effectiveDate: string
}

// Fetch transactions for a team within a date range
export async function fetchTransactions(
  teamId: number,
  startDate: string,
  endDate: string,
): Promise<MLBTransaction[]> {
  const url = `${MLB_BASE}/transactions?teamId=${teamId}&startDate=${startDate}&endDate=${endDate}`
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new Error(`MLB transactions fetch failed: ${res.status}`)
  const data = await res.json()

  const transactions: MLBTransaction[] = []
  for (const t of data.transactions ?? []) {
    transactions.push({
      player: { id: t.person?.id ?? 0, fullName: t.person?.fullName ?? 'Unknown' },
      fromTeam: t.fromTeam ? { id: t.fromTeam.id, name: t.fromTeam.name } : undefined,
      toTeam: t.toTeam ? { id: t.toTeam.id, name: t.toTeam.name } : undefined,
      typeDesc: t.typeDesc ?? t.description ?? '',
      date: t.date ?? '',
      effectiveDate: t.effectiveDate ?? t.date ?? '',
    })
  }
  return transactions
}

// Batch fetch transactions for multiple teams
export interface TransactionFetchResult {
  transactions: MLBTransaction[]
  failedTeamIds: number[]
}

export async function fetchAllTransactions(
  teamIds: number[],
  startDate: string,
  endDate: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<TransactionFetchResult> {
  const all: MLBTransaction[] = []
  const failedTeamIds: number[] = []
  const concurrency = 5
  let completed = 0

  for (let i = 0; i < teamIds.length; i += concurrency) {
    const batch = teamIds.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          return { id, txns: await fetchTransactions(id, startDate, endDate) }
        } catch {
          return { id, txns: [] as MLBTransaction[], failed: true }
        }
      }),
    )
    for (const r of results) {
      all.push(...r.txns)
      if ('failed' in r && r.failed) failedTeamIds.push(r.id)
    }
    completed += batch.length
    onProgress?.(completed, teamIds.length)
  }

  return { transactions: all, failedTeamIds }
}

// --- Rehab assignment detection ---

export interface RehabAssignmentTxn {
  playerName: string
  playerId: number
  toTeamId?: number
  toTeamName?: string
  /** Effective date of the rehab assignment, ISO YYYY-MM-DD. */
  effectiveDate: string
  description: string
}

/**
 * Filter a list of transactions down to just rehab assignments. The MLB API
 * doesn't expose a clean typeCode for rehab — we match on the description
 * containing "rehab" (and not "ended" / "completed"). Returns the most recent
 * rehab assignment per player within the window.
 */
export function extractActiveRehabAssignments(
  transactions: MLBTransaction[],
): RehabAssignmentTxn[] {
  const byPlayer = new Map<number, RehabAssignmentTxn>()
  for (const t of transactions) {
    const desc = (t.typeDesc ?? '').toLowerCase()
    if (!desc.includes('rehab')) continue
    // Skip "ended/completed/returned" — only count outbound rehab starts
    if (/ended|completed|returned|recalled|reinstated/.test(desc)) continue
    const playerId = t.player.id
    if (!playerId) continue
    const existing = byPlayer.get(playerId)
    // Keep the most recent effective date per player
    const effective = t.effectiveDate || t.date
    if (!existing || effective > existing.effectiveDate) {
      byPlayer.set(playerId, {
        playerName: t.player.fullName,
        playerId,
        toTeamId: t.toTeam?.id,
        toTeamName: t.toTeam?.name,
        effectiveDate: effective,
        description: t.typeDesc,
      })
    }
  }
  return Array.from(byPlayer.values())
}
