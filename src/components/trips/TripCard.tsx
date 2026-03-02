import { useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { useTripStore, getTripKey } from '../../store/tripStore'
import type { TripCandidate, VisitConfidence, ScheduleSource } from '../../types/schedule'
import type { TripStatus } from '../../store/tripStore'
import type { RosterPlayer } from '../../types/roster'

interface Props {
  trip: TripCandidate
  index: number
  defaultExpanded?: boolean
  onPlayerClick?: (playerName: string) => void
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

function formatDriveTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatGameTime(timeStr?: string, source?: ScheduleSource): string {
  if (!timeStr) return ''
  // Synthetic events (ST/NCAA/HS) have generic times — show TBD
  if (source && source !== 'mlb-api') return 'TBD'
  const d = new Date(timeStr)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }) + ' ET'
}

// Derive a human-readable reason the player should be at this venue
function getVisitContext(source: ScheduleSource, isHome: boolean, awayTeam: string): {
  label: string
  color: string
} {
  if (awayTeam === 'Spring Training') {
    return { label: 'Spring Training', color: 'bg-accent-orange/15 text-accent-orange' }
  }
  if (source === 'mlb-api') {
    return isHome
      ? { label: 'Home Game', color: 'bg-accent-green/15 text-accent-green' }
      : { label: 'Away Game', color: 'bg-purple-500/15 text-purple-400' }
  }
  if (source === 'ncaa-lookup') {
    return { label: 'School Visit (est.)', color: 'bg-accent-green/15 text-accent-green' }
  }
  // hs-lookup
  return { label: 'School Visit (est.)', color: 'bg-accent-orange/15 text-accent-orange' }
}

// Get data source badge for real vs estimated
function getSourceBadge(source: ScheduleSource, confidence: VisitConfidence | undefined, awayTeam: string): {
  label: string
  color: string
} | null {
  if (awayTeam === 'Spring Training') {
    return { label: 'ST Schedule', color: 'bg-pink-500/15 text-pink-400' }
  }
  if (source === 'mlb-api') {
    return { label: 'Confirmed', color: 'bg-accent-green/15 text-accent-green' }
  }
  if (source === 'ncaa-lookup') {
    if (confidence === 'high') {
      return { label: 'D1Baseball', color: 'bg-accent-green/15 text-accent-green' }
    }
    return { label: 'Estimated', color: 'bg-accent-orange/15 text-accent-orange' }
  }
  if (source === 'hs-lookup') {
    return { label: 'Estimated', color: 'bg-accent-orange/15 text-accent-orange' }
  }
  return null
}

// Derive org label for a venue stop
function getOrgLabel(
  source: ScheduleSource,
  homeTeam: string,
  awayTeam: string,
  playerNames: string[],
  players: RosterPlayer[],
): string {
  if (awayTeam === 'Spring Training') {
    // ST events have venue name as homeTeam — derive org from player
    const player = players.find((p) => playerNames.includes(p.playerName))
    return player?.org ?? ''
  }
  if (source === 'mlb-api') {
    // Regular pro game: homeTeam is already like "Cincinnati Reds"
    return homeTeam
  }
  if (source === 'ncaa-lookup') {
    return homeTeam // School name
  }
  if (source === 'hs-lookup') {
    const player = players.find((p) => playerNames.includes(p.playerName))
    return player ? `${player.org}, ${player.state}` : homeTeam
  }
  return homeTeam
}

const TIER_DOT_COLORS: Record<number, string> = {
  1: 'bg-accent-red',
  2: 'bg-accent-orange',
  3: 'bg-yellow-400',
  4: 'bg-gray-500',
}

// Deduplicate venues: merge nearby games at the same coords into one stop
interface VenueStop {
  venueName: string
  venueKey: string
  players: string[]
  driveFromAnchor: number
  isAnchor: boolean
  dates: string[]
  confidence?: VisitConfidence
  confidenceNote?: string
  source: ScheduleSource
  isHome: boolean
  homeTeam: string
  awayTeam: string
  sourceUrl?: string
  orgLabel: string
  gameTime?: string
  gameStatus?: string
}

