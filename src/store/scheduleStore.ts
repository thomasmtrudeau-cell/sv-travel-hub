import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MLBAffiliate, MLBGameRaw } from '../lib/mlbApi'
import { fetchAllAffiliates, fetchAllSchedules } from '../lib/mlbApi'
import { MLB_PARENT_IDS, resolveNcaaName } from '../data/aliases'
import type { GameEvent } from '../types/schedule'
import { extractVenueCoords } from '../lib/mlbApi'
import type { D1Schedule } from '../lib/d1baseball'
import { fetchAllD1Schedules, resolveOpponentVenue } from '../lib/d1baseball'
import { NCAA_VENUES } from '../data/ncaaVenues'

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

  // Actions
  fetchAffiliates: () => Promise<void>
  assignPlayerToTeam: (playerName: string, assignment: PlayerTeamAssignment) => void
  removePlayerAssignment: (playerName: string) => void
  fetchProSchedules: (startDate: string, endDate: string) => Promise<void>
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
  }
}

export const useScheduleStore = create<ScheduleState>()(
  persist(
    (set, get) => ({
      affiliates: [],
      affiliatesLoading: false,
      affiliatesError: null,

      playerTeamAssignments: {},

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

      fetchProSchedules: async (startDate, endDate) => {
        const state = get()
        const assignments = state.playerTeamAssignments

        // Collect unique teamId+sportId combos
        const teamSet = new Map<number, { teamId: number; sportId: number; players: string[] }>()
        for (const [playerName, assignment] of Object.entries(assignments)) {
          const existing = teamSet.get(assignment.teamId)
          if (existing) {
            existing.players.push(playerName)
          } else {
            teamSet.set(assignment.teamId, {
              teamId: assignment.teamId,
              sportId: assignment.sportId,
              players: [playerName],
            })
          }
        }

        if (teamSet.size === 0) {
          set({ proGames: [], schedulesError: 'No players assigned to teams yet' })
          return
        }

        set({ schedulesLoading: true, schedulesError: null, schedulesProgress: { completed: 0, total: teamSet.size } })

        try {
          const teams = [...teamSet.values()].map((t) => ({ teamId: t.teamId, sportId: t.sportId }))
          const schedules = await fetchAllSchedules(teams, startDate, endDate, (completed, total) => {
            set({ schedulesProgress: { completed, total } })
          })

          // Convert to GameEvents
          const allGames: GameEvent[] = []
          const seenIds = new Set<string>()

          for (const [teamId, games] of schedules.entries()) {
            const teamInfo = teamSet.get(teamId)
            if (!teamInfo) continue

            for (const game of games) {
              const event = mlbGameToEvent(game, teamId, teamInfo.players)
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
          })
        } catch (e) {
          set({
            schedulesLoading: false,
            schedulesError: e instanceof Error ? e.message : 'Failed to fetch schedules',
            schedulesProgress: null,
          })
        }
      },
      fetchNcaaSchedules: async (playerOrgs) => {
        // Resolve each player's org to a canonical NCAA school name
        const schoolToPlayers = new Map<string, string[]>()
        for (const { playerName, org } of playerOrgs) {
          const canonical = resolveNcaaName(org)
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
      }),
    },
  ),
)
