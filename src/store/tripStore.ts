import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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

export type TripStatus = 'planned' | 'completed'

// Stable trip key for status tracking across regeneration
export function getTripKey(trip: import('../types/schedule').TripCandidate): string {
  const anchorDate = trip.anchorGame.date
  const venueKey = `${trip.anchorGame.venue.coords.lat.toFixed(4)},${trip.anchorGame.venue.coords.lng.toFixed(4)}`
  return `trip-${anchorDate}-${venueKey}`
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
  tripStatuses: Record<string, TripStatus>

  setDateRange: (start: string, end: string) => void
  setMaxDriveMinutes: (minutes: number) => void
  setPriorityPlayers: (players: string[]) => void
  generateTrips: () => Promise<void>
  clearTrips: () => void
  setTripStatus: (tripKey: string, status: TripStatus | null) => void
}

export const useTripStore = create<TripState>()(
  persist(
    (set, get) => ({
  startDate: defaultStart(),
  endDate: defaultEnd(),
  maxDriveMinutes: MAX_DRIVE_MINUTES,
  priorityPlayers: [],
  tripPlan: null,
  computing: false,
  progressStep: '',
  progressDetail: '',
  tripStatuses: {},

  setDateRange: (startDate, endDate) => set({ startDate, endDate }),
  setMaxDriveMinutes: (maxDriveMinutes) => set({ maxDriveMinutes }),
  setPriorityPlayers: (priorityPlayers) => set({ priorityPlayers }),
  clearTrips: () => set({ tripPlan: null }),
  setTripStatus: (tripKey, status) => set((state) => {
    const next = { ...state.tripStatuses }
    if (status === null) {
      delete next[tripKey]
    } else {
      next[tripKey] = status
    }
    return { tripStatuses: next }
  }),

  generateTrips: async () => {
    const { startDate, endDate, maxDriveMinutes, priorityPlayers } = get()
    const players = useRosterStore.getState().players
    const scheduleState = useScheduleStore.getState()
    const scheduledGames = scheduleState.proGames
    const realNcaaGames = scheduleState.ncaaGames

    // Read custom aliases from schedule store
    const customMlbAliases = scheduleState.customMlbAliases
    const customNcaaAliases = scheduleState.customNcaaAliases

    // Merge scheduled games with spring training + NCAA + HS visit opportunities
    const stEvents = generateSpringTrainingEvents(players, startDate, endDate, customMlbAliases)

    // Use real D1Baseball NCAA schedules if available, otherwise fall back to synthetic
    const ncaaPlayersWithRealSchedules = new Set(
      realNcaaGames.flatMap((g) => g.playerNames),
    )
    const ncaaSyntheticEvents = generateNcaaEvents(
      // Only generate synthetic events for NCAA players WITHOUT real schedules
      players.filter((p) => p.level === 'NCAA' && !ncaaPlayersWithRealSchedules.has(p.playerName)),
      startDate,
      endDate,
      customNcaaAliases,
    )

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

    const allGames = [...scheduledGames, ...stEvents, ...realNcaaGames, ...ncaaSyntheticEvents, ...hsEvents]

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
}),
    {
      name: 'sv-travel-trips',
      partialize: (state) => ({
        tripPlan: state.tripPlan,
        startDate: state.startDate,
        endDate: state.endDate,
        maxDriveMinutes: state.maxDriveMinutes,
        priorityPlayers: state.priorityPlayers,
        tripStatuses: state.tripStatuses,
      }),
    },
  ),
)