function buildVenueStops(trip: TripCandidate, players: RosterPlayer[]): VenueStop[] {
  const venueMap = new Map<string, VenueStop>()

  // Add anchor venue
  const anchorKey = `${trip.anchorGame.venue.coords.lat.toFixed(4)},${trip.anchorGame.venue.coords.lng.toFixed(4)}`
  const anchorOrg = getOrgLabel(
    trip.anchorGame.source, trip.anchorGame.homeTeam, trip.anchorGame.awayTeam,
    trip.anchorGame.playerNames, players,
  )
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
    orgLabel: anchorOrg,
    gameTime: trip.anchorGame.time,
    gameStatus: trip.anchorGame.gameStatus,
  })

  // Merge nearby games by venue
  for (const game of trip.nearbyGames) {
    const key = `${game.venue.coords.lat.toFixed(4)},${game.venue.coords.lng.toFixed(4)}`
    const existing = venueMap.get(key)
    if (existing) {
      for (const name of game.playerNames) {
        if (!existing.players.includes(name)) existing.players.push(name)
      }
      if (!existing.dates.includes(game.date)) existing.dates.push(game.date)
    } else {
      const org = getOrgLabel(game.source, game.homeTeam, game.awayTeam, game.playerNames, players)
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
        orgLabel: org,
        gameTime: game.time,
        gameStatus: game.gameStatus,
      })
    }
  }

  return [...venueMap.values()].sort((a, b) => {
    if (a.isAnchor) return -1
    if (b.isAnchor) return 1
    return a.driveFromAnchor - b.driveFromAnchor
  })
}

// Generate plain-text itinerary for a trip
export function generateItineraryText(trip: TripCandidate, index: number, stops: VenueStop[], playerMap: Map<string, RosterPlayer>): string {
  const startDate = formatDate(trip.suggestedDays[0]!)
  const endDate = formatDate(trip.suggestedDays[trip.suggestedDays.length - 1]!)
  const dayCount = trip.suggestedDays.length
  const dateLabel = dayCount === 1 ? startDate : `${startDate} – ${endDate}`

  let text = `Trip #${index} — ${dateLabel} (${dayCount} day${dayCount !== 1 ? 's' : ''})\n`
  text += `Drive from Orlando: ~${formatDriveTime(trip.driveFromHomeMinutes)}\n`

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!
    const label = stop.orgLabel && stop.orgLabel !== stop.venueName
      ? `${stop.orgLabel} — ${stop.venueName}`
      : stop.venueName
    const ctx = getVisitContext(stop.source, stop.isHome, stop.awayTeam)
    const driveNote = i > 0 && stop.driveFromAnchor > 0 ? ` (${formatDriveTime(stop.driveFromAnchor)} from Stop ${1})` : ''
    text += `\nStop ${i + 1}: ${label} (${ctx.label})${driveNote}\n`
    const playerDescs = stop.players.map((name) => {
      const p = playerMap.get(name)
      return p ? `${name} (T${p.tier})` : name
    })
    text += `  Players: ${playerDescs.join(', ')}\n`
  }

  if (trip.scoreBreakdown) {
    const b = trip.scoreBreakdown
    const parts: string[] = []
    if (b.tier1Count > 0) parts.push(`${b.tier1Count}x T1`)
    if (b.tier2Count > 0) parts.push(`${b.tier2Count}x T2`)
    if (b.tier3Count > 0) parts.push(`${b.tier3Count}x T3`)
    if (b.thursdayBonus) parts.push('Thu bonus')
    text += `\nScore: ${b.finalScore} pts (${parts.join(' + ')})\n`
  }

  text += `Total drive: ~${formatDriveTime(trip.totalDriveMinutes)}\n`

  return text
}

