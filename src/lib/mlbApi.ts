import type { Coordinates } from '../types/roster'

const MLB_BASE = 'https://statsapi.mlb.com/api/v1'

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
  teams: {
    away: { team: { id: number; name: string } }
    home: { team: { id: number; name: string } }
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
  }
  status: { detailedState: string }
}

// Fetch all MiLB/MLB affiliates for a parent org
export async function fetchAffiliates(parentTeamId: number): Promise<MLBAffiliate[]> {
  const sportIds = MILB_SPORT_IDS.join(',')
  const url = `${MLB_BASE}/teams/affiliates?teamIds=${parentTeamId}&sportIds=${sportIds}`
  const res = await fetch(url)
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
  const url = `${MLB_BASE}/schedule?sportId=${sportId}&teamId=${teamId}&startDate=${startDate}&endDate=${endDate}&hydrate=venue(location)`
  const res = await fetch(url)
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
}

export async function fetchTeamRoster(teamId: number, sportId: number): Promise<MLBRosterEntry[]> {
  const url = `${MLB_BASE}/teams/${teamId}/roster?rosterType=fullRoster`
  const res = await fetch(url)
  if (!res.ok) return [] // Some teams may not have rosters available
  const data = await res.json()

  return (data.roster ?? []).map((entry: Record<string, unknown>) => {
    const person = entry.person as Record<string, unknown> | undefined
    return {
      playerId: (person?.id as number) ?? 0,
      fullName: (person?.fullName as string) ?? '',
      teamId,
      teamName: '', // Will be filled in by caller
      sportId,
    }
  })
}

// Batch fetch rosters for multiple teams
export async function fetchAllRosters(
  teams: Array<{ teamId: number; sportId: number; teamName: string }>,
  onProgress?: (completed: number, total: number) => void,
): Promise<MLBRosterEntry[]> {
  const all: MLBRosterEntry[] = []
  const concurrency = 5
  let completed = 0

  for (let i = 0; i < teams.length; i += concurrency) {
    const batch = teams.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(async (t) => {
        const roster = await fetchTeamRoster(t.teamId, t.sportId)
        return roster.map((r) => ({ ...r, teamName: t.teamName }))
      }),
    )
    for (const entries of results) all.push(...entries)
    completed += batch.length
    onProgress?.(completed, teams.length)
  }

  return all
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

// Batch fetch schedules for multiple teams
export async function fetchAllSchedules(
  teams: Array<{ teamId: number; sportId: number }>,
  startDate: string,
  endDate: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<number, MLBGameRaw[]>> {
  const schedules = new Map<number, MLBGameRaw[]>()
  const concurrency = 5
  let completed = 0

  for (let i = 0; i < teams.length; i += concurrency) {
    const batch = teams.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(async (t) => {
        const games = await fetchSchedule(t.teamId, t.sportId, startDate, endDate)
        return { teamId: t.teamId, games }
      }),
    )
    for (const r of results) {
      schedules.set(r.teamId, r.games)
    }
    completed += batch.length
    onProgress?.(completed, teams.length)
  }

  return schedules
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
  const res = await fetch(url)
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
export async function fetchAllTransactions(
  teamIds: number[],
  startDate: string,
  endDate: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<MLBTransaction[]> {
  const all: MLBTransaction[] = []
  const concurrency = 5
  let completed = 0

  for (let i = 0; i < teamIds.length; i += concurrency) {
    const batch = teamIds.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map((id) => fetchTransactions(id, startDate, endDate).catch(() => [] as MLBTransaction[])),
    )
    for (const txns of results) {
      all.push(...txns)
    }
    completed += batch.length
    onProgress?.(completed, teamIds.length)
  }

  return all
}
