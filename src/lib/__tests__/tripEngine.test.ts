import { describe, it, expect } from 'vitest'
import { computeScoreBreakdown, generateTrips } from '../tripEngine'
import type { RosterPlayer } from '../../types/roster'
import type { GameEvent, TripPlan } from '../../types/schedule'

function makePlayer(overrides: Partial<RosterPlayer> & { playerName: string }): RosterPlayer {
  return {
    normalizedName: overrides.playerName.toLowerCase(),
    org: 'Test Org',
    level: 'Pro',
    isJuco: false,
    mlbPlayerId: null,
    pgPlayerId: null,
    position: 'SS',
    state: 'FL',
    draftClass: '2027',
    tier: 1,
    leadAgent: 'Tom',
    visitTarget2026: 5,
    visitsCompleted: 0,
    lastVisitDate: null,
    visitsRemaining: 5,
    dob: '',
    age: null,
    phone: '',
    email: '',
    father: '',
    mother: '',
    status: '',
    ...overrides,
  }
}

function mapOf(...players: RosterPlayer[]): Map<string, RosterPlayer> {
  return new Map(players.map((p) => [p.playerName, p]))
}

describe('computeScoreBreakdown — pitcher position token matching', () => {
  it("does not treat 'Shortstop' as a pitcher (no substring 'P' match)", () => {
    const p = makePlayer({ playerName: 'Alex Fielder', position: 'Shortstop' })
    const games = [{ playerNames: ['Alex Fielder'], probablePitcherNames: ['Alex Fielder'] }]
    const bd = computeScoreBreakdown(['Alex Fielder'], mapOf(p), false, undefined, games)
    expect(bd.pitcherMatchBonus).toBe(0)
    expect(bd.finalScore).toBe(25) // tier 1 weight 5 × 5 visits, no boosts
  })

  it("treats 'RHP' as a pitcher and applies the probable-start boost", () => {
    const p = makePlayer({ playerName: 'Sam Arm', position: 'RHP' })
    const games = [{ playerNames: ['Sam Arm'], probablePitcherNames: ['Sam Arm'] }]
    const bd = computeScoreBreakdown(['Sam Arm'], mapOf(p), false, undefined, games)
    expect(bd.pitcherMatchBonus).toBe(13) // round(25 × 0.5)
    expect(bd.finalScore).toBe(38) // round(25 × 1.5)
  })
})

describe('computeScoreBreakdown — pitcher surname token matching', () => {
  it("probable 'Jake Kleeman' does not match player surname 'Lee'", () => {
    const p = makePlayer({ playerName: 'Chris Lee', position: 'LHP' })
    const games = [{ playerNames: ['Chris Lee'], probablePitcherNames: ['Jake Kleeman'] }]
    const bd = computeScoreBreakdown(['Chris Lee'], mapOf(p), false, undefined, games)
    expect(bd.pitcherMatchBonus).toBe(0)
  })

  it('whole-token surname match still works (suffix stripped)', () => {
    const p = makePlayer({ playerName: 'Chris Lee Jr.', position: 'LHP' })
    const games = [{ playerNames: ['Chris Lee Jr.'], probablePitcherNames: ['Chris Lee'] }]
    const bd = computeScoreBreakdown(['Chris Lee Jr.'], mapOf(p), false, undefined, games)
    expect(bd.pitcherMatchBonus).toBeGreaterThan(0)
  })
})

describe('computeScoreBreakdown — Tuesday bonus scope', () => {
  it('applies to Pro position players', () => {
    const p = makePlayer({ playerName: 'Pro Bat', level: 'Pro', position: '2B' })
    const bd = computeScoreBreakdown(['Pro Bat'], mapOf(p), true)
    expect(bd.tuesdayBonus).toBe(true)
    expect(bd.finalScore).toBe(30) // 25 × 1.2
  })

  it('does not apply to Pro pitchers', () => {
    const p = makePlayer({ playerName: 'Pro Arm', level: 'Pro', position: 'RHP' })
    const bd = computeScoreBreakdown(['Pro Arm'], mapOf(p), true)
    expect(bd.tuesdayBonus).toBe(false)
    expect(bd.finalScore).toBe(25)
  })

  it('does not apply to NCAA position players', () => {
    const p = makePlayer({ playerName: 'College Bat', level: 'NCAA', position: 'OF' })
    const bd = computeScoreBreakdown(['College Bat'], mapOf(p), true)
    expect(bd.tuesdayBonus).toBe(false)
    expect(bd.finalScore).toBe(25)
  })
})

