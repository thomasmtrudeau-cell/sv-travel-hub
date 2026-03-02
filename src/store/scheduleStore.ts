import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MLBAffiliate, MLBGameRaw, MLBTransaction } from '../lib/mlbApi'
import { fetchAllAffiliates, fetchAllSchedules, fetchAllTransactions } from '../lib/mlbApi'
import { MLB_PARENT_IDS, resolveNcaaName } from '../data/aliases'
import type { GameEvent } from '../types/schedule'
import { extractVenueCoords } from '../lib/mlbApi'
import type { D1Schedule } from '../lib/d1baseball'
import { fetchAllD1Schedules, resolveOpponentVenue } from '../lib/d1baseball'
import { NCAA_VENUES } from '../data/ncaaVenues'
import { useRosterStore } from './rosterStore'

interface PlayerTeamAssignment {
  teamId: number
  sportId: number
  teamName: string
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

  // Pro schedules
  proSchedules: Record<number, MLBGameRaw[]> // teamId → games
  proGames: GameEvent[]
  schedulesLoading: boolean
  schedulesError: string | null
  schedulesProgress: { completed: number; total: number } | null

  // NCAA schedules (from D1Baseball)
  ncaaSchedules: Record<string, D1Schedule> // school name → schedule
  ncaaGames: GameEvent[]
  ncaaLoading: boolean
  ncaaError: string | null
  ncaaProgress: { completed: number; total: number } | null

  // Roster moves detection
  rosterMoves: MLBTransaction[]
  rosterMovesLoading: boolean
  rosterMovesCheckedAt: string | null

  // Fetch timestamps
  proFetchedAt: number | null
  ncaaFetchedAt: number | null

  // Actions
  fetchAffiliates: () => Promise<void>
  assignPlayerToTeam: (playerName: string, assignment: PlayerTeamAssignment) => void
  removePlayerAssignment: (playerName: string) => void
  setCustomAlias: (type: 'mlb' | 'ncaa', raw: string, canonical: string) => void
  fetchProSchedules: (startDate: string, endDate: string) => Promise<void>
  regenerateProGames: () => void
  checkRosterMoves: () => Promise<void>
  fetchNcaaSchedules: (playerOrgs: Array<{ playerName: string; org: string }>) => Promise<void>
}

