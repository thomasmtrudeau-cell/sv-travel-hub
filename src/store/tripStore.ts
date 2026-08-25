import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Coordinates, RosterPlayer } from '../types/roster'
import type { GameEvent, TripCandidate, TripPlan } from '../types/schedule'
import { generateSpringTrainingEvents, generateNcaaEvents, generateHsEvents, MAX_DRIVE_MINUTES, estimateDriveMinutes, computeScoreBreakdown } from '../lib/tripEngine'
import { findDoubleUps } from '../lib/doubleUps'
import { debugLog } from '../lib/debugLog'
import type { UrgencyMap, PinnedGame } from '../lib/tripEngine'
import type { ConvergenceWindow } from '../lib/convergence'
import type { WorkerParams, WorkerMessage } from '../lib/tripEngine.worker'
import { useRosterStore } from './rosterStore'
import { useScheduleStore } from './scheduleStore'
import { useVenueStore } from './venueStore'
import { useHeartbeatStore } from './heartbeatStore'
import { useSummerStore } from './summerStore'
import { isInSummerWindow } from '../data/summerLeagues'

function toISO(d: Date): string {
  return d.toISOString().split('T')[0]!
}
// Default window: today → end of the season (Tom 2026-08-19: every fresh
// load or refresh starts from the FULL rest-of-season picture; narrowing is
// a per-session choice, never remembered). Sep 30 matches the pro-schedule
// fetch window; after Sep 30 "rest of season" rolls to next year's.
function defaultStart(): string {
  return toISO(new Date())
}
function defaultEnd(): string {
  const now = new Date()
  const seasonEnd = `${now.getFullYear()}-09-30`
  return toISO(now) <= seasonEnd ? seasonEnd : `${now.getFullYear() + 1}-09-30`
}

export type TripStatus = 'planned' | 'completed'

// Stable trip key for status tracking across regeneration
export function getTripKey(trip: import('../types/schedule').TripCandidate): string {
  const anchorDate = trip.anchorGame.date
  const venueKey = `${trip.anchorGame.venue.coords.lat.toFixed(4)},${trip.anchorGame.venue.coords.lng.toFixed(4)}`
  return `trip-${anchorDate}-${venueKey}`
}

/** Materialize a convergence route the user clicked "Plan" on as an exact
 *  trip card. Banner routes may carry legs over the Drive cap (flagged, not
 *  dropped), so the engine can't be trusted to rediscover the clicked
 *  itinerary — build the card straight from the route's own stops.
 *  Returns null if any stop's game is no longer in the loaded schedules. */
function swingToTripCandidate(
  swing: ConvergenceWindow,
  allGames: GameEvent[],
  players: RosterPlayer[],
  urgencyMap: UrgencyMap | undefined,
  homeBase: Coordinates,
): TripCandidate | null {
  const gameById = new Map(allGames.map((g) => [g.id, g]))
  const stopGames = swing.stops.map((s) => gameById.get(s.gameId)).filter((g): g is GameEvent => !!g)
  if (stopGames.length === 0 || stopGames.length !== swing.stops.length) return null
  const anchor = stopGames[0]!
  const nearbyGames = stopGames.slice(1).map((g, i) => ({ ...g, driveMinutes: swing.hopMinutes[i] ?? 0 }))
  const visitedPlayers = [...new Set(swing.stops.flatMap((s) => s.playerNames))]
  const playerMap = new Map(players.map((p) => [p.playerName, p]))
  const isTuesday = new Date(anchor.date + 'T12:00:00Z').getUTCDay() === 2
  const breakdown = computeScoreBreakdown(visitedPlayers, playerMap, isTuesday, urgencyMap, stopGames)
  return {
    anchorGame: anchor,
    nearbyGames,
    suggestedDays: [...new Set(stopGames.map((g) => g.date))].sort(),
    totalPlayersVisited: visitedPlayers.length,
    visitValue: breakdown.finalScore,
    driveFromHomeMinutes: Math.round(estimateDriveMinutes(homeBase, anchor.venue.coords)),
    totalDriveMinutes: swing.totalDriveMinutes,
    venueCount: new Set(stopGames.map((g) => `${g.venue.coords.lat},${g.venue.coords.lng}`)).size,
    scoreBreakdown: breakdown,
    plannedFromSwing: true,
  }
}

