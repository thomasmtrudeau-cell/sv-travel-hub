import { useEffect, useMemo, useRef } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useTripStore, getTripKey } from '../../store/tripStore'
import { useVenueStore } from '../../store/venueStore'
import { generateSpringTrainingEvents, generateNcaaEvents, generateHsEvents } from '../../lib/tripEngine'
import type { GameEvent } from '../../types/schedule'
import type { Coordinates } from '../../types/roster'

const TIER_COLORS: Record<number, string> = {
  1: 'bg-accent-red/20 text-accent-red',
  2: 'bg-accent-orange/20 text-accent-orange',
  3: 'bg-yellow-400/20 text-yellow-400',
  4: 'bg-gray-500/20 text-gray-400',
}

const SOURCE_LABELS: Record<string, string> = {
  'mlb-api': 'Pro',
  'ncaa-lookup': 'NCAA',
  'hs-lookup': 'HS',
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

interface Props {
  playerName: string
  onClose: () => void
}

export default function PlayerSchedulePanel({ playerName, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const players = useRosterStore((s) => s.players)
  const player = players.find((p) => p.playerName === playerName)
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const tripPlan = useTripStore((s) => s.tripPlan)
  const tripStatuses = useTripStore((s) => s.tripStatuses)
  const startDate = useTripStore((s) => s.startDate)
  const endDate = useTripStore((s) => s.endDate)
  const venueState = useVenueStore((s) => s.venues)

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Close on escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Gather all games for this player from all sources
  const allGames = useMemo(() => {
    const games: GameEvent[] = []

    // Pro games
    games.push(...proGames.filter((g) => g.playerNames.includes(playerName)))

    // NCAA games (real)
    games.push(...ncaaGames.filter((g) => g.playerNames.includes(playerName)))

    // Synthetic events
    if (player) {
      const stEvents = generateSpringTrainingEvents(players, startDate, endDate)
      games.push(...stEvents.filter((g) => g.playerNames.includes(playerName)))

      const ncaaPlayersWithReal = new Set(ncaaGames.flatMap((g) => g.playerNames))
      if (player.level === 'NCAA' && !ncaaPlayersWithReal.has(playerName)) {
        const syntheticNcaa = generateNcaaEvents([player], startDate, endDate)
        games.push(...syntheticNcaa.filter((g) => g.playerNames.includes(playerName)))
      }

      if (player.level === 'HS') {
        const hsVenues = new Map<string, { name: string; coords: Coordinates }>()
        for (const [key, v] of Object.entries(venueState)) {
          if (v.source === 'hs-geocoded') hsVenues.set(key.replace(/^hs-/, ''), { name: v.name, coords: v.coords })
        }
        const hsEvents = generateHsEvents([player], startDate, endDate, hsVenues)
        games.push(...hsEvents.filter((g) => g.playerNames.includes(playerName)))
      }
    }

    // Dedupe by ID and sort by date
    const seen = new Set<string>()
    const unique = games.filter((g) => {
      if (seen.has(g.id)) return false
      seen.add(g.id)
      return true
    })
    unique.sort((a, b) => a.date.localeCompare(b.date))

    // Only show upcoming (from today forward)
    const today = new Date().toISOString().split('T')[0]!
    return unique.filter((g) => g.date >= today)
  }, [playerName, player, players, proGames, ncaaGames, venueState, startDate, endDate])

  // Find which trips include this player
  const tripAssignments = useMemo(() => {
    if (!tripPlan) return []
    return tripPlan.trips
      .map((trip, i) => {
        const allNames = [
          ...trip.anchorGame.playerNames,
          ...trip.nearbyGames.flatMap((g) => g.playerNames),
        ]
        if (!allNames.includes(playerName)) return null
        const key = getTripKey(trip)
        const status = tripStatuses[key]
        return { tripNum: i + 1, trip, status }
      })
      .filter(Boolean) as Array<{ tripNum: number; trip: import('../../types/schedule').TripCandidate; status?: string }>
  }, [tripPlan, tripStatuses, playerName])

  if (!player) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
        <div ref={panelRef} className="w-full max-w-md bg-surface border-l border-border p-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text">Player Not Found</h2>
            <button onClick={onClose} className="text-text-dim hover:text-text text-xl">&times;</button>
          </div>
          <p className="text-sm text-text-dim">Could not find player "{playerName}" in the roster.</p>
        </div>
      </div>
    )
  }

  const tierColor = TIER_COLORS[player.tier] ?? 'bg-gray-500/20 text-gray-400'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div ref={panelRef} className="w-full max-w-md bg-surface border-l border-border overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-surface border-b border-border p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-text">{player.playerName}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tierColor}`}>
                T{player.tier}
              </span>
            </div>
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-text-dim hover:text-text text-xl">&times;</button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-dim">
            <span>{player.org}</span>
            <span className="text-text-dim/30">|</span>
            <span>{player.level}</span>
            <span className="text-text-dim/30">|</span>
            <span>{player.position}</span>
          </div>
          <div className="mt-2 flex gap-4 text-sm">
            <div>
              <span className="text-text-dim text-xs">Visits</span>
              <p className="font-bold text-text">{player.visitsCompleted} / {player.visitTarget2026}</p>
            </div>
            <div>
              <span className="text-text-dim text-xs">Remaining</span>
              <p className="font-bold text-accent-blue">{player.visitsRemaining}</p>
            </div>
            {player.lastVisitDate && (
              <div>
                <span className="text-text-dim text-xs">Last Visit</span>
                <p className="font-medium text-text">{formatDate(player.lastVisitDate)}</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-5 space-y-6">
          {/* Trip Assignments */}
          {tripAssignments.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-text">Trip Assignments</h3>
              <div className="space-y-1.5">
                {tripAssignments.map(({ tripNum, trip, status }) => {
                  const days = trip.suggestedDays
                  const dateLabel = days.length === 1
                    ? formatDate(days[0]!)
                    : `${formatDate(days[0]!)} – ${formatDate(days[days.length - 1]!)}`
                  return (
                    <div key={tripNum} className="flex items-center justify-between rounded-lg bg-gray-950/50 px-3 py-2 text-sm">
                      <span className="text-text">Trip #{tripNum}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-dim">{dateLabel}</span>
                        {status && (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            status === 'planned' ? 'bg-accent-blue/15 text-accent-blue' : 'bg-accent-green/15 text-accent-green'
                          }`}>
                            {status === 'planned' ? 'Planned' : 'Completed'}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Upcoming Games */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-text">
              Upcoming Games
              <span className="ml-2 text-xs font-normal text-text-dim">{allGames.length} events</span>
            </h3>
            {allGames.length === 0 ? (
              <p className="text-xs text-text-dim">No upcoming games found in the selected date range.</p>
            ) : (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {allGames.slice(0, 30).map((g) => {
                  const sourceLabel = SOURCE_LABELS[g.source] ?? 'Unknown'
                  const isPostponed = g.gameStatus === 'Postponed' || g.gameStatus === 'Suspended'
                  return (
                    <div key={g.id} className={`rounded-lg border px-3 py-2 text-sm ${
                      isPostponed
                        ? 'border-accent-red/30 bg-accent-red/5'
                        : 'border-border/30 bg-gray-950/30'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-text">{formatDate(g.date)}</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            g.source === 'mlb-api' ? 'bg-accent-blue/15 text-accent-blue' :
                            g.source === 'ncaa-lookup' ? 'bg-accent-green/15 text-accent-green' :
                            'bg-accent-orange/15 text-accent-orange'
                          }`}>
                            {sourceLabel}
                          </span>
                          {isPostponed && (
                            <span className="rounded bg-accent-red/15 px-1.5 py-0.5 text-[10px] font-bold text-accent-red">
                              {g.gameStatus}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="mt-0.5 text-xs text-text-dim">
                        {g.homeTeam} vs {g.awayTeam} @ {g.venue.name}
                      </p>
                    </div>
                  )
                })}
                {allGames.length > 30 && (
                  <p className="text-xs text-text-dim text-center">+{allGames.length - 30} more events</p>
                )}
              </div>
            )}
          </div>

          {/* Visit History */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-text">Visit History</h3>
            <div className="rounded-lg bg-gray-950/50 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-dim">Completed</span>
                <span className="text-text font-medium">{player.visitsCompleted}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-text-dim">Last visit</span>
                <span className="text-text">{player.lastVisitDate ? formatDate(player.lastVisitDate) : 'Never'}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-text-dim">Target (2026)</span>
                <span className="text-text">{player.visitTarget2026}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-text-dim">Remaining</span>
                <span className="text-accent-blue font-bold">{player.visitsRemaining}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
