import { create } from 'zustand'
import type { Coordinates } from '../types/roster'
import { NCAA_VENUES } from '../data/ncaaVenues'
import { geocodeAllHsVenues } from '../lib/geocoding'

interface VenueInfo {
  name: string
  coords: Coordinates
  source: 'mlb-api' | 'ncaa-hardcoded' | 'hs-geocoded'
}

interface VenueState {
  venues: Record<string, VenueInfo>
  hsGeocodingProgress: { completed: number; total: number } | null
  hsGeocodingError: string | null

  loadNcaaVenues: () => void
  addProVenue: (key: string, name: string, coords: Coordinates) => void
  geocodeHsVenues: (schools: Array<{ schoolName: string; city: string; state: string }>) => Promise<void>
  getVenue: (key: string) => VenueInfo | undefined
}

export const useVenueStore = create<VenueState>((set, get) => ({
  venues: {},
  hsGeocodingProgress: null,
  hsGeocodingError: null,

  loadNcaaVenues: () => {
    const venues = { ...get().venues }
    for (const [school, data] of Object.entries(NCAA_VENUES)) {
      venues[`ncaa-${school.toLowerCase()}`] = {
        name: data.venueName,
        coords: data.coords,
        source: 'ncaa-hardcoded',
      }
    }
    set({ venues })
  },

  addProVenue: (key, name, coords) => {
    set((state) => ({
      venues: {
        ...state.venues,
        [key]: { name, coords, source: 'mlb-api' },
      },
    }))
  },

  geocodeHsVenues: async (schools) => {
    set({ hsGeocodingProgress: { completed: 0, total: schools.length }, hsGeocodingError: null })

    try {
      const results = await geocodeAllHsVenues(schools, (completed, total) => {
        set({ hsGeocodingProgress: { completed, total } })
      })

      const venues = { ...get().venues }
      for (const [key, coords] of results.entries()) {
        venues[`hs-${key}`] = {
          name: key.split('|')[0] ?? key,
          coords,
          source: 'hs-geocoded',
        }
      }

      set({ venues, hsGeocodingProgress: null })
    } catch (e) {
      set({
        hsGeocodingError: e instanceof Error ? e.message : 'Geocoding failed',
        hsGeocodingProgress: null,
      })
    }
  },

  getVenue: (key) => get().venues[key],
}))
