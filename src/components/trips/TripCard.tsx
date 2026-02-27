import type { TripCandidate, VisitConfidence } from '../../types/schedule'

interface Props {
  trip: TripCandidate
  index: number
}

export default function TripCard({ trip, index }: Props) {
  const allPlayers = new Set<string>()
  for (const name of trip.anchorGame.playerNames) allPlayers.add(name)
  for (const g of trip.nearbyGames) {
    for (const name of g.playerNames) allPlayers.add(name)
  }

  const hasUncertainEvents =
    (trip.anchorGame.confidence && trip.anchorGame.confidence !== 'high') ||
    trip.nearbyGames.some((g) => g.confidence && g.confidence !== 'high')

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text">
            Trip #{index}
          </h3>
          <p className="text-xs text-text-dim">
            {trip.suggestedDays[0]} — {trip.suggestedDays[trip.suggestedDays.length - 1]}
            {' '}({trip.suggestedDays.length} days)
          </p>
        </div>
        <div className="text-right">
          <span className="text-lg font-bold text-accent-blue">{trip.visitValue}</span>
          <p className="text-xs text-text-dim">visit value</p>
        </div>
      </div>

      {/* Itinerary */}
      <div className="space-y-2">
        {/* Anchor game */}
        <div className="flex items-start gap-3 rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-3 py-2">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-blue text-[10px] font-bold text-white">
            A
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text">{trip.anchorGame.venue.name}</span>
              <span className="rounded bg-accent-blue/20 px-1.5 py-0.5 text-[10px] font-medium text-accent-blue">
                ANCHOR
              </span>
            </div>
            <p className="text-xs text-text-dim">
              {trip.anchorGame.date} — {trip.anchorGame.homeTeam} vs {trip.anchorGame.awayTeam}
            </p>
            {trip.anchorGame.confidence && trip.anchorGame.confidence !== 'high' && (
              <ConfidenceBadge confidence={trip.anchorGame.confidence} note={trip.anchorGame.confidenceNote} />
            )}
            <div className="mt-1 flex flex-wrap gap-1">
              {trip.anchorGame.playerNames.map((name) => (
                <span key={name} className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-text">
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Nearby games */}
        {trip.nearbyGames.map((game, i) => (
          <div key={game.id} className="flex items-start gap-3 rounded-lg border border-border/50 bg-gray-950/50 px-3 py-2">
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface text-[10px] font-medium text-text-dim">
              {i + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text">{game.venue.name}</span>
                <span className="text-[10px] text-text-dim">{game.driveMinutes} min drive</span>
              </div>
              <p className="text-xs text-text-dim">
                {game.date} — {game.homeTeam} vs {game.awayTeam}
              </p>
              {game.confidence && game.confidence !== 'high' && (
                <ConfidenceBadge confidence={game.confidence} note={game.confidenceNote} />
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                {game.playerNames.map((name) => (
                  <span key={name} className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-text">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Players summary */}
      <div className="mt-3 border-t border-border/30 pt-3">
        <p className="text-xs text-text-dim">
          {allPlayers.size} player{allPlayers.size !== 1 ? 's' : ''} visited:
          {' '}{[...allPlayers].join(', ')}
        </p>
      </div>

      {/* Confidence warning if any events are low/medium */}
      {hasUncertainEvents && (
        <div className="mt-2 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-1.5">
          <p className="text-[11px] text-accent-orange">
            Some stops on this trip are estimated (NCAA/HS). Confirm player availability before traveling.
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
