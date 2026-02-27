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

