import { create } from 'zustand'
import type { Coordinates } from '../types/roster'
import type { TripPlan } from '../types/schedule'
import { generateTrips, generateSpringTrainingEvents, generateNcaaEvents, generateHsEvents, MAX_DRIVE_MINUTES } from '../lib/tripEngine'
import { useRosterStore } from './rosterStore'
import { useScheduleStore } from './scheduleStore'
import { useVenueStore } from './venueStore'

// Default: 3-day trip starting 1 week from now
function toISO(d: Date): string {
  return d.toISOString().split('T')[0]!
}
function defaultStart(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return toISO(d)
}
function defaultEnd(): string {
  const d = new Date()
  d.setDate(d.getDate() + 9) // +7 start + 2 more = 3 days
  return toISO(d)
}

interface TripState {
  startDate: string
  endDate: string
  maxDriveMinutes: number
  priorityPlayers: string[]
  tripPlan: TripPlan | null
  computing: boolean
  progressStep: string
  progressDetail: string

  setDateRange: (start: string, end: string) => void
  setMaxDriveMinutes: (minutes: number) => void
  setPriorityPlayers: (players: string[]) => void
  generateTrips: () => Promise<void>
}

export const useTripStore = create<TripState>((set, get) => ({
  startDate: defaultStart(),
  endDate: defaultEnd(),
  maxDriveMinutes: MAX_DRIVE_MINUTES,
  priorityPlayers: [],
  tripPlan: null,
  computing: false,
  progressStep: '',
  progressDetail: '',

  setDateRange: (startDate, endDate) => set({ startDate, endDate }),
  setMaxDriveMinutes: (maxDriveMinutes) => set({ maxDriveMinutes }),
  setPriorityPlayers: (priorityPlayers) => set({ priorityPlayers }),

  generateTrips: async () => {
    const { startDate, endDate, maxDriveMinutes, priorityPlayers } = get()
    const players = useRosterStore.getState().players
    const scheduledGames = useScheduleStore.getState().proGames

    // Merge scheduled games with spring training + NCAA + HS visit opportunities
    const stEvents = generateSpringTrainingEvents(players, startDate, endDate)
    const ncaaEvents = generateNcaaEvents(players, startDate, endDate)

    // Build HS venue lookup from venue store
    const venueState = useVenueStore.getState().venues
    const hsVenues = new Map<string, { name: string; coords: Coordinates }>()
    for (const [key, v] of Object.entries(venueState)) {
      if (v.source === 'hs-geocoded') {
        const venueKey = key.replace(/^hs-/, '')
        hsVenues.set(venueKey, { name: v.name, coords: v.coords })
      }
    }
    const hsEvents = generateHsEvents(players, startDate, endDate, hsVenues)

    const allGames = [...scheduledGames, ...stEvents, ...ncaaEvents, ...hsEvents]

    set({ computing: true, tripPlan: null, progressStep: 'Starting...', progressDetail: '' })

    try {
      const plan = await generateTrips(
        allGames,
        players,
        startDate,
        endDate,
        (step, detail) => set({ progressStep: step, progressDetail: detail ?? '' }),
        maxDriveMinutes,
        priorityPlayers,
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
