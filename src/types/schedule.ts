import type { Coordinates } from './roster'

export type ScheduleSource = 'mlb-api' | 'ncaa-lookup' | 'hs-lookup'

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
}

export interface TripCandidate {
  anchorGame: GameEvent
  nearbyGames: Array<GameEvent & { driveMinutes: number }>
  suggestedDays: string[] // ISO dates
  totalPlayersVisited: number
  visitValue: number // tier-weighted score
}

export interface TripPlan {
  trips: TripCandidate[]
  unvisitablePlayers: string[]
  totalPlayersWithVisits: number
  totalVisitsCovered: number
  coveragePercent: number
}