describe('computeScoreBreakdown — per-player confidence', () => {
  it('empty games array means no confidence penalty', () => {
    const p = makePlayer({ playerName: 'No Games' })
    const bd = computeScoreBreakdown(['No Games'], mapOf(p), false, undefined, [])
    expect(bd.finalScore).toBe(25) // not 13 (0.5×)
  })

  it("uses the player's own best game confidence, not the trip's worst", () => {
    const low = makePlayer({ playerName: 'Low Conf' })
    const games = [
      { playerNames: ['Low Conf'], confidence: 'low' as const },
      { playerNames: ['Low Conf'], confidence: 'high' as const },
    ]
    const bd = computeScoreBreakdown(['Low Conf'], mapOf(low), false, undefined, games)
    expect(bd.finalScore).toBe(25) // best confidence (high) wins for this player

    const onlyLow = computeScoreBreakdown(
      ['Low Conf'], mapOf(low), false, undefined,
      [{ playerNames: ['Low Conf'], confidence: 'low' as const }],
    )
    expect(onlyLow.finalScore).toBe(13) // round(25 × 0.5)
  })
})

describe('computeScoreBreakdown — tier weighting', () => {
  it('five T3 players do not outrank one T1 with 5 visits remaining', () => {
    const t1 = makePlayer({ playerName: 'Star One', tier: 1, visitsRemaining: 5 })
    const t3s = ['A', 'B', 'C', 'D', 'E'].map((n) =>
      makePlayer({ playerName: `T3 ${n}`, tier: 3, visitsRemaining: 1 }),
    )
    const t1Score = computeScoreBreakdown(['Star One'], mapOf(t1), false).finalScore
    const t3Score = computeScoreBreakdown(t3s.map((p) => p.playerName), mapOf(...t3s), false).finalScore
    expect(t1Score).toBe(25)
    expect(t3Score).toBe(5)
    expect(t1Score).toBeGreaterThan(t3Score)
  })
})

