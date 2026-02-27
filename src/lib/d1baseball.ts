import { D1_BASEBALL_SLUGS } from '../data/d1baseballSlugs'
import { NCAA_VENUES } from '../data/ncaaVenues'
import { resolveNcaaName } from '../data/aliases'
import type { Coordinates } from '../types/roster'

const CORS_PROXY = 'https://api.allorigins.win/get?url='
const CACHE_KEY = 'sv-travel-d1baseball-cache'
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

export interface D1Game {
  date: string // ISO date YYYY-MM-DD
  isHome: boolean
  opponent: string
  opponentSlug: string
  venueName: string
  venueCity: string
}

export interface D1Schedule {
  school: string
  slug: string
  games: D1Game[]
  fetchedAt: number
}

// Cached schedules in localStorage
function getCache(): Record<string, D1Schedule> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function setCache(cache: Record<string, D1Schedule>) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
}

// Parse the D1Baseball schedule HTML into structured game data
function parseScheduleHtml(html: string): D1Game[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const games: D1Game[] = []

  const rows = doc.querySelectorAll('table tbody tr')
  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 4) continue

    // Date: extract from link href like /scores/?date=20260213
    const dateLink = cells[0]?.querySelector('a')
    if (!dateLink) continue
    const href = dateLink.getAttribute('href') ?? ''
    const dateMatch = href.match(/date=(\d{4})(\d{2})(\d{2})/)
    if (!dateMatch) continue
    const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`

    // Home/Away: "vs" = home, "@" = away
    const locText = cells[1]?.textContent?.trim() ?? ''
    const isHome = locText === 'vs'

    // Opponent name and slug
    const teamName = cells[2]?.querySelector('.team-name')?.textContent?.trim() ?? ''
    const teamLink = cells[2]?.querySelector('a.team-logo-name')?.getAttribute('href') ?? ''
    const slugMatch = teamLink.match(/\/team\/([^/]+)\//)
    const opponentSlug = slugMatch ? slugMatch[1]! : ''

    // Venue: last td
    const venueText = cells[cells.length - 1]?.textContent?.trim() ?? ''
    // Venue format: "City, State, Venue Name" or just "Venue Name"
    const venueParts = venueText.split(',').map((s) => s.trim())
    const venueName = venueParts.length >= 3 ? venueParts.slice(2).join(', ') : venueText
    const venueCity = venueParts.length >= 2 ? `${venueParts[0]}, ${venueParts[1]}` : ''

    if (date && teamName) {
      games.push({
        date,
        isHome,
        opponent: teamName,
        opponentSlug,
        venueName,
        venueCity,
      })
    }
  }

  return games
}

// Fetch schedule for a single school
export async function fetchD1Schedule(
  canonicalName: string,
): Promise<D1Schedule | null> {
  const slug = D1_BASEBALL_SLUGS[canonicalName]
  if (!slug) return null

  // Check cache
  const cache = getCache()
  const cached = cache[canonicalName]
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached
  }

  const url = `https://d1baseball.com/team/${slug}/schedule/`

  try {
    const res = await fetch(`${CORS_PROXY}${encodeURIComponent(url)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    const html = data.contents as string
    if (!html) throw new Error('Empty response')

    const games = parseScheduleHtml(html)
    const schedule: D1Schedule = {
      school: canonicalName,
      slug,
      games,
      fetchedAt: Date.now(),
    }

    // Cache result
    cache[canonicalName] = schedule
    setCache(cache)

    return schedule
  } catch (err) {
    console.warn(`Failed to fetch D1Baseball schedule for ${canonicalName}:`, err)
    return null
  }
}

// Fetch schedules for all NCAA players' schools
export async function fetchAllD1Schedules(
  schoolNames: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, D1Schedule>> {
  const unique = [...new Set(schoolNames)]
  const results = new Map<string, D1Schedule>()

  for (let i = 0; i < unique.length; i++) {
    onProgress?.(i, unique.length)
    const schedule = await fetchD1Schedule(unique[i]!)
    if (schedule) results.set(unique[i]!, schedule)

    // Rate limit: 500ms between requests to be polite
    if (i < unique.length - 1) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  onProgress?.(unique.length, unique.length)
  return results
}

// Resolve venue coordinates for an away game opponent
// First checks if opponent is a known NCAA school with coordinates,
// then falls back to null (would need geocoding)
export function resolveOpponentVenue(
  opponentName: string,
  opponentSlug: string,
): { name: string; coords: Coordinates } | null {
  // Try to match opponent to a known NCAA school
  const canonical = resolveNcaaName(opponentName)
  if (canonical && NCAA_VENUES[canonical]) {
    const v = NCAA_VENUES[canonical]!
    return { name: v.venueName, coords: v.coords }
  }

  // Try slug-based matching: convert slug to potential name forms
  const slugName = opponentSlug.replace(/-/g, ' ')
  const canonical2 = resolveNcaaName(slugName)
  if (canonical2 && NCAA_VENUES[canonical2]) {
    const v = NCAA_VENUES[canonical2]!
    return { name: v.venueName, coords: v.coords }
  }

  return null
}
