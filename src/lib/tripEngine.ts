import type { Coordinates } from '../types/roster'
import type { RosterPlayer } from '../types/roster'
import type { GameEvent, TripCandidate, TripPlan } from '../types/schedule'
import { TIER_VISIT_TARGETS } from '../types/roster'
import { computeDriveTimes } from './routing'
import { isSpringTraining, getSpringTrainingSite } from '../data/springTraining'
import { resolveMLBTeamId } from '../data/aliases'

// Constants
const HOME_BASE: Coordinates = { lat: 28.5383, lng: -81.3792 } // Orlando, FL
const MAX_DRIVE_MINUTES = 180 // 3 hours one-way
const ANCHOR_DAY = 4 // Thursday (0=Sun, 4=Thu)

const TIER_WEIGHTS: Record<number, number> = {
  1: 5,
  2: 3,
  3: 1,
  4: 0,
}

// Check if a date falls on Sunday (blackout)
function isSunday(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.getUTCDay() === 0
}

// Check if a date is allowed for travel (not Sunday)
export function isDateAllowed(dateStr: string): boolean {
  return !isSunday(dateStr)
}

// Get all dates in a range (inclusive)
function getDatesInRange(start: string, end: string): string[] {
  const dates: string[] = []
  const current = new Date(start + 'T12:00:00Z')
  const endDate = new Date(end + 'T12:00:00Z')

  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]!)
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

// Find Thursdays in a date range
function getThursdays(start: string, end: string): string[] {
  return getDatesInRange(start, end).filter((d) => {
    const day = new Date(d + 'T12:00:00Z').getUTCDay()
    return day === ANCHOR_DAY
  })
}

// Get Wed-Sat window around a Thursday
function getTripWindow(thursday: string): string[] {
  const thu = new Date(thursday + 'T12:00:00Z')
  const wed = new Date(thu)
  wed.setUTCDate(wed.getUTCDate() - 1)
  const sat = new Date(thu)
  sat.setUTCDate(sat.getUTCDate() + 2)

  return getDatesInRange(
    wed.toISOString().split('T')[0]!,
    sat.toISOString().split('T')[0]!,
  ).filter(isDateAllowed) // Exclude Sundays (shouldn't hit any in Wed-Sat but just in case)
}

// Score a trip candidate
export function scoreTripCandidate(
  playerNames: string[],
  playerMap: Map<string, RosterPlayer>,
): number {
  let score = 0
  for (const name of playerNames) {
    const player = playerMap.get(name)
    if (!player) continue
    const weight = TIER_WEIGHTS[player.tier] ?? 0
    score += weight * player.visitsRemaining
  }
  return score
}

// Generate synthetic spring training visit opportunities for Pro players
// During ST, players are at their parent org's ST facility every day (except Sunday)
export function generateSpringTrainingEvents(
  players: RosterPlayer[],
  startDate: string,
  endDate: string,
): GameEvent[] {
  const events: GameEvent[] = []
  const dates = getDatesInRange(startDate, endDate).filter(
    (d) => isSpringTraining(d) && isDateAllowed(d),
  )

  if (dates.length === 0) return events

  // Group Pro players by parent org
  const playersByOrg = new Map<number, string[]>()
  for (const p of players) {
    if (p.level !== 'Pro' || p.visitsRemaining <= 0) continue
    const orgId = resolveMLBTeamId(p.org)
    if (!orgId) continue
    const existing = playersByOrg.get(orgId)
    if (existing) existing.push(p.playerName)
    else playersByOrg.set(orgId, [p.playerName])
  }

  // Create events for each org's ST site on each valid date
  for (const [orgId, playerNames] of playersByOrg) {
    const site = getSpringTrainingSite(orgId)
    if (!site) continue

    for (const date of dates) {
      const d = new Date(date + 'T12:00:00Z')
      events.push({
        id: `st-${orgId}-${date}`,
        date,
        dayOfWeek: d.getUTCDay(),
        time: date + 'T13:00:00Z',
        homeTeam: site.venueName,
        awayTeam: 'Spring Training',
        isHome: true,
        venue: { name: site.venueName, coords: site.coords },
        source: 'mlb-api',
        playerNames,
      })
    }
  }

  return events
}

