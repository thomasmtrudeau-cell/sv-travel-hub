// Compact, Maptive-style filter strip for the Player Map.
//
// Filters apply on top of the existing date-range / drive-radius filtering.
// The filter state is owned by MapView and the visible tierMarkers are
// re-derived via useFilteredMarkers below.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { useTripStore } from '../../store/tripStore'
import type { TierMarker } from './hooks/useTierMarkers'
import { TIER_COLORS } from './hooks/useTierMarkers'
import PlayerCheckList from '../ui/PlayerCheckList'
import CityPicker from '../ui/CityPicker'
import DateRangeCalendar from '../ui/DateRangeCalendar'
import { STARTING_LOCATIONS } from '../../data/cityPresets'
import { dispatchMapEvent } from '../../lib/mapEvents'
import { formatDate } from '../../lib/formatters'

export type MapLevelFilter = 'Pro' | 'NCAA' | 'HS'
/** How to color venue dots — by player tier (default), or by Heartbeat
 *  overdue-ness (Kent's interview ask 2026-06-08: "different color of like guys
 *  that we need to see"). */
export type MapColorMode = 'tier' | 'heartbeat'

export interface MapFilterState {
  tiers: Set<number>
  levels: Set<MapLevelFilter>
  /** Free-text venue search (still useful for finding a specific stadium). */
  search: string
  /** Affirmatively picked players — narrows the map to only these players'
   *  venues. Kent's 2026-06-08 feedback: "should feel like I am SELECTING
   *  him instead of raw text." Multiple accumulate, each removable via its
   *  chip's ✕ (Tom 2026-08-11: "add another player, keep both"). */
  selectedPlayers: string[]
  colorBy: MapColorMode
  /** When true, only show venues with at least one overdue (>90d) or
   *  never-visited player. Kent interview ask: "guys we need to see." */
  overdueOnly: boolean
  /** When true, only show venues with a SAME-VENUE double up in the dates:
   *  one park, one seat, 2+ clients (head-to-heads + tournaments). Plain
   *  "double up" means exactly this everywhere in the app (Tom 2026-08-18). */
  doubleUpsOnly: boolean
  /** When true, only show venues in a DRIVABLE double up: 2+ clients
   *  seeable in one outing by driving between venues, paired by the Drive
   *  radius parameter — no trip origin needed (Tom 2026-08-18). */
  drivableDoubleUpsOnly: boolean
  /** Overlay of major-airport badges on the map (Tom 2026-08-18: toggleable
   *  airport markers, like the US view button). Overlay, not a filter — it
   *  never hides venues and doesn't count toward the Filters badge. */
  showAirports: boolean
}

export const DEFAULT_MAP_FILTERS: MapFilterState = {
  tiers: new Set([1, 2, 3, 4]),
  levels: new Set<MapLevelFilter>(['Pro', 'NCAA', 'HS']),
  search: '',
  selectedPlayers: [],
  colorBy: 'tier',
  overdueOnly: false,
  doubleUpsOnly: false,
  drivableDoubleUpsOnly: false,
  showAirports: false,
}

/** Heartbeat color thresholds (days since in-person visit).
 *  These intentionally use a DIFFERENT hue family from Tier coloring
 *  (which is red/orange/gray for T1/T2/T3) so the map can be read without
 *  confusion when both schemes are visible nearby. Magenta/amber/teal/gray
 *  reads as "freshness" and tier red/orange reads as "priority". */
export const HEARTBEAT_COLORS = {
  overdue: '#ec4899',   // >90 days  (pink/magenta — distinct from tier red)
  stale:   '#eab308',   // 45-90      (amber — distinct from tier orange)
  fresh:   '#06b6d4',   // <45        (cyan/teal — distinct from any tier color)
  unknown: '#6b7280',   // no data    (gray — same gray works for both)
} as const

export function heartbeatColorFor(days: number | null | undefined): string {
  if (days == null) return HEARTBEAT_COLORS.unknown
  if (days > 90) return HEARTBEAT_COLORS.overdue
  if (days > 45) return HEARTBEAT_COLORS.stale
  return HEARTBEAT_COLORS.fresh
}

