import { useEffect, useRef, useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useVenueStore } from '../../store/venueStore'
import { useTripStore } from '../../store/tripStore'
import { addMapEventListener, dispatchMapEvent } from '../../lib/mapEvents'
import PlayerSchedulePanel from '../roster/PlayerSchedulePanel'
import DateRangeBar from './DateRangeBar'
import MapContainer from './MapContainer'
import { useVenuePlayerMap } from './hooks/useVenuePlayerMap'
import { useEventMarkers } from './hooks/useEventMarkers'
import { useDateFilteredVenues } from './hooks/useDateFilteredVenues'
import { useMapDateRange } from './hooks/useMapDateRange'
import { useTierMarkers } from './hooks/useTierMarkers'
import type { TierMarker } from './hooks/useTierMarkers'
import { useBestWindows } from './hooks/useBestWindows'
import type { BestWindowStrategy } from './hooks/useBestWindows'
import { useDestinationPicks } from './hooks/useDestinationPicks'
import SuggestionsPanel, { type SuggestTab } from './SuggestionsPanel'
import InViewSummary from './InViewSummary'
import MapFilters, { DEFAULT_MAP_FILTERS, applyMapFilters, HeartbeatLegend, type MapFilterState } from './MapFilters'
import SummerCoverageNotice from './SummerCoverageNotice'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { useSummerStore } from '../../store/summerStore'
import { findDoubleUps, isSameVenueDoubleUp } from '../../lib/doubleUps'
import { formatDate } from '../../lib/formatters'
import type { DoubleUp } from '../../types/schedule'
import type { RosterPlayer } from '../../types/roster'
import { useMemo } from 'react'