export default function TripCard({ trip, index, defaultExpanded = false, onPlayerClick }: Props) {
  const players = useRosterStore((s) => s.players)
  const playerMap = new Map<string, RosterPlayer>()
  for (const p of players) playerMap.set(p.playerName, p)

  const stops = buildVenueStops(trip, players)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [showScoreDetail, setShowScoreDetail] = useState(false)
  const [copied, setCopied] = useState(false)

  const tripKey = getTripKey(trip)
  const tripStatuses = useTripStore((s) => s.tripStatuses)
  const setTripStatus = useTripStore((s) => s.setTripStatus)
  const currentStatus = tripStatuses[tripKey] as TripStatus | undefined

  function cycleStatus(e: React.MouseEvent) {
    e.stopPropagation()
    if (!currentStatus) setTripStatus(tripKey, 'planned')
    else if (currentStatus === 'planned') setTripStatus(tripKey, 'completed')
    else setTripStatus(tripKey, null)
  }

  const allPlayers = new Set<string>()
  for (const stop of stops) {
    for (const name of stop.players) allPlayers.add(name)
  }

  // Compute tier counts for collapsed header
  const tierCounts = { t1: 0, t2: 0, t3: 0 }
  for (const name of allPlayers) {
    const tier = playerMap.get(name)?.tier
    if (tier === 1) tierCounts.t1++
    else if (tier === 2) tierCounts.t2++
    else if (tier === 3) tierCounts.t3++
  }

  const hasUncertainEvents =
    stops.some((s) => s.confidence && s.confidence !== 'high')

  const startDate = formatDate(trip.suggestedDays[0]!)
  const endDate = formatDate(trip.suggestedDays[trip.suggestedDays.length - 1]!)
  const dayCount = trip.suggestedDays.length
  const dateLabel = dayCount === 1 ? startDate : `${startDate} – ${endDate}`

  const breakdown = trip.scoreBreakdown

  // Compute route distance breakdown
  const routeSegments: Array<{ from: string; to: string; minutes: number }> = []
  routeSegments.push({ from: 'Orlando', to: stops[0]?.orgLabel || stops[0]?.venueName || 'Stop 1', minutes: trip.driveFromHomeMinutes })
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1]!
    const curr = stops[i]!
    if (curr.driveFromAnchor > 0) {
      routeSegments.push({
        from: prev.orgLabel || prev.venueName,
        to: curr.orgLabel || curr.venueName,
        minutes: curr.driveFromAnchor,
      })
    }
  }
  // Return home from last stop
  const lastStop = stops[stops.length - 1]
  if (lastStop) {
    const interVenueDrive = stops.slice(1).reduce((sum, s) => sum + s.driveFromAnchor, 0)
    const returnMinutes = trip.totalDriveMinutes - trip.driveFromHomeMinutes - interVenueDrive
    if (returnMinutes > 0) {
      routeSegments.push({ from: lastStop.orgLabel || lastStop.venueName, to: 'Orlando', minutes: Math.round(returnMinutes) })
    }
  }

  async function handleCopyItinerary() {
    const text = generateItineraryText(trip, index, stops, playerMap)
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      {/* Header — always visible, clickable to expand/collapse */}
      <div
        className="flex cursor-pointer items-start justify-between gap-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-text-dim transition-transform ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
            <h3 className="text-base font-semibold text-text">
              Trip #{index}
            </h3>
            {breakdown && (
              <span className="rounded-lg bg-accent-blue/10 px-2 py-0.5 text-xs font-bold text-accent-blue">
                {breakdown.finalScore} pts
              </span>
            )}
            <button
              onClick={cycleStatus}
              className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                currentStatus === 'planned'
                  ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/30'
                  : currentStatus === 'completed'
                    ? 'bg-accent-green/15 text-accent-green border border-accent-green/30'
                    : 'bg-gray-800 text-text-dim/50 border border-border/30 hover:text-text-dim'
              }`}
              title={currentStatus ? `Status: ${currentStatus} (click to cycle)` : 'Click to mark as Planned'}
            >
              {currentStatus === 'planned' ? 'Planned' : currentStatus === 'completed' ? 'Completed' : 'No Status'}
            </button>
          </div>
          <p className="mt-0.5 text-sm text-text-dim">
            {dateLabel}
            <span className="ml-2 text-xs text-text-dim/60">
              {dayCount} day{dayCount !== 1 ? 's' : ''}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); handleCopyItinerary() }}
            className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text hover:bg-gray-700 transition-colors"
            title="Copy trip itinerary to clipboard"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <div className="rounded-lg bg-accent-blue/10 px-2.5 py-1">
            <span className="text-sm font-bold text-accent-blue">{allPlayers.size}</span>
            <span className="ml-1 text-[11px] text-accent-blue/70">
              player{allPlayers.size !== 1 ? 's' : ''}
            </span>
          </div>
          {(tierCounts.t1 > 0 || tierCounts.t2 > 0 || tierCounts.t3 > 0) && (
            <div className="flex items-center gap-1 rounded-lg bg-gray-950/60 px-2 py-1 text-[11px] font-medium">
              {tierCounts.t1 > 0 && <span className="text-accent-red">{tierCounts.t1}×T1</span>}
              {tierCounts.t1 > 0 && (tierCounts.t2 > 0 || tierCounts.t3 > 0) && <span className="text-text-dim/30">·</span>}
              {tierCounts.t2 > 0 && <span className="text-accent-orange">{tierCounts.t2}×T2</span>}
              {tierCounts.t2 > 0 && tierCounts.t3 > 0 && <span className="text-text-dim/30">·</span>}
              {tierCounts.t3 > 0 && <span className="text-yellow-400">{tierCounts.t3}×T3</span>}
            </div>
          )}
          <div className="rounded-lg bg-gray-950/60 px-2.5 py-1">
            <span className="text-sm font-bold text-text">{stops.length}</span>
            <span className="ml-1 text-[11px] text-text-dim">
              venue{stops.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="rounded-lg bg-gray-950/60 px-2.5 py-1">
            <span className="text-[11px] text-text-dim">~{formatDriveTime(trip.totalDriveMinutes)}</span>
          </div>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (<div className="mt-4">

      {/* Score breakdown toggle */}
      {breakdown && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowScoreDetail(!showScoreDetail) }}
          className="mb-2 rounded-lg bg-accent-blue/10 px-2 py-0.5 text-xs font-bold text-accent-blue hover:bg-accent-blue/20 transition-colors"
        >
          {showScoreDetail ? 'Hide Score Detail' : 'Show Score Detail'}
        </button>
      )}

      {/* Score breakdown (expandable) */}
      {showScoreDetail && breakdown && (
        <div className="mb-4 rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-3 py-2 text-xs">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {breakdown.tier1Count > 0 && (
              <span className="text-text">{breakdown.tier1Count}x Tier 1 <span className="text-text-dim">({breakdown.tier1Points}pts)</span></span>
            )}
            {breakdown.tier2Count > 0 && (
              <span className="text-text">{breakdown.tier2Count}x Tier 2 <span className="text-text-dim">({breakdown.tier2Points}pts)</span></span>
            )}
            {breakdown.tier3Count > 0 && (
              <span className="text-text">{breakdown.tier3Count}x Tier 3 <span className="text-text-dim">({breakdown.tier3Points}pts)</span></span>
            )}
            {breakdown.thursdayBonus && (
              <span className="text-accent-blue">Thu bonus +20%</span>
            )}
          </div>
          <p className="mt-1 text-text-dim">
            Raw: {breakdown.rawScore} → Final: {breakdown.finalScore} pts
          </p>
        </div>
      )}

      {/* Route distance breakdown */}
      <div className="mb-4 rounded-lg bg-gray-950/40 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          {routeSegments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              {i === 0 && <span className="inline-block h-2 w-2 rounded-full bg-accent-blue" />}
              {i > 0 && <span className="text-text-dim/40">&rarr;</span>}
              <span className="text-text-dim">{seg.to}</span>
              <span className="text-text-dim/60">({formatDriveTime(seg.minutes)})</span>
            </span>
          ))}
        </div>
        <p className="mt-1 text-text-dim/60">
          Total drive: ~{formatDriveTime(trip.totalDriveMinutes)}
        </p>
      </div>

      {/* Venue stops */}
      <div className="space-y-2">
        {stops.map((stop, i) => {
          const ctx = getVisitContext(stop.source, stop.isHome, stop.awayTeam)
          const srcBadge = getSourceBadge(stop.source, stop.confidence, stop.awayTeam)

          return (
            <div key={stop.venueKey}>
              {/* Drive connector between stops */}
              {i > 0 && stop.driveFromAnchor > 0 && (
                <div className="my-1 flex items-center gap-2 pl-6">
                  <div className="h-px flex-1 border-t border-dashed border-border/40" />
                  <span className="text-[10px] text-text-dim/60">
                    ~{formatDriveTime(stop.driveFromAnchor)} from stop 1
                  </span>
                  <div className="h-px flex-1 border-t border-dashed border-border/40" />
                </div>
              )}

              <div className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${
                stop.isAnchor
                  ? 'border border-accent-blue/20 bg-accent-blue/5'
                  : 'border border-border/30 bg-gray-950/30'
              }`}>
                {/* Stop number */}
                <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  stop.isAnchor
                    ? 'bg-accent-blue text-white'
                    : 'bg-surface text-text-dim'
                }`}>
                  {i + 1}
                </div>

                <div className="min-w-0 flex-1">
                  {/* Org label + venue name + context badges */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {stop.orgLabel && stop.orgLabel !== stop.venueName ? (
                      <>
                        <span className="text-sm font-medium text-text">{stop.orgLabel}</span>
                        <span className="text-xs text-text-dim">— {stop.venueName}</span>
                      </>
                    ) : (
                      <span className="text-sm font-medium text-text">{stop.venueName}</span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ctx.color}`}>
                      {ctx.label}
                    </span>
                    {srcBadge && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${srcBadge.color}`}>
                        {srcBadge.label}
                      </span>
                    )}
                    {stop.gameStatus && (stop.gameStatus === 'Postponed' || stop.gameStatus === 'Suspended') && (
                      <span className="rounded bg-accent-red/15 px-1.5 py-0.5 text-[10px] font-bold text-accent-red">
                        {stop.gameStatus}
                      </span>
                    )}
                    {stop.gameStatus && (stop.gameStatus === 'Cancelled' || stop.gameStatus === 'Canceled') && (
                      <span className="rounded bg-accent-red/15 px-1.5 py-0.5 text-[10px] font-bold text-accent-red line-through">
                        Canceled
                      </span>
                    )}
                    {stop.isAnchor && (
                      <span className="rounded bg-accent-blue/20 px-1.5 py-0.5 text-[10px] font-medium text-accent-blue">
                        BASE
                      </span>
                    )}
                    {stop.sourceUrl && (
                      <a
                        href={stop.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-text-dim hover:text-accent-blue transition-colors"
                        title="Verify this game on the source schedule"
                      >
                        {`Verify \u2197`}
                      </a>
                    )}
                  </div>

                  {/* Game time */}
                  {formatGameTime(stop.gameTime, stop.source) && (
                    <p className="mt-0.5 text-[11px] text-text-dim/70">
                      {formatGameTime(stop.gameTime, stop.source)}
                    </p>
                  )}

                  {/* Confidence badge */}
                  {stop.confidence && stop.confidence !== 'high' && (
                    <ConfidenceBadge confidence={stop.confidence} note={stop.confidenceNote} />
                  )}

                  {/* Players with tier badges */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {stop.players.map((name) => {
                      const player = playerMap.get(name)
                      const tier = player?.tier ?? 4
                      const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                      return (
                        <span
                          key={name}
                          className={`inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-medium text-text ${onPlayerClick ? 'cursor-pointer hover:bg-accent-blue/10' : ''}`}
                          onClick={onPlayerClick ? (e) => { e.stopPropagation(); onPlayerClick(name) } : undefined}
                        >
                          <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} title={`Tier ${tier}`} />
                          {name}
                          <span className="text-text-dim/60">T{tier}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Player list */}
      <div className="mt-4 border-t border-border/30 pt-3">
        <p className="text-xs text-text-dim">
          <span className="font-medium text-text">{allPlayers.size} players:</span>{' '}
          {[...allPlayers].map((name) => {
            const p = playerMap.get(name)
            return p ? `${name} (T${p.tier})` : name
          }).join(', ')}
        </p>
      </div>

      {/* Confidence warning */}
      {hasUncertainEvents && (
        <div className="mt-2 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-1.5">
          <p className="text-[11px] text-accent-orange">
            Some stops are estimated (NCAA/HS schedules). Confirm player availability before traveling.
          </p>
        </div>
      )}
      </div>)}
    </div>
  )
}

function ConfidenceBadge({ confidence, note }: { confidence: VisitConfidence; note?: string }) {
  const colors = confidence === 'medium'
    ? 'bg-accent-orange/10 text-accent-orange'
    : 'bg-accent-red/10 text-accent-red'
  const label = confidence === 'medium' ? 'Likely' : 'Uncertain'

  return (
    <span className={`mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${colors}`} title={note}>
      {label}
      {note && <span className="opacity-70">— {note}</span>}
    </span>
  )
}
