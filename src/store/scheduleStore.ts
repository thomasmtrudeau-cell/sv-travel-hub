import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MLBAffiliate, MLBGameRaw } from '../lib/mlbApi'
import { fetchAllAffiliates, fetchAllSchedules } from '../lib/mlbApi'
import { MLB_PARENT_IDS } from '../data/aliases'
import type { GameEvent } from '../types/schedule'
import { extractVenueCoords } from '../lib/mlbApi'

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

  // Actions
  fetchAffiliates: () => Promise<void>
  assignPlayerToTeam: (playerName: string, assignment: PlayerTeamAssignment) => void
  removePlayerAssignment: (playerName: string) => void
  fetchProSchedules: (startDate: string, endDate: string) => Promise<void>
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

      fetchAffiliates: async () => {
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
    }),
    {
      name: 'sv-travel-schedule',
      partialize: (state) => ({
        playerTeamAssignments: state.playerTeamAssignments,
      }),
    },
  ),
)