interface MapFiltersProps {
  state: MapFilterState
  setState: (s: MapFilterState) => void
  markerCount: number
  totalCount: number
  /** Pre-built lookup so the Overdue toggle and applyMapFilters share a single
   *  source of truth for days-since-visit. Built by MapView from heartbeatStore. */
  daysByPlayerKey?: Map<string, number | null>
  /** All loaded venue names — powers the venue search typeahead. */
  venueNames?: string[]
  /** Date-range state, owned by MapView. Every filter — dates, origin,
   *  players, tiers — lives under this ONE popover (Tom 2026-08-18, from
   *  the Maptive flow: "the first move for the user is to go to the
   *  filters"). */
  dateProps: {
    filterStart: string
    filterEnd: string
    setFilterStart: (v: string) => void
    setFilterEnd: (v: string) => void
    /** Atomic set of both ends — used by the calendar picker. */
    setRange: (start: string, end: string) => void
    onNext7Days: () => void
    onNext30Days: () => void
  }
}

const TIER_LABEL: Record<number, string> = { 1: 'Must-see (T1)', 2: 'High (T2)', 3: 'Standard (T3)', 4: 'Dev (T4)' }

/** How many filter categories deviate from defaults — shown as the badge
 *  on the Filters button so hidden constraints are never invisible. */
export function countActiveFilters(s: MapFilterState): number {
  let n = 0
  if (s.tiers.size < 4) n++
  if (s.levels.size < 3) n++
  if (s.overdueOnly) n++
  if (s.doubleUpsOnly) n++
  if (s.drivableDoubleUpsOnly) n++
  if (s.search.trim() !== '') n++
  if (s.selectedPlayers.length > 0) n++
  return n
}

/** Heartbeat color key — rendered under the toolbar only while Color by is
 *  Heartbeat, so exactly one color key is on screen at a time. */
export function HeartbeatLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-dim">
      <span className="uppercase tracking-wide text-text-dim/60">Map dots</span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: HEARTBEAT_COLORS.overdue }} />
        Overdue (&gt;90d)
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: HEARTBEAT_COLORS.stale }} />
        Stale (45–90d)
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: HEARTBEAT_COLORS.fresh }} />
        Fresh (&lt;45d)
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: HEARTBEAT_COLORS.unknown }} />
        No visit on record
      </span>
    </div>
  )
}

/**
 * Filters popover — one button in the toolbar, everything inside (2026-07-21
 * "apple-fy" pass: the standalone filter strip was a second full-width bar
 * of chrome). The badge shows how many filter categories are active so a
 * narrowed map is never a mystery.
 */