export default function MapView() {
  const [schedulePanelPlayer, setSchedulePanelPlayer] = useState<string | null>(null)

  const players = useRosterStore((s) => s.players)
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)
  const venues = useVenueStore((s) => s.venues)
  const loadNcaaVenues = useVenueStore((s) => s.loadNcaaVenues)
  const loadSpringTrainingVenues = useVenueStore((s) => s.loadSpringTrainingVenues)
  const addProVenue = useVenueStore((s) => s.addProVenue)
  const geocodeHsVenues = useVenueStore((s) => s.geocodeHsVenues)

  // Date range state
  const {
    filterStart,
    filterEnd,
    setFilterStart,
    setFilterEnd,
    setNext7Days,
    setNext30Days,
    setFilterRange,
  } = useMapDateRange()

  // Data hooks
  const venuePlayerMap = useVenuePlayerMap()
  const eventMarkers = useEventMarkers(filterStart, filterEnd)
  const dateFilteredVenues = useDateFilteredVenues(filterStart, filterEnd)
  const allTierMarkers = useTierMarkers(venuePlayerMap, dateFilteredVenues, filterStart, filterEnd)

  // Tier / level / search / overdue filter (Maptive Stage 1 polish)
  const [filterState, setFilterState] = useState<MapFilterState>(DEFAULT_MAP_FILTERS)
  // "In this view" chip toggles (Tom 2026-08-19), separate from Filters:
  // click a name = hide their events (faded, toggle back); double-click =
  // SOLO (only their events). Session-only state.
  const [hiddenPlayers, setHiddenPlayers] = useState<Set<string>>(new Set())
  const [soloPlayer, setSoloPlayer] = useState<string | null>(null)
  const heartbeatPlayers = useHeartbeatStore((s) => s.players)
  const daysByPlayerKey = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const p of heartbeatPlayers) {
      m.set(p.name.trim().toLowerCase(), p.daysSinceInPerson ?? null)
    }
    return m
  }, [heartbeatPlayers])
  // Best window recommender inputs (declared before the marker filter pass
  // because the "Double ups only" toggle needs the double-up list)
  const homeBase = useTripStore((s) => s.homeBase)
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const [windowDays, setWindowDays] = useState(3)
  const [bestWindowStrategy, setBestWindowStrategy] = useState<BestWindowStrategy>('impact')

  // Double ups for the map's date window — roster-wide (origin-agnostic).
  // Computed before Best Windows so the "Contains double ups" strategy and
  // per-window double-up chips can use them.
  const summerGames = useSummerStore((s) => s.summerGames)
  const doubleUps = useMemo(() => {
    if (players.length === 0) return []
    const all = [...proGames, ...ncaaGames, ...hsGames, ...summerGames]
    if (all.length === 0) return []
    // Pair cap follows the Drive-radius slider — widening the radius widens
    // what counts as a double/triple up (Tom 2026-08-12)
    return findDoubleUps(all, players, filterStart, filterEnd, undefined, undefined, maxDriveMinutes)
  }, [proGames, ncaaGames, hsGames, summerGames, players, filterStart, filterEnd, maxDriveMinutes])

  // Filters scope the suggestions too (Tom 2026-08-17: "we start out with
  // broad suggestions, we add filters, now the suggestions should change
  // just for those filters"): with players picked, the Double Ups tab and
  // its count only show combos involving at least one of them.
  const scopedDoubleUps = useMemo(() => {
    if (filterState.selectedPlayers.length === 0) return doubleUps
    const picked = new Set(filterState.selectedPlayers.map((n) => n.trim().toLowerCase()))
    return doubleUps.filter((du) => du.playerNames.some((n) => picked.has(n.trim().toLowerCase())))
  }, [doubleUps, filterState.selectedPlayers])

  // Chip toggles prune double ups too: solo keeps only combos featuring
  // them; hiding a player drops combos featuring them.
  const chipDoubleUps = useMemo(() => {
    if (!soloPlayer && hiddenPlayers.size === 0) return scopedDoubleUps
    return scopedDoubleUps.filter((du) =>
      soloPlayer ? du.playerNames.includes(soloPlayer) : !du.playerNames.some((n) => hiddenPlayers.has(n)))
  }, [scopedDoubleUps, soloPlayer, hiddenPlayers])

  // Two double-up families (Tom 2026-08-18): "double up" plain = SAME
  // VENUE, same game (head-to-head, tournament); "drivable" = a drive
  // between venues within the Drive-radius parameter, origin not needed.
  // The map toggles filter by family; only games in the ACTIVE families
  // survive (count badges, popups, and date ranges follow).
  const activeFamilyDus = useMemo(() => {
    return chipDoubleUps.filter((du) =>
      isSameVenueDoubleUp(du.type) ? filterState.doubleUpsOnly : filterState.drivableDoubleUpsOnly)
  }, [chipDoubleUps, filterState.doubleUpsOnly, filterState.drivableDoubleUpsOnly])
  const doubleUpCoords = useMemo(
    () => activeFamilyDus.flatMap((du) => du.games.map((g) => g.venue.coords)),
    [activeFamilyDus],
  )
  const doubleUpGameIds = useMemo(
    () => new Set(activeFamilyDus.flatMap((du) => du.games.map((g) => g.id))),
    [activeFamilyDus],
  )
  // Per-game double-up kind for popup rows (Tom 2026-08-18: "drivable"
  // could be misread as same-venue — name which one it is on every game).
  const duLabelByGameId = useMemo(() => {
    const m = new Map<string, string>()
    for (const du of scopedDoubleUps) {
      const sameVenue = isSameVenueDoubleUp(du.type)
      for (const g of du.games) {
        if (m.has(g.id)) continue
        if (sameVenue) {
          m.set(g.id, 'Same-venue double up: one seat covers multiple clients')
        } else {
          const partners = [...new Set(du.games.filter((o) => o.id !== g.id && o.venue.name !== g.venue.name).map((o) => o.venue.name))]
          m.set(g.id, partners.length > 0 ? `Drivable double up: pairs with ${partners.join(' / ')}` : 'Drivable double up')
        }
      }
    }
    return m
  }, [scopedDoubleUps])
  const tierMarkers = applyMapFilters(allTierMarkers, filterState, daysByPlayerKey, doubleUpCoords, doubleUpGameIds)
  // Chip toggles applied on top of the Filters output: hidden players'
  // events drop out (or everyone but the solo player), per-marker player
  // lists, games, counts, and dates all follow.
  const effectiveMarkers = useMemo(() => {
    if (!soloPlayer && hiddenPlayers.size === 0) return tierMarkers
    const keep = (name: string) => (soloPlayer ? name === soloPlayer : !hiddenPlayers.has(name))
    return tierMarkers
      .map((m) => {
        const players = m.players.filter((p) => keep(p.name))
        if (players.length === 0) return null
        const games = m.games.filter((g) => g.players.some(keep))
        if (m.games.length > 0 && games.length === 0) return null
        return {
          ...m,
          players,
          playerCount: players.length,
          bestTier: Math.min(...players.map((p) => p.tier)),
          games,
          gameDates: m.games.length > 0 ? [...new Set(games.map((g) => g.date))].sort() : m.gameDates,
        }
      })
      .filter((m): m is TierMarker => m !== null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tierMarkers, hiddenPlayers, soloPlayer])

  // ── Viewport scope (Tom + colleague 2026-08-18): the map view itself
  // informs the left rail. Pan or zoom and the in-view summary + all three
  // suggestion tabs re-scope to what you're looking at — no origin or
  // player filter needed. At US view this is simply everything.
  const [viewport, setViewport] = useState<{ south: number; west: number; north: number; east: number } | null>(null)
  const inViewport = (lat: number, lng: number) =>
    !viewport || (lat >= viewport.south && lat <= viewport.north && lng >= viewport.west && lng <= viewport.east)
  // Pre-hide list for the summary card (hidden players must stay listed,
  // faded, or they could never be unhidden)
  const summaryMarkers = useMemo(
    () => (viewport ? tierMarkers.filter((m) => inViewport(m.coords.lat, m.coords.lng)) : tierMarkers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tierMarkers, viewport],
  )
  const visibleMarkers = useMemo(
    () => (viewport ? effectiveMarkers.filter((m) => inViewport(m.coords.lat, m.coords.lng)) : effectiveMarkers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveMarkers, viewport],
  )
  const zoomedWide = !viewport || viewport.east - viewport.west > 45
  // Double ups fully inside the view (player scope wins when active —
  // "wherever they play" beats "where I'm looking")
  const viewDoubleUps = useMemo(
    () => chipDoubleUps.filter((du) => du.games.every((g) => inViewport(g.venue.coords.lat, g.venue.coords.lng))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chipDoubleUps, viewport],
  )

  // Filtering to specific players re-scopes the question: "when/where can I
  // see THEM", not "what's near my star". The drive radius is skipped so a
  // stale origin can't blank the answer (Tom 2026-08-12: two FL players
  // filtered, star still in NC, panel claimed "no games in this range").
  const playerScoped = filterState.selectedPlayers.length > 0
  // The VIEWPORT scopes suggestions (radius no longer does — the star keeps
  // distances and trip generation, the view says where you're interested).
  // Player filter still wins: those players wherever they play.
  const suggestionMarkers = playerScoped ? effectiveMarkers : visibleMarkers
  const suggestionDoubleUps = playerScoped ? chipDoubleUps : viewDoubleUps
  const bestWindows = useBestWindows(suggestionMarkers, homeBase, maxDriveMinutes, filterStart, filterEnd, windowDays, 5, bestWindowStrategy, suggestionDoubleUps, true)

  // Destination picks — the best areas within what you're looking at (the
  // whole US when zoomed out).
  const destinationPicks = useDestinationPicks(suggestionMarkers, 180, 5)
  const playerMap = useMemo(() => {
    const m = new Map<string, RosterPlayer>()
    for (const p of players) m.set(p.playerName, p)
    return m
  }, [players])
  const [suggestTab, setSuggestTab] = useState<SuggestTab>('when')
  // Selection is tracked by a stable KEY, not an index — the visible list
  // re-scopes on every pan/zoom, so an index would drift onto the wrong
  // pair (selecting a pair zooms the map, which itself re-scopes the list).
  const duKey = (du: DoubleUp) => `${du.date}|${du.playerNames.join('+')}|${du.games.map((g) => g.venue.name).join('>')}`
  const [selectedDuKey, setSelectedDuKey] = useState<string | null>(null)
  const selectedDoubleUp = useMemo(() => {
    if (!selectedDuKey) return null
    const i = suggestionDoubleUps.findIndex((du) => duKey(du) === selectedDuKey)
    return i >= 0 ? i : null
  }, [suggestionDoubleUps, selectedDuKey])
  const setSelectedDoubleUp = (i: number | null) =>
    setSelectedDuKey(i == null ? null : duKey(suggestionDoubleUps[i]!))
  // The DRAWN pair is locked to the selection key, independent of the
  // viewport-scoped list — panning away must never drop or re-zoom it
  // (Tom 2026-08-18). Cleared by the card toggle or the connector's ✕.
  const drawnDoubleUp = useMemo(
    () => (selectedDuKey ? chipDoubleUps.find((du) => duKey(du) === selectedDuKey) ?? null : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chipDoubleUps, selectedDuKey],
  )
  // Player filter changes re-scope the Double Ups list — clear selection.
  const selectedPlayersKey = filterState.selectedPlayers.join('|')
  useEffect(() => { setSelectedDuKey(null) }, [selectedPlayersKey])

  function handlePlanDoubleUp(du: DoubleUp) {
    useTripStore.getState().setPriorityPlayers(du.playerNames.slice(0, 5))
    const today = new Date().toISOString().split('T')[0]!
    const first = du.dates[0] ?? du.date
    const last = du.dates[du.dates.length - 1] ?? du.date
    const start = first > today ? first : today
    useTripStore.getState().setDateRange(start, last >= start ? last : start)
    // No setHomeBase here — the origin is user-owned (Tom 2026-08-18: only
    // the origin picker and star-drag move it). The engine anchors itself
    // at the first priority player's earliest game.
    dispatchMapEvent('app:switch-tab', { tab: 'trips' })
    window.scrollTo({ top: 0 })
    setTimeout(() => {
      useTripStore.getState().generateTrips().catch((e) => console.warn('[map] auto-generate after double-up failed:', e))
    }, 100)
  }

  // Are any schedules loaded?
  const hasSchedules = proGames.length > 0 || ncaaGames.length > 0 || hsGames.length > 0
  const anyScheduleLoading = useScheduleStore((s) => s.schedulesLoading || s.ncaaLoading || s.hsLoading || s.autoAssignLoading)
  const schedulesProgress = useScheduleStore((s) => s.schedulesProgress)
  const rosterError = useRosterStore((s) => s.error)
  const scheduleErrorHint = useScheduleStore((s) => s.autoAssignResult?.error ?? s.schedulesError ?? s.ncaaError ?? null)
  // Roster errors first — everything downstream depends on the roster, so a
  // schedule-side symptom must not mask the root cause.
  const loadErrorHint = rosterError ?? scheduleErrorHint

  // Load venues once
  const venuesLoaded = useRef(false)
  useEffect(() => {
    if (venuesLoaded.current) return
    venuesLoaded.current = true
    loadNcaaVenues()
    loadSpringTrainingVenues()
  }, [loadNcaaVenues, loadSpringTrainingVenues])

  // Geocode HS venues once when players are available
  const hsGeocodeStarted = useRef(false)
  useEffect(() => {
    if (hsGeocodeStarted.current) return
    const hsPlayers = players.filter((p) => p.level === 'HS')
    if (hsPlayers.length === 0) return
    const hasHsVenues = Object.keys(venues).some((k) => k.startsWith('hs-'))
    if (hasHsVenues) { hsGeocodeStarted.current = true; return }
    hsGeocodeStarted.current = true
    const schools = hsPlayers.map((p) => ({
      schoolName: p.org,
      city: '',
      state: p.state,
    }))
    geocodeHsVenues(schools)
  }, [players, venues, geocodeHsVenues])

  // Add pro venues from schedule data
  const lastProGamesLen = useRef(0)
  useEffect(() => {
    if (proGames.length === lastProGamesLen.current) return
    lastProGamesLen.current = proGames.length
    for (const game of proGames) {
      const key = `pro-${game.venue.name.toLowerCase().replace(/\s+/g, '-')}`
      addProVenue(key, game.venue.name, game.venue.coords)
    }
  }, [proGames, addProVenue])

  // Listen for map:open-schedule events
  useEffect(() => {
    return addMapEventListener('map:open-schedule', (detail) => {
      if (detail.player) setSchedulePanelPlayer(detail.player)
    })
  }, [])

  // Listen for global player search from the header. Filter to that player
  // (which will trigger the map zoom via fitToMarkersKey).
  useEffect(() => {
    return addMapEventListener('map:select-player', (detail) => {
      if (!detail.playerName) return
      setFilterState((s) =>
        s.selectedPlayers.includes(detail.playerName)
          ? s
          : { ...s, selectedPlayers: [...s.selectedPlayers, detail.playerName] })
    })
  }, [])

  // When a Trip Card sets selectedTripIndex (via the "Show on Map" button),
  // sync the map's visible date range to that trip's window so the trip's
  // venues actually fall inside the date filter and tier markers stay visible
  // around the highlighted polyline.
  const selectedTripIndex = useTripStore((s) => s.selectedTripIndex)
  const tripPlan = useTripStore((s) => s.tripPlan)
  useEffect(() => {
    if (selectedTripIndex == null || !tripPlan) return
    const trip = tripPlan.trips[selectedTripIndex]
    if (!trip || trip.suggestedDays.length === 0) return
    const days = [...trip.suggestedDays].sort()
    setFilterStart(days[0]!)
    setFilterEnd(days[days.length - 1]!)
  }, [selectedTripIndex, tripPlan, setFilterStart, setFilterEnd])

  // "Show on map" from ANY trip card (road or fly-in) — narrow the visible
  // date range to exactly that trip's game dates so the map isolates the
  // trip instead of showing seven weeks of markers (Tom 2026-08-12). The
  // focus lives in the store because this component isn't mounted when the
  // click happens on the Trip Planner tab.
  const mapFocus = useTripStore((s) => s.mapFocus)
  useEffect(() => {
    if (!mapFocus) return
    setFilterStart(mapFocus.startDate)
    setFilterEnd(mapFocus.endDate)
  }, [mapFocus, setFilterStart, setFilterEnd])

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Help + the wide control strips stay full-width across the top so the
          date/origin/filter rows don't get cramped. Everything below splits
          into a two-pane layout: a scrolling recommendations rail on the left
          and a sticky, always-visible map on the right. The map used to live
          ~1,250px down the page (below both recommenders); pinning it keeps
          the namesake feature in view while Kent reads the picks. */}
      {/* Schedule banner — honest about the auto-load in progress. The old
          "Load schedules from the Trip Planner tab" text made a working
          background fetch look like a required manual step (Tom 2026-07-22).
          Also shown while PRO games specifically haven't landed: bundled
          NCAA/HS data makes hasSchedules true instantly, and a map missing
          the bulk of its games with no banner reads as broken
          (Tom 2026-07-24). */}
      {(!hasSchedules || (proGames.length === 0 && anyScheduleLoading)) && (
        <div className="rounded-xl bg-surface border border-border/50 px-4 py-3 text-sm text-text-dim">
          {anyScheduleLoading ? (
            <span className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-accent-blue border-t-transparent" />
              Loading game data{schedulesProgress ? ` — Pro schedules ${schedulesProgress.completed}/${schedulesProgress.total} teams` : ''}... the first load takes a minute or two.
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-3">
              <span>Game data hasn't loaded yet.</span>
              {loadErrorHint && <span className="text-xs text-accent-red">Last attempt failed: {loadErrorHint}</span>}
              <button
                onClick={() => {
                  void (async () => {
                    // Refresh the roster FIRST — a stale/garbled cached roster
                    // makes every downstream step fail quietly ("No recognized
                    // NCAA schools", zero assignments). Tom's personal Chrome,
                    // 2026-07-22.
                    await useRosterStore.getState().fetchRoster()
                    const sched = useScheduleStore.getState()
                    await sched.autoAssignPlayers()
                    if (Object.keys(useScheduleStore.getState().playerTeamAssignments).length > 0) {
                      const y = new Date().getFullYear()
                      sched.fetchProSchedules(`${y}-03-01`, `${y}-09-30`)
                    }
                    const roster = useRosterStore.getState().players // fresh — fetched above
                    const ncaaOrgs = roster.filter((p) => p.level === 'NCAA').map((p) => ({ playerName: p.playerName, org: p.org }))
                    if (ncaaOrgs.length > 0) sched.fetchNcaaSchedules(ncaaOrgs)
                    const hsOrgs = roster.filter((p) => p.level === 'HS' && p.state).map((p) => ({ playerName: p.playerName, org: p.org, state: p.state! }))
                    if (hsOrgs.length > 0) sched.fetchHsSchedules(hsOrgs)
                  })()
                }}
                className="rounded-lg bg-accent-blue/15 px-3 py-1 text-xs font-medium text-accent-blue hover:bg-accent-blue/25 transition-colors"
              >
                Load now
              </button>
            </span>
          )}
        </div>
      )}

      {/* THE toolbar — one Filters popover holding EVERY control (dates,
          origin, radius, players, tiers...) plus a passive readout of what's
          applied (Tom 2026-08-18: nest every filter under Filters; the first
          move is the filters, Maptive-style). */}
      <DateRangeBar filterStart={filterStart} filterEnd={filterEnd}>
        <MapFilters
          state={filterState}
          setState={setFilterState}
          markerCount={effectiveMarkers.length}
          totalCount={allTierMarkers.length}
          daysByPlayerKey={daysByPlayerKey}
          venueNames={[...new Set(allTierMarkers.map((m) => m.venueName))].sort()}
          dateProps={{
            filterStart,
            filterEnd,
            setFilterStart,
            setFilterEnd,
            setRange: setFilterRange,
            onNext7Days: setNext7Days,
            onNext30Days: setNext30Days,
          }}
        />
        <MapHelp />
      </DateRangeBar>

      {/* Player-schedule chips — always visible while the map is narrowed
          to specific players, so a filtered map is never a mystery with the
          Filters popover closed. Each ✕ removes just that player
          (Tom 2026-08-11). */}
      {filterState.selectedPlayers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-1 text-[11px]">
          <span className="text-text-dim/60">
            Showing schedule{filterState.selectedPlayers.length !== 1 ? 's' : ''} for
          </span>
          {filterState.selectedPlayers.map((name) => (
            <span key={name} className="flex items-center gap-1 rounded-lg bg-accent-blue/15 px-2 py-0.5 font-medium text-accent-blue">
              {name}
              <button
                onClick={() => setFilterState((s) => ({ ...s, selectedPlayers: s.selectedPlayers.filter((n) => n !== name) }))}
                className="text-accent-blue/60 hover:text-accent-blue"
                title={`Remove ${name} — show the full map again`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Heartbeat color key — the only time a legend needs to be visible
          outside the Filters popover is when the dots aren't tier-colored. */}
      {filterState.colorBy === 'heartbeat' && (
        <div className="px-1">
          <HeartbeatLegend />
        </div>
      )}

      {/* Two-pane: recommendations rail (left) · sticky map (right).
          On small screens the MAP renders first (order classes) — it's the
          tab's namesake and used to sit below the fold under both
          recommender panels. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        {/* ── Left rail: recommendations (scrolls with the page) ── */}
        <div className="order-2 lg:order-none flex flex-col gap-3 lg:w-[460px] lg:shrink-0">
          {/* Summer coverage gap — only renders if any SV player is in a
              non-live summer league (e.g. PGCBL, NECBL, Northwoods). */}
          {/* Summer coverage notice hidden 2026-08-25: summer leagues are over and
              the chip read as noise (Tom). Component kept for next summer. */}
          {false && <SummerCoverageNotice />}

          {/* Trip preview banner — shown when a trip card put itself on the
              map ("Show on map"). Covers fly-ins too via mapFocus, and says
              the dates so the narrowed date range isn't a mystery. */}
          {(mapFocus || (selectedTripIndex != null && tripPlan && tripPlan.trips[selectedTripIndex])) && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs">
              <span className="min-w-0 truncate text-yellow-200">
                Previewing{' '}
                <strong>
                  {mapFocus?.label ??
                    (selectedTripIndex != null ? `Trip #${selectedTripIndex + 1}` : '')}
                </strong>
                {mapFocus && (
                  <span className="text-yellow-200/70">
                    {' '}· {mapFocus.startDate === mapFocus.endDate
                      ? formatDate(mapFocus.startDate)
                      : `${formatDate(mapFocus.startDate)} – ${formatDate(mapFocus.endDate)}`} · map dates narrowed to this
                  </span>
                )}
              </span>
              <button
                onClick={() => {
                  useTripStore.getState().setSelectedTripIndex(null)
                  useTripStore.getState().setMapFocus(null)
                }}
                className="shrink-0 text-yellow-200/80 hover:text-yellow-200 underline-offset-2 hover:underline"
              >
                clear preview
              </button>
            </div>
          )}

          {/* In this view — live inventory of the current viewport (Tom +
              colleague 2026-08-18): names the players you're looking at as
              you pan/zoom. Always visible, never behind a tab. */}
          {(allTierMarkers.length > 0 || anyScheduleLoading) && (
            <InViewSummary
              markers={summaryMarkers}
              filterStart={filterStart}
              filterEnd={filterEnd}
              hiddenPlayers={hiddenPlayers}
              soloPlayer={soloPlayer}
              onToggleHide={(n) => {
                if (soloPlayer) {
                  // Clicking the solo name exits solo; clicking another
                  // name exits solo AND hides them.
                  setSoloPlayer(null)
                  if (soloPlayer !== n) setHiddenPlayers((prev) => new Set(prev).add(n))
                  return
                }
                setHiddenPlayers((prev) => {
                  const next = new Set(prev)
                  if (next.has(n)) next.delete(n)
                  else next.add(n)
                  return next
                })
              }}
              onSolo={(n) => setSoloPlayer((cur) => (cur === n ? null : n))}
              onOpenSchedule={(n) => {
                // Locate before detail (Tom 2026-08-18): pulse the player's
                // visible venues, THEN open their schedule. 0.5s — quick
                // flash, fast card (Tom 2026-08-19).
                const visible = visibleMarkers.some((m) => m.players.some((p) => p.name === n))
                if (visible) {
                  dispatchMapEvent('map:pulse-player', { playerName: n })
                  setTimeout(() => setSchedulePanelPlayer(n), 500)
                } else {
                  setSchedulePanelPlayer(n)
                }
              }}
              onResetChips={() => { setHiddenPlayers(new Set()); setSoloPlayer(null) }}
              zoomedWide={zoomedWide}
            />
          )}

          {/* Suggestions — one tabbed panel replacing the old stacked Best
              Windows + Where to go? pair (Tom 2026-07-21: consolidate). Tabs:
              When (dates from the star) · Where (cities, radius-agnostic) ·
              Double Ups (2+ clients, one outing — also draws map connectors).
              Rendered during the initial fetch too, showing a loading row —
              an absent/empty panel read as broken (Tom 2026-07-22). */}
          {(allTierMarkers.length > 0 || anyScheduleLoading) && (
            <SuggestionsPanel
              loading={anyScheduleLoading && allTierMarkers.length === 0}
              stillLoading={anyScheduleLoading}
              progressLabel={schedulesProgress ? `Pro schedules ${schedulesProgress.completed}/${schedulesProgress.total} teams` : null}
              windows={bestWindows}
              windowDays={windowDays}
              setWindowDays={setWindowDays}
              strategy={bestWindowStrategy}
              setStrategy={setBestWindowStrategy}
              onPlanWindow={(w) => {
                setFilterStart(w.startDate)
                setFilterEnd(w.endDate)
                // Plan THIS window: the planner has its own dates and priority
                // players, and stale ones hijack the results (Tom 2026-07-23 —
                // clicked an Aug 10–12 card, got old priorities + old dates).
                const trip = useTripStore.getState()
                trip.setDateRange(w.startDate, w.endDate)
                trip.setPriorityPlayers(w.players.slice(0, 5).map((p) => p.name))
                dispatchMapEvent('app:switch-tab', { tab: 'trips' })
                window.scrollTo({ top: 0 })
                setTimeout(() => {
                  useTripStore.getState().generateTrips().catch((e) => console.warn('[map] auto-generate after Plan trips failed:', e))
                }, 100)
              }}
              picks={destinationPicks}
              doubleUps={suggestionDoubleUps}
              playerMap={playerMap}
              scopedPlayers={filterState.selectedPlayers}
              originName={homeBaseName}
              driveHours={Math.round(maxDriveMinutes / 60)}
              viewportScoped={!playerScoped && !zoomedWide}
              activeTab={suggestTab}
              setActiveTab={(t) => {
                setSuggestTab(t)
                // Returning to "When to go" = back to the starred area
                // (only meaningful once an origin/star exists)
                if (t === 'when' && homeBase) dispatchMapEvent('map:fit-points', { points: [homeBase] })
              }}
              selectedDoubleUp={selectedDoubleUp}
              setSelectedDoubleUp={setSelectedDoubleUp}
              onPlanDoubleUp={handlePlanDoubleUp}
            />
          )}
        </div>

        {/* ── Right on desktop / FIRST on mobile: sticky map. Fills the
            viewport height and pins in place on desktop so it stays visible
            while the left rail scrolls. ── */}
        <div className="order-1 lg:order-none min-w-0 flex-1">
          {/* `isolate` traps Leaflet's internal z-indexes (panes 400+,
              controls 1000) inside this box — without it they paint over
              the toolbar's Filters/calendar popovers (z-40/z-50), which on
              mobile sit directly above the map (Tom 2026-08-19). */}
          <div className="isolate h-[calc(100vh-180px)] min-h-[500px] lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
            {/* Map — when a specific player is selected, fitToMarkersKey changes,
                telling MapContainer to zoom to wherever that player's venues are.
                ("Find Jake Munroe for me.") */}
            <MapContainer
              tierMarkers={effectiveMarkers}
              colorBy={filterState.colorBy}
              showAirports={filterState.showAirports}
              duLabelByGameId={duLabelByGameId}
              eventMarkers={eventMarkers}
              fitToMarkersKey={filterState.selectedPlayers.join('|') || undefined}
              onViewportChange={setViewport}
              doubleUps={
                // Only the SELECTED pair draws on the map — all 30 at once
                // was a spaghetti of triangles (Tom 2026-07-22)
                suggestTab === 'doubleups' && drawnDoubleUp ? [drawnDoubleUp] : []
              }
              selectedDoubleUp={drawnDoubleUp ? 0 : null}
              doubleUpFocusKey={suggestTab === 'doubleups' ? selectedDuKey : null}
              onClearDoubleUp={() => setSelectedDuKey(null)}
            />
          </div>
        </div>
      </div>

      {/* Schedule panel (side drawer) */}
      {schedulePanelPlayer && (
        <PlayerSchedulePanel
          playerName={schedulePanelPlayer}
          onClose={() => setSchedulePanelPlayer(null)}
        />
      )}
    </div>
  )
}

/** Quick-guide popover — a "?" button in the toolbar (2026-07-21 apple-fy:
 *  replaced the old full-width help bar that greeted every page load). */
function MapHelp() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-[11px] font-bold text-text-dim hover:text-accent-blue hover:border-accent-blue/50 transition-colors"
        title="How to use this map"
      >
        ?
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[320px] rounded-xl border border-border bg-surface px-4 py-3 text-xs text-text-dim leading-relaxed shadow-xl">
          <p className="mb-1.5 font-semibold text-text">How to use this map</p>
          <ol className="space-y-1 list-decimal list-inside">
            <li><strong className="text-text">Open Filters</strong>: dates, trip origin, players, tiers, and more all live there.</li>
            <li>Each dot = a venue with at least one of your players. Click for who, when, and recency. Zoom in to split the numbered clusters.</li>
            <li>Set a <strong className="text-text">Trip origin</strong> to get the star, drive radius, and distances. Drag the star to move it.</li>
            <li><strong className="text-text">Click and hold a dot, then drag</strong> to another venue (or anywhere) to measure miles and est. drive. With Airports on, dragging airport to airport shows est. flight time.</li>
            <li>Open <em>Suggestions</em> for when to go, where to go, and double ups (same venue) plus drivable double ups.</li>
          </ol>
          <p className="mt-2 text-[11px] text-text-dim/60">
            In Filters, switch <strong className="text-text">Color by</strong> to <em>Heartbeat</em> to see overdue players (magenta).
          </p>
        </div>
      )}
    </div>
  )
}
