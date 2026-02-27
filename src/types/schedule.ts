import type { Coordinates } from './roster'

export type ScheduleSource = 'mlb-api' | 'ncaa-lookup' | 'hs-lookup'

// Confidence that the player will actually be at this venue on this date
export type VisitConfidence = 'high' | 'medium' | 'low'

export interface GameEvent {
  id: string
  date: string // ISO date
  dayOfWeek: number // 0=Sun, 1=Mon, ..., 6=Sat
  time: string
  homeTeam: string
  awayTeam: string
  isHome: boolean
  venue: {
    name: string
    coords: Coordinates
  }
  source: ScheduleSource
  playerNames: string[]
  sportId?: number
  confidence?: VisitConfidence
  confidenceNote?: string // e.g. "Typical home game day" or "May be traveling for away series"
}

export interface TripCandidate {
  anchorGame: GameEvent
  nearbyGames: Array<GameEvent & { driveMinutes: number }>
  suggestedDays: string[] // ISO dates
  totalPlayersVisited: number
  visitValue: number // tier-weighted score
  driveFromHomeMinutes: number // Orlando → anchor drive time
  totalDriveMinutes: number // estimated total driving (round trip)
  venueCount: number // number of distinct venues visited
}

export interface PriorityResult {
  playerName: string
  status: 'included' | 'separate-trip' | 'unreachable'
  reason?: string
}

export interface TripPlan {
  trips: TripCandidate[]
  unvisitablePlayers: string[]
  totalPlayersWithVisits: number
  totalVisitsCovered: number
  coveragePercent: number
  priorityResults?: PriorityResult[]
}
