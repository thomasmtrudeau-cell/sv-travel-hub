import type { Coordinates } from '../types/roster'
import type { RosterPlayer } from '../types/roster'
import type { GameEvent, TripCandidate, TripPlan, PriorityResult, VisitConfidence, FlyInVisit } from '../types/schedule'
import { TIER_VISIT_TARGETS } from '../types/roster'
import { isSpringTraining, getSpringTrainingSite } from '../data/springTraining'
import { resolveMLBTeamId, resolveNcaaName } from '../data/aliases'
import { NCAA_VENUES } from '../data/ncaaVenues'
import { D1_BASEBALL_SLUGS } from '../data/d1baseballSlugs'

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

// Haversine distance in km between two coordinates
function haversineKm(a: Coordinates, b: Coordinates): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// Estimate drive time in minutes from straight-line distance
// ~90 km/h avg speed with 1.3 detour factor (reasonable for Florida highway driving)
function estimateDriveMinutes(a: Coordinates, b: Coordinates): number {
  const km = haversineKm(a, b)
  return Math.round((km * 1.3 / 90) * 60)
}

// Estimate total travel time for a fly-in visit (hours)
// Includes: drive to airport (0.5h) + security/boarding (1.5h) + flight + deplane/rental (1h)
function estimateFlightHours(distanceKm: number): number {
  const flightHours = distanceKm / 800 // ~800 km/h avg commercial speed
  const overhead = 3 // airport + rental car on both ends
  return Math.round((flightHours + overhead) * 10) / 10
}

// Get ISO week number for venue-week deduplication
function getWeekNumber(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z')
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.floor((d.getTime() - yearStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
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

// Get trip window around any anchor day (day before through 2 days after, excluding Sundays)
function getTripWindow(anchorDate: string): string[] {
  const anchor = new Date(anchorDate + 'T12:00:00Z')
  const dayBefore = new Date(anchor)
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1)
  const twoDaysAfter = new Date(anchor)
  twoDaysAfter.setUTCDate(twoDaysAfter.getUTCDate() + 2)

  return getDatesInRange(
    dayBefore.toISOString().split('T')[0]!,
    twoDaysAfter.toISOString().split('T')[0]!,
  ).filter(isDateAllowed) // Exclude Sundays
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
        sourceUrl: 'https://www.mlb.com/spring-training/schedule',
      })
    }
  }

  return events
}

// NCAA baseball season: mid-February through early June
const NCAA_SEASON_START = '02-14' // MM-DD
const NCAA_SEASON_END = '06-15'
// Typical NCAA home game days: Tuesday, Friday, Saturday
const NCAA_HOME_GAME_DAYS = [2, 5, 6] // 0=Sun, 2=Tue, 5=Fri, 6=Sat

function isNcaaSeason(dateStr: string): boolean {
  const mmdd = dateStr.slice(5)
  return mmdd >= NCAA_SEASON_START && mmdd <= NCAA_SEASON_END
}

// HS baseball season: mid-February through mid-May
const HS_SEASON_START = '02-14'
const HS_SEASON_END = '05-15'
// Typical HS home game days: Tuesday, Thursday
const HS_HOME_GAME_DAYS = [2, 4] // Tue, Thu

function isHsSeason(dateStr: string): boolean {
  const mmdd = dateStr.slice(5)
  return mmdd >= HS_SEASON_START && mmdd <= HS_SEASON_END
}