export default function MapFilters({ state, setState, markerCount, totalCount, daysByPlayerKey, venueNames = [], dateProps }: MapFiltersProps) {
  void daysByPlayerKey // accepted so caller can pass; consumed by applyMapFilters below
  const players = useRosterStore((s) => s.players)
  const filtered = markerCount < totalCount
  const [open, setOpen] = useState(false)
  const [venueFocus, setVenueFocus] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const activeCount = countActiveFilters(state)

  // Trip origin + drive radius — shared store, so the Trip Planner stays in
  // sync. The radius control only exists once an origin is set (the radius
  // is measured FROM the origin — without one it has no meaning).
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const setHomeBase = useTripStore((s) => s.setHomeBase)
  const clearHomeBase = useTripStore((s) => s.clearHomeBase)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const setMaxDriveMinutes = useTripStore((s) => s.setMaxDriveMinutes)
  const radiusEnabled = useTripStore((s) => s.radiusEnabled)
  const setRadiusEnabled = useTripStore((s) => s.setRadiusEnabled)

  // Venue typeahead — Kent types "Dayt" hoping for Daytona; the venue is
  // named "Jackie Robinson Ballpark", so raw substring match found nothing.
  // Suggest matching venue names as he types; picking one fills the filter.
  const venueQuery = state.search.trim().toLowerCase()
  const venueMatches = venueFocus && venueQuery.length >= 2
    ? venueNames.filter((v) => v.toLowerCase().includes(venueQuery)).slice(0, 8)
    : []

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  // Count players per level so users see what each toggle would hide
  const levelCounts = useMemo(() => {
    const c: Record<MapLevelFilter, number> = { Pro: 0, NCAA: 0, HS: 0 }
    for (const p of players) c[p.level]++
    return c
  }, [players])

  function toggleTier(t: number) {
    const next = new Set(state.tiers)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    if (next.size === 0) next.add(t) // never empty — re-add
    setState({ ...state, tiers: next })
  }
  function toggleLevel(l: MapLevelFilter) {
    const next = new Set(state.levels)
    if (next.has(l)) next.delete(l)
    else next.add(l)
    if (next.size === 0) next.add(l)
    setState({ ...state, levels: next })
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
          activeCount > 0
            ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue'
            : 'border-border bg-gray-950/50 text-text-dim hover:text-text'
        }`}
        title="Tier, level, player, and venue filters — plus map color mode"
      >
        Filters
        {activeCount > 0 && (
          <span className="rounded-full bg-accent-blue/25 px-1.5 text-[10px] font-bold text-accent-blue">{activeCount}</span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[400px] max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border border-border bg-surface p-3.5 shadow-xl">
          {/* The big three first — dates, origin, player (Tom 2026-08-18) */}

          {/* Date range — a calendar picker, so days of the week are
              visible while choosing (Tom 2026-08-18). */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Dates</span>
            <DateRangeCalendar
              start={dateProps.filterStart}
              end={dateProps.filterEnd}
              onChange={dateProps.setRange}
            />
            <button
              onClick={dateProps.onNext7Days}
              className="rounded bg-gray-950/50 border border-border px-2 py-1 text-[11px] text-text-dim hover:text-text transition-colors"
            >
              Next 7 days
            </button>
            <button
              onClick={dateProps.onNext30Days}
              className="rounded bg-gray-950/50 border border-border px-2 py-1 text-[11px] text-text-dim hover:text-text transition-colors"
            >
              Next 30 days
            </button>
          </div>

          {/* Trip origin — unset by default; picking one drops the star,
              flies the map there, and enables the drive radius. */}
          <div className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Origin</span>
            <CityPicker
              value={homeBaseName}
              onChange={(coords, cityLabel) => {
                setHomeBase(coords, cityLabel)
                dispatchMapEvent('map:fly-to', { lat: coords.lat, lng: coords.lng })
              }}
              onClear={clearHomeBase}
              presets={[...STARTING_LOCATIONS]}
              placeholder="No origin set"
              buttonClass="min-w-[160px]"
              title="Where you'll be. Sets the star + drive radius, and every distance reads from here. Drag the star on the map to move it."
            />
          </div>
          {/* Always visible: the radius is BOTH the circle around the
              origin (when set) AND the pairing distance for drivable
              double ups, which need no origin (Tom 2026-08-18). */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Radius</span>
            <input
              type="range"
              min={120}
              max={480}
              step={30}
              value={maxDriveMinutes}
              onChange={(e) => setMaxDriveMinutes(parseInt(e.target.value))}
              className={`h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-gray-700 accent-accent-blue ${radiusEnabled ? '' : 'opacity-40'}`}
              title="Max drive: pairs drivable double ups anywhere on the map, and draws the dashed circle around your origin when one is set"
            />
            <span className={`w-12 shrink-0 text-right text-[11px] ${radiusEnabled ? 'text-text' : 'text-text-dim/50 line-through'}`}>
              {maxDriveMinutes % 60 > 0 ? `${Math.floor(maxDriveMinutes / 60)}h ${maxDriveMinutes % 60}m` : `${Math.floor(maxDriveMinutes / 60)}h`}
            </span>
            {/* Kent 2026-08-25: a way to switch the radius off and just see
                where everyone is that week. Hides the circle and lifts the
                planner's in-range gate; double-up pairing keeps the slider value. */}
            <button
              onClick={() => setRadiusEnabled(!radiusEnabled)}
              className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                radiusEnabled ? 'text-text-dim/60 hover:text-text hover:bg-gray-800/50' : 'bg-accent-blue/15 text-accent-blue'
              }`}
              title={radiusEnabled ? 'Turn the radius off: no circle, and the Trip Planner lists every game on these dates' : 'Turn the radius back on'}
            >
              {radiusEnabled ? 'Off' : 'Radius off'}
            </button>
          </div>

          {/* Player checklist (Kent 2026-08-25): the old typeahead closed
              after each pick, so filtering to several players meant many
              round trips. Now a persistent searchable checklist with All /
              None per level. Empty selection = everyone shown. */}
          <div className="flex items-start gap-1.5">
            <span className="w-16 shrink-0 pt-1 text-[10px] uppercase tracking-wide text-text-dim/60">Player</span>
            <PlayerCheckList
              players={players}
              selected={state.selectedPlayers}
              onChange={(selectedPlayers) => setState({ ...state, selectedPlayers })}
            />
          </div>

          {/* Quick toggles */}
          <div className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Show</span>
            <button
              onClick={() => setState({ ...state, overdueOnly: !state.overdueOnly })}
              className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                state.overdueOnly ? 'bg-accent-red/15 text-accent-red' : 'text-text-dim/60 hover:text-text hover:bg-gray-800/50'
              }`}
              title="Show only venues with at least one player overdue (>90d) or never visited"
            >
              Overdue only
            </button>
            <button
              onClick={() => setState({ ...state, doubleUpsOnly: !state.doubleUpsOnly })}
              className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                state.doubleUpsOnly ? 'bg-accent-green/15 text-accent-green' : 'text-text-dim/60 hover:text-text hover:bg-gray-800/50'
              }`}
              title="Same-venue double ups: one park, one seat, 2+ clients (head-to-heads and tournaments) within your dates"
            >
              Double ups (same venue)
            </button>
            <button
              onClick={() => setState({ ...state, drivableDoubleUpsOnly: !state.drivableDoubleUpsOnly })}
              className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                state.drivableDoubleUpsOnly ? 'bg-accent-green/15 text-accent-green' : 'text-text-dim/60 hover:text-text hover:bg-gray-800/50'
              }`}
              title="Drivable double ups: 2+ clients seeable in one outing by driving between venues. Pairing distance = the Drive radius below; works anywhere on the map, no trip origin needed"
            >
              Drivable double ups
            </button>
            <button
              onClick={() => setState({ ...state, showAirports: !state.showAirports })}
              className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                state.showAirports ? 'bg-sky-500/15 text-sky-400' : 'text-text-dim/60 hover:text-text hover:bg-gray-800/50'
              }`}
              title="Overlay major-airport badges on the map (never hides venues)"
            >
              Airports
            </button>
          </div>

          {/* Tier pills — dots double as the legend in Tier color mode */}
          <div className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Tier</span>
            {[1, 2, 3, 4].map((t) => {
              const active = state.tiers.has(t)
              return (
                <button
                  key={t}
                  onClick={() => toggleTier(t)}
                  className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    active ? 'bg-gray-800/60 text-text' : 'text-text-dim/40 line-through hover:text-text-dim'
                  }`}
                  title={TIER_LABEL[t]}
                >
                  {state.colorBy === 'tier' && (
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: TIER_COLORS[t] ?? TIER_COLORS[4]! }} />
                  )}
                  T{t}
                </button>
              )
            })}
          </div>

          {/* Level filters */}
          <div className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Level</span>
            {(['Pro', 'NCAA', 'HS'] as MapLevelFilter[]).map((l) => {
              const active = state.levels.has(l)
              return (
                <button
                  key={l}
                  onClick={() => toggleLevel(l)}
                  className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    active ? 'bg-gray-800/60 text-text' : 'text-text-dim/40 line-through hover:text-text-dim'
                  }`}
                  title={`${levelCounts[l]} ${l} players in roster`}
                >
                  {l}
                </button>
              )
            })}
          </div>

          {/* Venue text search with typeahead over loaded venue names */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Venue</span>
            <div className="relative min-w-0 flex-1">
              <input
                type="text"
                value={state.search}
                onChange={(e) => setState({ ...state, search: e.target.value })}
                onFocus={() => setVenueFocus(true)}
                onBlur={() => setTimeout(() => setVenueFocus(false), 150)}
                placeholder="e.g. Bowman Field"
                className="w-full rounded-lg border border-border/40 bg-gray-950/40 px-2 py-1 text-[11px] text-text placeholder:text-text-dim/40 focus:outline-none focus:border-accent-blue/50"
              />
              {venueMatches.length > 0 && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  {venueMatches.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onMouseDown={() => setState({ ...state, search: v })}
                      className="block w-full truncate px-2.5 py-1.5 text-left text-[11px] text-text hover:bg-accent-blue/10 transition-colors"
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Color-by mode (Kent's "color overdue guys" ask) */}
          <div className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Color by</span>
            {(['tier', 'heartbeat'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setState({ ...state, colorBy: mode })}
                className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  state.colorBy === mode
                    ? 'bg-accent-blue/15 text-accent-blue'
                    : 'text-text-dim/60 hover:text-text hover:bg-gray-800/50'
                }`}
                title={mode === 'tier' ? 'Color by player tier (T1 red, T2 orange, T3 gray)' : 'Color by Heartbeat overdue-ness'}
              >
                {mode === 'tier' ? 'Tier' : 'Heartbeat'}
              </button>
            ))}
          </div>

          {/* Footer: live result count + range readout (proof the filters
              applied — changes are live, no submit needed) + Done to close. */}
          <div className="flex items-center justify-between gap-2 border-t border-border/30 pt-2 text-[10px] text-text-dim">
            <span>
              {markerCount} venue{markerCount !== 1 ? 's' : ''}
              {filtered && <span className="text-text-dim/40"> of {totalCount}</span>}
              <span className="text-text-dim/40"> · {formatDate(dateProps.filterStart)} to {formatDate(dateProps.filterEnd)} · applied live</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {activeCount > 0 && (
                <button
                  onClick={() => setState({ ...DEFAULT_MAP_FILTERS, colorBy: state.colorBy, showAirports: state.showAirports })}
                  className="text-accent-blue/80 hover:text-accent-blue underline-offset-2 hover:underline"
                >
                  Clear filters
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg bg-accent-blue px-3 py-1 text-[11px] font-semibold text-white hover:bg-accent-blue/80 transition-colors"
                title="Filters apply as you change them; this just closes the panel"
              >
                Done
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Apply the filter state to a list of TierMarkers. Returns markers whose
 * surviving player list (after tier/level/search/overdue) is non-empty; players
 * inside each marker are also pruned so the popup matches.
 */

export function applyMapFilters(
  markers: TierMarker[],
  state: MapFilterState,
  daysByPlayerKey?: Map<string, number | null>,
  /** Venue coordinates that participate in a double up within the current
   *  dates — the coarse venue-level gate for "Double ups only". */
  doubleUpCoords?: Array<{ lat: number; lng: number }>,
  /** Game ids that participate in a double up — with the toggle on, each
   *  surviving venue's game list (and so its count badge, popup drill-in,
   *  and date range) narrows to ONLY these. Without it, a venue that had
   *  one double up kept all its solo games too (Tom 2026-08-18, Clover
   *  Park showing 12 games with the toggle on). */
  doubleUpGameIds?: Set<string>,
): TierMarker[] {
  const search = state.search.trim().toLowerCase()
  const selectedPlayers = new Set(state.selectedPlayers.map((n) => n.trim().toLowerCase()))
  const isDoubleUpVenue = (m: TierMarker): boolean => {
    if (!doubleUpCoords || doubleUpCoords.length === 0) return false
    // Same proximity tolerance the marker builder uses to match games to venues
    return doubleUpCoords.some((c) => {
      const dLat = c.lat - m.coords.lat
      const dLng = c.lng - m.coords.lng
      return dLat * dLat + dLng * dLng < 0.00002
    })
  }
  return markers
    .map((m) => {
      // Venue-name search: when set, only keep markers whose venue matches.
      if (search !== '' && !m.venueName.toLowerCase().includes(search)) return null
      // Double-up family toggles: only venues in an ACTIVE family (the
      // caller pre-unions ids/coords per the toggles), showing only those
      // games.
      if (state.doubleUpsOnly || state.drivableDoubleUpsOnly) {
        if (m.games.length > 0 && doubleUpGameIds) {
          const duGames = m.games.filter((g) => doubleUpGameIds.has(g.id))
          if (duGames.length === 0) return null
          const duDates = [...new Set(duGames.map((g) => g.date))].sort()
          const duNames = new Set(duGames.flatMap((g) => g.players))
          m = {
            ...m,
            games: duGames,
            gameDates: duDates,
            // Keep only players who appear in a double-up game here, so the
            // popup's player list matches its game list.
            players: m.players.filter((p) => duNames.has(p.name)),
          }
          if (m.players.length === 0) return null
        } else if (!isDoubleUpVenue(m)) {
          // Venues without per-game data (e.g. spring training complexes)
          // fall back to the coarse venue-coordinate check.
          return null
        }
      }
      const survivors = m.players.filter((p) => {
        if (!state.tiers.has(p.tier)) return false
        if (!state.levels.has(p.level as MapLevelFilter)) return false
        // Affirmative player selection: keep only the picked players.
        if (selectedPlayers.size > 0 && !selectedPlayers.has(p.name.toLowerCase())) return false
        if (state.overdueOnly) {
          if (!daysByPlayerKey) return false
          const days = daysByPlayerKey.get(p.name.trim().toLowerCase())
          // Overdue = no visit on record, OR more than 90 days since last visit
          if (days != null && days <= 90) return false
        }
        return true
      })
      if (survivors.length === 0) return null
      return {
        ...m,
        players: survivors,
        playerCount: survivors.length,
        bestTier: Math.min(...survivors.map((p) => p.tier)),
      } as TierMarker
    })
    .filter((m): m is TierMarker => m !== null)
}
