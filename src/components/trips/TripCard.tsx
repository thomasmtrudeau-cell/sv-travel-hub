import type { TripCandidate, VisitConfidence } from '../../types/schedule'

interface Props {
  trip: TripCandidate
  index: number
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
}

function buildVenueStops(trip: TripCandidate): VenueStop[] {
  const venueMap = new Map<string, VenueStop>()

  // Add anchor venue
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
  })

  // Merge nearby games by venue
  for (const game of trip.nearbyGames) {
    const key = `${game.venue.coords.lat.toFixed(4)},${game.venue.coords.lng.toFixed(4)}`
    const existing = venueMap.get(key)
    if (existing) {
      // Merge players and dates
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
      })
    }
  }

  // Sort: anchor first, then by distance
  return [...venueMap.values()].sort((a, b) => {
    if (a.isAnchor) return -1
    if (b.isAnchor) return 1
    return a.driveFromAnchor - b.driveFromAnchor
  })
}

export default function TripCard({ trip, index }: Props) {
  const stops = buildVenueStops(trip)

  // Collect all unique players
  const allPlayers = new Set<string>()
  for (const stop of stops) {
    for (const name of stop.players) allPlayers.add(name)
  }

  const hasUncertainEvents =
    stops.some((s) => s.confidence && s.confidence !== 'high')

  const startDate = formatDate(trip.suggestedDays[0]!)
  const endDate = formatDate(trip.suggestedDays[trip.suggestedDays.length - 1]!)
  const dayCount = trip.suggestedDays.length
  const dateLabel = dayCount === 1 ? startDate : `${startDate} – ${endDate}`

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-text">
            Trip #{index}
          </h3>
          <p className="mt-0.5 text-sm text-text-dim">
            {dateLabel}
            <span className="ml-2 text-xs text-text-dim/60">
              {dayCount} day{dayCount !== 1 ? 's' : ''}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="rounded-lg bg-accent-blue/10 px-2.5 py-1">
            <span className="text-sm font-bold text-accent-blue">{allPlayers.size}</span>
            <span className="ml-1 text-[11px] text-accent-blue/70">
              player{allPlayers.size !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="rounded-lg bg-gray-950/60 px-2.5 py-1">
            <span className="text-sm font-bold text-text">{stops.length}</span>
            <span className="ml-1 text-[11px] text-text-dim">
              venue{stops.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Drive from Orlando */}
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-gray-950/40 px-3 py-2 text-xs">
        <span className="inline-block h-2 w-2 rounded-full bg-accent-blue" />
        <span className="text-text-dim">
          ~{formatDriveTime(trip.driveFromHomeMinutes)} drive from Orlando
        </span>
      </div>

      {/* Venue stops */}
      <div className="space-y-2">
        {stops.map((stop, i) => (
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
                {/* Venue name + badge */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text">{stop.venueName}</span>
                  {stop.isAnchor && (
                    <span className="rounded bg-accent-blue/20 px-1.5 py-0.5 text-[10px] font-medium text-accent-blue">
                      BASE
                    </span>
                  )}
                </div>

                {/* Confidence badge */}
                {stop.confidence && stop.confidence !== 'high' && (
                  <ConfidenceBadge confidence={stop.confidence} note={stop.confidenceNote} />
                )}

                {/* Players */}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {stop.players.map((name) => (
                    <span key={name} className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-medium text-text">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Player list */}
      <div className="mt-4 border-t border-border/30 pt-3">
        <p className="text-xs text-text-dim">
          <span className="font-medium text-text">{allPlayers.size} players:</span>{' '}
          {[...allPlayers].join(', ')}
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