interface TripState {
  startDate: string
  endDate: string
  maxDriveMinutes: number
  /** Kent 2026-08-25: "a turn off button for the radius so I can just see
   *  the general location of players that week". When false the dashed
   *  circle is hidden and the planner's facts table shows every game on
   *  the dates (distances still labeled). Drivable double-up pairing and
   *  the trip engine keep using maxDriveMinutes — that is a pairing
   *  distance, not a view filter. */
  radiusEnabled: boolean
  maxFlightHours: number
  useHeartbeatBoost: boolean
  priorityPlayers: string[]
  maxNights: number
  /** Trip origin. NULL until the user picks one — there is no pre-set
   *  starting destination (Tom 2026-08-18, Mike D flow: the map starts as
   *  the whole US; star + drive radius appear only after the origin filter
   *  is enabled). Only the origin picker and star-drag ever set this. */
  homeBase: Coordinates | null
  homeBaseName: string
  tripPlan: TripPlan | null
  computing: boolean
  progressStep: string
  progressDetail: string
  tripStatuses: Record<string, TripStatus>
  /** Kent-favorited trips, keyed by getTripKey(trip). Persisted so
   *  starring survives regenerations and sessions. */
  starredTrips: Record<string, boolean>
  selectedTripIndex: number | null // For map preview highlighting
  /** "Show on map" focus — works for BOTH road trips and fly-ins. Set
   *  BEFORE switching to the Map tab: the map mounts only when its tab is
   *  active, so a dispatched map event from the Trip Planner is lost, but
   *  store state survives the tab switch. MapView narrows the date range
   *  to it; MapContainer fits the viewport to its points. Not persisted. */
  mapFocus: {
    points: Coordinates[]
    startDate: string
    endDate: string
    label: string
  } | null
  /** One-shot: a specific game (Schedule tab "Plan trip") the next
   *  generation must build a trip around. Consumed by generateTrips. */
  pinnedGame: PinnedGame | null
  /** One-shot: the exact convergence route the user clicked "Plan" on.
   *  Materialized as a trip card after the next generation — the engine
   *  can't be trusted to rediscover it (its legs may exceed the Drive cap,
   *  which the banner flags but the engine enforces). Not persisted. */
  plannedSwing: ConvergenceWindow | null

  setDateRange: (start: string, end: string) => void
  setMaxDriveMinutes: (minutes: number) => void
  setRadiusEnabled: (enabled: boolean) => void
  setMaxFlightHours: (hours: number) => void
  setPriorityPlayers: (players: string[]) => void
  setHomeBase: (coords: Coordinates, name: string) => void
  clearHomeBase: () => void
  setMaxNights: (n: number) => void
  setPinnedGame: (pin: PinnedGame | null) => void
  setPlannedSwing: (swing: ConvergenceWindow | null) => void
  generateTrips: () => Promise<void>
  clearTrips: () => void
  setTripStatus: (tripKey: string, status: TripStatus | null) => void
  toggleTripStar: (tripKey: string) => void
  setUseHeartbeatBoost: (v: boolean) => void
  setSelectedTripIndex: (index: number | null) => void
  setMapFocus: (focus: TripState['mapFocus']) => void
  /** Drop persisted priority picks for players no longer on the master
   *  roster. Called by rosterStore after every successful roster fetch. */
  pruneRemovedPlayers: () => void
}

// Track active worker for cancel support
let activeWorker: Worker | null = null