// Generate visit opportunities for NCAA players at their school venues
export function generateNcaaEvents(
  players: RosterPlayer[],
  startDate: string,
  endDate: string,
): GameEvent[] {
  const events: GameEvent[] = []
  const dates = getDatesInRange(startDate, endDate).filter(
    (d) => isNcaaSeason(d) && isDateAllowed(d),
  )

  if (dates.length === 0) return events

  // Group NCAA players by school
  const playersBySchool = new Map<string, { players: string[]; venue: typeof NCAA_VENUES[string] }>()
  for (const p of players) {
    if (p.level !== 'NCAA' || p.visitsRemaining <= 0) continue
    const canonical = resolveNcaaName(p.org)
    if (!canonical) continue
    const venue = NCAA_VENUES[canonical]
    if (!venue) continue
    const existing = playersBySchool.get(canonical)
    if (existing) existing.players.push(p.playerName)
    else playersBySchool.set(canonical, { players: [p.playerName], venue })
  }

  for (const [school, { players: playerNames, venue }] of playersBySchool) {
    for (const date of dates) {
      const d = new Date(date + 'T12:00:00Z')
      const dow = d.getUTCDay()
      const isGameDay = NCAA_HOME_GAME_DAYS.includes(dow)

      // Determine confidence
      let confidence: VisitConfidence
      let confidenceNote: string
      if (isGameDay) {
        confidence = 'medium'
        confidenceNote = 'Typical home game day — player likely at campus'
      } else if (dow === 1 || dow === 3) {
        // Mon or Wed — could be travel day for away series
        confidence = 'low'
        confidenceNote = 'Non-game weekday — player may be traveling for away series'
      } else {
        confidence = 'low'
        confidenceNote = 'Non-game day — player assumed at campus but may be away'
      }

      // Link to D1Baseball schedule if slug exists, otherwise generic
      const slug = D1_BASEBALL_SLUGS[school]
      const sourceUrl = slug
        ? `https://d1baseball.com/team/${slug}/schedule/`
        : undefined

      events.push({
        id: `ncaa-${school.toLowerCase().replace(/\s+/g, '-')}-${date}`,
        date,
        dayOfWeek: dow,
        time: date + 'T14:00:00Z',
        homeTeam: school,
        awayTeam: isGameDay ? 'Home Game (estimated)' : 'No game scheduled',
        isHome: true,
        venue: { name: venue.venueName, coords: venue.coords },
        source: 'ncaa-lookup',
        playerNames,
        confidence,
        confidenceNote,
        sourceUrl,
      })
    }
  }

  return events
}

// Generate visit opportunities for HS players at their school
export function generateHsEvents(
  players: RosterPlayer[],
  startDate: string,
  endDate: string,
  hsVenues: Map<string, { name: string; coords: Coordinates }>,
): GameEvent[] {
  const events: GameEvent[] = []
  const dates = getDatesInRange(startDate, endDate).filter(
    (d) => isHsSeason(d) && isDateAllowed(d),
  )

  if (dates.length === 0) return events

  // Group HS players by school+state
  const playersBySchool = new Map<string, { players: string[]; venue: { name: string; coords: Coordinates } }>()
  for (const p of players) {
    if (p.level !== 'HS' || p.visitsRemaining <= 0) continue
    const key = `${p.org.toLowerCase().trim()}|${p.state.toLowerCase().trim()}`
    const venue = hsVenues.get(key)
    if (!venue) continue
    const existing = playersBySchool.get(key)
    if (existing) existing.players.push(p.playerName)
    else playersBySchool.set(key, { players: [p.playerName], venue })
  }

  for (const [key, { players: playerNames, venue }] of playersBySchool) {
    const schoolName = key.split('|')[0] ?? key
    for (const date of dates) {
      const d = new Date(date + 'T12:00:00Z')
      const dow = d.getUTCDay()
      const isGameDay = HS_HOME_GAME_DAYS.includes(dow)

      let confidence: VisitConfidence
      let confidenceNote: string
      if (isGameDay) {
        confidence = 'medium'
        confidenceNote = 'Typical home game day — player likely at school'
      } else if (dow >= 1 && dow <= 5) {
        confidence = 'low'
        confidenceNote = 'School day but no game — player at school, may travel next day for away game'
      } else {
        confidence = 'low'
        confidenceNote = 'Weekend non-game day — may not be at school'
      }

      events.push({
        id: `hs-${schoolName.replace(/\s+/g, '-')}-${date}`,
        date,
        dayOfWeek: dow,
        time: date + 'T15:30:00Z',
        homeTeam: schoolName,
        awayTeam: isGameDay ? 'Home Game (estimated)' : 'No game scheduled',
        isHome: true,
        venue: { name: venue.name, coords: venue.coords },
        source: 'hs-lookup',
        playerNames,
        confidence,
        confidenceNote,
      })
    }
  }

  return events
}

