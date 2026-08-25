import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { idbStorage } from '../lib/idbStorage'
import { debugLog } from '../lib/debugLog'
import type { MLBAffiliate, MLBGameRaw, MLBTransaction } from '../lib/mlbApi'
import { fetchAllAffiliates, fetchAllSchedules, fetchAllTransactions, fetchAllRosters } from '../lib/mlbApi'
import { MLB_PARENT_IDS, resolveNcaaName, resolveMLBTeamId } from '../data/aliases'
import type { GameEvent } from '../types/schedule'
import { extractVenueCoords } from '../lib/mlbApi'
import type { D1Schedule } from '../lib/d1baseball'
import { fetchAllD1Schedules, resolveOpponentVenue, resolveOpponentVenueAsync } from '../lib/d1baseball'
import { NCAA_VENUES } from '../data/ncaaVenues'
import type { MaxPrepsSchedule } from '../lib/maxpreps'
import { fetchScheduleCsv } from '../lib/scheduleCsv'
import { useRosterStore } from './rosterStore'
import { useVenueStore } from './venueStore'
import { useDiagnosticsStore } from './diagnosticsStore'
import { useRehabStore } from './rehabStore'
import { HS_VENUE_COORDS } from '../data/hsVenueCoords'

export interface PlayerTeamAssignment {
  teamId: number
  sportId: number
  teamName: string
  /** How this assignment was determined */
  source?: 'milb-roster' | 'mlb-roster' | 'mlb-il' | 'estimated' | 'manual'
}

// Activity log entry — tracks visible changes for transparency
export interface AssignmentChange {
  playerName: string
  action: 'assigned' | 'reassigned' | 'not-found' | 'name-matched' | 'fallback' | 'removed'
  from?: string // previous team name
  to?: string   // new team name
  timestamp: number
}

interface ScheduleState {
  // Affiliates
  affiliates: MLBAffiliate[]
  affiliatesLoading: boolean
  affiliatesError: string | null

  // Player → team assignments (persisted)
  playerTeamAssignments: Record<string, PlayerTeamAssignment>

  // Custom aliases for unrecognized org names (persisted)
  customMlbAliases: Record<string, string>   // raw name → canonical MLB org name
  customNcaaAliases: Record<string, string>   // raw name → canonical NCAA school name

  // Assignment activity log (persisted) — shows what auto-assign did
  assignmentLog: AssignmentChange[]

  // Pro schedules
  proSchedules: Record<number, MLBGameRaw[]> // teamId → games
  proGames: GameEvent[]
  proDroppedGames: number // games dropped due to missing venue coordinates
  schedulesLoading: boolean
  schedulesError: string | null
  schedulesProgress: { completed: number; total: number } | null

  // NCAA schedules (from D1Baseball)
  ncaaSchedules: Record<string, D1Schedule> // school name → schedule
  ncaaGames: GameEvent[]
  ncaaLoading: boolean
  ncaaError: string | null
  ncaaProgress: { completed: number; total: number } | null
  ncaaFailedSchools: string[]         // schools whose schedule fetch failed
  ncaaDroppedAwayGames: number        // away games skipped due to unknown opponent venue

  // HS schedules (from MaxPreps)
  hsSchedules: Record<string, MaxPrepsSchedule> // org|state key → schedule
  hsGames: GameEvent[]
  hsLoading: boolean
  hsError: string | null
  hsProgress: { completed: number; total: number } | null
  hsFailedSchools: string[]
  hsFetchedAt: number | null

  // Roster moves detection
  rosterMoves: MLBTransaction[]
  rosterMovesLoading: boolean
  rosterMovesCheckedAt: string | null
  rosterMovesError: string | null

  // Fetch timestamps
  proFetchedAt: number | null
  ncaaFetchedAt: number | null

  // Cached coverage tracking (for incremental fetching)
  cachedProTeamIds: number[]
  cachedNcaaSchools: string[]
  cachedHsSchools: string[]

  // Auto-assign
  autoAssignLoading: boolean
  autoAssignResult: { assigned: number; confirmed: number; estimated: number; notFound: string[]; error?: string; springTrainingEstimate?: boolean } | null

  // Actions
  fetchAffiliates: (forceRefresh?: boolean) => Promise<void>
  assignPlayerToTeam: (playerName: string, assignment: PlayerTeamAssignment) => void
  removePlayerAssignment: (playerName: string) => void
  setCustomAlias: (type: 'mlb' | 'ncaa', raw: string, canonical: string) => void
  autoAssignPlayers: () => Promise<void>
  fetchProSchedules: (startDate: string, endDate: string) => Promise<void>
  regenerateProGames: () => void
  pruneRemovedPlayers: () => void
  checkRosterMoves: () => Promise<void>
  fetchNcaaSchedules: (playerOrgs: Array<{ playerName: string; org: string }>, opts?: { merge?: boolean; forceRefresh?: boolean }) => Promise<void>
  fetchHsSchedules: (playerOrgs: Array<{ playerName: string; org: string; state: string }>, opts?: { merge?: boolean; forceRefresh?: boolean }) => Promise<void>
}

function mlbGameToEvent(game: MLBGameRaw, teamId: number, playerNames: string[]): GameEvent | null {
  const coords = extractVenueCoords(game)
  if (!coords) return null

  // officialDate is the venue-LOCAL calendar date. gameDate is UTC, so a
  // 6:40 PM PT game carries a UTC timestamp on the NEXT day — deriving the
  // date from it shifted every late game forward (Petco "two games on 7/29"
  // that MLB lists as 7/28 + 7/29, Tom 2026-07-24).
  const localDate = game.officialDate ?? game.gameDate.split('T')[0]!
  const isHome = game.teams.home.team.id === teamId

  // All players passed in are assigned to `teamId`, so they share one side
  const side: 'home' | 'away' = isHome ? 'home' : 'away'
  const playerSides: Record<string, 'home' | 'away'> = {}
  for (const n of playerNames) playerSides[n] = side

  // Extract probable pitcher names
  const pitcherNames: string[] = []
  if (game.teams.home.probablePitcher?.fullName) {
    pitcherNames.push(game.teams.home.probablePitcher.fullName)
  }
  if (game.teams.away.probablePitcher?.fullName) {
    pitcherNames.push(game.teams.away.probablePitcher.fullName)
  }

  return {
    id: `mlb-${game.gamePk}`,
    date: localDate,
    dayOfWeek: new Date(localDate + 'T12:00:00Z').getUTCDay(),
    time: new Date(game.gameDate).toISOString(),
    homeTeam: game.teams.home.team.name,
    awayTeam: game.teams.away.team.name,
    isHome,
    venue: {
      name: game.venue.name,
      coords,
      tz: game.venue.timeZone?.id,
    },
    source: 'mlb-api',
    // MUST be a copy — callers pass a shared per-team array, and
    // mergeEventPlayers pushes into event.playerNames when a game shows up
    // in both participants' schedules. Without the copy that push mutated
    // the SHARED team array, leaking players onto every game of the team
    // and cascading league-wide (the "Sterlin Thompson at Progressive
    // Field" bug, 2026-07-22).
    playerNames: [...playerNames],
    playerSides,
    sportId: undefined,
    sourceUrl: `https://www.mlb.com/gameday/${game.gamePk}`,
    gameStatus: game.status?.detailedState,
    probablePitcherNames: pitcherNames.length > 0 ? pitcherNames : undefined,
  }
}

/** The same MLB game appears in BOTH teams' schedules when two tracked
 *  clients' teams play each other. Merge the second team's players into the
 *  existing event instead of dropping them — this is what makes
 *  "SV matchup" double-up detection possible for Pro games. */
function mergeEventPlayers(target: GameEvent, incoming: GameEvent): void {
  for (const name of incoming.playerNames) {
    if (!target.playerNames.includes(name)) target.playerNames.push(name)
  }
  if (incoming.playerSides) {
    target.playerSides = { ...target.playerSides, ...incoming.playerSides }
  }
}