export const useTripStore = create<TripState>()(
  persist(
    (set, get) => ({
  startDate: defaultStart(),
  endDate: defaultEnd(),
  maxDriveMinutes: MAX_DRIVE_MINUTES,
  radiusEnabled: true,
  maxFlightHours: 4,
  useHeartbeatBoost: false, // default OFF — Heartbeat data is a snapshot of now, not the future
  priorityPlayers: [],
  maxNights: 2,
  homeBase: null,
  homeBaseName: '',
  tripPlan: null,
  computing: false,
  progressStep: '',
  progressDetail: '',
  tripStatuses: {},
  starredTrips: {},
  selectedTripIndex: null,
  mapFocus: null,
  pinnedGame: null,
  plannedSwing: null,

  setDateRange: (startDate, endDate) => {
    // Old games never render (Mike D 2026-08-17: past games still showing
    // was a top Maptive complaint). Clamp at the store chokepoint so every
    // date input — Map bar, planner, presets — inherits the guard.
    const today = new Date().toISOString().split('T')[0]!
    const s = startDate < today ? today : startDate
    const e = endDate < today ? today : endDate
    set({ startDate: s, endDate: e })
  },
  setMaxDriveMinutes: (maxDriveMinutes) => set({ maxDriveMinutes, radiusEnabled: true }),
  setRadiusEnabled: (radiusEnabled) => set({ radiusEnabled }),
  setMaxFlightHours: (maxFlightHours) => set({ maxFlightHours }),
  setUseHeartbeatBoost: (useHeartbeatBoost: boolean) => set({ useHeartbeatBoost }),
  setPriorityPlayers: (priorityPlayers) => set({ priorityPlayers }),
  pruneRemovedPlayers: () => {
    // Roster master sheet is the source of truth (Tom 2026-08-17) —
    // persisted priority picks must not keep an ex-client's name alive.
    const rosterPlayers = useRosterStore.getState().players
    if (rosterPlayers.length === 0) return // roster not loaded — never wipe on an empty read
    const rosterNames = new Set(rosterPlayers.map((p) => p.playerName))
    const current = get().priorityPlayers
    const kept = current.filter((n) => rosterNames.has(n))
    if (kept.length !== current.length) set({ priorityPlayers: kept })
  },
  setHomeBase: (homeBase, homeBaseName) => set({ homeBase, homeBaseName }),
  clearHomeBase: () => set({ homeBase: null, homeBaseName: '' }),
  setMaxNights: (maxNights: number) => set({ maxNights }),
  setPinnedGame: (pinnedGame) => set({ pinnedGame }),
  setPlannedSwing: (plannedSwing) => set({ plannedSwing }),
  clearTrips: () => set({ tripPlan: null, selectedTripIndex: null, mapFocus: null }),
  setSelectedTripIndex: (selectedTripIndex) => set({ selectedTripIndex }),
  setMapFocus: (mapFocus) => set({ mapFocus }),
  setTripStatus: (tripKey, status) => set((state) => {
    const next = { ...state.tripStatuses }
    if (status === null) {
      delete next[tripKey]
    } else {
      next[tripKey] = status
    }
    return { tripStatuses: next }
  }),
  toggleTripStar: (tripKey) => set((state) => {
    const next = { ...state.starredTrips }
    if (next[tripKey]) delete next[tripKey]
    else next[tripKey] = true
    return { starredTrips: next }
  }),

  generateTrips: async () => {
    if (get().computing) return
    const { startDate, endDate, maxDriveMinutes, maxFlightHours, priorityPlayers, useHeartbeatBoost, maxNights, pinnedGame } = get()
    let { homeBase, homeBaseName } = get()

    // Origin scrapped (Tom 2026-07-22): with priority players set, anchor
    // the engine at the FIRST priority player's earliest in-range game —
    // trips are built around where the games are, and the user handles
    // getting to the area themselves. A pinned game (Schedule tab "Plan
    // trip" on a specific row) overrides that: anchor at the PINNED game's
    // venue so the clicked game is always inside the drive radius.
    if (priorityPlayers.length > 0) {
      const ss = useScheduleStore.getState()
      const pool = [...ss.proGames, ...ss.ncaaGames, ...ss.hsGames]
      const anchorGame =
        (pinnedGame
          ? pool.find((g) =>
              g.date === pinnedGame.date &&
              g.venue.name === pinnedGame.venueName &&
              g.playerNames.includes(pinnedGame.playerName))
          : undefined) ??
        pool
          .filter((g) => g.date >= startDate && g.date <= endDate && g.playerNames.includes(priorityPlayers[0]!))
          .sort((a, b) => a.date.localeCompare(b.date))[0]
      if (anchorGame) {
        // Local re-anchor ONLY — the engine builds around the games, but the
        // user's typed base must survive the run. Persisting the venue name
        // here silently flipped "Trip origin: Philadelphia" to e.g. "FNB
        // Field" after Generate, which is exactly the from-where ambiguity
        // Kent flagged (2026-08-17: distances read from the base he set,
        // never from an inferred anchor).
        homeBase = anchorGame.venue.coords
        homeBaseName = anchorGame.venue.name
      }
    }
    // No origin at all — the origin starts unset (no pre-set default), and
    // without either a base or a priority-player anchor the engine has no
    // "from where". Block with the fix instead of guessing a city.
    if (!homeBase) {
      set({
        computing: false,
        tripPlan: null,
        progressStep: 'Blocked',
        progressDetail: 'Pick a Trip origin (or add a priority player to anchor around) before generating trips.',
      })
      return
    }
    const base: Coordinates = homeBase
    const baseName = homeBaseName || 'trip start'
    const players = useRosterStore.getState().players
    let scheduleState = useScheduleStore.getState()

    set({ computing: true, tripPlan: null, progressStep: 'Preparing...', progressDetail: '' })

    // BLOCK: Refuse to generate if priority player schedule data is missing
    if (priorityPlayers.length > 0) {
      const missingSchedule: string[] = []
      for (const pName of priorityPlayers) {
        const player = players.find((p) => p.playerName === pName)
        if (!player) continue
        if (player.level === 'Pro' && scheduleState.proGames.length === 0) {
          missingSchedule.push(`${pName} (Pro) — click "Load Pro Schedules" first`)
        }
        if (player.level === 'NCAA' && scheduleState.ncaaGames.length === 0) {
          missingSchedule.push(`${pName} (NCAA) — click "Load College Schedules" first`)
        }
      }
      if (missingSchedule.length > 0) {
        set({
          computing: false,
          tripPlan: null,
          progressStep: 'Blocked',
          progressDetail: `Cannot generate trips — missing schedule data for priority player(s):\n${missingSchedule.join('\n')}`,
        })
        return
      }
    }

    // Pre-flight check: warn immediately if priority players have no drivable games
    if (priorityPlayers.length > 0) {
      const allAvailableGames = [...scheduleState.proGames, ...scheduleState.ncaaGames, ...scheduleState.hsGames]
      for (const pName of priorityPlayers) {
        const playerGames = allAvailableGames.filter((g) => g.playerNames.includes(pName))
        if (playerGames.length === 0) continue // missing schedule already handled above
        const hasDrivable = playerGames.some((g) => {
          if (g.venue.coords.lat === 0 && g.venue.coords.lng === 0) return false
          return estimateDriveMinutes(base, g.venue.coords) <= maxDriveMinutes
        })
        if (!hasDrivable) {
          const driveHours = Math.round(maxDriveMinutes / 60)
          set({ progressDetail: `Heads up: ${pName} has no games within ${driveHours}h drive of ${baseName} — will check fly-in options...` })
          // Brief pause so user sees the warning before heavy computation
          await new Promise((r) => setTimeout(r, 1200))
        }
      }
    }

    const scheduledGames = scheduleState.proGames
    const realNcaaGames = scheduleState.ncaaGames

    // Pull in summer-league games if the date window overlaps summer. Most
    // SV-relevant summer schedules (CCBL, MLB Draft League) come straight from
    // the MLB Stats API; PrestoSports leagues will join later.
    const summerStore = useSummerStore.getState()
    const summerInRange = (() => {
      try {
        return isInSummerWindow(new Date(startDate)) || isInSummerWindow(new Date(endDate))
      } catch { return false }
    })()
    if (summerInRange && summerStore.assignments.length > 0 && summerStore.summerGames.length === 0) {
      // Don't await — let the trip computation kick off; summer games will
      // appear on the next Generate Trips press. We only block on the first
      // load when there are zero summer games but assignments exist.
      await summerStore.loadSchedules(startDate, endDate)
    }
    const summerGames = useSummerStore.getState().summerGames

    // Read custom aliases from schedule store
    const customMlbAliases = scheduleState.customMlbAliases
    const customNcaaAliases = scheduleState.customNcaaAliases

    // Merge scheduled games with spring training + NCAA + HS visit opportunities
    // Only generate ST events for Pro players who don't have real API games yet
    const proPlayersWithRealGames = new Set(
      scheduledGames.flatMap((g) => g.playerNames),
    )
    const stEvents = generateSpringTrainingEvents(
      players.filter((p) => !proPlayersWithRealGames.has(p.playerName)),
      startDate, endDate, customMlbAliases,
    )

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

    // Use real MaxPreps HS schedules if available, otherwise fall back to synthetic
    const realHsGames = scheduleState.hsGames
    const hsPlayersWithRealSchedules = new Set(
      realHsGames.flatMap((g) => g.playerNames),
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
    // Only generate synthetic events for HS players WITHOUT real schedules
    const hsSyntheticEvents = generateHsEvents(
      players.filter((p) => p.level === 'HS' && !hsPlayersWithRealSchedules.has(p.playerName)),
      startDate, endDate, hsVenues,
    )

    // During summer, an NCAA player's summer-team games should replace their
    // (essentially absent) college games. Filter out synthetic NCAA events for
    // any player who has an active summer assignment.
    const summerByPlayer = useSummerStore.getState().byPlayer
    const ncaaSyntheticFiltered = ncaaSyntheticEvents
      .map((g) => {
        const kept = g.playerNames.filter((n) => !summerByPlayer[n]?.active)
        if (kept.length === 0) return null
        if (kept.length === g.playerNames.length) return g
        return { ...g, playerNames: kept }
      })
      .filter((g): g is typeof ncaaSyntheticEvents[number] => g !== null)

    // Merge all game sources and deduplicate by venue+date+playerSet
    // This prevents synthetic events from duplicating real schedule data
    const rawGames = [...scheduledGames, ...stEvents, ...realNcaaGames, ...ncaaSyntheticFiltered, ...realHsGames, ...hsSyntheticEvents, ...summerGames]
    const gameMap = new Map<string, typeof rawGames[0]>()
    for (const game of rawGames) {
      // Prefer real (high confidence) games over synthetic ones at same venue+date
      const dedupeKey = `${game.venue.coords.lat.toFixed(4)},${game.venue.coords.lng.toFixed(4)}|${game.date}|${game.playerNames.sort().join(',')}`
      const existing = gameMap.get(dedupeKey)
      if (!existing || (game.confidence === 'high' && existing.confidence !== 'high')) {
        gameMap.set(dedupeKey, game)
      }
    }
    const allGames = [...gameMap.values()]

    // Diagnostic: log HS game counts per player so we can debug "no games in range" issues
    const hsPlayers = players.filter((p) => p.level === 'HS')
    if (hsPlayers.length > 0) {
      const hsInAll = allGames.filter((g) => g.source === 'hs-lookup')
      debugLog(`[HS-DEBUG] HS games in allGames: ${hsInAll.length}, realHsGames: ${realHsGames.length}, hsSynthetic: ${hsSyntheticEvents.length}`)
      for (const p of hsPlayers) {
        const playerGames = allGames.filter((g) => g.playerNames.includes(p.playerName))
        const inRange = playerGames.filter((g) => g.date >= startDate && g.date <= endDate)
        if (playerGames.length > 0 || inRange.length === 0) {
          debugLog(`[HS-DEBUG] ${p.playerName}: ${playerGames.length} total games, ${inRange.length} in range (${startDate} to ${endDate})${playerGames.length > 0 ? `, dates: ${playerGames[0]!.date} to ${playerGames[playerGames.length - 1]!.date}` : ''}`)
        }
      }
    }

    // Build urgency map from heartbeat data (only when toggle is ON)
    const urgencyMap: UrgencyMap = new Map()
    if (useHeartbeatBoost) {
      const heartbeatState = useHeartbeatStore.getState()
      for (const p of players) {
        const urgency = heartbeatState.getPlayerUrgency(p.playerName)
        if (urgency && urgency.visitUrgencyScore > 0) {
          // Scale: urgencyScore of 50+ gets 2.0x, 25-49 gets 1.5x, below 25 gets 1.25x
          const boost = urgency.visitUrgencyScore >= 50 ? 2.0
            : urgency.visitUrgencyScore >= 25 ? 1.5
            : 1.25
          urgencyMap.set(p.playerName, boost)
        }
      }
    }

    // Cross-agent visit coverage — if another SV agent already has a planned
    // visit to a player within the trip window, down-weight that player so
    // the engine doesn't recommend Tom double up. Always applied (not gated
    // on useHeartbeatBoost) because Kent specifically asked for this.
    {
      const heartbeatState = useHeartbeatStore.getState()
      for (const p of players) {
        const vc = heartbeatState.getVisitCount(p.playerName)
        const planned = vc?.nextPlannedDate
        if (!planned) continue
        // Only count if the planned visit falls inside (or within 14d of) the trip window
        const plannedISO = planned.length > 10 ? planned.slice(0, 10) : planned
        if (plannedISO < startDate) continue
        // Noon-UTC parse + UTC date math — new Date('YYYY-MM-DD') parses as
        // UTC midnight, so local setDate/toISOString shifted a day in some TZs
        const windowEnd = new Date(endDate + 'T12:00:00Z')
        windowEnd.setUTCDate(windowEnd.getUTCDate() + 14)
        const windowEndISO = windowEnd.toISOString().split('T')[0]!
        if (plannedISO > windowEndISO) continue
        // Multiply existing urgency by 0.4 (or set to 0.4 if no entry yet).
        // 0.4 = noticeable de-prioritization without zeroing out — if Mike
        // cancels his visit, this player still shows up in trip generation.
        const existing = urgencyMap.get(p.playerName) ?? 1.0
        urgencyMap.set(p.playerName, existing * 0.4)
      }
    }

    set({ computing: true, tripPlan: null, progressStep: 'Analyzing games...', progressDetail: `${allGames.length} games in date range` })

    // Cancel any in-flight worker
    if (activeWorker) {
      activeWorker.terminate()
      activeWorker = null
    }

    // Convert urgencyMap (Map) to plain Record for worker serialization
    const urgencyRecord: Record<string, number> = {}
    for (const [k, v] of urgencyMap) urgencyRecord[k] = v

    const workerParams: WorkerParams = {
      games: allGames,
      players,
      startDate,
      endDate,
      maxDriveMinutes,
      priorityPlayers,
      urgencyRecord: Object.keys(urgencyRecord).length > 0 ? urgencyRecord : undefined,
      maxFlightHours,
      playerTeamAssignments: scheduleState.playerTeamAssignments,
      homeBase: base,
      maxTripDays: maxNights + 1,
      pinnedGame: pinnedGame ?? undefined,
    }

    const worker = new Worker(
      new URL('../lib/tripEngine.worker.ts', import.meta.url),
      { type: 'module' },
    )
    activeWorker = worker

    worker.postMessage(workerParams)

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        set({ progressStep: msg.step, progressDetail: msg.detail ?? '' })
      } else if (msg.type === 'result') {
        const plan = msg.plan
        // Label driveFromHomeMinutes with the base the ENGINE actually used
        // (anchor venue when priority players re-anchored) — every distance
        // names its origin (Kent 2026-08-17).
        plan.baseName = baseName
        // Detect double-up opportunities across all games — pair cap follows
        // the Drive-radius setting, same as the Map tab
        plan.doubleUps = findDoubleUps(allGames, players, startDate, endDate, undefined, undefined, get().maxDriveMinutes)

        // Exact-route injection: the user clicked "Plan" on a specific
        // convergence route, so the results must contain THAT itinerary —
        // not just the engine's take on the same dates, which enforces the
        // Drive cap the banner deliberately shows routes beyond.
        const plannedSwing = get().plannedSwing
        if (plannedSwing) {
          const planned = swingToTripCandidate(plannedSwing, allGames, players,
            urgencyMap.size > 0 ? urgencyMap : undefined, base)
          if (planned) {
            const routeIds = (t: TripCandidate) => [t.anchorGame.id, ...t.nearbyGames.map((g) => g.id)].sort().join('|')
            const plannedIds = routeIds(planned)
            const engineMatch = plan.trips.find((t) => routeIds(t) === plannedIds)
            if (engineMatch) engineMatch.plannedFromSwing = true
            else plan.trips.unshift(planned)
          }
        }

        // Prune stale tripStatuses — only keep keys that match current trips
        const currentKeys = new Set(plan.trips.map(getTripKey))
        const oldStatuses = get().tripStatuses
        const prunedStatuses: Record<string, TripStatus> = {}
        for (const [key, status] of Object.entries(oldStatuses)) {
          if (currentKeys.has(key)) prunedStatuses[key] = status
        }

        // pinnedGame/plannedSwing are one-shot: consumed by this run so later
        // manual Generate presses aren't silently steered by a stale pin.
        set({ tripPlan: plan, computing: false, progressStep: '', progressDetail: '', tripStatuses: prunedStatuses, pinnedGame: null, plannedSwing: null })
        worker.terminate()
        activeWorker = null
      } else if (msg.type === 'error') {
        set({
          computing: false,
          progressStep: 'Error',
          progressDetail: msg.message,
        })
        worker.terminate()
        activeWorker = null
      }
    }

    worker.onerror = (e) => {
      set({
        computing: false,
        progressStep: 'Error',
        progressDetail: e.message || 'Worker failed unexpectedly',
      })
      worker.terminate()
      activeWorker = null
    }
  },
}),
    {
      name: 'sv-travel-trips',
      // v7: reset every user's home base back to Orlando, FL — Kent (primary
      // user) lives there, so it's the right default. Previously each user's
      // session held their last picked city forever via localStorage, which
      // meant Kent's session was stuck on whatever I last tested with.
      // v8: reset dates to the fresh default (today → +14d) — persisted
      // ranges went stale (start dates in the past) and Orlando default
      // re-asserted (Tom 2026-07-22).
      // v9: origin starts UNSET (Tom 2026-08-18) — no pre-set starting
      // destination; the star/radius exist only after the user picks one.
      // One-time wipe of the old Orlando default; origins picked after v9
      // persist normally.
      version: 9,
      migrate: (persisted: any) => ({
        maxDriveMinutes: persisted?.maxDriveMinutes === 180 ? MAX_DRIVE_MINUTES : (persisted?.maxDriveMinutes ?? MAX_DRIVE_MINUTES),
        maxFlightHours: persisted?.maxFlightHours ?? 4,
        useHeartbeatBoost: persisted?.useHeartbeatBoost ?? false,
        priorityPlayers: persisted?.priorityPlayers ?? [],
        tripStatuses: persisted?.tripStatuses ?? {},
        starredTrips: persisted?.starredTrips ?? {},
        maxNights: persisted?.maxNights ?? 2,
        // v9 reset: origin unset — no default city.
        homeBase: null as Coordinates | null,
        homeBaseName: '',
      }),
      partialize: (state) => ({
        // tripPlan is NOT persisted — it's computed data that should be
        // regenerated each session to avoid stale results and schema mismatches.
        // startDate/endDate are NOT persisted either — every session starts
        // at the rest-of-season default (Tom 2026-08-19).
        maxDriveMinutes: state.maxDriveMinutes,
        radiusEnabled: state.radiusEnabled,
        maxFlightHours: state.maxFlightHours,
        useHeartbeatBoost: state.useHeartbeatBoost,
        maxNights: state.maxNights,
        priorityPlayers: state.priorityPlayers,
        tripStatuses: state.tripStatuses,
        starredTrips: state.starredTrips,
        homeBase: state.homeBase,
        homeBaseName: state.homeBaseName,
      }),
      // Every load starts at the rest-of-season default (Tom 2026-08-19) —
      // dates are no longer partialized, but blobs written before that
      // change still carry them and merge() would restore them, so the
      // reset here is unconditional.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        state.setDateRange(defaultStart(), defaultEnd())
        // Nights UI removed 2026-07-23 — pin persisted values to Kent's
        // 3-day rule (2 nights) so old 1/3 settings don't silently differ.
        if (state.maxNights !== 2) state.maxNights = 2
      },
      merge: (persisted, current) => {
        const p = persisted as any
        return {
          ...current,
          ...(p ?? {}),
          maxFlightHours: p?.maxFlightHours ?? 4, // match initial state + migrate default
          priorityPlayers: p?.priorityPlayers ?? [],
          tripStatuses: p?.tripStatuses ?? {},
          starredTrips: p?.starredTrips ?? {},
          maxNights: p?.maxNights ?? 2,
          homeBase: p?.homeBase ?? null,
          homeBaseName: p?.homeBaseName ?? '',
          tripPlan: null, // Always start fresh
        }
      },
    },
  ),
)