function daysFromToday(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

describe('generateTrips — widening the drive radius never loses trips', () => {
  // Regression for 2026-08-17: at a 5h radius the top trip covered 3 priority
  // players; at 8h it vanished, leaving only 2-player trips. Cause: the wider
  // radius let the candidate absorb far-away filler stops, pushing its total
  // drive past a FIXED 600-min cap, which discarded the whole candidate. The
  // total-drive budget now scales with the radius and over-budget stops are
  // trimmed individually instead of killing the trip.
  const HOME = { lat: 28.5383, lng: -81.3792 } // Orlando
  const LNG = -81.3792
  const venueAt = (lat: number, name: string) => ({ name, coords: { lat, lng: LNG } })

  const game = (
    id: string, date: string, dayOfWeek: number, lat: number, venueName: string, playerName: string,
  ): GameEvent => ({
    id, date, dayOfWeek, time: '', homeTeam: 'Home', awayTeam: 'Away', isHome: true,
    venue: venueAt(lat, venueName), source: 'mlb-api', playerNames: [playerName],
  })

  // Anchor ~3h north of home (Mon), two priority teammates ±0.5° (Tue),
  // and filler games 5-6.5h from home — only reachable at the 8h radius.
  // Dates are relative to today: the engine clamps the start date to today,
  // so a fixed 2026-08-24 fixture silently aged out on 2026-08-25.
  const D1 = daysFromToday(7)
  const D2 = daysFromToday(8)
  const games: GameEvent[] = [
    game('a', D1, 1, 30.5, 'Anchor Park', 'Anchor Ace'),
    game('b', D2, 2, 31.0, 'North Field', 'Nearby Beta'),
    game('c', D2, 2, 30.0, 'South Field', 'Nearby Carl'),
    game('f1', D2, 2, 33.5, 'Filler Park 1', 'Filler One'),
    game('f2', D2, 2, 34.0, 'Filler Park 2', 'Filler Two'),
    game('f3', D2, 2, 34.5, 'Filler Park 3', 'Filler Three'),
    game('f4', D2, 2, 35.0, 'Filler Park 4', 'Filler Four'),
  ]
  const players = [
    'Anchor Ace', 'Nearby Beta', 'Nearby Carl',
    'Filler One', 'Filler Two', 'Filler Three', 'Filler Four',
  ].map((playerName) => makePlayer({ playerName }))
  const priority = ['Anchor Ace', 'Nearby Beta', 'Nearby Carl']

  const priorityCoverage = (plan: TripPlan): number => {
    let best = 0
    for (const trip of plan.trips) {
      const names = new Set([
        ...trip.anchorGame.playerNames,
        ...trip.nearbyGames.flatMap((g) => g.playerNames),
      ])
      best = Math.max(best, priority.filter((p) => names.has(p)).length)
    }
    return best
  }

  it('a trip covering all 3 priority players survives the radius expanding 5h → 8h', async () => {
    const run = (maxDriveMinutes: number) =>
      generateTrips(games, players, D1, D2, undefined,
        maxDriveMinutes, priority, undefined, 4, undefined, HOME)

    const at5h = await run(300)
    const at8h = await run(480)

    expect(priorityCoverage(at5h)).toBe(3)
    // The wider radius must not lose that coverage (this is the regression)
    expect(priorityCoverage(at8h)).toBe(3)
  })
})

describe('generateTrips — overlapping start times never disqualify a same-day double up', () => {
  // Regression for 2026-08-17: Tiroly (The Diamond, 9:05 PM) + Lindsey
  // (ONT Field, 9:35 PM), 37 min apart on Sep 1. The Map counted it as a
  // double up, but a start-time gap check in the nearby filter dropped the
  // partner game, so a Sep 1-only search built two solo trips and no card
  // carried the double up. Tom's rule: times never disqualify (split
  // innings, or game + meal).
  const VENUE_A = { lat: 33.65, lng: -117.35 }
  const VENUE_B = { lat: 34.05, lng: -117.60 } // ~35-40 min drive north

  const games: GameEvent[] = [
    {
      id: 'du-a', date: '2026-09-01', dayOfWeek: 2, time: '2026-09-02T01:05:00Z',
      homeTeam: 'Home A', awayTeam: 'Away A', isHome: true,
      venue: { name: 'Diamond Test Park', coords: VENUE_A },
      source: 'mlb-api', playerNames: ['Pair One'],
    },
    {
      id: 'du-b', date: '2026-09-01', dayOfWeek: 2, time: '2026-09-02T01:35:00Z',
      homeTeam: 'Home B', awayTeam: 'Away B', isHome: true,
      venue: { name: 'ONT Test Field', coords: VENUE_B },
      source: 'mlb-api', playerNames: ['Pair Two'],
    },
  ]
  const players = ['Pair One', 'Pair Two'].map((playerName) => makePlayer({ playerName }))

  it('a single-day search puts both overlapping games in one trip', async () => {
    const plan = await generateTrips(games, players, '2026-09-01', '2026-09-01', undefined,
      480, ['Pair One', 'Pair Two'], undefined, 4, undefined, VENUE_A)

    const covering = plan.trips.find((t) => {
      const names = new Set([
        ...t.anchorGame.playerNames,
        ...t.nearbyGames.flatMap((g) => g.playerNames),
      ])
      return names.has('Pair One') && names.has('Pair Two')
    })
    expect(covering).toBeDefined()
  })
})
