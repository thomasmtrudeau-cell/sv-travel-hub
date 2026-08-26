import { useEffect, useMemo, useRef, useState } from 'react'
import { useTripStore, getTripKey } from '../../store/tripStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { useSummerStore } from '../../store/summerStore'
import CompareStarredTrips from './CompareStarredTrips'
import TripSummaryCard from './TripSummaryCard'
// ICS export removed from main UI — kept in individual trip cards
// import { generateAllTripsIcs, downloadIcs } from '../../lib/icsExport'
import PlayerSchedulePanel from '../roster/PlayerSchedulePanel'
import { PairVerdictBanner, type PairVerdict } from './DoubleUpSection'
import ConvergenceBanner from './ConvergenceBanner'
import { findDoubleUps, findClosestApproach } from '../../lib/doubleUps'
import { findConvergenceWindows, playersWithoutGames } from '../../lib/convergence'
import type { RosterPlayer } from '../../types/roster'
import type { FlyInVisit } from '../../types/schedule'
import { formatDate, formatDriveTime, TIER_DOT_COLORS, TIER_LABELS } from '../../lib/formatters'
import { groupAndNumberTrips, itemHasPriorityPlayer, itemPlayerNames, type UnifiedTripItem } from './groupAndNumberTrips'
import { estimateDriveMinutes } from '../../lib/tripEngine'
import CityPicker from '../ui/CityPicker'
import DateRangeCalendar from '../ui/DateRangeCalendar'
import NearbyGamesFacts from './NearbyGamesFacts'
import PriorityFacts from './PriorityFacts'
import { STARTING_LOCATIONS } from '../../data/cityPresets'

// 5 priority slots per Kent's interview ("if I select five players...").
// Shared by the picker AND the Not Covered click-to-add flow so they agree.
const PRIORITY_SLOTS = 5


const LEVEL_ORDER: Record<string, number> = { Pro: 0, NCAA: 1, HS: 2 }
const LEVEL_LABELS: Record<string, string> = { Pro: 'Pro', NCAA: 'College', HS: 'High School' }
const LEVEL_COLORS: Record<string, string> = {
  Pro: 'text-accent-blue',
  NCAA: 'text-accent-green',
  HS: 'text-accent-orange',
}