export const useScheduleStore = create<ScheduleState>()(
  persist(
    (set, get) => ({
      affiliates: [],
      affiliatesLoading: false,
      affiliatesError: null,

      playerTeamAssignments: {},
      customMlbAliases: {},
      customNcaaAliases: {},
      assignmentLog: [],

      proSchedules: {},
      proGames: [],
      proDroppedGames: 0,
      schedulesLoading: false,
      schedulesError: null,
      schedulesProgress: null,

      ncaaSchedules: {},
      ncaaGames: [],
      ncaaLoading: false,
      ncaaError: null,
      ncaaProgress: null,
      ncaaFailedSchools: [],
      ncaaDroppedAwayGames: 0,

      hsSchedules: {},
      hsGames: [],
      hsLoading: false,
      hsError: null,
      hsProgress: null,
      hsFailedSchools: [],
      hsFetchedAt: null,

      autoAssignLoading: false,
      autoAssignResult: null,

      rosterMoves: [],
      rosterMovesLoading: false,
      rosterMovesCheckedAt: null,
      rosterMovesError: null,

      proFetchedAt: null,
      ncaaFetchedAt: null,

      cachedProTeamIds: [],
      cachedNcaaSchools: [],
      cachedHsSchools: [],

      fetchAffiliates: async (forceRefresh?: boolean) => {
        if (get().affiliatesLoading) return
        // Skip if already cached from localStorage (unless forced)
        if (!forceRefresh && get().affiliates.length > 0) return
        set({ affiliatesLoading: true, affiliatesError: null })
        try {
          const affiliates = await fetchAllAffiliates(MLB_PARENT_IDS)
          set({ affiliates, affiliatesLoading: false })
        } catch (e) {
          set({ affiliatesLoading: false, affiliatesError: e instanceof Error ? e.message : 'Failed to fetch affiliates' })
        }
      },

      assignPlayerToTeam: (playerName, assignment) => {
        set((state) => ({
          playerTeamAssignments: {
            ...state.playerTeamAssignments,
            [playerName]: { ...assignment, source: 'manual' },
          },
        }))
      },

      removePlayerAssignment: (playerName) => {
        set((state) => {
          const next = { ...state.playerTeamAssignments }
          delete next[playerName]
          return { playerTeamAssignments: next }
        })
      },

      setCustomAlias: (type, raw, canonical) => {
        if (type === 'mlb') {
          set((state) => ({
            customMlbAliases: { ...state.customMlbAliases, [raw]: canonical },
          }))
        } else {
          set((state) => ({
            customNcaaAliases: { ...state.customNcaaAliases, [raw]: canonical },
          }))
        }
      },

      autoAssignPlayers: async () => {
        if (get().autoAssignLoading) return
        set({ autoAssignLoading: true, autoAssignResult: null })

        let state = get()
        const customMlb = state.customMlbAliases
        const rosterPlayers = useRosterStore.getState().players

        // Auto-fetch affiliates if not loaded yet
        if (state.affiliates.length === 0) {
          await get().fetchAffiliates()
          state = get() // re-read after fetch
        }

        const allAffiliates = state.affiliates

        // Get ALL Pro players — re-check even previously assigned ones
        const proPlayers = rosterPlayers.filter(
          (p) => p.level === 'Pro' && p.mlbPlayerId,
        )

        // Also get Pro players without mlbPlayerId (will be handled via fallback)
        const proPlayersWithoutId = rosterPlayers.filter(
          (p) => p.level === 'Pro' && !p.mlbPlayerId,
        )

        if (proPlayers.length === 0 && proPlayersWithoutId.length === 0) {
          set({ autoAssignLoading: false, autoAssignResult: { assigned: 0, confirmed: 0, estimated: 0, notFound: [] } })
          return
        }

        // Collect unique parent org IDs and build orgId → orgName lookup
        const parentOrgIds = new Set<number>()
        const orgIdToName = new Map<number, string>()
        for (const p of [...proPlayers, ...proPlayersWithoutId]) {
          const orgId = resolveMLBTeamId(p.org, customMlb)
          if (orgId) {
            parentOrgIds.add(orgId)
            if (!orgIdToName.has(orgId)) orgIdToName.set(orgId, p.org)
          }
        }

        if (parentOrgIds.size === 0) {
          set({ autoAssignLoading: false, autoAssignResult: { assigned: 0, confirmed: 0, estimated: 0, notFound: [...proPlayers, ...proPlayersWithoutId].map((p) => p.playerName) } })
          return
        }

        try {
          const newAssignments: Record<string, PlayerTeamAssignment> = { ...state.playerTeamAssignments }
          let assignedCount = 0
          const notFoundNames: string[] = []

          // Phase 1: Try MLB-level rosters first (sportId=1) — players on the
          // 40-man roster can be assigned directly to the parent org without
          // needing to search through all affiliate teams.
          const mlbTeamsToQuery = [...parentOrgIds].map((orgId) => {
            // Try to get the canonical team name from affiliates, fall back to org name
            const affEntry = allAffiliates.find((a) => a.parentOrgId === orgId && a.sportId === 1)
            const teamName = affEntry?.teamName ?? orgIdToName.get(orgId) ?? `Team ${orgId}`
            return { teamId: orgId, sportId: 1, teamName }
          })

          // ACTIVE roster only — fullRoster at the MLB level includes the
          // whole 40-man, so optioned MiLB players read as "at the parent
          // club" whenever their MiLB roster lookup misses (mass false
          // promotions under fetch failures, found 2026-07-22).
          const mlbRosterResult = await fetchAllRosters(mlbTeamsToQuery, undefined, undefined, 'active')
          const mlbRosterEntries = mlbRosterResult.entries
          const mlbPlayerIdToTeam = new Map<number, PlayerTeamAssignment>()
          for (const entry of mlbRosterEntries) {
            if (entry.playerId > 0) {
              mlbPlayerIdToTeam.set(entry.playerId, {
                teamId: entry.teamId,
                sportId: 1,
                teamName: entry.teamName,
              })
            }
          }

          // Injured-list fallback. MLB players on the 10/15/60-day IL are NOT
          // on the active roster, so they vanished from the hub entirely
          // (Garrett Whitlock, 15-day IL, 2026-08-25 — Kent expected to see
          // him with Boston in Miami). Pull the 40-man and keep only "D*"
          // (injured) statuses — optioned / reassigned players still fall
          // through to the MiLB roster lookup below. Used only as a last
          // resort after active + MiLB rosters miss, so a rehab assignment
          // at an affiliate still wins.
          const mlb40Result = await fetchAllRosters(mlbTeamsToQuery, undefined, undefined, '40Man')
          const mlbIlPlayerIdToTeam = new Map<number, PlayerTeamAssignment>()
          for (const entry of mlb40Result.entries) {
            if (entry.playerId > 0 && entry.statusCode && entry.statusCode.startsWith('D')) {
              mlbIlPlayerIdToTeam.set(entry.playerId, {
                teamId: entry.teamId,
                sportId: 1,
                teamName: entry.teamName,
              })
            }
          }

          // Phase 2: ALWAYS check MiLB rosters — a player on the 40-man may be
          // optioned to the minors and should use the MiLB team's schedule, not MLB.
          // Hoist milbRosterEntries so Phase 3 can also use them for name matching
          let milbRosterEntries: typeof mlbRosterEntries = []
          let failedMilbRosterTeams: Array<{ teamId: number; sportId: number; teamName: string }> = []

          {
            const allOrgIds = new Set<number>()
            for (const p of proPlayers) {
              const orgId = resolveMLBTeamId(p.org, customMlb)
              if (orgId) allOrgIds.add(orgId)
            }

            // Get MiLB affiliate teams (exclude sportId=1 since that's MLB level)
            const teamsToQuery = allAffiliates
              .filter((a) => allOrgIds.has(a.parentOrgId) && a.sportId !== 1)
              .map((a) => ({ teamId: a.teamId, sportId: a.sportId, teamName: a.teamName }))

            if (teamsToQuery.length > 0) {
              const milbRosterResult = await fetchAllRosters(teamsToQuery)
              milbRosterEntries = milbRosterResult.entries
              failedMilbRosterTeams = milbRosterResult.failedTeams
            }
          }

          // Surface roster fetch failures — distinct from "player not on any roster"
          const allFailedRosterTeams = [...mlbRosterResult.failedTeams, ...failedMilbRosterTeams]
          if (allFailedRosterTeams.length > 0) {
            useDiagnosticsStore.getState().addIssue({
              level: 'warning',
              source: 'pro',
              message: `${allFailedRosterTeams.length} roster fetch(es) failed — some players may show as unassigned when they're actually rostered`,
              details: allFailedRosterTeams.map((t) => t.teamName).join(', '),
            })
          }

          // Build MiLB player lookup
          const milbPlayerIdToTeam = new Map<number, PlayerTeamAssignment>()
          for (const entry of milbRosterEntries) {
            if (entry.playerId > 0) {
              milbPlayerIdToTeam.set(entry.playerId, {
                teamId: entry.teamId,
                sportId: entry.sportId,
                teamName: entry.teamName,
              })
            }
          }

          // Detect spring training: use month check + MiLB roster coverage heuristic.
          // Even in April, MiLB rosters may not be finalized until opening day.
          const now = new Date()
          const monthBasedST = now.getMonth() < 3 // Jan=0, Feb=1, Mar=2 → before April

          // Check if current MiLB rosters cover our tracked players well.
          // Exclude players whose previously-assigned team's roster fetch
          // FAILED — they'd read as "not covered" purely because of a flaky
          // fetch, which could falsely flip the store into spring-training
          // estimation mode.
          const trackedProWithId = proPlayers.filter((p) => p.mlbPlayerId)
          const failedMilbTeamIds = new Set(failedMilbRosterTeams.map((t) => t.teamId))
          const coverageEligible = trackedProWithId.filter((p) => {
            const prev = state.playerTeamAssignments[p.playerName]
            return !(prev && failedMilbTeamIds.has(prev.teamId))
          })
          const milbCoverage = coverageEligible.length > 0
            ? coverageEligible.filter((p) => milbPlayerIdToTeam.has(p.mlbPlayerId!)).length / coverageEligible.length
            : trackedProWithId.length > 0 && failedMilbTeamIds.size > 0
              ? 1 // every tracked player's team failed to fetch — coverage unknown, don't flip to estimation
              : 0

          // Use spring training estimation if: before April OR if MiLB coverage is < 50%
          // (MiLB rosters aren't finalized yet even in early April)
          const isSpringTraining = monthBasedST || milbCoverage < 0.5
          // Log spring training detection for debugging assignment issues
          const diagST = useDiagnosticsStore.getState()
          diagST.addIssue({
            level: 'info',
            source: 'pro',
            message: isSpringTraining
              ? `Spring training mode active (month-based: ${monthBasedST}, MiLB coverage: ${Math.round(milbCoverage * 100)}%) — using estimated assignments`
              : `Regular season mode (MiLB coverage: ${Math.round(milbCoverage * 100)}%) — using current rosters`,
          })
          // During spring training, ALWAYS fetch last year's rosters to estimate
          // each player's level, then promote by one level. Current MiLB rosters
          // are unreliable before April — they may have some entries but not all players.
          let lastYearMilbLookup = new Map<number, PlayerTeamAssignment>()
          if (isSpringTraining) {
            const lastYear = now.getFullYear() - 1
            const lastYearTeamsToQuery = allAffiliates
              .filter((a) => [...parentOrgIds].some((orgId) => a.parentOrgId === orgId) && a.sportId !== 1)
              .map((a) => ({ teamId: a.teamId, sportId: a.sportId, teamName: a.teamName }))

            if (lastYearTeamsToQuery.length > 0) {
              const { entries: lastYearEntries } = await fetchAllRosters(lastYearTeamsToQuery, undefined, lastYear)
              for (const entry of lastYearEntries) {
                if (entry.playerId > 0) {
                  lastYearMilbLookup.set(entry.playerId, {
                    teamId: entry.teamId,
                    sportId: entry.sportId,
                    teamName: entry.teamName,
                  })
                }
              }
            }
          }

          // Promotion map: sportId → promoted sportId
          // 14 (A) → 13 (High-A), 13 → 12 (AA), 12 → 11 (AAA), 11 → 11 (stay AAA)
          const PROMOTE_SPORT: Record<number, number> = { 14: 13, 13: 12, 12: 11, 11: 11 }

          // Find the affiliate team for a promoted sportId within the same org
          // Skip complex league teams (ACL/FCL/Prospects/DSL) — they don't play regular schedules
          const COMPLEX_LEAGUE_PATTERNS = /\b(ACL|FCL|DSL|Prospects|Complex)\b/i
          function findAffiliateForSport(orgId: number, targetSportId: number): { teamId: number; sportId: number; teamName: string } | null {
            // First try to find a non-complex-league team at this level
            const match = allAffiliates.find((a) =>
              a.parentOrgId === orgId && a.sportId === targetSportId && !COMPLEX_LEAGUE_PATTERNS.test(a.teamName)
            )
            if (match) return { teamId: match.teamId, sportId: match.sportId, teamName: match.teamName }
            // Fall back to any team at this level
            const fallback = allAffiliates.find((a) => a.parentOrgId === orgId && a.sportId === targetSportId)
            return fallback ? { teamId: fallback.teamId, sportId: fallback.sportId, teamName: fallback.teamName } : null
          }

          // Assign players: prefer MiLB roster (where they're actually playing)
          // over 40-man roster (where they might just be on the reserve list).
          // During spring training, use last year's level + 1 as estimate.
          const remainingPlayers: typeof proPlayers = []
          for (const player of proPlayers) {
            // Check current MiLB first — if found, they're playing at that level
            const milbMatch = milbPlayerIdToTeam.get(player.mlbPlayerId!)
            if (milbMatch) {
              // During spring training, skip complex league teams (ACL/FCL/Prospects)
              // — the player is probably at a higher level and just listed there as a default
              if (isSpringTraining && COMPLEX_LEAGUE_PATTERNS.test(milbMatch.teamName)) {
                // Fall through to spring training promotion logic below
              } else {
                newAssignments[player.playerName] = { ...milbMatch, source: 'milb-roster' }
                assignedCount++
                continue
              }
            }

            // Spring training fallback: use last year's level, promote by 1
            if (isSpringTraining && lastYearMilbLookup.size > 0) {
              const lastYearMatch = lastYearMilbLookup.get(player.mlbPlayerId!)
              if (lastYearMatch) {
                const promotedSportId = PROMOTE_SPORT[lastYearMatch.sportId] ?? lastYearMatch.sportId
                const orgId = resolveMLBTeamId(player.org, customMlb)
                const promoted = orgId ? findAffiliateForSport(orgId, promotedSportId) : null
                if (promoted) {
                  newAssignments[player.playerName] = { ...promoted, source: 'estimated' }
                  assignedCount++
                  continue
                }
              }
            }

            // If player was on a complex league team and promotion logic didn't find them,
            // assign to the org's lowest full-season affiliate (A→High-A→AA→AAA) instead of MLB
            const wasOnComplexTeam = milbMatch && COMPLEX_LEAGUE_PATTERNS.test(milbMatch.teamName)
            if (isSpringTraining && wasOnComplexTeam) {
              const orgId = resolveMLBTeamId(player.org, customMlb)
              if (orgId) {
                // Try A (14), then High-A (13), then AA (12), then AAA (11)
                const levelOrder = [14, 13, 12, 11]
                let assigned = false
                for (const sportId of levelOrder) {
                  const affiliate = findAffiliateForSport(orgId, sportId)
                  if (affiliate) {
                    newAssignments[player.playerName] = { ...affiliate, source: 'estimated' }
                    assignedCount++
                    assigned = true
                    break
                  }
                }
                if (assigned) continue
              }
            }

            // If the player's PREVIOUS team's roster fetch failed, keep the
            // previous assignment — "not found" is a fetch gap, not a move.
            const prevAssignment = state.playerTeamAssignments[player.playerName]
            if (prevAssignment && failedMilbTeamIds.has(prevAssignment.teamId)) {
              newAssignments[player.playerName] = prevAssignment
              assignedCount++
              continue
            }

            // Fall back to MLB roster (ACTIVE roster — a real call-up)
            const mlbMatch2 = mlbPlayerIdToTeam.get(player.mlbPlayerId!)
            const ilMatch = mlbIlPlayerIdToTeam.get(player.mlbPlayerId!)
            if (mlbMatch2) {
              newAssignments[player.playerName] = { ...mlbMatch2, source: 'mlb-roster' }
              assignedCount++
            } else if (ilMatch) {
              // On the injured list with the big-league club — travels with
              // the team, so show the club's schedule.
              newAssignments[player.playerName] = { ...ilMatch, source: 'mlb-il' }
              assignedCount++
            } else {
              remainingPlayers.push(player)
            }
          }

          // For remaining players (not found on any roster), mark as not found
          for (const player of remainingPlayers) {
            notFoundNames.push(player.playerName)
          }

          // Phase 3: Name-based fallback for players without mlbPlayerId
          if (proPlayersWithoutId.length > 0) {
            // Build a name lookup from all rosters already fetched (MLB + MiLB)
            const allRosterEntries = [...mlbRosterEntries, ...milbRosterEntries]

            const nameToTeam = new Map<string, PlayerTeamAssignment>()
            for (const entry of allRosterEntries) {
              if (entry.fullName) {
                nameToTeam.set(entry.fullName.toLowerCase().trim(), {
                  teamId: entry.teamId,
                  sportId: entry.sportId,
                  teamName: entry.teamName,
                })
              }
            }

            for (const player of proPlayersWithoutId) {
              const normalizedName = player.playerName.toLowerCase().trim()
              const match = nameToTeam.get(normalizedName)
              if (match) {
                // During spring training, redirect MLB-level matches to MiLB estimate
                if (isSpringTraining && match.sportId === 1) {
                  const orgId = resolveMLBTeamId(player.org, customMlb)
                  const highA = orgId ? findAffiliateForSport(orgId, 13) : null
                  if (highA) {
                    newAssignments[player.playerName] = { ...highA, source: 'estimated' }
                    assignedCount++
                    const idx = notFoundNames.indexOf(player.playerName)
                    if (idx >= 0) notFoundNames.splice(idx, 1)
                    continue
                  }
                }
                newAssignments[player.playerName] = { ...match, source: match.sportId === 1 ? 'mlb-roster' : 'milb-roster' }
                assignedCount++
                // Remove from notFoundNames if present
                const idx = notFoundNames.indexOf(player.playerName)
                if (idx >= 0) notFoundNames.splice(idx, 1)
              } else {
                if (!notFoundNames.includes(player.playerName)) {
                  notFoundNames.push(player.playerName)
                }
              }
            }
          }

          // Build activity log — compare old vs new assignments
          const oldAssignments = state.playerTeamAssignments
          const changeLog: AssignmentChange[] = []
          const logTimestamp = Date.now()
          for (const [playerName, newAssignment] of Object.entries(newAssignments)) {
            const oldAssignment = oldAssignments[playerName]
            if (!oldAssignment) {
              changeLog.push({ playerName, action: 'assigned', to: newAssignment.teamName, timestamp: logTimestamp })
            } else if (oldAssignment.teamId !== newAssignment.teamId) {
              changeLog.push({ playerName, action: 'reassigned', from: oldAssignment.teamName, to: newAssignment.teamName, timestamp: logTimestamp })
            } else {
              // Same assignment — confirmed
              changeLog.push({ playerName, action: 'assigned', to: newAssignment.teamName, timestamp: logTimestamp })
            }
          }
          for (const name of notFoundNames) {
            changeLog.push({ playerName: name, action: 'not-found', timestamp: logTimestamp })
          }

          set({
            playerTeamAssignments: newAssignments,
            autoAssignLoading: false,
            autoAssignResult: {
              assigned: assignedCount,
              confirmed: Object.values(newAssignments).filter((a) => a.source === 'milb-roster' || a.source === 'mlb-roster').length,
              estimated: Object.values(newAssignments).filter((a) => a.source === 'estimated').length,
              notFound: notFoundNames,
              springTrainingEstimate: isSpringTraining,
            },
            assignmentLog: [...(get().assignmentLog ?? []), ...changeLog],
          })

          // Drop assignments for names no longer on the roster BEFORE
          // regenerating — newAssignments spreads the old map, so removed
          // players ride along forever otherwise.
          get().pruneRemovedPlayers()

          // Re-process cached schedule data with new assignments
          // so players appear on their correct team's games
          const cachedSchedules = get().proSchedules
          if (cachedSchedules && Object.keys(cachedSchedules).length > 0) {
            get().regenerateProGames()
          }

          // Diagnostics
          const diagAuto = useDiagnosticsStore.getState()
          if (notFoundNames.length > 0) {
            diagAuto.addIssue({
              level: 'warning',
              source: 'pro',
              message: `${notFoundNames.length} player(s) not found on any roster`,
              details: notFoundNames.join(', '),
            })
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Unknown error'
          set({
            autoAssignLoading: false,
            autoAssignResult: { assigned: 0, confirmed: 0, estimated: 0, notFound: [...proPlayers, ...proPlayersWithoutId].map((p) => p.playerName), error: msg },
          })
          console.error('Auto-assign failed:', e)
        }
      },

      pruneRemovedPlayers: () => {
        // The roster master sheet is the source of truth (Tom 2026-08-17:
        // removed from the sheet = removed from the app). Assignments are
        // persisted and keyed by name, and auto-assign only ever UPDATES
        // names still on the roster — spreading the old map kept removed
        // players alive forever, and regenerateProGames kept stamping them
        // onto games, where they surfaced as tier-4 ghosts. rosterMoves and
        // assignmentLog are persisted too, so ex-roster names must be
        // dropped from them as well (not even logged — removed from the
        // sheet means not stored anywhere).
        const rosterPlayers = useRosterStore.getState().players
        if (rosterPlayers.length === 0) return // roster not loaded — never wipe on an empty read
        const rosterNames = new Set(rosterPlayers.map((p) => p.playerName))
        const assignments = get().playerTeamAssignments
        const removed = Object.keys(assignments).filter((n) => !rosterNames.has(n))
        const oldMoves = get().rosterMoves
        const prunedMoves = oldMoves.filter((m) => rosterNames.has(m.player.fullName))
        const oldLog = get().assignmentLog ?? []
        const prunedLog = oldLog.filter((e) => rosterNames.has(e.playerName))
        if (removed.length === 0 && prunedMoves.length === oldMoves.length && prunedLog.length === oldLog.length) return
        const pruned = { ...assignments }
        for (const n of removed) delete pruned[n]
        set({
          playerTeamAssignments: pruned,
          rosterMoves: prunedMoves,
          assignmentLog: prunedLog,
        })
        debugLog(`[roster-prune] dropped ${removed.length} ex-roster assignment(s), ${oldMoves.length - prunedMoves.length} roster move(s), ${oldLog.length - prunedLog.length} log entrie(s)`)
        if (removed.length > 0) get().regenerateProGames()
      },

      regenerateProGames: () => {
        const state = get()
        const assignments = state.playerTeamAssignments
        const rawSchedules = state.proSchedules

        // Build player-to-teamId mapping directly from assignments
        const playersByTeamId = new Map<number, string[]>()
        for (const [playerName, assignment] of Object.entries(assignments)) {
          const existing = playersByTeamId.get(assignment.teamId)
          if (existing) existing.push(playerName)
          else playersByTeamId.set(assignment.teamId, [playerName])
        }

        // Pull rehab windows. The static import above is a cycle with
        // rehabStore — safe under ESM because we only ACCESS the binding at
        // runtime, not at module init.
        const rehabWindows = useRehabStore.getState().windows

        // Clip ONLY when the MLB Transactions API has confirmed a rehab
        // assignment. Optioned/demoted players (no rehab record) and genuine
        // MiLB players (no warning entry) keep their full schedules — they
        // could legitimately be at the MiLB affiliate for months.
        function clipPlayersForGame(_teamId: number, gameDate: string, players: string[]): string[] {
          return players.filter((name) => {
            const assignment = assignments[name]
            if (!assignment) return true
            if (assignment.sportId < 11 || assignment.sportId > 14) return true
            const win = rehabWindows[name.trim().toLowerCase()]
            if (!win || !win.confirmedRehab || !win.estimatedEndDate) return true
            return gameDate <= win.estimatedEndDate
          })
        }

        // Re-process cached raw game data
        const eventsById = new Map<string, GameEvent>()
        for (const [teamIdStr, games] of Object.entries(rawSchedules)) {
          const teamId = parseInt(teamIdStr)
          const teamPlayers = playersByTeamId.get(teamId) ?? []
          if (teamPlayers.length === 0) continue

          for (const game of games) {
            const gameDate = game.gameDate.split('T')[0]!
            const clipped = clipPlayersForGame(teamId, gameDate, teamPlayers)
            if (clipped.length === 0) continue
            const event = mlbGameToEvent(game, teamId, clipped)
            if (!event) continue
            const existing = eventsById.get(event.id)
            if (existing) mergeEventPlayers(existing, event)
            else eventsById.set(event.id, event)
          }
        }

        const allGames = [...eventsById.values()]
        allGames.sort((a, b) => a.date.localeCompare(b.date))
        set({ proGames: allGames })
      },

      fetchProSchedules: async (startDate, endDate) => {
        if (get().schedulesLoading) return
        const state = get()
        const assignments = state.playerTeamAssignments
        const allAffiliates = state.affiliates

        // Collect players by their specific assigned teamId
        const playersByTeamId = new Map<number, string[]>()
        const parentOrgIds = new Set<number>()
        for (const [playerName, assignment] of Object.entries(assignments)) {
          const existing = playersByTeamId.get(assignment.teamId)
          if (existing) existing.push(playerName)
          else playersByTeamId.set(assignment.teamId, [playerName])
          // Also track parent orgs so we fetch ALL affiliate schedules
          const aff = allAffiliates.find((a) => a.teamId === assignment.teamId)
          if (aff?.parentOrgId) parentOrgIds.add(aff.parentOrgId)
        }

        if (playersByTeamId.size === 0) {
          set({ proGames: [], schedulesError: 'No players assigned to teams yet' })
          return
        }

        // For each parent org, get ALL affiliate teams (not just assigned ones)
        const teamsToFetch: Array<{ teamId: number; sportId: number }> = []
        for (const parentOrgId of parentOrgIds) {
          const orgAffiliates = allAffiliates.filter((a) => a.parentOrgId === parentOrgId)
          for (const aff of orgAffiliates) {
            if (!teamsToFetch.some((t) => t.teamId === aff.teamId)) {
              teamsToFetch.push({ teamId: aff.teamId, sportId: aff.sportId })
            }
          }
        }

        set({ schedulesLoading: true, schedulesError: null, schedulesProgress: { completed: 0, total: teamsToFetch.length } })

        try {
          const { schedules, failedTeamIds } = await fetchAllSchedules(teamsToFetch, startDate, endDate, (completed, total) => {
            set({ schedulesProgress: { completed, total } })
          })

          // Build the raw schedule map: fresh data for successful fetches;
          // for FAILED teams, keep the previously cached non-empty schedule
          // rather than silently wiping it with nothing.
          const rawSchedules: Record<number, MLBGameRaw[]> = {}
          for (const [teamId, games] of schedules.entries()) {
            rawSchedules[teamId] = games
          }
          for (const teamId of failedTeamIds) {
            const prevGames = state.proSchedules[teamId]
            if (prevGames && prevGames.length > 0) {
              rawSchedules[teamId] = prevGames
            }
          }

          // Convert to GameEvents — attach only players assigned to this specific team
          const eventsById = new Map<string, GameEvent>()
          const droppedIds = new Set<string>()

          for (const [teamIdStr, games] of Object.entries(rawSchedules)) {
            const teamId = parseInt(teamIdStr)
            const teamPlayers = playersByTeamId.get(teamId) ?? []
            if (teamPlayers.length === 0) continue

            for (const game of games) {
              const event = mlbGameToEvent(game, teamId, teamPlayers)
              if (!event) {
                droppedIds.add(`mlb-${game.gamePk}`)
                continue
              }
              const existing = eventsById.get(event.id)
              if (existing) mergeEventPlayers(existing, event)
              else eventsById.set(event.id, event)
            }
          }
          const droppedGames = droppedIds.size

          // Sort by date
          const allGames = [...eventsById.values()]
          allGames.sort((a, b) => a.date.localeCompare(b.date))

          set({
            proSchedules: rawSchedules,
            proGames: allGames,
            proDroppedGames: droppedGames,
            schedulesLoading: false,
            schedulesProgress: null,
            proFetchedAt: Date.now(),
            cachedProTeamIds: [...teamsToFetch.keys()],
          })

          // Diagnostics
          const diag = useDiagnosticsStore.getState()
          diag.clearSource('pro')
          if (failedTeamIds.length > 0) {
            // Map failed teamIds to affected player names for an actionable message
            const affectedPlayers = failedTeamIds.flatMap((id) => playersByTeamId.get(id) ?? [])
            const failedTeamNames = failedTeamIds.map((id) =>
              allAffiliates.find((a) => a.teamId === id)?.teamName ?? `Team ${id}`,
            )
            diag.addIssue({
              level: 'warning',
              source: 'pro',
              message: `${failedTeamIds.length} team schedule fetch(es) failed — ${affectedPlayers.length > 0 ? `affects ${affectedPlayers.join(', ')}` : 'no assigned players affected'}${failedTeamIds.some((id) => (state.proSchedules[id]?.length ?? 0) > 0) ? ' (kept previously cached games)' : ''}`,
              details: failedTeamNames.join(', '),
            })
          }
          if (droppedGames > 0) {
            diag.addIssue({
              level: 'warning',
              source: 'pro',
              message: `${droppedGames} Pro games dropped — missing venue coordinates`,
            })
          }
        } catch (e) {
          set({
            schedulesLoading: false,
            schedulesError: e instanceof Error ? e.message : 'Failed to fetch schedules',
            schedulesProgress: null,
          })
        }
      },
      checkRosterMoves: async () => {
        if (get().rosterMovesLoading) return
        const state = get()
        const assignments = state.playerTeamAssignments
        const allAffiliates = state.affiliates

        // Collect unique parent org IDs from assigned players
        const parentOrgIds = new Set<number>()
        for (const assignment of Object.values(assignments)) {
          const aff = allAffiliates.find((a) => a.teamId === assignment.teamId)
          if (aff?.parentOrgId) parentOrgIds.add(aff.parentOrgId)
        }

        if (parentOrgIds.size === 0) return

        set({ rosterMovesLoading: true })

        try {
          // Look back to start of current season (Feb 1) to catch all moves
          const now = new Date()
          const endDate = now.toISOString().split('T')[0]!
          const seasonStart = new Date(now.getFullYear(), 1, 1) // Feb 1
          const startDate = seasonStart.toISOString().split('T')[0]!

          const txResult = await fetchAllTransactions(
            [...parentOrgIds],
            startDate,
            endDate,
          )
          const transactions = txResult.transactions
          if (txResult.failedTeamIds.length > 0) {
            console.warn(`Transaction fetch failed for ${txResult.failedTeamIds.length} team(s):`, txResult.failedTeamIds)
          }

          // Cross-reference: find transactions involving assigned players
          const playerMlbIds = new Map<number, string>() // mlbPlayerId → playerName
          const playerAssignedTeams = new Map<string, number>() // playerName → assigned teamId

          const rosterPlayers = useRosterStore.getState().players

          for (const player of rosterPlayers) {
            if (player.level !== 'Pro' || !player.mlbPlayerId) continue
            playerMlbIds.set(player.mlbPlayerId, player.playerName)
            const assignment = assignments[player.playerName]
            if (assignment) playerAssignedTeams.set(player.playerName, assignment.teamId)
          }

          // Apply moves CHRONOLOGICALLY against the evolving assignment.
          // The old logic compared every move against the pre-update
          // assignment, so a May recall could stick forever: the later
          // option BACK to the original team read as "not a move" and was
          // dropped (Sterlin Thompson stuck on the Rockies, 2026-07-22).
          const candidateMoves = transactions
            .filter((t) => playerMlbIds.has(t.player.id) && t.toTeam)
            .sort((a, b) => (a.effectiveDate || a.date).localeCompare(b.effectiveDate || b.date))

          const updatedAssignments = { ...assignments }
          const moveLog: AssignmentChange[] = []
          const moveTimestamp = Date.now()
          const relevantMoves: typeof transactions = []

          for (const move of candidateMoves) {
            const playerName = playerMlbIds.get(move.player.id)
            if (!playerName || !move.toTeam) continue
            const current = updatedAssignments[playerName]
            if (!current) continue
            if (move.toTeam.id === current.teamId) continue

            // Find the destination team in affiliates to get sportId
            const destAff = allAffiliates.find((a) => a.teamId === move.toTeam!.id)
            if (!destAff) continue

            // Paper moves to the MLB club ("Assigned", contract selections in
            // spring, etc.) don't mean the player physically plays there —
            // only honor a real call-up.
            if (destAff.sportId === 1 && !/recall|selected|purchas/i.test(move.typeDesc)) continue

            relevantMoves.push(move)
            updatedAssignments[playerName] = {
              teamId: destAff.teamId,
              sportId: destAff.sportId,
              teamName: destAff.teamName,
            }
            moveLog.push({
              playerName,
              action: 'reassigned',
              from: current.teamName,
              to: destAff.teamName,
              timestamp: moveTimestamp,
            })
          }

          set({
            rosterMoves: relevantMoves,
            rosterMovesLoading: false,
            rosterMovesCheckedAt: new Date().toISOString(),
            // Auto-update assignments from detected moves
            ...(moveLog.length > 0 ? {
              playerTeamAssignments: updatedAssignments,
              assignmentLog: [...(get().assignmentLog ?? []), ...moveLog].slice(-50),
            } : {}),
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Unknown error'
          set({
            rosterMovesLoading: false,
            rosterMovesError: `Failed to check roster moves: ${msg}`,
          })
          console.error('Failed to check roster moves:', e)
        }
      },
      fetchNcaaSchedules: async (playerOrgs, { merge = false, forceRefresh = false } = {}) => {
        if (get().ncaaLoading) return
        // Resolve each player's org to a canonical NCAA school name
        const customNcaa = get().customNcaaAliases
        const schoolToPlayers = new Map<string, string[]>()
        const unresolvedOrgs = new Map<string, string[]>()
        for (const { playerName, org } of playerOrgs) {
          const canonical = resolveNcaaName(org, customNcaa)
          if (!canonical) {
            const key = org.trim() || '(blank)'
            const misses = unresolvedOrgs.get(key)
            if (misses) misses.push(playerName)
            else unresolvedOrgs.set(key, [playerName])
            continue
          }
          const existing = schoolToPlayers.get(canonical)
          if (existing) existing.push(playerName)
          else schoolToPlayers.set(canonical, [playerName])
        }

        // Clear stale ncaa diagnostics BEFORE filing this run's issues —
        // d1baseball.ts pushes more (stale-bundle fallbacks, 0-game parses)
        // during the fetch and they must survive.
        useDiagnosticsStore.getState().clearSource('ncaa')

        // A school that resolves to nothing used to be dropped with no trace —
        // a transfer to a school missing from NCAA_ALIASES (Kersey→Tennessee,
        // 2026-08) just silently lost coverage. File each one.
        if (unresolvedOrgs.size > 0) {
          useDiagnosticsStore.getState().addIssues(
            [...unresolvedOrgs.entries()].map(([org, players]) => ({
              level: 'warning' as const,
              source: 'ncaa' as const,
              message: `"${org}" (${players.join(', ')}) doesn't match any known NCAA school — no schedule fetched`,
              details:
                'Map it under Unknown Team Names on the Roster tab, or add the school to NCAA_ALIASES + D1_BASEBALL_SLUGS in src/data/ so it works for everyone.',
            })),
          )
        }

        if (schoolToPlayers.size === 0) {
          // Name the inputs — "No recognized NCAA schools" alone gave no way
          // to tell a garbled roster from a broken alias table (Tom's
          // personal Chrome, 2026-07-23).
          const sample = playerOrgs.slice(0, 3).map((p) => `"${p.org || '(blank)'}"`).join(', ')
          set({ ncaaError: `None of ${playerOrgs.length} NCAA players' orgs matched a known school — e.g. ${sample}` })
          return
        }

        const prevState = get()
        set({
          ncaaLoading: true,
          ncaaError: null,
          ncaaProgress: { completed: 0, total: schoolToPlayers.size },
          ncaaFailedSchools: merge ? prevState.ncaaFailedSchools : [],
          ncaaDroppedAwayGames: merge ? prevState.ncaaDroppedAwayGames : 0,
        })

        try {
          const { schedules, failedSchools } = await fetchAllD1Schedules(
            [...schoolToPlayers.keys()],
            (completed, total) => set({ ncaaProgress: { completed, total } }),
            { forceRefresh },
          )

          // Convert D1 games to GameEvents
          const newGames: GameEvent[] = []
          const schedulesObj: Record<string, D1Schedule> = merge ? { ...prevState.ncaaSchedules } : {}
          let droppedAwayGames = merge ? prevState.ncaaDroppedAwayGames : 0

          // Collect unresolved away games for async geocoding
          const unresolvedAway: Array<{ school: string; game: D1Schedule['games'][number]; playerNames: string[] }> = []

          for (const [school, schedule] of schedules) {
            schedulesObj[school] = schedule
            const playerNames = schoolToPlayers.get(school) ?? []
            const homeVenue = NCAA_VENUES[school]

            for (const game of schedule.games) {
              const d = new Date(game.date + 'T12:00:00Z')

              let venue: { name: string; coords: { lat: number; lng: number } }
              if (game.isHome && homeVenue) {
                venue = { name: homeVenue.venueName, coords: homeVenue.coords }
              } else if (!game.isHome) {
                // Away game: try sync resolution first (fast)
                const oppVenue = resolveOpponentVenue(game.opponent, game.opponentSlug)
                if (oppVenue) {
                  venue = oppVenue
                } else {
                  // Queue for async geocoding
                  unresolvedAway.push({ school, game, playerNames })
                  continue
                }
              } else {
                continue // No venue coords
              }

              newGames.push({
                id: `ncaa-d1-${school.toLowerCase().replace(/\s+/g, '-')}-${game.date}-${game.opponent.toLowerCase().replace(/\s+/g, '-')}`,
                date: game.date,
                dayOfWeek: d.getUTCDay(),
                time: game.date + 'T14:00:00Z',
                homeTeam: game.isHome ? school : game.opponent,
                awayTeam: game.isHome ? game.opponent : school,
                isHome: game.isHome,
                venue,
                source: 'ncaa-lookup',
                playerNames,
                confidence: 'high',
                confidenceNote: game.isHome
                  ? 'Confirmed home game from D1Baseball'
                  : `Away game at ${game.opponent}`,
                sourceUrl: `https://d1baseball.com/team/${schedule.slug}/schedule/`,
              })
            }
          }

          // Phase 2: Resolve away games at unknown venues
          // Try cached venues first (instant), then batch-geocode uncached ones
          if (unresolvedAway.length > 0) {
            const needsGeocoding: typeof unresolvedAway = []
            // Fast pass: resolve from localStorage cache
            for (const entry of unresolvedAway) {
              const oppVenue = resolveOpponentVenue(entry.game.opponent, entry.game.opponentSlug)
              if (oppVenue) {
                const d = new Date(entry.game.date + 'T12:00:00Z')
                newGames.push({
                  id: `ncaa-d1-${entry.school.toLowerCase().replace(/\s+/g, '-')}-${entry.game.date}-${entry.game.opponent.toLowerCase().replace(/\s+/g, '-')}`,
                  date: entry.game.date,
                  dayOfWeek: d.getUTCDay(),
                  time: entry.game.date + 'T14:00:00Z',
                  homeTeam: entry.game.opponent,
                  awayTeam: entry.school,
                  isHome: false,
                  venue: oppVenue,
                  source: 'ncaa-lookup',
                  playerNames: entry.playerNames,
                  confidence: 'medium',
                  confidenceNote: `Away game at ${entry.game.opponent} (cached venue)`,
                  sourceUrl: `https://d1baseball.com/team/${schedulesObj[entry.school]!.slug}/schedule/`,
                })
              } else {
                needsGeocoding.push(entry)
              }
            }

            // Async geocoding only for truly unknown venues — skip on first load
            // (bundled data + NCAA_VENUES covers most cases; geocode on reload)
            const MAX_GEOCODE = merge ? 10 : 0
            const geocodeBatch = needsGeocoding.slice(0, MAX_GEOCODE)
            if (geocodeBatch.length > 0) {
              const baseCompleted = schoolToPlayers.size
              const extendedTotal = baseCompleted + geocodeBatch.length
              set({ ncaaProgress: { completed: baseCompleted, total: extendedTotal } })
              let geocoded = 0
              let geocodeIdx = 0
              for (const { school, game, playerNames } of geocodeBatch) {
                geocodeIdx++
                set({ ncaaProgress: { completed: baseCompleted + geocodeIdx, total: extendedTotal } })
                const oppVenue = await resolveOpponentVenueAsync(
                  game.opponent, game.opponentSlug,
                  game.venueName, game.venueCity,
                )
                if (oppVenue) {
                  const d = new Date(game.date + 'T12:00:00Z')
                  const schedule = schedulesObj[school]!
                  newGames.push({
                    id: `ncaa-d1-${school.toLowerCase().replace(/\s+/g, '-')}-${game.date}-${game.opponent.toLowerCase().replace(/\s+/g, '-')}`,
                    date: game.date,
                    dayOfWeek: d.getUTCDay(),
                    time: game.date + 'T14:00:00Z',
                    homeTeam: game.opponent,
                    awayTeam: school,
                    isHome: false,
                    venue: oppVenue,
                    source: 'ncaa-lookup',
                    playerNames,
                    confidence: 'medium',
                    confidenceNote: `Away game at ${game.opponent} (venue geocoded)`,
                    sourceUrl: `https://d1baseball.com/team/${schedule.slug}/schedule/`,
                  })
                  geocoded++
                } else {
                  droppedAwayGames++
                }
                // Rate limit for Nominatim
                await new Promise(r => setTimeout(r, 1200))
              }
              if (geocoded > 0) {
                const diag = useDiagnosticsStore.getState()
                diag.addIssue({
                  level: 'info',
                  source: 'ncaa',
                  message: `${geocoded} NCAA away game venue(s) discovered via geocoding`,
                })
              }
            }
            // Count remaining unresolved as dropped (will be geocoded on next load from cache)
            droppedAwayGames += needsGeocoding.length - geocodeBatch.length
          }

          // Merge or replace games
          let allGames: GameEvent[]
          if (merge) {
            // Dedup by game ID — new games overwrite existing ones for the same ID
            const gameMap = new Map<string, GameEvent>()
            for (const g of prevState.ncaaGames) gameMap.set(g.id, g)
            for (const g of newGames) gameMap.set(g.id, g)
            allGames = [...gameMap.values()]
          } else {
            allGames = newGames
          }
          allGames.sort((a, b) => a.date.localeCompare(b.date))

          // Merge failed schools — append new failures, don't duplicate
          const mergedFailed = merge
            ? [...new Set([...prevState.ncaaFailedSchools, ...failedSchools])]
            : failedSchools

          // Derive ncaaFetchedAt from the underlying schedules' own fetchedAt
          // (min across schools) so bundled/stale snapshots aren't masked by a
          // Date.now() stamped at conversion time.
          const scheduleTimestamps = Object.values(schedulesObj)
            .map((s) => s.fetchedAt)
            .filter((t): t is number => typeof t === 'number' && t > 0)
          const derivedNcaaFetchedAt = scheduleTimestamps.length > 0
            ? Math.min(...scheduleTimestamps)
            : Date.now()

          set({
            ncaaSchedules: schedulesObj,
            ncaaGames: allGames,
            ncaaLoading: false,
            ncaaProgress: null,
            ncaaFetchedAt: derivedNcaaFetchedAt,
            ncaaFailedSchools: mergedFailed,
            ncaaDroppedAwayGames: droppedAwayGames,
            cachedNcaaSchools: [...new Set([...(merge ? prevState.cachedNcaaSchools ?? [] : []), ...schoolToPlayers.keys()])],
          })

          // Diagnostics (source already cleared before the fetch)
          const diag = useDiagnosticsStore.getState()
          const STALE_SNAPSHOT_AGE = 7 * 24 * 60 * 60 * 1000
          const staleSchools = Object.values(schedulesObj)
            .filter((s) => Date.now() - s.fetchedAt > STALE_SNAPSHOT_AGE)
          if (staleSchools.length > 0) {
            const oldest = Math.min(...staleSchools.map((s) => s.fetchedAt))
            diag.addIssue({
              level: 'info',
              source: 'ncaa',
              message: `Serving bundled/stale schedule snapshot for ${staleSchools.length} NCAA school(s) — oldest from ${new Date(oldest).toISOString().split('T')[0]}`,
              details: staleSchools.map((s) => s.school).join(', '),
            })
          }
          if (mergedFailed.length > 0) {
            diag.addIssue({
              level: 'warning',
              source: 'ncaa',
              message: `${mergedFailed.length} NCAA school(s) failed to fetch`,
              details: mergedFailed.join(', '),
            })
          }
          if (droppedAwayGames > 0) {
            diag.addIssue({
              level: 'info',
              source: 'ncaa',
              message: `${droppedAwayGames} NCAA away games skipped — unknown opponent venue`,
            })
          }
        } catch (e) {
          set({
            ncaaLoading: false,
            ncaaError: e instanceof Error ? e.message : 'Failed to fetch NCAA schedules',
            ncaaProgress: null,
          })
        }
      },
      fetchHsSchedules: async (playerOrgs, { merge = false, forceRefresh: _forceRefresh = false } = {}) => {
        debugLog(`[HS-ENTRY] fetchHsSchedules called with ${playerOrgs.length} players, hsLoading=${get().hsLoading}`)
        if (get().hsLoading) { debugLog('[HS-ENTRY] SKIPPED — already loading'); return }

        // CSV is the SOLE source of truth for HS schedules. The previous
        // bundled fallback was a 2.5-month-old snapshot that could silently
        // serve stale data. If the CSV fetch fails — including HTML bodies,
        // parse errors, or missing required headers (validated inside
        // fetchScheduleCsv) — we surface the error rather than letting every
        // school land in hsFailedSchools with a misleading "add to Google
        // Sheet" message.
        let csvSchedules: Map<string, MaxPrepsSchedule>
        let csvUnmappedTeams: string[] = []
        let csvWarnings: string[] = []
        try {
          const result = await fetchScheduleCsv()
          csvSchedules = result.schedules
          csvUnmappedTeams = result.unmappedTeams
          csvWarnings = result.warnings
          debugLog(`[HS] CSV fetch OK: ${csvSchedules.size} schools, ${result.hsRowCount} HS/JUCO rows`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[HS] CSV fetch failed:', msg)
          const diagErr = useDiagnosticsStore.getState()
          diagErr.clearSource('hs')
          diagErr.addIssue({
            level: 'error',
            source: 'hs',
            message: 'HS schedule CSV feed is broken — no HS games loaded',
            details: msg,
          })
          set({
            hsError: `HS schedule CSV could not be loaded — check VITE_SCHEDULE_CSV_URL. (${msg})`,
            hsGames: merge ? get().hsGames : [],
          })
          return
        }

        const availableKeys = Array.from(csvSchedules.keys())

        // Group players by org|state key with fuzzy matching against CSV keys only.
        const schoolToPlayers = new Map<string, string[]>()
        for (const { playerName, org, state } of playerOrgs) {
          let key = `${org}|${state}`
          if (!csvSchedules.has(key)) {
            const keyLower = key.toLowerCase()
            const exactMatch = availableKeys.find(k => k.toLowerCase() === keyLower)
            if (exactMatch) {
              key = exactMatch
            } else {
              const orgLower = org.toLowerCase().trim()
              const prefixMatch = availableKeys.find(k => {
                const [bOrg] = k.split('|')
                return bOrg!.toLowerCase().trim() === orgLower
              })
              if (prefixMatch) key = prefixMatch
            }
          }

          debugLog(`[HS-KEY] ${playerName}: "${org}|${state}" → "${key}" (csv: ${csvSchedules.has(key)}, coords: ${!!HS_VENUE_COORDS[key]})`)
          const existing = schoolToPlayers.get(key)
          if (existing) existing.push(playerName)
          else schoolToPlayers.set(key, [playerName])
        }

        if (schoolToPlayers.size === 0) {
          set({ hsError: 'No HS schools found in roster' })
          return
        }

        const prevState = get()
        set({
          hsLoading: true,
          hsError: null,
          hsProgress: { completed: 0, total: schoolToPlayers.size },
          hsFailedSchools: merge ? prevState.hsFailedSchools : [],
        })

        // Clear stale hs diagnostics BEFORE pushing this run's issues (the
        // conversion loop below also pushes venue warnings that must survive).
        const diag = useDiagnosticsStore.getState()
        diag.clearSource('hs')

        // Parser-level warnings (unresolved columns, 0 HS/JUCO rows, …)
        for (const w of csvWarnings) {
          diag.addIssue({ level: 'warning', source: 'hs', message: w })
        }

        // Teams present in the sheet but missing a CSV_TEAM_INFO mapping —
        // actionable and distinct from "school not in the sheet at all".
        if (csvUnmappedTeams.length > 0) {
          diag.addIssue({
            level: 'warning',
            source: 'hs',
            message: `${csvUnmappedTeams.length} team(s) in the schedule sheet but not in CSV_TEAM_INFO — add mapping in src/lib/hsCsvShared.ts`,
            details: csvUnmappedTeams.join(', '),
          })
        }

        try {
          // Resolve schedules from the CSV only. Schools not present in the
          // CSV are listed in `failedSchools` so the UI can prompt the user
          // to add them to the sheet rather than silently rendering stale data.
          const schedules = new Map<string, MaxPrepsSchedule>()
          const failedSchools: string[] = []
          // Failed schools split by cause: rows exist in the sheet but the
          // team name has no CSV_TEAM_INFO mapping vs. genuinely absent.
          const failedUnmapped: string[] = []
          const failedMissing: string[] = []
          const unmappedLower = csvUnmappedTeams.map((t) => t.toLowerCase().trim())

          for (const schoolKey of schoolToPlayers.keys()) {
            const csvSched = csvSchedules.get(schoolKey)
            if (csvSched) {
              schedules.set(schoolKey, csvSched)
            } else {
              failedSchools.push(schoolKey)
              const orgLower = (schoolKey.split('|')[0] ?? '').toLowerCase().trim()
              const isUnmapped = unmappedLower.some(
                (t) => t === orgLower || t.includes(orgLower) || orgLower.includes(t),
              )
              if (isUnmapped) failedUnmapped.push(schoolKey)
              else failedMissing.push(schoolKey)
            }
          }

          if (failedMissing.length > 0) {
            console.warn('[HS] Schools missing from CSV (add to Google Sheet):', failedMissing)
          }
          if (failedUnmapped.length > 0) {
            console.warn('[HS] Schools in the sheet but unmapped (add to CSV_TEAM_INFO in src/lib/hsCsvShared.ts):', failedUnmapped)
          }

          // Convert MaxPreps games to GameEvents
          const newGames: GameEvent[] = []
          const schedulesObj: Record<string, MaxPrepsSchedule> = merge ? { ...prevState.hsSchedules } : {}

          // Hardcoded venue coords loaded via static import

          // Get venue store for additional fallback
          const venueState = useVenueStore.getState().venues

          for (const [schoolKey, schedule] of schedules) {
            schedulesObj[schoolKey] = schedule
            const playerNames = schoolToPlayers.get(schoolKey) ?? []

            // Look up home venue coords — check bundled coords first, then venueStore
            let homeVenue: { name: string; coords: { lat: number; lng: number } } | null = null
            const [schoolOrg] = schoolKey.split('|')

            // Use bundled venue coords if available (from generateSchedules.ts geocoding)
            if (schedule.homeVenue) {
              homeVenue = {
                name: schedule.homeVenue.name,
                coords: { lat: schedule.homeVenue.lat, lng: schedule.homeVenue.lng },
              }
            }

            // Fallback: hardcoded venue coords (always available, no geocoding needed)
            if (!homeVenue) {
              // Try exact key first, then org-name-only match
              let hc = HS_VENUE_COORDS[schoolKey]
              if (!hc) {
                const orgOnly = (schoolKey.split('|')[0] ?? '').toLowerCase()
                const coordKey = Object.keys(HS_VENUE_COORDS).find(k => k.toLowerCase().startsWith(orgOnly + '|'))
                if (coordKey) hc = HS_VENUE_COORDS[coordKey]
              }
              if (hc) {
                homeVenue = { name: hc.name, coords: { lat: hc.lat, lng: hc.lng } }
                debugLog(`[HS-VENUE] ${schoolKey}: using hardcoded coords [${hc.lat}, ${hc.lng}]`)
              }
            }

            debugLog(`[HS-VENUE] ${schoolKey}: venue=${homeVenue ? homeVenue.name : 'NONE'}, games=${schedule.games.length}`)
            const normalizedSchoolOrg = (schoolOrg ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
            if (!homeVenue) for (const [vKey, v] of Object.entries(venueState)) {
              if (v.source === 'hs-geocoded') {
                const venueSchoolKey = vKey.replace(/^hs-/, '')
                // Match on org name portion (venueStore key: "OrgName|City, State")
                const [venueOrg] = venueSchoolKey.split('|')
                const normalizedVenueOrg = (venueOrg ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
                // Exact match or fuzzy: one name contains the other (handles "Hebron" vs "Hebron High School")
                if (normalizedVenueOrg === normalizedSchoolOrg ||
                    normalizedVenueOrg.includes(normalizedSchoolOrg) ||
                    normalizedSchoolOrg.includes(normalizedVenueOrg)) {
                  homeVenue = { name: v.name, coords: v.coords }
                  break
                }
              }
            }

            if (!homeVenue) {
              // Add diagnostic warning — these players will fall back to synthetic events
              diag.addIssue({
                level: 'warning',
                source: 'hs',
                message: `HS venue not geocoded for ${schoolKey.split('|')[0]} — games will use roster coordinates as fallback`,
                details: `Players: ${playerNames.join(', ')}`,
              })

              // Fallback: try matching by full key (org|state) or any venue with the school org name
              for (const [vKey, v] of Object.entries(venueState)) {
                if (v.source === 'hs-geocoded') {
                  const normalizedVKey = vKey.replace(/^hs-/, '').toLowerCase().replace(/[^a-z0-9|]/g, '')
                  if (normalizedVKey.includes(normalizedSchoolOrg)) {
                    homeVenue = { name: v.name, coords: v.coords }
                    break
                  }
                }
              }
              if (!homeVenue) {
                console.warn(`[HS-VENUE] SKIPPING ${schoolKey} — no venue found (bundled: ${!!schedule.homeVenue}, hardcoded: ${!!HS_VENUE_COORDS[schoolKey]})`)
                continue // No venue found — truly unresolvable
              }
            }

            for (const game of schedule.games) {
              const d = new Date(game.date + 'T12:00:00Z')
              const [schoolOrg] = schoolKey.split('|')

              newGames.push({
                id: `hs-mp-${schoolKey.toLowerCase().replace(/[|]/g, '-')}-${game.date}-${game.isHome ? '' : 'away-'}${game.opponent.toLowerCase().replace(/\s+/g, '-')}`,
                date: game.date,
                dayOfWeek: d.getUTCDay(),
                time: game.time ?? game.date + 'T16:00:00Z',
                homeTeam: game.isHome ? (schedule.teamName || schoolOrg || schoolKey) : game.opponent,
                awayTeam: game.isHome ? game.opponent : (schedule.teamName || schoolOrg || schoolKey),
                isHome: game.isHome,
                venue: game.isHome
                  ? homeVenue
                  : { name: `at ${game.opponent}`, coords: homeVenue.coords },
                source: 'hs-lookup',
                playerNames,
                confidence: game.isHome ? 'high' : 'medium',
                confidenceNote: game.isHome
                  ? 'Confirmed home game from schedule'
                  : `Away game vs. ${game.opponent} — location estimated from home field area`,
                sourceUrl: schedule.slug ? `https://www.maxpreps.com/${schedule.slug}/baseball/schedule/` : undefined,
              })
            }
          }

          // Merge or replace games
          let allGames: GameEvent[]
          if (merge) {
            const gameMap = new Map<string, GameEvent>()
            for (const g of prevState.hsGames) gameMap.set(g.id, g)
            for (const g of newGames) gameMap.set(g.id, g)
            allGames = [...gameMap.values()]
          } else {
            allGames = newGames
          }
          allGames.sort((a, b) => a.date.localeCompare(b.date))

          // Merge failed schools
          const mergedFailed = merge
            ? [...new Set([...prevState.hsFailedSchools, ...failedSchools])]
            : failedSchools

          // Per-player game count diagnostic
          const playerGameCounts = new Map<string, number>()
          for (const g of allGames) {
            for (const n of g.playerNames) {
              playerGameCounts.set(n, (playerGameCounts.get(n) ?? 0) + 1)
            }
          }
          debugLog(`[HS] Conversion complete: ${allGames.length} games from ${schedules.size} schools, ${failedSchools.length} failed`)
          debugLog(`[HS] Per-player: ${[...playerGameCounts.entries()].map(([n, c]) => `${n}:${c}`).join(', ')}`)
          // Flag players in roster but missing from games
          for (const [, players] of schoolToPlayers) {
            for (const name of players) {
              if (!playerGameCounts.has(name)) {
                console.warn(`[HS] MISSING: ${name} has 0 games after conversion`)
              }
            }
          }
          set({
            hsSchedules: schedulesObj,
            hsGames: allGames,
            hsLoading: false,
            hsProgress: null,
            hsFetchedAt: merge ? (prevState.hsFetchedAt ?? Date.now()) : Date.now(),
            hsFailedSchools: mergedFailed,
            cachedHsSchools: [...new Set([...(merge ? prevState.cachedHsSchools ?? [] : []), ...schoolToPlayers.keys()])],
          })

          // Diagnostics (source already cleared before conversion) — split
          // failure causes so "add to sheet" isn't shown for mapping gaps.
          if (failedMissing.length > 0) {
            diag.addIssue({
              level: 'warning',
              source: 'hs',
              message: `${failedMissing.length} HS school(s) missing from the schedule sheet — add their games to the Google Sheet`,
              details: failedMissing.join(', '),
            })
          }
          if (failedUnmapped.length > 0) {
            diag.addIssue({
              level: 'warning',
              source: 'hs',
              message: `${failedUnmapped.length} HS school(s) have rows in the sheet but no team mapping — add to CSV_TEAM_INFO in src/lib/hsCsvShared.ts`,
              details: failedUnmapped.join(', '),
            })
          }
        } catch (e) {
          set({
            hsLoading: false,
            hsError: e instanceof Error ? e.message : 'Failed to fetch HS schedules',
            hsProgress: null,
          })
        }
      },
    }),
    {
      name: 'sv-travel-schedule',
      // v4 (2026-07-22): purge polluted caches. Cached proGames carried the
      // shared-array player leak (minor leaguers on every MLB game) and
      // playerTeamAssignments carried false promotions from the 40-man
      // fullRoster fallback + out-of-order transaction moves. Dropping both
      // routes every client through the cold path: fresh auto-assign with
      // the fixed logic, fresh schedule fetch with per-event player copies.
      // Manual assignments survive.
      // v5 (2026-07-24): purge proGames again — cached events carried dates
      // derived from the UTC gameDate, which shifted every night game
      // starting ≥8pm ET to the next day (Petco 7/28 listed as 7/29).
      // mlbGameToEvent now uses officialDate; the cache must refetch.
      version: 5,
      storage: createJSONStorage(() => idbStorage),
      migrate: (persisted: any, version: number) => {
        const keptAssignments: Record<string, PlayerTeamAssignment> = {}
        if (version >= 4) {
          Object.assign(keptAssignments, persisted?.playerTeamAssignments ?? {})
        } else {
          for (const [name, a] of Object.entries(persisted?.playerTeamAssignments ?? {})) {
            if ((a as PlayerTeamAssignment)?.source === 'manual') keptAssignments[name] = a as PlayerTeamAssignment
          }
        }
        const purge = version < 5
        return {
          playerTeamAssignments: keptAssignments,
          affiliates: persisted?.affiliates ?? [],
          customMlbAliases: persisted?.customMlbAliases ?? {},
          customNcaaAliases: persisted?.customNcaaAliases ?? {},
          rosterMoves: purge ? [] : (persisted?.rosterMoves ?? []),
          rosterMovesCheckedAt: purge ? null : (persisted?.rosterMovesCheckedAt ?? null),
          proGames: purge ? [] : (persisted?.proGames ?? []),
          ncaaGames: persisted?.ncaaGames ?? [],
          hsGames: persisted?.hsGames ?? [],
          proFetchedAt: purge ? null : (persisted?.proFetchedAt ?? null),
          ncaaFetchedAt: persisted?.ncaaFetchedAt ?? null,
          hsFetchedAt: persisted?.hsFetchedAt ?? null,
          cachedProTeamIds: purge ? [] : (persisted?.cachedProTeamIds ?? []),
          cachedNcaaSchools: persisted?.cachedNcaaSchools ?? [],
          cachedHsSchools: persisted?.cachedHsSchools ?? [],
        }
      },
      partialize: (state) => ({
        playerTeamAssignments: state.playerTeamAssignments,
        affiliates: state.affiliates,
        customMlbAliases: state.customMlbAliases,
        customNcaaAliases: state.customNcaaAliases,
        assignmentLog: (state.assignmentLog ?? []).slice(-50),
        rosterMoves: state.rosterMoves,
        rosterMovesCheckedAt: state.rosterMovesCheckedAt,
        // Persist game data (stored in IndexedDB, no size limit)
        proGames: state.proGames,
        // NCAA and HS games are NOT persisted — always recomputed from bundled data on startup
        // This prevents stale cached games from overriding newer bundled schedules
        proFetchedAt: state.proFetchedAt,
        // Track cached coverage for incremental fetching
        cachedProTeamIds: state.cachedProTeamIds,
        cachedNcaaSchools: state.cachedNcaaSchools,
        cachedHsSchools: state.cachedHsSchools,
      }),
      merge: (persisted, current) => {
        const p = persisted as any
        return {
          ...current,
          ...(p ?? {}),
          affiliates: p?.affiliates ?? [],
          playerTeamAssignments: p?.playerTeamAssignments ?? {},
          customMlbAliases: p?.customMlbAliases ?? {},
          customNcaaAliases: p?.customNcaaAliases ?? {},
          assignmentLog: p?.assignmentLog ?? [],
          // Restore cached game data (was previously cleared every session)
          proGames: p?.proGames ?? [],
          // NCAA and HS games: use current state if populated (from bundle conversion),
          // otherwise start empty (will be loaded from bundle on startup)
          ncaaGames: (current as any).ncaaGames?.length > 0 ? (current as any).ncaaGames : [],
          hsGames: (current as any).hsGames?.length > 0 ? (current as any).hsGames : [],
          proFetchedAt: p?.proFetchedAt ?? null,
          ncaaFetchedAt: null,
          hsFetchedAt: null,
          cachedProTeamIds: p?.cachedProTeamIds ?? [],
          cachedNcaaSchools: p?.cachedNcaaSchools ?? [],
          cachedHsSchools: p?.cachedHsSchools ?? [],
          rosterMoves: p?.rosterMoves ?? [],
        }
      },
    },
  ),
)
