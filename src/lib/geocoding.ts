import type { Coordinates } from '../types/roster'

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search'
const CACHE_KEY = 'sv-travel-geocode-cache'

function getCache(): Record<string, Coordinates> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function setCache(cache: Record<string, Coordinates>) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
}

function cacheKey(schoolName: string, state: string): string {
  return `${schoolName.toLowerCase().trim()}|${state.toLowerCase().trim()}`
}

// Geocode a single school venue
export async function geocodeVenue(
  schoolName: string,
  city: string,
  state: string,
): Promise<Coordinates | null> {
  const cache = getCache()
  const key = cacheKey(schoolName, state)
  if (cache[key]) return cache[key]!

  // Try specific baseball field query first
  const queries = [
    `${schoolName} baseball field, ${city}, ${state}`,
    `${schoolName}, ${city}, ${state}`,
    `${schoolName} High School, ${state}`,
  ]

  for (const q of queries) {
    const params = new URLSearchParams({
      q,
      format: 'json',
      limit: '1',
      countrycodes: 'us',
    })

    const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: {
        'User-Agent': 'SVTravelHub/1.0 (Stadium Ventures internal tool)',
      },
    })

    if (!res.ok) continue

    const results = await res.json()
    if (results.length > 0) {
      const coords: Coordinates = {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon),
      }
      cache[key] = coords
      setCache(cache)
      return coords
    }
  }

  return null
}

// Batch geocode all HS venues with 1-second delay between requests
export async function geocodeAllHsVenues(
  schools: Array<{ schoolName: string; city: string; state: string }>,
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, Coordinates>> {
  const results = new Map<string, Coordinates>()
  const unique = new Map<string, { schoolName: string; city: string; state: string }>()

  // Deduplicate
  for (const s of schools) {
    const key = cacheKey(s.schoolName, s.state)
    if (!unique.has(key)) unique.set(key, s)
  }

  const entries = [...unique.entries()]
  let completed = 0

  for (const [key, school] of entries) {
    const coords = await geocodeVenue(school.schoolName, school.city, school.state)
    if (coords) results.set(key, coords)

    completed++
    onProgress?.(completed, entries.length)

    // Rate limit: 1 req/sec for Nominatim
    if (completed < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, 1100))
    }
  }

  return results
}
