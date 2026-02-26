import type { Coordinates } from '../types/roster'

const ORS_BASE = 'https://api.openrouteservice.org/v2'
const CACHE_KEY = 'sv-travel-drivetime-cache'

function getApiKey(): string {
  const key = import.meta.env.VITE_ORS_API_KEY as string | undefined
  if (!key) throw new Error('VITE_ORS_API_KEY is not configured')
  return key
}

function getCache(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function setCache(cache: Record<string, number>) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
}

function pairKey(from: Coordinates, to: Coordinates): string {
  return `${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}`
}

// Compute drive times from one anchor to multiple candidates
// ORS Matrix API uses [lng, lat] order (GeoJSON)
export async function computeDriveTimes(
  anchorCoords: Coordinates,
  candidateCoords: Coordinates[],
): Promise<number[]> {
  const cache = getCache()
  const results: number[] = new Array(candidateCoords.length).fill(-1)
  const uncachedIndices: number[] = []

  // Check cache first
  for (let i = 0; i < candidateCoords.length; i++) {
    const key = pairKey(anchorCoords, candidateCoords[i]!)
    if (cache[key] !== undefined) {
      results[i] = cache[key]!
    } else {
      uncachedIndices.push(i)
    }
  }

  if (uncachedIndices.length === 0) return results

  const apiKey = getApiKey()

  // ORS Matrix supports up to 50x50 pairs — batch if needed
  const batchSize = 49 // 1 source + 49 destinations max
  for (let b = 0; b < uncachedIndices.length; b += batchSize) {
    const batchIndices = uncachedIndices.slice(b, b + batchSize)
    const batchLocations = [
      [anchorCoords.lng, anchorCoords.lat],
      ...batchIndices.map((i) => [candidateCoords[i]!.lng, candidateCoords[i]!.lat]),
    ]

    const res = await fetch(`${ORS_BASE}/matrix/driving-car`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({
        locations: batchLocations,
        sources: [0],
        destinations: batchIndices.map((_, j) => j + 1),
        metrics: ['duration'],
        units: 'm',
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`ORS Matrix API failed: ${res.status} - ${text}`)
    }

    const data = await res.json()
    const durations: number[] = data.durations[0] // row 0 = anchor

    for (let j = 0; j < batchIndices.length; j++) {
      const origIdx = batchIndices[j]!
      const minutes = Math.round(durations[j]! / 60) // Convert seconds to minutes
      results[origIdx] = minutes

      // Cache result
      const key = pairKey(anchorCoords, candidateCoords[origIdx]!)
      cache[key] = minutes
    }

    setCache(cache)
  }

  return results
}

// Compute drive time between two specific points (convenience wrapper)
export async function computeSingleDriveTime(
  from: Coordinates,
  to: Coordinates,
): Promise<number> {
  const [result] = await computeDriveTimes(from, [to])
  return result!
}
