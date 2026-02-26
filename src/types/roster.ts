export interface Coordinates {
  lat: number
  lng: number
}

export type PlayerLevel = 'Pro' | 'NCAA' | 'HS'

export interface RosterPlayer {
  playerName: string
  normalizedName: string
  org: string
  level: PlayerLevel
  position: string
  state: string
  draftClass: string
  tier: number // 1-4
  leadAgent: string
  visitTarget2026: number
  visitsCompleted: number
  lastVisitDate: string | null
  visitsRemaining: number // derived
  dob: string
  age: number | null
  phone: string
  email: string
  father: string
  mother: string
}

export const TIER_VISIT_TARGETS: Record<number, number> = {
  1: 5,
  2: 3,
  3: 1,
  4: 0,
}
