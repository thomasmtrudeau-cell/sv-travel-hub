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
