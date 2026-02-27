import Papa from 'papaparse'
import type { RosterPlayer, PlayerLevel } from '../types/roster'
import { TIER_VISIT_TARGETS } from '../types/roster'

const ROSTER_CSV_URL = import.meta.env.VITE_ROSTER_CSV_URL as string | undefined

interface RosterRow {
  [key: string]: string
}

function findColumn(row: RosterRow, candidates: string[]): string {
  for (const c of candidates) {
    const cl = c.toLowerCase()
    const key = Object.keys(row).find((k) => {
      const kl = k.trim().toLowerCase()
      // Exact match or starts-with match (handles "State (High School)" matching "State")
      return kl === cl || kl.startsWith(cl + ' ') || kl.startsWith(cl + '(')
    })
    if (key && row[key]) return row[key].trim()
  }
  return ''
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseLevel(raw: string): PlayerLevel {
  const lower = raw.toLowerCase().trim()
  if (lower === 'pro' || lower === 'professional' || lower === 'mlb' || lower === 'milb') return 'Pro'
  if (lower === 'ncaa' || lower === 'college') return 'NCAA'
  if (lower === 'hs' || lower === 'high school') return 'HS'
  return 'Pro' // default
}

function parseNumber(raw: string): number | null {
  if (!raw || raw === 'N/A' || raw === '-') return null
  const n = parseInt(raw, 10)
  return isNaN(n) ? null : n
}

export async function fetchRoster(): Promise<RosterPlayer[]> {
  if (!ROSTER_CSV_URL) {
    throw new Error('VITE_ROSTER_CSV_URL is not configured. Add it to your .env file.')
  }

  const res = await fetch(ROSTER_CSV_URL)
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`)
  const text = await res.text()

  const parsed = Papa.parse<RosterRow>(text, { header: true, skipEmptyLines: true })

  return parsed.data
    .filter((r) => findColumn(r, ['Name', 'Player Name', 'Player']))
    .map((r) => {
      const playerName = findColumn(r, ['Name', 'Player Name', 'Player'])
      const tier = parseNumber(findColumn(r, ['Tier', 'Player Tier'])) ?? 2
      const visitTarget = TIER_VISIT_TARGETS[tier] ?? 0
      const visitTargetRaw = parseNumber(findColumn(r, ['2026 Visit Target', 'Visit Target', 'Visits Target']))
      const visitsCompleted = parseNumber(findColumn(r, ['Visits Completed', 'Visits', 'In-Person Visits'])) ?? 0
      const lastVisit = findColumn(r, ['Last Visit Date', 'Last Visit', 'Last In-Person'])
      const ageRaw = findColumn(r, ['Age'])
      const dobRaw = findColumn(r, ['DOB', 'Date of Birth', 'Birthday'])

      return {
        playerName,
        normalizedName: normalizeName(playerName),
        org: findColumn(r, ['Org', 'Organization', 'Team', 'School']),
        level: parseLevel(findColumn(r, ['Level', 'Player Level'])),
        mlbId: parseNumber(findColumn(r, ['MLB_ID', 'MLB Id', 'MLB ID', 'MLBId', 'MLB Team Id'])),
        position: findColumn(r, ['Position', 'Pos']),
        state: findColumn(r, ['State', 'Home State']),
        draftClass: findColumn(r, ['Draft Class', 'Class', 'Draft Year']),
        tier,
        leadAgent: findColumn(r, ['Lead Agent', 'Agent', 'Lead']),
        visitTarget2026: visitTargetRaw ?? visitTarget,
        visitsCompleted,
        lastVisitDate: lastVisit || null,
        visitsRemaining: Math.max(0, (visitTargetRaw ?? visitTarget) - visitsCompleted),
        dob: dobRaw,
        age: parseNumber(ageRaw),
        phone: findColumn(r, ['Phone', 'Cell', 'Phone Number']),
        email: findColumn(r, ['Email', 'Email Address']),
        father: findColumn(r, ['Father', "Father's Name", 'Dad']),
        mother: findColumn(r, ['Mother', "Mother's Name", 'Mom']),
      }
    })
}
