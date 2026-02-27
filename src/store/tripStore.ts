import { create } from 'zustand'
import type { TripPlan } from '../types/schedule'
import { generateTrips, generateSpringTrainingEvents } from '../lib/tripEngine'
import { useRosterStore } from './rosterStore'
import { useScheduleStore } from './scheduleStore'

interface TripState {
  startDate: string
  endDate: string
  tripPlan: TripPlan | null
  computing: boolean
  progressStep: string
  progressDetail: string

  setDateRange: (start: string, end: string) => void
  generateTrips: () => Promise<void>
}

export const useTripStore = create<TripState>((set, get) => ({
  startDate: '2026-03-01',
  endDate: '2026-09-30',
  tripPlan: null,
  computing: false,
  progressStep: '',
  progressDetail: '',

  setDateRange: (startDate, endDate) => set({ startDate, endDate }),

  generateTrips: async () => {
    const { startDate, endDate } = get()
    const players = useRosterStore.getState().players
    const scheduledGames = useScheduleStore.getState().proGames

    // Merge scheduled games with spring training visit opportunities
    const stEvents = generateSpringTrainingEvents(players, startDate, endDate)
    const allGames = [...scheduledGames, ...stEvents]

    set({ computing: true, tripPlan: null, progressStep: 'Starting...', progressDetail: '' })

    try {
      const plan = await generateTrips(
        allGames,
        players,
        startDate,
        endDate,
        (step, detail) => set({ progressStep: step, progressDetail: detail ?? '' }),
      )
      set({ tripPlan: plan, computing: false, progressStep: '', progressDetail: '' })
    } catch (e) {
      set({
        computing: false,
        progressStep: 'Error',
        progressDetail: e instanceof Error ? e.message : 'Trip generation failed',
      })
    }
  },
}))