// Main trip generation algorithm
export async function generateTrips(
  games: GameEvent[],
  players: RosterPlayer[],
  startDate: string,
  endDate: string,
  onProgress?: (step: string, detail?: string) => void,
): Promise<TripPlan> {
  onProgress?.('Preparing', 'Filtering eligible players...')

  // Build player lookup
  const playerMap = new Map<string, RosterPlayer>()
  for (const p of players) {
    playerMap.set(p.playerName, p)
  }

  // Filter to players needing visits
  const eligiblePlayers = new Set(
    players.filter((p) => p.visitsRemaining > 0).map((p) => p.playerName),
  )

  // Filter games: no Sundays, within date range, with eligible players
  const eligibleGames = games.filter(
    (g) =>
      isDateAllowed(g.date) &&
      g.date >= startDate &&
      g.date <= endDate &&
      g.playerNames.some((n) => eligiblePlayers.has(n)),
  )

  if (eligibleGames.length === 0) {
    return {
      trips: [],
      unvisitablePlayers: [...eligiblePlayers],
      totalPlayersWithVisits: 0,
      totalVisitsCovered: 0,
      coveragePercent: 0,
    }
  }

  onProgress?.('Finding anchors', 'Identifying Thursday games...')

  // Find all Thursdays
  const thursdays = getThursdays(startDate, endDate)

  // Build trip candidates for each Thursday anchor
  const candidates: TripCandidate[] = []

  for (const thursday of thursdays) {
    const window = getTripWindow(thursday)

    // Find games on this Thursday with eligible players
    const thursdayGames = eligibleGames.filter((g) => g.date === thursday)

    for (const anchor of thursdayGames) {
      onProgress?.('Computing drive times', `Anchor: ${anchor.venue.name} on ${thursday}`)

      // Find nearby games within the trip window
      const windowGames = eligibleGames.filter(
        (g) =>
          window.includes(g.date) &&
          g.id !== anchor.id &&
          g.venue.coords.lat !== 0 &&
          g.venue.coords.lng !== 0,
      )

      if (windowGames.length === 0) {
        // Solo anchor trip
        const driveFromHome = await computeDriveTimes(HOME_BASE, [anchor.venue.coords])
        if (driveFromHome[0]! <= MAX_DRIVE_MINUTES) {
          const visitedPlayers = anchor.playerNames.filter((n) => eligiblePlayers.has(n))
          candidates.push({
            anchorGame: anchor,
            nearbyGames: [],
            suggestedDays: [anchor.date],
            totalPlayersVisited: visitedPlayers.length,
            visitValue: scoreTripCandidate(visitedPlayers, playerMap),
          })
        }
        continue
      }

      // Compute drive times from anchor to all window games
      const candidateCoords = windowGames.map((g) => g.venue.coords)
      const driveTimes = await computeDriveTimes(anchor.venue.coords, candidateCoords)

      // Filter to within 3hr radius
      const nearbyGames = windowGames
        .map((g, i) => ({ ...g, driveMinutes: driveTimes[i]! }))
        .filter((g) => g.driveMinutes <= MAX_DRIVE_MINUTES && g.driveMinutes >= 0)

      // Also check anchor is reachable from Orlando
      const driveFromHome = await computeDriveTimes(HOME_BASE, [anchor.venue.coords])
      if (driveFromHome[0]! > MAX_DRIVE_MINUTES) continue

      // Collect all unique players visited
      const allPlayerNames = new Set<string>()
      for (const name of anchor.playerNames) {
        if (eligiblePlayers.has(name)) allPlayerNames.add(name)
      }
      for (const g of nearbyGames) {
        for (const name of g.playerNames) {
          if (eligiblePlayers.has(name)) allPlayerNames.add(name)
        }
      }

      const suggestedDays = [...new Set([anchor.date, ...nearbyGames.map((g) => g.date)])].sort()

      candidates.push({
        anchorGame: anchor,
        nearbyGames,
        suggestedDays,
        totalPlayersVisited: allPlayerNames.size,
        visitValue: scoreTripCandidate([...allPlayerNames], playerMap),
      })
    }
  }

  onProgress?.('Optimizing', 'Selecting best trips...')

  // Greedy selection: pick highest-value trip, remove visited players, repeat
  const selectedTrips: TripCandidate[] = []
  const visitedPlayers = new Set<string>()
  const remainingCandidates = [...candidates].sort((a, b) => b.visitValue - a.visitValue)

  while (remainingCandidates.length > 0) {
    // Rescore remaining candidates excluding already-visited players
    for (const trip of remainingCandidates) {
      const remainingPlayerNames = [
        ...trip.anchorGame.playerNames,
        ...trip.nearbyGames.flatMap((g) => g.playerNames),
      ].filter((n) => eligiblePlayers.has(n) && !visitedPlayers.has(n))

      trip.visitValue = scoreTripCandidate([...new Set(remainingPlayerNames)], playerMap)
      trip.totalPlayersVisited = new Set(remainingPlayerNames).size
    }

    // Re-sort and pick best
    remainingCandidates.sort((a, b) => b.visitValue - a.visitValue)

    const best = remainingCandidates[0]!
    if (best.visitValue === 0) break

    selectedTrips.push(best)

    // Mark players as visited
    for (const name of best.anchorGame.playerNames) {
      if (eligiblePlayers.has(name)) visitedPlayers.add(name)
    }
    for (const g of best.nearbyGames) {
      for (const name of g.playerNames) {
        if (eligiblePlayers.has(name)) visitedPlayers.add(name)
      }
    }

    // Remove this candidate
    remainingCandidates.shift()
  }

  // Compute stats
  const unvisitablePlayers = [...eligiblePlayers].filter((n) => !visitedPlayers.has(n))
  const totalTarget = players.reduce((sum, p) => sum + (TIER_VISIT_TARGETS[p.tier] ?? 0), 0)
  const totalCovered = visitedPlayers.size

  return {
    trips: selectedTrips,
    unvisitablePlayers,
    totalPlayersWithVisits: totalCovered,
    totalVisitsCovered: totalCovered,
    coveragePercent: totalTarget > 0 ? Math.round((totalCovered / eligiblePlayers.size) * 100) : 0,
  }
}

export { HOME_BASE, MAX_DRIVE_MINUTES }