function mlbGameToEvent(game: MLBGameRaw, teamId: number, playerNames: string[]): GameEvent | null {
  const coords = extractVenueCoords(game)
  if (!coords) return null

  const date = new Date(game.gameDate)
  const isHome = game.teams.home.team.id === teamId

  return {
    id: `mlb-${game.gamePk}`,
    date: game.gameDate.split('T')[0]!,
    dayOfWeek: date.getUTCDay(),
    time: date.toISOString(),
    homeTeam: game.teams.home.team.name,
    awayTeam: game.teams.away.team.name,
    isHome,
    venue: {
      name: game.venue.name,
      coords,
    },
    source: 'mlb-api',
    playerNames,
    sportId: undefined,
    sourceUrl: `https://www.mlb.com/gameday/${game.gamePk}`,
    gameStatus: game.status?.detailedState,
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

      proSchedules: {},
      proGames: [],
      schedulesLoading: false,
      schedulesError: null,
      schedulesProgress: null,

      ncaaSchedules: {},
      ncaaGames: [],
      ncaaLoading: false,
      ncaaError: null,
      ncaaProgress: null,

      rosterMoves: [],
      rosterMovesLoading: false,
      rosterMovesCheckedAt: null,

      proFetchedAt: null,
      ncaaFetchedAt: null,

      fetchAffiliates: async () => {
        // Skip if already cached from localStorage
        if (get().affiliates.length > 0) return
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
            [playerName]: assignment,
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

      regenerateProGames: () => {
        const state = get()
        const assignments = state.playerTeamAssignments
        const allAffiliates = state.affiliates
        const rawSchedules = state.proSchedules

        // Rebuild player-to-parent-org mapping
        const playersByParentOrg = new Map<number, string[]>()
        for (const [playerName, assignment] of Object.entries(assignments)) {
          const aff = allAffiliates.find((a) => a.teamId === assignment.teamId)
          const parentOrgId = aff?.parentOrgId
          if (!parentOrgId) continue
          const existing = playersByParentOrg.get(parentOrgId)
          if (existing) existing.push(playerName)
          else playersByParentOrg.set(parentOrgId, [playerName])
        }

        // Build team → parentOrg lookup
        const teamToParentOrg = new Map<number, number>()
        for (const aff of allAffiliates) {
          teamToParentOrg.set(aff.teamId, aff.parentOrgId)
        }

        // Re-process cached raw game data
        const allGames: GameEvent[] = []
        const seenIds = new Set<string>()
        for (const [teamIdStr, games] of Object.entries(rawSchedules)) {
          const teamId = parseInt(teamIdStr)
          const parentOrgId = teamToParentOrg.get(teamId)
          if (!parentOrgId) continue
          const orgPlayers = playersByParentOrg.get(parentOrgId) ?? []
          if (orgPlayers.length === 0) continue

          for (const game of games) {
            const event = mlbGameToEvent(game, teamId, orgPlayers)
            if (event && !seenIds.has(event.id)) {
              seenIds.add(event.id)
              allGames.push(event)
            }
          }
        }

        allGames.sort((a, b) => a.date.localeCompare(b.date))
        set({ proGames: allGames })
      },

      fetchProSchedules: async (startDate, endDate) => {
        const state = get()
        const assignments = state.playerTeamAssignments
        const allAffiliates = state.affiliates

        // Collect players by parent org
        const playersByParentOrg = new Map<number, string[]>()
        for (const [playerName, assignment] of Object.entries(assignments)) {
          // Find this team's parent org from affiliates
          const aff = allAffiliates.find((a) => a.teamId === assignment.teamId)
          const parentOrgId = aff?.parentOrgId
          if (!parentOrgId) continue
          const existing = playersByParentOrg.get(parentOrgId)
          if (existing) existing.push(playerName)
          else playersByParentOrg.set(parentOrgId, [playerName])
        }

        if (playersByParentOrg.size === 0) {
          set({ proGames: [], schedulesError: 'No players assigned to teams yet' })
          return
        }

        // For each parent org, get ALL affiliate teams (not just assigned ones)
        const teamsToFetch: Array<{ teamId: number; sportId: number }> = []
        const teamToParentOrg = new Map<number, number>()
        for (const parentOrgId of playersByParentOrg.keys()) {
          const orgAffiliates = allAffiliates.filter((a) => a.parentOrgId === parentOrgId)
          for (const aff of orgAffiliates) {
            if (!teamsToFetch.some((t) => t.teamId === aff.teamId)) {
              teamsToFetch.push({ teamId: aff.teamId, sportId: aff.sportId })
              teamToParentOrg.set(aff.teamId, parentOrgId)
            }
          }
        }

        set({ schedulesLoading: true, schedulesError: null, schedulesProgress: { completed: 0, total: teamsToFetch.length } })

        try {
          const schedules = await fetchAllSchedules(teamsToFetch, startDate, endDate, (completed, total) => {
            set({ schedulesProgress: { completed, total } })
          })

          // Convert to GameEvents — attach all org players to each affiliate's games
          const allGames: GameEvent[] = []
          const seenIds = new Set<string>()

          for (const [teamId, games] of schedules.entries()) {
            const parentOrgId = teamToParentOrg.get(teamId)
            if (!parentOrgId) continue
            const orgPlayers = playersByParentOrg.get(parentOrgId) ?? []

            for (const game of games) {
              const event = mlbGameToEvent(game, teamId, orgPlayers)
              if (event && !seenIds.has(event.id)) {
                seenIds.add(event.id)
                allGames.push(event)
              }
            }
          }

          // Sort by date
          allGames.sort((a, b) => a.date.localeCompare(b.date))

          const rawSchedules: Record<number, MLBGameRaw[]> = {}
          for (const [teamId, games] of schedules.entries()) {
            rawSchedules[teamId] = games
          }

          set({
            proSchedules: rawSchedules,
            proGames: allGames,
            schedulesLoading: false,
            schedulesProgress: null,
            proFetchedAt: Date.now(),
          })
        } catch (e) {
          set({
            schedulesLoading: false,
            schedulesError: e instanceof Error ? e.message : 'Failed to fetch schedules',
            schedulesProgress: null,
          })
        }
      },
      checkRosterMoves: async () => {
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
          // Look back 30 days
          const endDate = new Date().toISOString().split('T')[0]!
          const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!

          const transactions = await fetchAllTransactions(
            [...parentOrgIds],
            startDate,
            endDate,
          )

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

          // Filter transactions to only those involving our rostered players
          const relevantMoves = transactions.filter((t) => {
            const playerName = playerMlbIds.get(t.player.id)
            if (!playerName) return false
            // Check if the destination team differs from their current assignment
            const assignedTeamId = playerAssignedTeams.get(playerName)
            if (!assignedTeamId || !t.toTeam) return false
            return t.toTeam.id !== assignedTeamId
          })

          set({
            rosterMoves: relevantMoves,
            rosterMovesLoading: false,
            rosterMovesCheckedAt: new Date().toISOString(),
          })
        } catch (e) {
          set({
            rosterMovesLoading: false,
          })
          console.error('Failed to check roster moves:', e)
        }
      },
      fetchNcaaSchedules: async (playerOrgs) => {
        // Resolve each player's org to a canonical NCAA school name
        const customNcaa = get().customNcaaAliases
        const schoolToPlayers = new Map<string, string[]>()
        for (const { playerName, org } of playerOrgs) {
          const canonical = resolveNcaaName(org, customNcaa)
          if (!canonical) continue
          const existing = schoolToPlayers.get(canonical)
          if (existing) existing.push(playerName)
          else schoolToPlayers.set(canonical, [playerName])
        }

        if (schoolToPlayers.size === 0) {
          set({ ncaaError: 'No recognized NCAA schools found' })
          return
        }

        set({ ncaaLoading: true, ncaaError: null, ncaaProgress: { completed: 0, total: schoolToPlayers.size } })

        try {
          const schedules = await fetchAllD1Schedules(
            [...schoolToPlayers.keys()],
            (completed, total) => set({ ncaaProgress: { completed, total } }),
          )

          // Convert D1 games to GameEvents
          const allGames: GameEvent[] = []
          const schedulesObj: Record<string, D1Schedule> = {}

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
                // Away game: try to resolve opponent venue
                const oppVenue = resolveOpponentVenue(game.opponent, game.opponentSlug)
                if (oppVenue) {
                  venue = oppVenue
                } else {
                  // Unknown opponent venue — skip (could geocode later)
                  continue
                }
              } else {
                continue // No venue coords
              }

              allGames.push({
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

          allGames.sort((a, b) => a.date.localeCompare(b.date))

          set({
            ncaaSchedules: schedulesObj,
            ncaaGames: allGames,
            ncaaLoading: false,
            ncaaProgress: null,
            ncaaFetchedAt: Date.now(),
          })
        } catch (e) {
          set({
            ncaaLoading: false,
            ncaaError: e instanceof Error ? e.message : 'Failed to fetch NCAA schedules',
            ncaaProgress: null,
          })
        }
      },
    }),
    {
      name: 'sv-travel-schedule',
      partialize: (state) => ({
        playerTeamAssignments: state.playerTeamAssignments,
        affiliates: state.affiliates,
        proFetchedAt: state.proFetchedAt,
        ncaaFetchedAt: state.ncaaFetchedAt,
        customMlbAliases: state.customMlbAliases,
        customNcaaAliases: state.customNcaaAliases,
        rosterMoves: state.rosterMoves,
        rosterMovesCheckedAt: state.rosterMovesCheckedAt,
      }),
    },
  ),
)