function PlayerSearchPicker({
  value,
  players,
  excludeNames,
  placeholder,
  onChange,
}: {
  value: string
  players: RosterPlayer[]
  excludeNames?: string[]
  placeholder: string
  onChange: (name: string) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return players
      .filter((p) => !excludeNames?.includes(p.playerName))
      .filter((p) => !q || p.playerName.toLowerCase().includes(q) || p.org.toLowerCase().includes(q))
      .sort((a, b) => {
        const levelDiff = (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9)
        if (levelDiff !== 0) return levelDiff
        return a.playerName.localeCompare(b.playerName)
      })
  }, [players, excludeNames, search])

  // Group by level
  const grouped = useMemo(() => {
    const groups: Array<{ level: string; players: RosterPlayer[] }> = []
    let currentLevel = ''
    for (const p of filtered) {
      if (p.level !== currentLevel) {
        currentLevel = p.level
        groups.push({ level: currentLevel, players: [] })
      }
      groups[groups.length - 1]!.players.push(p)
    }
    return groups
  }, [filtered])

  const selectedPlayer = players.find((p) => p.playerName === value)

  // Auto-clear stale selection (player no longer eligible)
  useEffect(() => {
    if (value && !selectedPlayer) {
      onChange('')
    }
  }, [value, selectedPlayer, onChange])

  return (
    <div ref={containerRef} className="relative min-w-[220px]">
      {value && selectedPlayer ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5">
          <span className={`h-2 w-2 rounded-full ${TIER_DOT_COLORS[selectedPlayer.tier] ?? 'bg-gray-500'}`} />
          <span className="text-sm text-text">{selectedPlayer.playerName}</span>
          <span className={`text-[10px] ${LEVEL_COLORS[selectedPlayer.level] ?? 'text-text-dim'}`}>{selectedPlayer.level}</span>
          <button
            onClick={() => { onChange(''); setSearch('') }}
            className="ml-auto text-text-dim hover:text-text text-xs"
          >
            ✕
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text placeholder:text-text-dim/50 focus:border-accent-blue focus:outline-none"
        />
      )}

      {open && !selectedPlayer && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {grouped.length === 0 && (
            <p className="px-3 py-2 text-xs text-text-dim">No players match "{search}"</p>
          )}
          {grouped.map((group) => (
            <div key={group.level}>
              <div className={`sticky top-0 bg-gray-950 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${LEVEL_COLORS[group.level] ?? 'text-text-dim'}`}>
                {LEVEL_LABELS[group.level] ?? group.level} ({group.players.length})
              </div>
              {group.players.map((p) => (
                <button
                  key={p.playerName}
                  onClick={() => { onChange(p.playerName); setSearch(''); setOpen(false) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent-blue/10 transition-colors"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TIER_DOT_COLORS[p.tier] ?? 'bg-gray-500'}`} />
                  <span className="text-text">{p.playerName}</span>
                  <span className="text-[10px] text-text-dim/50">{TIER_LABELS[p.tier] ?? ''}</span>
                  <span className="ml-auto text-[10px] text-text-dim">{p.org}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function addDaysISO(date: string, delta: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().split('T')[0]!
}

// Progress bar helpers for trip generation
function getProgressPercent(step: string): string {
  if (step.includes('Auto-assigning')) return '10%'
  if (step.includes('Pro schedules')) return '25%'
  if (step.includes('College')) return '45%'
  if (step.includes('Mapping HS')) return '55%'
  if (step.includes('HS schedules')) return '65%'
  if (step.includes('Starting')) return '75%'
  if (step.includes('Analyzing') || step.includes('Scoring')) return '85%'
  if (step.includes('Optimizing') || step.includes('Selecting')) return '92%'
  return '50%'
}

function getProgressNote(step: string): string {
  if (step.includes('Auto-assigning')) return 'Checking MLB/MiLB rosters for player affiliates (~5s)'
  if (step.includes('Pro schedules')) return 'Fetching game schedules from MLB API (~15-30s)'
  if (step.includes('College')) return 'Scraping D1Baseball schedules (~30-60s)'
  if (step.includes('Mapping HS')) return 'Geocoding high school locations (~5s)'
  if (step.includes('HS schedules')) return 'Loading HS games from the schedule sheet'
  if (step.includes('Starting') || step.includes('Analyzing')) return 'Building trip candidates...'
  if (step.includes('Optimizing') || step.includes('Selecting')) return 'Almost done — selecting best trips...'
  return 'First run loads all schedule data. Subsequent runs are much faster.'
}

function ScheduleProgressRow({ label, loading, done, progress, detail, color }: {
  label: string
  loading: boolean
  done: boolean
  progress?: { completed: number; total: number } | null
  detail?: string
  color: string
}) {
  const pct = progress ? Math.round((progress.completed / progress.total) * 100) : 0
  const allFetched = progress != null && progress.completed >= progress.total
  // Done = games loaded into store, OR all items fetched (store still post-processing)
  const effectivelyDone = done || allFetched

  return (
    <div className="flex items-center gap-3">
      {/* Status icon */}
      <div className="w-3 shrink-0">
        {effectivelyDone ? (
          <svg className="h-3 w-3 text-accent-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : loading ? (
          <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent text-text-dim" />
        ) : (
          <span className="block h-2 w-2 rounded-full bg-gray-600 ml-0.5" />
        )}
      </div>
      {/* Label + bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className={`text-[11px] font-medium ${effectivelyDone ? 'text-accent-green' : loading ? 'text-text' : 'text-text-dim'}`}>
            {label}
          </span>
          <span className="text-[10px] text-text-dim/60">
            {effectivelyDone
              ? 'Done'
              : loading && progress
              ? `${progress.completed}/${progress.total}`
              : loading
              ? (detail ?? 'Starting...')
              : 'Pending'}
          </span>
        </div>
        <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
          {effectivelyDone ? (
            <div className={`h-full rounded-full ${color} w-full`} />
          ) : loading && progress ? (
            <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
          ) : loading ? (
            <div className={`h-full rounded-full ${color} animate-pulse w-1/3`} />
          ) : (
            <div className="h-full rounded-full bg-gray-700 w-0" />
          )}
        </div>
      </div>
    </div>
  )
}

export default function TripPlanner() {
  const startDate = useTripStore((s) => s.startDate)
  const endDate = useTripStore((s) => s.endDate)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const priorityPlayers = useTripStore((s) => s.priorityPlayers)

  // Read ?priority=PlayerName from URL (cross-app link from Insight Engine)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const priority = params.get('priority')
    if (priority && !priorityPlayers.includes(priority)) {
      useTripStore.getState().setPriorityPlayers([priority])
      // Clean URL without reload
      window.history.replaceState({}, '', window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const tripPlan = useTripStore((s) => s.tripPlan)
  const computing = useTripStore((s) => s.computing)
  const progressStep = useTripStore((s) => s.progressStep)
  const progressDetail = useTripStore((s) => s.progressDetail)
  const setDateRange = useTripStore((s) => s.setDateRange)
  const setPriorityPlayers = useTripStore((s) => s.setPriorityPlayers)
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const setHomeBase = useTripStore((s) => s.setHomeBase)
  const clearHomeBase = useTripStore((s) => s.clearHomeBase)
  const generateTrips = useTripStore((s) => s.generateTrips)
  const clearTrips = useTripStore((s) => s.clearTrips)
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)
  const schedulesLoading = useScheduleStore((s) => s.schedulesLoading)
  const schedulesProgress = useScheduleStore((s) => s.schedulesProgress)
  const ncaaLoading = useScheduleStore((s) => s.ncaaLoading)
  const ncaaProgress = useScheduleStore((s) => s.ncaaProgress)
  const hsLoading = useScheduleStore((s) => s.hsLoading)
  const hsProgress = useScheduleStore((s) => s.hsProgress)
  const autoAssignLoading = useScheduleStore((s) => s.autoAssignLoading)
  const players = useRosterStore((s) => s.players)
  const rosterLoading = useRosterStore((s) => s.loading)
  const rosterError = useRosterStore((s) => s.error)
  const fetchRoster = useRosterStore((s) => s.fetchRoster)

  // Auto-load roster if empty on mount (Trip Planner is the default tab)
  const rosterInitialized = useRef(false)
  useEffect(() => {
    if (rosterInitialized.current) return
    if (players.length === 0 && !rosterLoading) {
      rosterInitialized.current = true
      fetchRoster()
    }
  }, [players.length, rosterLoading, fetchRoster])

  const [sortBy] = useState<'score' | 'date'>('score') // toolbar removed 2026-07-22 — best-first, always
  const [tripFilter] = useState<'all' | 'drive' | 'fly' | 'multi' | 'anchor' | 'starred'>('all') // filter chips removed 2026-07-22
  const [tripLengthFilter] = useState<'all' | '1' | '2' | '3'>('all') // length chips removed 2026-07-22 (simplify)
  const [showAllTrips, setShowAllTrips] = useState(false)
  const [showAllOtherTrips, setShowAllOtherTrips] = useState(false)
  // tierFilter removed — was adding clutter to the results toolbar
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const [showPickLogic, setShowPickLogic] = useState(false)



  // Build player lookup
  const playerMap = useMemo(() => {
    const map = new Map<string, RosterPlayer>()
    for (const p of players) map.set(p.playerName, p)
    return map
  }, [players])

  // Double ups — computed live from loaded schedules, so Kent sees them
  // WITHOUT having to generate trips first. Real games only (no synthetic
  // events), which keeps this signal high-trust. Fixed 30-day lookahead,
  // independent of the trip date range — Kent wants these flagged well
  // ahead of when he's actually planning the trip (2026-07-21).
  const DOUBLE_UP_WINDOW_DAYS = 30
  const summerGames = useSummerStore((s) => s.summerGames)
  const upcomingDoubleUps = useMemo(() => {
    if (players.length === 0) return []
    const all = [...proGames, ...ncaaGames, ...hsGames, ...summerGames]
    if (all.length === 0) return []
    const today = new Date().toISOString().split('T')[0]!
    // Horizon covers at least the planner's selected end date so in-window
    // verdicts don't miss double ups late in a long range.
    const horizon = addDaysISO(today, DOUBLE_UP_WINDOW_DAYS)
    return findDoubleUps(all, players, today, endDate > horizon ? endDate : horizon, undefined, undefined, maxDriveMinutes)
  }, [proGames, ncaaGames, hsGames, summerGames, players, DOUBLE_UP_WINDOW_DAYS, endDate, maxDriveMinutes])

  // Convergence scan — the all-N answer to Kent's "west coast swing" text
  // (2026-07-24): with 3+ priority players, when do ALL of them land within
  // one multi-stop swing? Scans the planner's full selected range. Computed
  // BEFORE pairVerdicts so a pair on the feasible swing can say "closest is
  // the swing above" instead of a misleading far-future approach.
  const CONVERGENCE_SPAN_DAYS = 5
  const convergence = useMemo(() => {
    if (priorityPlayers.length < 3) return null
    const all = [...proGames, ...ncaaGames, ...hsGames, ...summerGames]
    if (all.length === 0) return null
    const missing = playersWithoutGames(all, priorityPlayers, startDate, endDate)
    const opts = { maxSpanDays: CONVERGENCE_SPAN_DAYS, maxHopMinutes: maxDriveMinutes }
    const windows = missing.length > 0
      ? []
      : findConvergenceWindows(all, priorityPlayers, startDate, endDate, opts)
    // No doable swing inside the selected dates? Scan the rest of the season
    // so the banner can say "they DO line up Jul 29–31 — widen your dates"
    // instead of dead-ending (same shift-your-dates pattern the pair
    // verdicts already use; Tom 2026-07-24).
    let outOfWindow: ReturnType<typeof findConvergenceWindows>[number] | null = null
    if (missing.length === 0 && (windows.length === 0 || !windows[0]!.feasible)) {
      const today = new Date().toISOString().split('T')[0]!
      const seasonEnd = `${new Date().getFullYear()}-09-30`
      outOfWindow = findConvergenceWindows(all, priorityPlayers, today, seasonEnd, opts)
        .find((w) => w.feasible && !(w.startDate >= startDate && w.endDate <= endDate)) ?? null
    }
    return { windows, missing, outOfWindow }
  }, [priorityPlayers, proGames, ncaaGames, hsGames, summerGames, startDate, endDate, maxDriveMinutes])

  // "Does X double up with Y?" — Tom's 2026-07-21 read of the priority
  // pickers as a player-combo double-up filter. For each pair of selected
  // priority players, state the verdict explicitly: dates when they double
  // up, or how close their schedules come (silence read as noise before).
  const pairVerdicts = useMemo<PairVerdict[]>(() => {
    if (priorityPlayers.length < 2) return []
    const all = [...proGames, ...ncaaGames, ...hsGames, ...summerGames]
    const bestSwing = convergence?.windows[0]?.feasible ? convergence.windows[0] : null
    const out: PairVerdict[] = []
    for (let i = 0; i < priorityPlayers.length; i++) {
      for (let j = i + 1; j < priorityPlayers.length; j++) {
        const a = priorityPlayers[i]!
        const b = priorityPlayers[j]!
        const dus = upcomingDoubleUps.filter((du) => du.playerNames.includes(a) && du.playerNames.includes(b))
        const allDates = [...new Set(dus.flatMap((d) => d.dates))].sort()
        // A verdict that says "in this window" must actually mean the
        // planner's selected dates — the fixed 30-day horizon claimed
        // "3 of 6 pairs double up" for an Aug 9–11 plan whose double ups
        // were on Aug 18 (Tom 2026-07-23).
        const inWindow = allDates.filter((d) => d >= startDate && d <= endDate)
        if (inWindow.length > 0) {
          out.push({ a, b, doubleUpDates: inWindow, closest: null })
          continue
        }
        if (allDates.length > 0) {
          out.push({ a, b, doubleUpDates: null, outsideDates: allDates, closest: null })
          continue
        }
        // Both players sit on the feasible swing above? Then "closest" IS
        // the swing — a far-future same-day approach (Sep at Yankee/Fenway)
        // under a banner showing them 2 days apart in LA read as the app
        // contradicting itself (Tom 2026-07-24).
        const stopA = bestSwing?.stops.find((s) => s.playerNames.includes(a))
        const stopB = bestSwing?.stops.find((s) => s.playerNames.includes(b))
        if (stopA && stopB) {
          out.push({ a, b, doubleUpDates: null, closest: null, swingNote: { dateA: stopA.date, dateB: stopB.date } })
          continue
        }
        // Scan the planner's SELECTED dates, not a fixed 30-day horizon —
        // "closest" must mean closest within the window Kent is looking at
        // (a 2-month range was reporting only next-30-day approaches).
        out.push({ a, b, doubleUpDates: null, closest: findClosestApproach(all, a, b, startDate, endDate) })
      }
    }
    return out
  }, [priorityPlayers, upcomingDoubleUps, proGames, ncaaGames, hsGames, summerGames, convergence, startDate, endDate])

  // All players eligible for priority selection (don't filter by visits remaining)
  const eligibleForPriority = useMemo(
    () => players.sort((a, b) => a.playerName.localeCompare(b.playerName)),
    [players],
  )

  // Best week suggestions — computed on-demand only when user clicks "Suggest"
  // bestWeeks removed — trip planner generates for the dates selected

  const hasHsPlayers = players.some((p) => p.level === 'HS')


  const canGenerate = players.length > 0 && !computing


  function addPriorityPlayer(name: string) {
    if (!name) return
    setPriorityPlayers([...new Set([...priorityPlayers, name])].slice(0, PRIORITY_SLOTS))
  }
  function removePriorityPlayer(name: string) {
    setPriorityPlayers(priorityPlayers.filter((n) => n !== name))
  }

  // Fly-in visits are no longer surfaced in Suggested Trips (Tom/Kent
  // 2026-08-26): the planner is a driving-radius tool. Single-game "trips"
  // 2,000 miles from the origin read as broken results. The engine still
  // computes flyInVisits; we just never display them here.
  const displayedFlyIns = useMemo((): FlyInVisit[] => [], [])
  const [showOverlaps, setShowOverlaps] = useState(false)
  const proFetchedAt = useScheduleStore((s) => s.proFetchedAt)

  // Shared trip grouping + numbering — one source of truth for "Trip #N"
  // across the Priority Player Results, status banner, and the card list.
  // See groupAndNumberTrips.ts for the history of why this must be shared.
  const tripGrouping = useMemo(
    () => tripPlan
      ? groupAndNumberTrips({ trips: tripPlan.trips, flyInVisits: displayedFlyIns, priorityPlayers, sortBy })
      : null,
    [tripPlan, displayedFlyIns, priorityPlayers, sortBy],
  )

  // A generated trip that covers EVERY priority player makes the full
  // convergence itinerary redundant — the banner collapses to a headline
  // pointing at that trip ("same result twice, once highlighted", Tom
  // 2026-07-24). Numbering comes from the shared grouping so "#N" matches.
  const coveredByTripNumber = useMemo(() => {
    if (!tripGrouping || priorityPlayers.length < 3) return null
    for (const g of tripGrouping.groups) {
      const names = itemPlayerNames(g.primary)
      if (priorityPlayers.every((p) => names.has(p))) return g.displayIndex
    }
    return null
  }, [tripGrouping, priorityPlayers])

  const anyScheduleLoading = schedulesLoading || ncaaLoading || hsLoading
  const allSchedulesLoaded = proGames.length > 0 && ncaaGames.length > 0 && (!hasHsPlayers || hsGames.length > 0)

  // Compute staleness — only pro schedules can go stale (live-fetched from MLB API).
  // NCAA and HS schedules are bundled as static data and don't expire.
  const now = Date.now()
  const STALE_THRESHOLD = 24 * 60 * 60 * 1000 // 24 hours
  const proStale = proFetchedAt ? (now - proFetchedAt > STALE_THRESHOLD) : false
  const anyStale = proStale


  // (formatAge removed — schedule badges simplified)

  // NOTE: schedule auto-loading happens ONCE at the App level (AutoFetchData
  // in App.tsx) — it fires as soon as the roster loads, regardless of which
  // tab Kent lands on first. TripPlanner only reads the store; the manual
  // "Load Schedules" button below covers retry/refresh.

  async function handleLoadAllSchedules() {
    if (anyScheduleLoading) return
    const schedStore = useScheduleStore.getState()

    // 1. Pro: auto-assign then fetch
    if (Object.keys(schedStore.playerTeamAssignments).length === 0) {
      await schedStore.autoAssignPlayers()
    }
    if (Object.keys(useScheduleStore.getState().playerTeamAssignments).length > 0) {
      const y = new Date().getFullYear()
      schedStore.fetchProSchedules(`${y}-03-01`, `${y}-09-30`)
    }

    // 2. NCAA — bundled data loads instantly
    const ncaaAllOrgs = players
      .filter((p) => p.level === 'NCAA')
      .map((p) => ({ playerName: p.playerName, org: p.org }))
    if (ncaaAllOrgs.length > 0) {
      schedStore.fetchNcaaSchedules(ncaaAllOrgs)
    }

    // 3. HS — bundled data loads instantly (includes pre-geocoded venue coords)
    // NO geocoding needed — bundled homeVenue coords are used directly
    if (hasHsPlayers) {
      const hsOrgs = players
        .filter((p) => p.level === 'HS')
        .map((p) => ({ playerName: p.playerName, org: p.org, state: p.state }))
      if (hsOrgs.length > 0) {
        schedStore.fetchHsSchedules(hsOrgs)
      }
    }

    // 4. Summer — fetch live partner-league schedules (CCBL, MLBD)
    const summerStore = useSummerStore.getState()
    if (summerStore.assignments.length === 0) {
      await summerStore.loadAssignments()
    }
    if (useSummerStore.getState().assignments.length > 0) {
      const y = new Date().getFullYear()
      summerStore.loadSchedules(`${y}-05-20`, `${y}-08-31`)
    }
  }


  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // Fly-in section removed — fly-ins are now in the unified "Your Trips" list

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Trip Planner</h2>

        {/* Schedule status — minimal */}
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Ghost button — schedules auto-load at app start; this is a
                retry/refresh affordance, not the screen's primary action
                (that's Generate Trips). */}
            {!allSchedulesLoaded && !anyScheduleLoading && (
              <button
                onClick={handleLoadAllSchedules}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-dim hover:text-text hover:bg-gray-800 transition-colors"
              >
                Load schedules
              </button>
            )}
            {anyScheduleLoading && !allSchedulesLoaded && (
              <span className="flex items-center gap-2 text-xs text-text-dim">
                <span className="h-3 w-3 animate-spin rounded-full border border-accent-blue border-t-transparent" />
                Loading game data...
              </span>
            )}
            {allSchedulesLoaded && !anyScheduleLoading && (
              <span className="text-[10px] text-accent-green/60">
                Game data loaded
                {anyStale && <button onClick={handleLoadAllSchedules} className="ml-2 text-accent-orange hover:underline">refresh</button>}
              </span>
            )}
          </div>

          {/* Per-source progress bars — only during active network fetches, not cached restores */}
          {anyScheduleLoading && !allSchedulesLoaded && (
            <div className="mt-3 space-y-2">
              <ScheduleProgressRow
                label="Pro Schedules"
                loading={schedulesLoading || autoAssignLoading}
                done={proGames.length > 0}
                progress={schedulesProgress}
                detail={autoAssignLoading ? 'Verifying team assignments...' : undefined}
                color="bg-accent-blue"
              />
              <ScheduleProgressRow
                label="College Schedules"
                loading={ncaaLoading}
                done={ncaaGames.length > 0}
                progress={ncaaProgress}
                color="bg-accent-green"
              />
              {hasHsPlayers && (
                <ScheduleProgressRow
                  label={`HS Schedules${hsGames.length > 0 ? ` (${hsGames.length} games, ${new Set(hsGames.flatMap(g => g.playerNames)).size} players)` : ''}`}
                  loading={hsLoading}
                  done={hsGames.length > 0}
                  progress={hsProgress}
                  color="bg-accent-orange"
                />
              )}
            </div>
          )}
        </div>

        {/* Roster load error */}
        {rosterError && players.length === 0 && (
          <div className="mb-4 rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2">
            <p className="text-sm text-accent-red">Failed to load roster: {rosterError}</p>
            <button
              onClick={fetchRoster}
              disabled={rosterLoading}
              className="mt-2 rounded-lg bg-accent-blue px-3 py-1 text-xs font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
            >
              {rosterLoading ? 'Retrying...' : 'Retry'}
            </button>
          </div>
        )}

        {/* Top row — dates + starting city + Generate, always visible.
            These are shared with the Map tab via the trip store. */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Same calendar popover as the Map's Filters (Tom 2026-08-19:
              the native date inputs fought the store's past-date clamp —
              every mid-edit keystroke snapped back to today, so the date
              couldn't be changed at all). The calendar only ever commits a
              complete, ordered range, so the clamp never bites mid-edit. */}
          <div>
            <label className="mb-1 block text-xs text-text-dim">Dates</label>
            <DateRangeCalendar
              start={startDate}
              end={endDate}
              onChange={setDateRange}
              buttonClass="py-1.5 text-sm"
            />
          </div>
          {/* Trip origin lives HERE too (Kent 2026-08-17: "where am I +
              what dates am I there" is the whole input). Same shared store
              value as the Map's Trip Origin — change either, both update. */}
          <div>
            <label className="mb-1 block text-xs text-text-dim">Trip origin</label>
            <div className="py-0.5">
              <CityPicker
                value={homeBaseName}
                onChange={(coords, cityLabel) => setHomeBase(coords, cityLabel)}
                onClear={clearHomeBase}
                presets={STARTING_LOCATIONS}
                placeholder="No origin set"
                buttonClass="min-w-[170px] py-1.5"
                title="Where you'll be. The games list below shows drive times from here. Shared with the Map's Trip Origin."
              />
            </div>
          </div>
          <button
            onClick={generateTrips}
            disabled={!canGenerate || startDate > endDate}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
          >
            {computing ? 'Computing...' : 'Generate Trips'}
          </button>
          {tripPlan && (
            <button
              onClick={clearTrips}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-dim hover:text-text hover:bg-gray-800 transition-colors"
            >
              Clear Results
            </button>
          )}
        </div>

        {/* Quick date presets + shared-with-Map note */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {([
            { label: 'Next 30 days', days: 30 },
            { label: 'Next 3 months', days: 90 },
            { label: 'Full season', days: 0 },
          ]).map(({ label, days }) => (
            <button
              key={label}
              onClick={() => {
                const today = new Date().toISOString().split('T')[0]!
                if (days === 0) {
                  const y = new Date().getFullYear()
                  setDateRange(today, `${y}-09-30`)
                } else {
                  const end = new Date()
                  end.setDate(end.getDate() + days)
                  setDateRange(today, end.toISOString().split('T')[0]!)
                }
              }}
              className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text transition-colors"
            >
              {label}
            </button>
          ))}
          <span className="text-[11px] text-text-dim/50" title="Dates and starting city are shared with the Map tab — change them here or there, both stay in sync.">
            Same dates as Map
          </span>
        </div>

        {/* Max drive is adjustable HERE too (Tom 2026-08-12) — same shared
            value as the map's Drive chip, so changing either updates both.
            Trip length stays fixed at Kent's 3-day rule. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-text-dim/60">
          <label className="flex items-center gap-2" title="How far you'll drive within a trip's area. Shared with the Drive chip on the Map.">
            <span className="text-text-dim">Max drive</span>
            <input
              type="range"
              min={120}
              max={480}
              step={30}
              value={maxDriveMinutes}
              onChange={(e) => useTripStore.getState().setMaxDriveMinutes(Number(e.target.value))}
              className="w-32 accent-blue-500"
            />
            <span className="font-medium text-text">
              {maxDriveMinutes % 60 > 0
                ? `${Math.floor(maxDriveMinutes / 60)}h ${maxDriveMinutes % 60}m`
                : `${Math.floor(maxDriveMinutes / 60)}h`}
            </span>
          </label>
          <span>
            {priorityPlayers.length > 0
              ? <>· trips stay within this drive of {priorityPlayers[0]}&rsquo;s games · 3 days max</>
              : <>· trips stay within this drive of {homeBaseName || 'your trip origin'} (Trip Origin above) · 3 days max</>}
          </span>
        </div>

        {/* Priority players — selected names as chips + ONE add picker
            (2026-07-21 apple-fy: five empty search boxes read as a form). */}
        <div className="mt-4 rounded-xl bg-gray-900/30 p-3">
          <label className="mb-2 block text-xs font-medium text-text-dim">
            Priority players <span className="text-text-dim/50">(optional — guaranteed to appear in your trip results)</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {priorityPlayers.map((name) => {
              const p = playerMap.get(name)
              return (
                <span key={name} className="flex items-center gap-1.5 rounded-lg bg-gray-800/60 px-2.5 py-1.5 text-sm text-text">
                  <span className={`h-2 w-2 rounded-full ${TIER_DOT_COLORS[p?.tier ?? 4] ?? 'bg-gray-500'}`} />
                  {name}
                  {p && <span className="text-[10px] text-text-dim">{p.level}</span>}
                  <button
                    onClick={() => removePriorityPlayer(name)}
                    className="ml-0.5 text-text-dim hover:text-text text-xs"
                    title={`Remove ${name}`}
                  >
                    ✕
                  </button>
                </span>
              )
            })}
            {priorityPlayers.length < PRIORITY_SLOTS && (
              <PlayerSearchPicker
                value=""
                players={eligibleForPriority}
                excludeNames={priorityPlayers}
                placeholder={priorityPlayers.length === 0 ? 'Add a priority player...' : '+ Add another...'}
                onChange={addPriorityPlayer}
              />
            )}
            {priorityPlayers.length > 0 && (
              <button
                onClick={() => setPriorityPlayers([])}
                className="rounded-lg px-2 py-1 text-xs text-text-dim hover:text-text"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Facts before planning (Kent via Tom 2026-08-18): with priority
            players picked — including arriving via a map popup's "Plan this
            trip" — lay out each player's venue per date and the distances
            involved BEFORE any suggestion. Generation stays the explicit
            button below. */}
        <PriorityFacts playerMap={playerMap} onPlayerClick={(n) => setSelectedPlayer(n)} />

        {/* Trip Anchor moved below results */}

        {!canGenerate && !computing && players.length === 0 && (
          <p className="mt-3 text-xs text-accent-orange">Loading roster...</p>
        )}

        {computing && (
          <div className="mt-4 rounded-xl border border-accent-blue/30 bg-accent-blue/5 p-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
              <span className="text-sm font-semibold text-text">{progressStep || 'Working...'}</span>
            </div>
            {progressDetail && <p className="text-xs text-text-dim mb-2">{progressDetail}</p>}
            <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
              <div className="h-full rounded-full bg-accent-blue animate-pulse" style={{ width: getProgressPercent(progressStep) }} />
            </div>
            <p className="mt-1.5 text-[10px] text-text-dim/60">
              {getProgressNote(progressStep)}
            </p>
          </div>
        )}

        {/* Blocked / Error state — shown when generation was refused or failed */}
        {!computing && !tripPlan && (progressStep === 'Blocked' || progressStep === 'Error') && (
          <div className="mt-4 rounded-lg border border-accent-red/50 bg-accent-red/10 p-4">
            <div className="flex items-center gap-2">
              
              <span className="text-sm font-semibold text-accent-red">{progressStep === 'Blocked' ? 'Trip Generation Blocked' : 'Trip Generation Failed'}</span>
            </div>
            {progressDetail && (
              <p className="mt-2 text-sm text-text-dim whitespace-pre-line">{progressDetail}</p>
            )}
            <p className="mt-3 text-xs text-text-dim">
              Trips need game schedules. Load them right here, or check the <strong>Schedule</strong> tab to see what's already loaded.
            </p>
            <button
              onClick={handleLoadAllSchedules}
              disabled={anyScheduleLoading}
              className="mt-2 rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
            >
              {anyScheduleLoading ? 'Loading schedules...' : 'Load Schedules'}
            </button>
          </div>
        )}
      </div>

      {/* FACTS FIRST (Kent 2026-08-17): before any recommendation, show the
          raw opportunities around the chosen base for the chosen dates —
          games, times, venues, players, and drive times from the base. Trip
          generation stays the explicit second step (Generate Trips above /
          "+ Priority" on a row feeds it). */}
      {players.length > 0 && (
        <NearbyGamesFacts
          playerMap={playerMap}
          onPlayerClick={(name) => setSelectedPlayer(name)}
          onAddPriority={addPriorityPlayer}
        />
      )}

      {/* Convergence — with 3+ priority players, lead with the all-N answer:
          the tightest window where every one of them has a game (or the
          closest they come, flagged infeasible). NOT rendered once a
          generated trip below covers everyone — the trip card carries the
          swing + Option rows, and a summary of the card beneath it was
          noise (Tom 2026-07-24). */}
      {!computing && convergence && coveredByTripNumber == null && (
        <ConvergenceBanner
          windows={convergence.windows}
          playerNames={priorityPlayers}
          missingPlayers={convergence.missing}
          playerMap={playerMap}
          maxHopMinutes={maxDriveMinutes}
          maxSpanDays={CONVERGENCE_SPAN_DAYS}
          outOfWindow={convergence.outOfWindow}
          onUseDates={(w) => {
            // Carry the clicked route itself, not just its dates — the
            // regeneration must show the EXACT itinerary the user picked
            // (its legs may exceed the Drive cap, which the engine enforces
            // but the banner deliberately shows past).
            useTripStore.getState().setPlannedSwing(w)
            setDateRange(w.startDate, w.endDate)
            generateTrips()
          }}
          onPlayerClick={setSelectedPlayer}
        />
      )}

      {/* Double ups are no longer a separate drawer — trips ARE the options,
          with double-up dates badged on each card (Tom 2026-07-22). Only the
          pair verdicts remain here: "do my priority players line up?" */}
      {!computing && pairVerdicts.length > 0 && (
        <PairVerdictBanner verdicts={pairVerdicts} swingTripNumber={coveredByTripNumber} />
      )}

      {/* First-time welcome — dismissible */}
      {!tripPlan && !computing && <WelcomeHint />}

      {/* Empty state coaching — when no trips generated yet */}
      {!tripPlan && !computing && allSchedulesLoaded && (
        <div className="rounded-xl border border-border/50 bg-surface/50 px-5 py-6 text-center">
          <p className="text-sm text-text-dim">Set your date range above and hit <span className="font-medium text-accent-blue">Generate Trips</span> to see trip options.</p>
        </div>
      )}

      {/* Results */}
      {tripPlan && (
        <>

          {/* Player Coverage + coverage stats moved into the collapsible
              "Details" section below the results — Kent asked for results
              first, diagnostics second. */}


          {/* Zero road trips explanation */}
          {tripPlan.trips.length === 0 && (
            <div className="rounded-xl border border-border/50 bg-surface/50 px-5 py-6 text-center space-y-2">
              <p className="text-sm font-medium text-text">No trip options found for this date range.</p>
              <p className="text-xs text-text-dim">
                No games within {Math.floor(maxDriveMinutes / 60)}h of {tripPlan?.baseName || homeBaseName || 'your trip origin'} on these dates. Try extending your end date, widening the drive radius, or moving the trip origin.
              </p>
            </div>
          )}

          {/* Unified trip list — road trips and fly-ins sorted together.
              Grouping/numbering comes from the SHARED tripGrouping memo so
              "Trip #N" here always matches the banners above. */}
          {tripGrouping && tripPlan.trips.length > 0 && (() => {
            const { unified, groups: numbered } = tripGrouping
            const prioritySet = new Set(priorityPlayers)

            // Filter helper — works on the primary item of each group
            function passesFilters(item: UnifiedTripItem): boolean {
              // Transport type filter
              if (tripFilter === 'drive' && item.type !== 'road') return false
              if (tripFilter === 'fly' && item.type !== 'flyin') return false
              if (tripFilter === 'multi') {
                if (item.type === 'road') {
                  const playerSet = new Set([...item.trip.anchorGame.playerNames, ...item.trip.nearbyGames.flatMap(g => g.playerNames)])
                  if (playerSet.size < 2) return false
                } else {
                  if (item.visit.playerNames.length < 2) return false
                }
              }
              // Starred filter — only show Kent's favorites (road trips only;
              // fly-ins don't have stable keys today).
              if (tripFilter === 'starred') {
                if (item.type !== 'road') return false
                const key = getTripKey(item.trip)
                if (!useTripStore.getState().starredTrips[key]) return false
              }

              // Trip length filter (fly-ins add +1 for return travel day, matching the card display)
              if (tripLengthFilter !== 'all') {
                const targetDays = Number(tripLengthFilter)
                const actualDays = item.type === 'road'
                  ? item.trip.suggestedDays.length
                  : item.visit.dates.length + 1
                if (actualDays !== targetDays) return false
              }

              return true
            }

            const filtered = numbered.filter((group) => passesFilters(group.primary))

            // When priority players are set, priority-bearing trips lead the
            // list — but other clients reachable in these dates are still
            // WORTH SEEING, listed separately below (Tom 2026-08-12: "want
            // to also be shown... the priority should always be those first
            // players being most convenient, granted"). Previously the
            // non-priority trips were hidden outright.
            const relevantToFilters = prioritySet.size > 0
              ? filtered.filter((g) => itemHasPriorityPlayer(g.primary, prioritySet))
              : filtered
            // Road trips only: the header promises "in range", and the
            // engine guarantees that for drive trips. Fly-in visits (e.g.
            // Sterlin at Isotopes Park, 24h from an FNB Field anchor) are
            // the opposite of in-range and read as a bug here (Tom
            // 2026-08-17: "why is Sterlin Thompson (albuquerque) shown?").
            const otherClientGroups = prioritySet.size > 0
              ? filtered.filter((g) => !itemHasPriorityPlayer(g.primary, prioritySet) && g.primary.type === 'road')
              : []

            // Cap displayed trips (default 5) with a Show all expander —
            // fewer options surfaced by default. Kent's principle: quality
            // over quantity.
            const DEFAULT_TRIP_CAP = 5
            const capped = showAllTrips ? relevantToFilters : relevantToFilters.slice(0, DEFAULT_TRIP_CAP)
            const hasMore = relevantToFilters.length > capped.length

            return (
            <div id="section-road-trips">
              <div className="mb-3">
                {/* Honest count: say what's SHOWN, and why the rest isn't
                    (Tom 2026-07-22: "why does it say 7 trips and show 3?").
                    The full why lives in the "How these were picked"
                    explainer below (Tom 2026-08-11 — the old "N without
                    your priority players hidden" fragment read as noise). */}
                <h3 className="text-sm font-semibold text-text">
                  Suggested Trips
                  <span className="ml-2 text-xs font-normal text-text-dim">
                    {relevantToFilters.length} option{relevantToFilters.length !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={() => setShowPickLogic((v) => !v)}
                    className="ml-3 text-xs font-normal text-accent-blue/80 hover:text-accent-blue hover:underline"
                  >
                    {showPickLogic ? 'Hide' : 'How these were picked'}
                  </button>
                </h3>
                {showPickLogic && (
                  <div className="mt-2 rounded-xl bg-gray-900/40 px-3 py-2.5 text-xs leading-relaxed text-text-dim">
                    <ul className="list-disc space-y-1 pl-4">
                      {prioritySet.size > 0 ? (
                        <>
                          <li>
                            Trips with {priorityPlayers.length === 1 ? priorityPlayers[0] : 'your priority players'} come first.
                            {otherClientGroups.length > 0 && (
                              <> {otherClientGroups.length} more trip{otherClientGroups.length !== 1 ? 's' : ''} with other clients in range {otherClientGroups.length !== 1 ? 'are' : 'is'} listed under &ldquo;Other clients in range&rdquo; below.</>
                            )}
                          </li>
                          <li>
                            Trips are anchored where {priorityPlayers[0]}&rsquo;s games are — each one stays within a {Math.floor(maxDriveMinutes / 60)}h drive of its anchor game (the Map&rsquo;s Drive chip).
                          </li>
                        </>
                      ) : (
                        <li>
                          Trips stay within a {Math.floor(maxDriveMinutes / 60)}h drive of {tripPlan?.baseName || homeBaseName || 'your trip origin'} (Trip Origin above).
                        </li>
                      )}
                      <li>
                        When a player has several games in a week, the best one wins: Tuesdays score higher for pro position players, and so do outings that catch multiple clients or players overdue for a visit. At most 2 trips per ballpark per week.
                      </li>
                      <li>
                        Trips never overlap dates, and a player stops being suggested once the suggested trips cover the visits they still need this year — so you see their best few dates, not every game on their schedule.
                      </li>
                    </ul>
                  </div>
                )}
              </div>


              {/* Side-by-side comparison of starred favorites — renders only
                  when 2+ trips are starred. Lets Kent pick the best one
                  without scrolling back and forth between cards. */}
              <div className="mb-4">
                <CompareStarredTrips />
              </div>

              <div className="space-y-4">
                {capped.map((group) => {
                  const { primary } = group
                  const tripIndex = primary.type === 'road' && tripPlan
                    ? tripPlan.trips.indexOf(primary.trip)
                    : null
                  return (
                    <TripSummaryCard
                      key={`${primary.type}-${group.displayIndex}`}
                      item={primary}
                      tripIndex={tripIndex != null && tripIndex >= 0 ? tripIndex : null}
                      playerMap={playerMap}
                      swing={group.displayIndex === coveredByTripNumber ? convergence?.windows[0] ?? null : null}
                      onPlayerClick={setSelectedPlayer}
                    />
                  )
                })}
                {unified.length === 0 && (
                  <p className="py-4 text-center text-sm text-text-dim">No trips generated for the selected date range.</p>
                )}
                {unified.length > 0 && filtered.length === 0 && (
                  <p className="py-4 text-center text-sm text-text-dim">
                    No trips match these filters. Try switching Show back to "All" or Days to "Any".
                  </p>
                )}
                {prioritySet.size > 0 && filtered.length > 0 && relevantToFilters.length === 0 && (
                  <p className="py-4 text-center text-sm text-accent-orange">
                    None of the generated trips include your priority player{prioritySet.size !== 1 ? 's' : ''}.
                    {' '}Try widening the date range, raising the max drive, or removing a priority filter.
                  </p>
                )}
                {hasMore && (
                  <button
                    onClick={() => setShowAllTrips(true)}
                    className="w-full rounded-lg border border-border bg-surface/40 px-4 py-2 text-xs text-text-dim hover:text-text hover:border-accent-blue/40 transition-colors"
                  >
                    Show all {relevantToFilters.length} trips
                    <span className="text-text-dim/40"> · {relevantToFilters.length - capped.length} more</span>
                  </button>
                )}
                {showAllTrips && relevantToFilters.length > DEFAULT_TRIP_CAP && (
                  <button
                    onClick={() => setShowAllTrips(false)}
                    className="w-full rounded-lg border border-border/30 bg-transparent px-4 py-1.5 text-[11px] text-text-dim/60 hover:text-text-dim transition-colors"
                  >
                    Collapse to top {DEFAULT_TRIP_CAP}
                  </button>
                )}
              </div>

              {/* Other clients reachable in these dates — priority trips
                  lead, but these are still opportunities worth seeing
                  (Tom 2026-08-12). Collapsed to 3 by default. */}
              {otherClientGroups.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-semibold text-text">
                    Other clients in range
                    <span className="ml-2 text-xs font-normal text-text-dim">
                      {otherClientGroups.length} option{otherClientGroups.length !== 1 ? 's' : ''} without your priority players
                    </span>
                  </h3>
                  <div className="space-y-4">
                    {(showAllOtherTrips ? otherClientGroups : otherClientGroups.slice(0, 3)).map((group) => {
                      const { primary } = group
                      const tripIndex = primary.type === 'road' && tripPlan
                        ? tripPlan.trips.indexOf(primary.trip)
                        : null
                      return (
                        <TripSummaryCard
                          key={`other-${primary.type}-${group.displayIndex}`}
                          item={primary}
                          tripIndex={tripIndex != null && tripIndex >= 0 ? tripIndex : null}
                          playerMap={playerMap}
                          onPlayerClick={setSelectedPlayer}
                        />
                      )
                    })}
                    {otherClientGroups.length > 3 && !showAllOtherTrips && (
                      <button
                        onClick={() => setShowAllOtherTrips(true)}
                        className="w-full rounded-lg border border-border bg-surface/40 px-4 py-2 text-xs text-text-dim hover:text-text hover:border-accent-blue/40 transition-colors"
                      >
                        Show all {otherClientGroups.length} other-client trips
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            )
          })()}

          {/* Overlap warning — uses sorted trip order so numbers match cards above */}
          {tripPlan.trips.length > 1 && (() => {
            // Sort trips the same way as the card list so numbers are consistent
            const sorted = [...tripPlan.trips].sort((a, b) => {
              if (sortBy === 'score') return (b.scoreBreakdown?.finalScore ?? b.visitValue) - (a.scoreBreakdown?.finalScore ?? a.visitValue)
              if (sortBy === 'date') return a.anchorGame.date.localeCompare(b.anchorGame.date)
              return 0
            })
            const overlaps: Array<{ idxA: number; idxB: number; tripA: typeof sorted[0]; tripB: typeof sorted[0]; dates: string[]; uniqueA: string[]; uniqueB: string[]; shared: string[] }> = []
            // Two trips' games on the same date within double-up range are an
            // OPPORTUNITY (meal + game covers both), not a conflict — calling
            // them "you can only take one" contradicts the app's own double-up
            // doctrine (Tom 2026-07-24). Only genuinely-unreachable overlaps warn.
            const DOUBLE_UP_RANGE_MIN = 120
            const gamesOn = (t: typeof sorted[0], d: string) =>
              [t.anchorGame, ...t.nearbyGames].filter((g) => g.date === d)
            for (let a = 0; a < sorted.length; a++) {
              for (let b = a + 1; b < sorted.length; b++) {
                const daysA = new Set(sorted[a]!.suggestedDays)
                const sharedDates = sorted[b]!.suggestedDays.filter((d) => daysA.has(d)).filter((d) => {
                  const ga = gamesOn(sorted[a]!, d)
                  const gb = gamesOn(sorted[b]!, d)
                  if (ga.length === 0 || gb.length === 0) return true
                  const doubleUpPossible = ga.some((x) => gb.some((y) =>
                    estimateDriveMinutes(x.venue.coords, y.venue.coords) <= DOUBLE_UP_RANGE_MIN))
                  return !doubleUpPossible
                })
                if (sharedDates.length > 0) {
                  const playersA = new Set([...sorted[a]!.anchorGame.playerNames, ...sorted[a]!.nearbyGames.flatMap((g) => g.playerNames)])
                  const playersB = new Set([...sorted[b]!.anchorGame.playerNames, ...sorted[b]!.nearbyGames.flatMap((g) => g.playerNames)])
                  overlaps.push({
                    idxA: a + 1, idxB: b + 1,
                    tripA: sorted[a]!, tripB: sorted[b]!,
                    dates: sharedDates,
                    uniqueA: [...playersA].filter((n) => !playersB.has(n)),
                    uniqueB: [...playersB].filter((n) => !playersA.has(n)),
                    shared: [...playersA].filter((n) => playersB.has(n)),
                  })
                }
              }
            }
            if (overlaps.length === 0) return null
            return (
              <div className="rounded-xl border border-accent-orange/30 bg-accent-orange/5 p-4">
                <div className="flex cursor-pointer items-center justify-between" onClick={() => setShowOverlaps(!showOverlaps)}>
                  <h3 className="text-sm font-semibold text-accent-orange">
                    <span className={`mr-1.5 inline-block text-text-dim transition-transform ${showOverlaps ? 'rotate-90' : ''}`}>&#9654;</span>
                    {overlaps.length} date overlap{overlaps.length !== 1 ? 's' : ''} between trips
                  </h3>
                </div>
                {showOverlaps && (
                <>
                <p className="mt-2 mb-3 text-[11px] text-text-dim">These trips share dates — you can only take one per time slot.</p>
                <div className="space-y-4">
                  {overlaps.map((o, i) => (
                    <div key={i} className="rounded-lg border border-border/30 bg-gray-950/30 p-3">
                      <p className="mb-2 text-xs text-text-dim">
                        <span className="font-medium text-accent-orange">Trips #{o.idxA} and #{o.idxB}</span> overlap on{' '}
                        {o.dates.map((d) => {
                          return formatDate(d)
                        }).join(', ')}
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <p className="mb-1 font-medium text-accent-blue">Only in #{o.idxA}</p>
                          {o.uniqueA.length > 0 ? o.uniqueA.map((n) => {
                            const p = playerMap.get(n)
                            return <p key={n} className="text-text-dim cursor-pointer hover:text-accent-blue transition-colors" onClick={() => setSelectedPlayer(n)}>{n} {p ? `(${TIER_LABELS[p.tier] ?? ''})` : ''}</p>
                          }) : <p className="text-text-dim/50">None</p>}
                        </div>
                        <div>
                          <p className="mb-1 font-medium text-text-dim">Shared</p>
                          {o.shared.length > 0 ? o.shared.map((n) => {
                            const p = playerMap.get(n)
                            return <p key={n} className="text-text-dim cursor-pointer hover:text-accent-blue transition-colors" onClick={() => setSelectedPlayer(n)}>{n} {p ? `(${TIER_LABELS[p.tier] ?? ''})` : ''}</p>
                          }) : <p className="text-text-dim/50">None</p>}
                        </div>
                        <div>
                          <p className="mb-1 font-medium text-accent-green">Only in #{o.idxB}</p>
                          {o.uniqueB.length > 0 ? o.uniqueB.map((n) => {
                            const p = playerMap.get(n)
                            return <p key={n} className="text-text-dim cursor-pointer hover:text-accent-blue transition-colors" onClick={() => setSelectedPlayer(n)}>{n} {p ? `(${TIER_LABELS[p.tier] ?? ''})` : ''}</p>
                          }) : <p className="text-text-dim/50">None</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                </>
                )}
              </div>
            )
          })()}

          {/* Near-misses */}
          {tripPlan.nearMisses && tripPlan.nearMisses.length > 0 && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-5">
              <h3 className="mb-2 text-sm font-semibold text-yellow-400">
                Near Misses
                <span className="ml-2 text-xs font-normal text-text-dim">
                  Extend drive to also reach these players
                </span>
              </h3>
              <div className="space-y-1.5">
                {tripPlan.nearMisses.map((nm, i) => {
                  const player = playerMap.get(nm.playerName)
                  const tier = player?.tier ?? 4
                  const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                  return (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                      <span className="font-medium text-text cursor-pointer hover:text-yellow-400 transition-colors" onClick={() => setSelectedPlayer(nm.playerName)}>{nm.playerName}</span>
                      <span className="text-xs text-text-dim">{TIER_LABELS[tier] ?? ''}</span>
                      <span className="text-xs text-text-dim">@ {nm.venue}</span>
                      <span className="ml-auto text-xs text-yellow-400">
                        +{nm.overBy}m over limit ({formatDriveTime(nm.driveMinutes)} drive)
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Fly-in visits — all options */}
          {/* Fly-ins are now merged into the unified trip list above */}

          {/* The "Too far from this trip's area" fly-in box was removed
              2026-08-26: the "N more games beyond your drive" expander in
              the facts table already covers who is outside the radius. */}

        </>
      )}

      {/* Did you know? — rotating app tips (below results per Kent's flow) */}
      <DidYouKnow />

      {/* Player schedule drill-down panel */}
      {selectedPlayer && (
        <PlayerSchedulePanel
          playerName={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  )
}



/* ── Did You Know? ── rotating app tips ── */
// Keep these true to the CURRENT UI — stale tips referencing removed
// controls (drive slider, sort toolbar, stat cards) confused more than
// they helped (Tom 2026-07-23).
const APP_TIPS = [
  'Click any player name to see their full schedule and upcoming games.',
  'Use Priority Players to build trips around specific guys first.',
  'Green dates on a trip card mean 2+ clients that day — a double up at one park, or a drivable double up between parks.',
  'Drive times marked "est." are straight-line guesses; unmarked ones are road-routed. Trip legs upgrade to road routing as it loads.',
  'Set the star and drive radius on the Map to control where trips are built.',
  'Estimated pro assignments auto-correct once official rosters are published.',
]

function DidYouKnow() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * APP_TIPS.length))
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % APP_TIPS.length), 20_000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex items-center gap-2 rounded-lg bg-gray-950/40 px-4 py-2">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-accent-blue/60">Tip</span>
      <p className="text-[11px] text-text-dim/70">{APP_TIPS[index]}</p>
    </div>
  )
}

/* ── Welcome Hint ── collapsible "?" disclosure, mirrors Map's MapHelp ── */
function WelcomeHint() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('sv-trip-welcome-dismissed') !== '1' } catch { return true }
  })
  function toggle() {
    const next = !open
    setOpen(next)
    try {
      if (!next) localStorage.setItem('sv-trip-welcome-dismissed', '1')
      else localStorage.removeItem('sv-trip-welcome-dismissed')
    } catch {}
  }
  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-gray-900/30 transition-colors"
      >
        <span className="flex items-center gap-2 text-xs text-text-dim">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-bold text-accent-blue">?</span>
          <span className="font-medium text-text">How to use the Trip Planner</span>
          {!open && <span className="text-text-dim/60 text-[11px]">— click for the quick guide</span>}
        </span>
        <span className={`text-text-dim text-xs transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
      </button>
      {open && (
        <div className="border-t border-border/30 px-5 py-3 text-xs text-text-dim leading-relaxed">
          <ol className="space-y-1 list-decimal list-inside">
            <li>Pick your <span className="text-text">date range</span> and adjust the max drive if needed.</li>
            <li>Hit <span className="font-medium text-accent-blue">Generate Trips</span> to get Suggested Trips.</li>
            <li>Review the Suggested Trips — each card lists its games with dates, times, and drives.</li>
          </ol>
          <p className="mt-2 text-[10px] text-text-dim/50">Use Priority Players to build trips around specific guys first.</p>
        </div>
      )}
    </div>
  )
}