export { NCAA_SEASON_START, NCAA_SEASON_END, HS_SEASON_START, HS_SEASON_END }
export { isNcaaSeason, isHsSeason }

// Deduplicate coordinates by rounding to 4 decimal places (~11m precision)
function coordKey(c: Coordinates): string {
  return `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`
}

// Main trip generation algorithm
export async function generateTrips(
  games: GameEvent[],
  players: RosterPlayer[],
  startDate: string,
  endDate: string,
  onProgress?: (step: string, detail?: string) => void,
  maxDriveMinutes: number = MAX_DRIVE_MINUTES,
  priorityPlayers: string[] = [],
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
      flyInVisits: [],
      unvisitablePlayers: [...eligiblePlayers],
      totalPlayersWithVisits: 0,
      totalVisitsCovered: 0,
      coveragePercent: 0,
    }
  }

  // Pre-compute home-to-venue distances using Haversine (instant, no API needed)
  const homeToVenue = new Map<string, number>()
  for (const g of eligibleGames) {
    if (g.venue.coords.lat === 0 && g.venue.coords.lng === 0) continue
    const key = coordKey(g.venue.coords)
    if (!homeToVenue.has(key)) {
      homeToVenue.set(key, estimateDriveMinutes(HOME_BASE, g.venue.coords))
    }
  }

  const uniqueVenueCount = homeToVenue.size
  onProgress?.('Analyzing', `${eligibleGames.length} visit opportunities across ${uniqueVenueCount} venues...`)

  // Get ALL non-Sunday dates as potential anchor days (not just Thursdays)
  const anchorDays = getDatesInRange(startDate, endDate).filter(isDateAllowed)

  // Build trip candidates — any day can anchor a trip
  // Deduplicate: only evaluate each venue once per week
  const candidates: TripCandidate[] = []
  const seenVenueWeeks = new Set<string>()

  for (const anchorDay of anchorDays) {
    const anchorGames = eligibleGames.filter((g) => g.date === anchorDay)

    for (const anchor of anchorGames) {
      if (anchor.venue.coords.lat === 0 && anchor.venue.coords.lng === 0) continue

      const anchorKey = coordKey(anchor.venue.coords)
      const homeToAnchor = homeToVenue.get(anchorKey) ?? Infinity
      if (homeToAnchor > maxDriveMinutes) continue

      // Deduplicate: same venue within same week → skip
      const weekNum = getWeekNumber(anchorDay)
      const venueWeekKey = `${anchorKey}-w${weekNum}`
      if (seenVenueWeeks.has(venueWeekKey)) continue
      seenVenueWeeks.add(venueWeekKey)

      const window = getTripWindow(anchorDay)

      // Find nearby games within the trip window at any venue
      const windowGames = eligibleGames.filter(
        (g) =>
          window.includes(g.date) &&
          g.id !== anchor.id &&
          g.venue.coords.lat !== 0 &&
          g.venue.coords.lng !== 0,
      )

      if (windowGames.length === 0) {
        // Solo anchor trip
        const visitedPlayersList = anchor.playerNames.filter((n) => eligiblePlayers.has(n))
        candidates.push({
          anchorGame: anchor,
          nearbyGames: [],
          suggestedDays: [anchor.date],
          totalPlayersVisited: visitedPlayersList.length,
          visitValue: scoreTripCandidate(visitedPlayersList, playerMap),
          driveFromHomeMinutes: homeToAnchor,
          totalDriveMinutes: homeToAnchor * 2,
          venueCount: 1,
        })
        continue
      }

      // Use Haversine for nearby game distance estimation (instant, no API)
      const nearbyGames = windowGames
        .map((g) => ({ ...g, driveMinutes: estimateDriveMinutes(anchor.venue.coords, g.venue.coords) }))
        .filter((g) => g.driveMinutes <= maxDriveMinutes && g.driveMinutes >= 0)

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

      // Estimate total driving
      const interVenueDrive = nearbyGames.reduce((sum, g) => sum + g.driveMinutes, 0)
      const lastVenueKey = nearbyGames.length > 0
        ? coordKey(nearbyGames[nearbyGames.length - 1]!.venue.coords)
        : anchorKey
      const returnHome = homeToVenue.get(lastVenueKey) ?? homeToAnchor
      const totalDrive = homeToAnchor + interVenueDrive + returnHome

      // Thursday bonus: prefer Thursday anchors with 20% value boost
      const dayOfWeek = new Date(anchorDay + 'T12:00:00Z').getUTCDay()
      const thursdayBonus = dayOfWeek === ANCHOR_DAY ? 1.2 : 1.0

      candidates.push({
        anchorGame: anchor,
        nearbyGames,
        suggestedDays,
        totalPlayersVisited: allPlayerNames.size,
        visitValue: Math.round(scoreTripCandidate([...allPlayerNames], playerMap) * thursdayBonus),
        driveFromHomeMinutes: homeToAnchor,
        totalDriveMinutes: totalDrive,
        venueCount: 1 + new Set(nearbyGames.map((g) => coordKey(g.venue.coords))).size,
      })
    }
  }

  onProgress?.('Optimizing', `${candidates.length} trip candidates — selecting best trips...`)

  // --- Priority player handling ---
  const priorityResults: PriorityResult[] = []
  const selectedTrips: TripCandidate[] = []
  const visitedPlayers = new Set<string>()

  if (priorityPlayers.length > 0) {
    onProgress?.('Priority', `Building trip around ${priorityPlayers.join(' & ')}...`)

    // Helper: get all candidates containing a specific player
    function candidatesWithPlayer(name: string): TripCandidate[] {
      return candidates.filter((c) => {
        const allNames = [
          ...c.anchorGame.playerNames,
          ...c.nearbyGames.flatMap((g) => g.playerNames),
        ]
        return allNames.includes(name)
      })
    }

    if (priorityPlayers.length === 2) {
      const [p1, p2] = priorityPlayers as [string, string]

      // Try to find a trip that includes BOTH priority players
      const bothCandidates = candidates.filter((c) => {
        const allNames = new Set([
          ...c.anchorGame.playerNames,
          ...c.nearbyGames.flatMap((g) => g.playerNames),
        ])
        return allNames.has(p1) && allNames.has(p2)
      })

      if (bothCandidates.length > 0) {
        // Found a trip with both — pick the highest value one
        bothCandidates.sort((a, b) => b.visitValue - a.visitValue)
        const best = bothCandidates[0]!
        selectedTrips.push(best)
        for (const name of best.anchorGame.playerNames) {
          if (eligiblePlayers.has(name)) visitedPlayers.add(name)
        }
        for (const g of best.nearbyGames) {
          for (const name of g.playerNames) {
            if (eligiblePlayers.has(name)) visitedPlayers.add(name)
          }
        }
        priorityResults.push({ playerName: p1, status: 'included' })
        priorityResults.push({ playerName: p2, status: 'included' })
      } else {
        // Can't combine — build separate priority trips for each
        for (const pName of [p1, p2]) {
          const pCandidates = candidatesWithPlayer(pName)
          if (pCandidates.length > 0) {
            pCandidates.sort((a, b) => b.visitValue - a.visitValue)
            const best = pCandidates[0]!
            selectedTrips.push(best)
            for (const name of best.anchorGame.playerNames) {
              if (eligiblePlayers.has(name)) visitedPlayers.add(name)
            }
            for (const g of best.nearbyGames) {
              for (const name of g.playerNames) {
                if (eligiblePlayers.has(name)) visitedPlayers.add(name)
              }
            }
            priorityResults.push({
              playerName: pName,
              status: 'separate-trip',
              reason: `No trip covers both ${p1} and ${p2} within the drive radius — created separate trips`,
            })
          } else {
            priorityResults.push({
              playerName: pName,
              status: 'unreachable',
              reason: `No reachable games for ${pName} in the selected date range`,
            })
          }
        }
      }
    } else if (priorityPlayers.length === 1) {
      const pName = priorityPlayers[0]!
      const pCandidates = candidatesWithPlayer(pName)
      if (pCandidates.length > 0) {
        pCandidates.sort((a, b) => b.visitValue - a.visitValue)
        const best = pCandidates[0]!
        selectedTrips.push(best)
        for (const name of best.anchorGame.playerNames) {
          if (eligiblePlayers.has(name)) visitedPlayers.add(name)
        }
        for (const g of best.nearbyGames) {
          for (const name of g.playerNames) {
            if (eligiblePlayers.has(name)) visitedPlayers.add(name)
          }
        }
        priorityResults.push({ playerName: pName, status: 'included' })
      } else {
        priorityResults.push({
          playerName: pName,
          status: 'unreachable',
          reason: `No reachable games for ${pName} in the selected date range`,
        })
      }
    }
  }

  // --- Greedy selection for remaining trips ---
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

  // --- Fly-in visits for players beyond driving range ---
  onProgress?.('Fly-in analysis', 'Finding fly-in options for distant players...')

  const playersNotOnRoadTrips = [...eligiblePlayers].filter((n) => !visitedPlayers.has(n))
  const flyInVisits: FlyInVisit[] = []
  const flyInCovered = new Set<string>()

  // Group remaining eligible games by venue for players not on road trips
  const flyInVenueMap = new Map<string, {
    venue: GameEvent['venue']
    players: Set<string>
    dates: Set<string>
    source: GameEvent['source']
    isHome: boolean
    distanceKm: number
    sourceUrl?: string
  }>()

  for (const game of eligibleGames) {
    if (game.venue.coords.lat === 0 && game.venue.coords.lng === 0) continue
    const relevantPlayers = game.playerNames.filter((n) => playersNotOnRoadTrips.includes(n))
    if (relevantPlayers.length === 0) continue

    const key = coordKey(game.venue.coords)
    const existing = flyInVenueMap.get(key)
    if (existing) {
      for (const name of relevantPlayers) existing.players.add(name)
      existing.dates.add(game.date)
    } else {
      const distKm = haversineKm(HOME_BASE, game.venue.coords)
      flyInVenueMap.set(key, {
        venue: game.venue,
        players: new Set(relevantPlayers),
        dates: new Set([game.date]),
        source: game.source,
        isHome: game.isHome,
        distanceKm: distKm,
        sourceUrl: game.sourceUrl,
      })
    }
  }

  // Convert to FlyInVisit array (only venues beyond driving range)
  for (const [, entry] of flyInVenueMap) {
    const driveMinutes = estimateDriveMinutes(HOME_BASE, entry.venue.coords)
    if (driveMinutes <= maxDriveMinutes) continue // already handled by road trips

    const sortedDates = [...entry.dates].sort()
    flyInVisits.push({
      playerNames: [...entry.players],
      venue: entry.venue,
      dates: sortedDates,
      distanceKm: Math.round(entry.distanceKm),
      estimatedTravelHours: estimateFlightHours(entry.distanceKm),
      source: entry.source,
      isHome: entry.isHome,
      sourceUrl: entry.sourceUrl,
    })

    for (const name of entry.players) flyInCovered.add(name)
  }

  // Sort fly-in visits by number of players (most valuable first)
  flyInVisits.sort((a, b) => b.playerNames.length - a.playerNames.length)

  // Truly unreachable: no games at all in date range (not even fly-in)
  const trulyUnreachable = playersNotOnRoadTrips.filter((n) => !flyInCovered.has(n))

  const totalCovered = visitedPlayers.size + flyInCovered.size
  const totalTarget = players.reduce((sum, p) => sum + (TIER_VISIT_TARGETS[p.tier] ?? 0), 0)

  return {
    trips: selectedTrips,
    flyInVisits,
    unvisitablePlayers: trulyUnreachable,
    totalPlayersWithVisits: totalCovered,
    totalVisitsCovered: totalCovered,
    coveragePercent: totalTarget > 0 ? Math.round((totalCovered / eligiblePlayers.size) * 100) : 0,
    priorityResults: priorityResults.length > 0 ? priorityResults : undefined,
  }
}

export { HOME_BASE, MAX_DRIVE_MINUTES }
