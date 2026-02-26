import { create } from 'zustand'
import type { RosterPlayer } from '../types/roster'
import { fetchRoster } from '../lib/csv'

interface RosterState {
  players: RosterPlayer[]
  loading: boolean
  error: string | null
  lastFetchedAt: string | null
  fetchRoster: () => Promise<void>
}

export const useRosterStore = create<RosterState>((set) => ({
  players: [],
  loading: false,
  error: null,
  lastFetchedAt: null,

  fetchRoster: async () => {
    set({ loading: true, error: null })
    try {
      const players = await fetchRoster()
      set({ players, loading: false, lastFetchedAt: new Date().toISOString() })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Unknown error' })
    }
  },
}))

// Derived selectors
export const selectProPlayers = (state: RosterState) =>
  state.players.filter((p) => p.level === 'Pro')

export const selectNcaaPlayers = (state: RosterState) =>
  state.players.filter((p) => p.level === 'NCAA')

export const selectHsPlayers = (state: RosterState) =>
  state.players.filter((p) => p.level === 'HS')

export const selectPlayersNeedingVisits = (state: RosterState) =>
  state.players.filter((p) => p.visitsRemaining > 0)

export const selectRosterStats = (state: RosterState) => {
  const total = state.players.length
  const totalTarget = state.players.reduce((sum, p) => sum + p.visitTarget2026, 0)
  const totalCompleted = state.players.reduce((sum, p) => sum + p.visitsCompleted, 0)
  const coveragePercent = totalTarget > 0 ? Math.round((totalCompleted / totalTarget) * 100) : 0
  const needingVisits = state.players.filter((p) => p.visitsRemaining > 0).length

  return { total, totalTarget, totalCompleted, coveragePercent, needingVisits }
}
