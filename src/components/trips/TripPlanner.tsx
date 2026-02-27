import { useMemo, useState } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { isSpringTraining } from '../../data/springTraining'
import { isNcaaSeason, isHsSeason } from '../../lib/tripEngine'
import TripCard, { generateItineraryText } from './TripCard'
import type { RosterPlayer } from '../../types/roster'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const TIER_DOT_COLORS: Record<number, string> = {
  1: 'bg-accent-red',
  2: 'bg-accent-orange',
  3: 'bg-yellow-400',
  4: 'bg-gray-500',
}

function getDayName(dateStr: string): string {
  return DAY_NAMES[new Date(dateStr + 'T12:00:00Z').getUTCDay()]!
}

function getDaysInRange(start: string, end: string): string[] {
  const days: string[] = []
  const cur = new Date(start + 'T12:00:00Z')
  const last = new Date(end + 'T12:00:00Z')
  while (cur <= last) {
    days.push(DAY_NAMES[cur.getUTCDay()]!)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return days
}

function formatDriveTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function TripPlanner() {
  const startDate = useTripStore((s) => s.startDate)
  const endDate = useTripStore((s) => s.endDate)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const priorityPlayers = useTripStore((s) => s.priorityPlayers)
  const tripPlan = useTripStore((s) => s.tripPlan)
  const computing = useTripStore((s) => s.computing)
  const progressStep = useTripStore((s) => s.progressStep)
  const progressDetail = useTripStore((s) => s.progressDetail)
  const setDateRange = useTripStore((s) => s.setDateRange)
  const setMaxDriveMinutes = useTripStore((s) => s.setMaxDriveMinutes)
  const setPriorityPlayers = useTripStore((s) => s.setPriorityPlayers)
  const generateTrips = useTripStore((s) => s.generateTrips)
  const proGames = useScheduleStore((s) => s.proGames)
  const proFetchedAt = useScheduleStore((s) => s.proFetchedAt)
  const ncaaFetchedAt = useScheduleStore((s) => s.ncaaFetchedAt)
  const players = useRosterStore((s) => s.players)

  const [copiedAll, setCopiedAll] = useState(false)

  // Build player lookup
  const playerMap = useMemo(() => {
    const map = new Map<string, RosterPlayer>()
    for (const p of players) map.set(p.playerName, p)
    return map
  }, [players])

  // Players eligible for priority selection (have visits remaining)
  const eligibleForPriority = useMemo(
    () => players.filter((p) => p.visitsRemaining > 0).sort((a, b) => a.playerName.localeCompare(b.playerName)),
    [players],
  )

  const hasStDates = isSpringTraining(startDate) || isSpringTraining(endDate)
  const hasNcaaDates = isNcaaSeason(startDate) || isNcaaSeason(endDate)
  const hasHsDates = isHsSeason(startDate) || isHsSeason(endDate)
  const hasProPlayers = players.some((p) => p.level === 'Pro' && p.visitsRemaining > 0)
  const hasNcaaPlayers = players.some((p) => p.level === 'NCAA' && p.visitsRemaining > 0)
  const hasHsPlayers = players.some((p) => p.level === 'HS' && p.visitsRemaining > 0)

  const hasData = proGames.length > 0
    || (hasStDates && hasProPlayers)
    || (hasNcaaDates && hasNcaaPlayers)
    || (hasHsDates && hasHsPlayers)
  const canGenerate = hasData && players.length > 0 && !computing

  // Data freshness checks
  const proStale = proFetchedAt && (Date.now() - proFetchedAt > 24 * 60 * 60 * 1000)
  const ncaaStale = ncaaFetchedAt && (Date.now() - ncaaFetchedAt > 24 * 60 * 60 * 1000)
  const showFreshnessWarning = (hasProPlayers && (proStale || !proFetchedAt)) || (hasNcaaPlayers && (ncaaStale || !ncaaFetchedAt))

  function handlePriorityChange(slot: 0 | 1, value: string) {
    const next = [...priorityPlayers]
    if (value === '') {
      next.splice(slot, 1)
    } else {
      next[slot] = value
    }
    // Remove duplicates and empty slots
    setPriorityPlayers([...new Set(next.filter(Boolean))])
  }

  async function handleCopyAllTrips() {
    if (!tripPlan) return
    // We can't easily access stops from here without re-building them,
    // so generate a simplified version per trip
    const texts: string[] = []
    for (let i = 0; i < tripPlan.trips.length; i++) {
      const trip = tripPlan.trips[i]!
      // Build stops inline
      const stops = buildSimpleStops(trip)
      texts.push(generateItineraryText(trip, i + 1, stops, playerMap))
    }
    await navigator.clipboard.writeText(texts.join('\n---\n\n'))
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Trip Planner</h2>
        <p className="mb-4 text-xs text-text-dim">
          Generate optimized road trips within driving radius. Thursdays are preferred anchor days, Sundays are blacked out.
        </p>

        {/* Data freshness indicators */}
        <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
          <span className={`rounded px-2 py-0.5 ${
            proFetchedAt
              ? proStale ? 'bg-accent-orange/10 text-accent-orange' : 'bg-accent-green/10 text-accent-green'
              : 'bg-gray-800 text-text-dim/60'
          }`}>
            Pro: {proFetchedAt ? `fetched ${formatTimeAgo(proFetchedAt)}` : 'never fetched'}
          </span>
          <span className={`rounded px-2 py-0.5 ${
            ncaaFetchedAt
              ? ncaaStale ? 'bg-accent-orange/10 text-accent-orange' : 'bg-accent-green/10 text-accent-green'
              : 'bg-gray-800 text-text-dim/60'
          }`}>
            NCAA: {ncaaFetchedAt ? `fetched ${formatTimeAgo(ncaaFetchedAt)}` : 'never fetched'}
          </span>
        </div>

        {showFreshnessWarning && (
          <div className="mb-4 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-1.5">
            <p className="text-[11px] text-accent-orange">
              {!proFetchedAt && hasProPlayers && 'Pro schedules never fetched. '}
              {proStale && 'Pro schedules are stale (>24h). '}
              {!ncaaFetchedAt && hasNcaaPlayers && 'NCAA schedules never fetched. '}
              {ncaaStale && 'NCAA schedules are stale (>24h). '}
              Refresh on the Schedule tab for the latest data.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-text-dim">Start Date</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setDateRange(e.target.value, endDate)}
                className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
              />
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs font-medium text-text-dim">
                {getDayName(startDate)}
              </span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dim">End Date</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setDateRange(startDate, e.target.value)}
                className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
              />
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs font-medium text-text-dim">
                {getDayName(endDate)}
              </span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dim">
              Max Drive: {Math.floor(maxDriveMinutes / 60)}h{maxDriveMinutes % 60 > 0 ? ` ${maxDriveMinutes % 60}m` : ''}
            </label>
            <input
              type="range"
              min={120}
              max={300}
              step={15}
              value={maxDriveMinutes}
              onChange={(e) => setMaxDriveMinutes(parseInt(e.target.value))}
              className="h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-gray-700 accent-accent-blue"
            />
          </div>
          <button
            onClick={generateTrips}
            disabled={!canGenerate}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
          >
            {computing ? 'Computing...' : 'Generate Trips'}
          </button>
        </div>

        {/* Day-of-week strip */}
        <DayStrip startDate={startDate} endDate={endDate} />

        {/* Priority players */}
        <div className="mt-4 rounded-lg border border-border/50 bg-gray-950/50 p-3">
          <label className="mb-2 block text-xs font-medium text-text-dim">
            Priority Players <span className="text-text-dim/50">(optional — build first trip around these players)</span>
          </label>
          <div className="flex flex-wrap gap-3">
            {[0, 1].map((slot) => (
              <select
                key={slot}
                value={priorityPlayers[slot] ?? ''}
                onChange={(e) => handlePriorityChange(slot as 0 | 1, e.target.value)}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-accent-blue focus:outline-none"
              >
                <option value="">{slot === 0 ? 'Select player 1...' : 'Select player 2...'}</option>
                {eligibleForPriority
                  .filter((p) => p.playerName !== priorityPlayers[slot === 0 ? 1 : 0])
                  .map((p) => (
                    <option key={p.playerName} value={p.playerName}>
                      {p.playerName} ({p.level} — {p.org})
                    </option>
                  ))}
              </select>
            ))}
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

        {!canGenerate && !computing && (
          <p className="mt-3 text-xs text-accent-orange">
            {players.length === 0
              ? 'Load the roster first.'
              : 'No visit data for the selected date range. Adjust dates to overlap a season (ST: Feb 15–Mar 28, NCAA: Feb 14–Jun 15, HS: Feb 14–May 15) or fetch Pro schedules in the Schedule tab.'}
          </p>
        )}

        {canGenerate && proGames.length === 0 && (
          <p className="mt-3 text-xs text-accent-green">
            {[
              hasStDates && hasProPlayers ? 'Spring training (Pro)' : '',
              hasNcaaDates && hasNcaaPlayers ? 'NCAA season' : '',
              hasHsDates && hasHsPlayers ? 'HS season' : '',
            ].filter(Boolean).join(', ')} data available — trips can be generated now.
            {hasProPlayers && ' For exact Pro regular season schedules, also fetch schedules in the Schedule tab.'}
          </p>
        )}

        {computing && (
          <div className="mt-4 rounded-lg border border-border/50 bg-gray-950 p-3">
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
              <span className="text-sm font-medium text-text">{progressStep}</span>
            </div>
            {progressDetail && <p className="mt-1 text-xs text-text-dim">{progressDetail}</p>}
          </div>
        )}
      </div>

      {/* Results */}
      {tripPlan && (
        <>
          {/* Priority player results */}
          {tripPlan.priorityResults && tripPlan.priorityResults.length > 0 && (
            <div className="rounded-xl border border-accent-blue/30 bg-accent-blue/5 p-4">
              <h3 className="mb-2 text-sm font-semibold text-accent-blue">Priority Player Results</h3>
              <div className="space-y-1.5">
                {tripPlan.priorityResults.map((r) => (
                  <div key={r.playerName} className="flex items-center gap-2 text-sm">
                    <span className={`h-2 w-2 rounded-full ${
                      r.status === 'included' ? 'bg-accent-green' :
                      r.status === 'separate-trip' ? 'bg-accent-orange' :
                      'bg-accent-red'
                    }`} />
                    <span className="font-medium text-text">{r.playerName}</span>
                    <span className="text-xs text-text-dim">
                      {r.status === 'included' && 'Included in Trip #1'}
                      {r.status === 'separate-trip' && 'Separate trip created'}
                      {r.status === 'unreachable' && 'Could not be reached'}
                    </span>
                    {r.reason && (
                      <span className="text-[11px] text-accent-orange">— {r.reason}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Coverage stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Road Trips" value={tripPlan.trips.length} />
            <StatCard label="Fly-in Visits" value={tripPlan.flyInVisits.length} />
            <StatCard label="Player Coverage" value={`${tripPlan.coveragePercent}%`} accent={tripPlan.coveragePercent >= 70 ? 'green' : 'orange'} />
            <StatCard label="No Games Found" value={tripPlan.unvisitablePlayers.length} accent={tripPlan.unvisitablePlayers.length > 0 ? 'red' : 'green'} />
          </div>

          {/* Road trip cards */}
          {tripPlan.trips.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">
                  Road Trips
                  <span className="ml-2 text-xs font-normal text-text-dim">
                    Drivable from Orlando within {Math.floor(maxDriveMinutes / 60)}h{maxDriveMinutes % 60 > 0 ? ` ${maxDriveMinutes % 60}m` : ''} radius
                  </span>
                </h3>
                <button
                  onClick={handleCopyAllTrips}
                  className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-text-dim hover:text-text hover:bg-gray-700 transition-colors"
                >
                  {copiedAll ? 'Copied!' : 'Copy All Trips'}
                </button>
              </div>
              <div className="space-y-4">
                {tripPlan.trips.map((trip, i) => (
                  <TripCard key={`trip-${i}`} trip={trip} index={i + 1} />
                ))}
              </div>
            </div>
          )}

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
                      <span className="font-medium text-text">{nm.playerName}</span>
                      <span className="text-xs text-text-dim">T{tier}</span>
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

          {/* Fly-in visits */}
          {tripPlan.flyInVisits.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-purple-400">
                Fly-in Visits
                <span className="ml-2 text-xs font-normal text-text-dim">
                  Beyond driving range — requires flight
                </span>
              </h3>
              <p className="mb-3 text-xs text-text-dim">
                These players have games outside driving radius. Estimated travel includes flight + airport + rental car.
              </p>
              <div className="space-y-2">
                {tripPlan.flyInVisits.map((visit, i) => {
                  // Derive org label for fly-in
                  const firstPlayer = players.find((p) => visit.playerNames.includes(p.playerName))
                  let orgLabel = ''
                  if (visit.source === 'hs-lookup' && firstPlayer) {
                    orgLabel = `${firstPlayer.org}, ${firstPlayer.state}`
                  } else if (visit.source === 'ncaa-lookup' && firstPlayer) {
                    orgLabel = firstPlayer.org
                  } else if (visit.source === 'mlb-api' && firstPlayer) {
                    orgLabel = firstPlayer.org
                  }

                  return (
                    <div key={i} className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {orgLabel && orgLabel !== visit.venue.name ? (
                              <>
                                <span className="text-sm font-medium text-text">{orgLabel}</span>
                                <span className="text-xs text-text-dim">— {visit.venue.name}</span>
                              </>
                            ) : (
                              <span className="text-sm font-medium text-text">{visit.venue.name}</span>
                            )}
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              visit.source === 'mlb-api'
                                ? visit.isHome ? 'bg-accent-green/15 text-accent-green' : 'bg-purple-500/15 text-purple-400'
                                : 'bg-accent-orange/15 text-accent-orange'
                            }`}>
                              {visit.source === 'mlb-api'
                                ? (visit.isHome ? 'Home Game' : 'Away Game')
                                : 'School Visit (est.)'}
                            </span>
                            {visit.sourceUrl && (
                              <a
                                href={visit.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-text-dim hover:text-purple-400 transition-colors"
                                title="Verify this game on the source schedule"
                              >
                                {`Verify \u2197`}
                              </a>
                            )}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {visit.playerNames.map((name) => {
                              const player = playerMap.get(name)
                              const tier = player?.tier ?? 4
                              const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                              return (
                                <span key={name} className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-medium text-text">
                                  <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} title={`Tier ${tier}`} />
                                  {name}
                                  <span className="text-text-dim/60">T{tier}</span>
                                </span>
                              )
                            })}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-medium text-purple-400">
                            ~{visit.estimatedTravelHours}h travel
                          </p>
                          <p className="text-[11px] text-text-dim">
                            {visit.distanceKm.toLocaleString()} km
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Truly unreachable players (no games at all) — with reasons */}
          {tripPlan.unvisitablePlayers.length > 0 && (
            <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-5">
              <h3 className="mb-2 text-sm font-semibold text-accent-red">
                No Games Found ({tripPlan.unvisitablePlayers.length})
              </h3>
              <p className="mb-3 text-xs text-text-dim">
                No visit opportunities found for these players in the selected date range.
              </p>
              <div className="space-y-1.5">
                {tripPlan.unvisitablePlayers.map((entry) => {
                  const player = playerMap.get(entry.name)
                  const tier = player?.tier ?? 4
                  const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                  return (
                    <div key={entry.name} className="flex items-center gap-2 text-sm">
                      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                      <span className="font-medium text-accent-red">{entry.name}</span>
                      <span className="text-xs text-text-dim">T{tier}</span>
                      <span className="text-xs text-text-dim/70">— {entry.reason}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {tripPlan.trips.length === 0 && tripPlan.flyInVisits.length === 0 && (
            <div className="rounded-xl border border-border bg-surface p-10 text-center">
              <p className="text-text-dim">No trips could be generated for the selected date range.</p>
              <p className="mt-1 text-xs text-text-dim/60">Try expanding the date range or assigning more players.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Simplified stop builder for Copy All Trips (mirrors TripCard logic)
function buildSimpleStops(trip: import('../../types/schedule').TripCandidate) {
  const venueMap = new Map<string, {
    venueName: string; venueKey: string; players: string[]; driveFromAnchor: number
    isAnchor: boolean; dates: string[]; confidence?: import('../../types/schedule').VisitConfidence
    confidenceNote?: string; source: import('../../types/schedule').ScheduleSource
    isHome: boolean; homeTeam: string; awayTeam: string; sourceUrl?: string; orgLabel: string
  }>()

  const anchorKey = `${trip.anchorGame.venue.coords.lat.toFixed(4)},${trip.anchorGame.venue.coords.lng.toFixed(4)}`
  venueMap.set(anchorKey, {
    venueName: trip.anchorGame.venue.name,
    venueKey: anchorKey,
    players: [...trip.anchorGame.playerNames],
    driveFromAnchor: 0,
    isAnchor: true,
    dates: [trip.anchorGame.date],
    confidence: trip.anchorGame.confidence,
    confidenceNote: trip.anchorGame.confidenceNote,
    source: trip.anchorGame.source,
    isHome: trip.anchorGame.isHome,
    homeTeam: trip.anchorGame.homeTeam,
    awayTeam: trip.anchorGame.awayTeam,
    sourceUrl: trip.anchorGame.sourceUrl,
    orgLabel: trip.anchorGame.homeTeam,
  })

  for (const game of trip.nearbyGames) {
    const key = `${game.venue.coords.lat.toFixed(4)},${game.venue.coords.lng.toFixed(4)}`
    const existing = venueMap.get(key)
    if (existing) {
      for (const name of game.playerNames) {
        if (!existing.players.includes(name)) existing.players.push(name)
      }
      if (!existing.dates.includes(game.date)) existing.dates.push(game.date)
    } else {
      venueMap.set(key, {
        venueName: game.venue.name,
        venueKey: key,
        players: [...game.playerNames],
        driveFromAnchor: game.driveMinutes,
        isAnchor: false,
        dates: [game.date],
        confidence: game.confidence,
        confidenceNote: game.confidenceNote,
        source: game.source,
        isHome: game.isHome,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        sourceUrl: game.sourceUrl,
        orgLabel: game.homeTeam,
      })
    }
  }

  return [...venueMap.values()].sort((a, b) => {
    if (a.isAnchor) return -1
    if (b.isAnchor) return 1
    return a.driveFromAnchor - b.driveFromAnchor
  })
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  const accentColor =
    accent === 'green' ? 'text-accent-green' :
    accent === 'orange' ? 'text-accent-orange' :
    accent === 'red' ? 'text-accent-red' :
    'text-text'

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium text-text-dim">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accentColor}`}>{value}</p>
    </div>
  )
}

function DayStrip({ startDate, endDate }: { startDate: string; endDate: string }) {
  const daysInRange = getDaysInRange(startDate, endDate)
  const dayCount = daysInRange.length

  if (dayCount < 1 || dayCount > 14) return null

  // Count occurrences of each day
  const dayCounts = new Map<string, number>()
  for (const d of daysInRange) {
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1)
  }

  const hasSunday = dayCounts.has('Sun')
  const hasThursday = dayCounts.has('Thu')

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="flex items-center gap-1">
        {DAY_NAMES.map((day) => {
          const inRange = dayCounts.has(day)
          const isSunday = day === 'Sun'
          const isThursday = day === 'Thu'

          return (
            <span
              key={day}
              className={`flex h-7 w-8 items-center justify-center rounded text-[11px] font-medium ${
                !inRange
                  ? 'text-text-dim/20'
                  : isSunday
                    ? 'bg-accent-red/15 text-accent-red line-through'
                    : isThursday
                      ? 'bg-accent-blue/15 text-accent-blue'
                      : 'bg-gray-800 text-text-dim'
              }`}
            >
              {day}
            </span>
          )
        })}
      </div>
      <span className="text-[11px] text-text-dim/60">
        {dayCount} day{dayCount !== 1 ? 's' : ''}
        {hasThursday && ' · Thu preferred'}
        {hasSunday && ' · Sun blacked out'}
      </span>
    </div>
  )
}
