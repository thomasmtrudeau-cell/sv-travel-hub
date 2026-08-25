// Facts-first view (Kent 2026-08-17): "generate information first, then
// optionally generate a trip." Given a base city + dates, show the raw
// opportunities — every client game in range with its time, venue, players,
// and drive time FROM THE BASE ("2h 5m from Philadelphia", never from an
// inferred previous leg) — so Kent can fit baseball around a mixed-purpose
// trip himself. Trip generation stays available below as the explicit
// second step; "+ Priority" feeds a row's players into it.

import { useMemo, useState } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useSummerStore } from '../../store/summerStore'
import { useTimeStore } from '../../store/timeStore'
import { estimateDriveMinutes } from '../../lib/tripEngine'
import { formatDate, formatDriveTime, formatGameTimeDisplay, TIER_DOT_COLORS } from '../../lib/formatters'
import { driveTierClass } from './DoubleUpSection'
import type { RosterPlayer } from '../../types/roster'
import type { GameEvent } from '../../types/schedule'

const INITIAL_ROWS = 30

interface FactRow {
  game: GameEvent
  players: RosterPlayer[]
  driveMinutes: number
}

type SortKey = 'date' | 'drive'

export default function NearbyGamesFacts({
  playerMap,
  onPlayerClick,
  onAddPriority,
}: {
  playerMap: Map<string, RosterPlayer>
  onPlayerClick: (name: string) => void
  /** Adds a player to the priority list below (capped there). */
  onAddPriority: (name: string) => void
}) {
  const startDate = useTripStore((s) => s.startDate)
  const endDate = useTripStore((s) => s.endDate)
  const homeBase = useTripStore((s) => s.homeBase)
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const radiusEnabled = useTripStore((s) => s.radiusEnabled)
  const priorityPlayers = useTripStore((s) => s.priorityPlayers)
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)
  const summerGames = useSummerStore((s) => s.summerGames)
  const timeMode = useTimeStore((s) => s.mode)

  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [showAll, setShowAll] = useState(false)
  const [showBeyond, setShowBeyond] = useState(false)

  const { inRange, beyond } = useMemo(() => {
    const inRangeRows: FactRow[] = []
    const beyondRows: FactRow[] = []
    if (!homeBase) return { inRange: inRangeRows, beyond: beyondRows }
    const all = [...proGames, ...ncaaGames, ...hsGames, ...summerGames]
    const seen = new Set<string>()
    for (const g of all) {
      if (g.date < startDate || g.date > endDate) continue
      if (g.venue.coords.lat === 0 && g.venue.coords.lng === 0) continue
      // Roster is the source of truth — names on cached games that are no
      // longer on the roster are ghosts, never facts.
      const rosterPlayers = g.playerNames
        .map((n) => playerMap.get(n))
        .filter((p): p is RosterPlayer => !!p)
      if (rosterPlayers.length === 0) continue
      const key = `${g.venue.coords.lat.toFixed(4)},${g.venue.coords.lng.toFixed(4)}|${g.date}|${rosterPlayers.map((p) => p.playerName).sort().join(',')}`
      if (seen.has(key)) continue
      seen.add(key)
      const driveMinutes = estimateDriveMinutes(homeBase, g.venue.coords)
      const row = { game: g, players: rosterPlayers, driveMinutes }
      // Radius off (Kent 2026-08-25): every game on the dates is a fact,
      // distance still labeled so the far ones read as far.
      if (!radiusEnabled || driveMinutes <= maxDriveMinutes) inRangeRows.push(row)
      else beyondRows.push(row)
    }
    const cmp = (a: FactRow, b: FactRow) =>
      sortKey === 'drive'
        ? a.driveMinutes - b.driveMinutes || a.game.date.localeCompare(b.game.date)
        : a.game.date.localeCompare(b.game.date) || a.driveMinutes - b.driveMinutes
    inRangeRows.sort(cmp)
    beyondRows.sort(cmp)
    return { inRange: inRangeRows, beyond: beyondRows }
  }, [proGames, ncaaGames, hsGames, summerGames, startDate, endDate, homeBase, maxDriveMinutes, radiusEnabled, playerMap, sortKey])

  // Facts need a "from where" — until an origin is set there is nothing
  // honest to compute, so ask for the one missing input instead of
  // defaulting to a city the user never picked.
  if (!homeBase) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-3">
        <h3 className="text-sm font-semibold text-text">What&rsquo;s around your trip origin</h3>
        <p className="mt-1 text-xs text-text-dim">
          Pick a Trip origin above to see every client game within reach on these dates, with estimated drive times from it.
        </p>
      </div>
    )
  }

  const visible = showAll ? inRange : inRange.slice(0, INITIAL_ROWS)
  const driveHoursLabel = !radiusEnabled
    ? 'any distance (radius off)'
    : maxDriveMinutes % 60 > 0
      ? `${Math.floor(maxDriveMinutes / 60)}h ${maxDriveMinutes % 60}m`
      : `${Math.floor(maxDriveMinutes / 60)}h`

  function Row({ row }: { row: FactRow }) {
    const { game, players, driveMinutes } = row
    const t = game.source === 'mlb-api'
      ? formatGameTimeDisplay(game.time, timeMode, { coords: game.venue.coords, tz: game.venue.tz })
      : ''
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5 text-xs hover:bg-gray-900/50 transition-colors">
        <span className="w-20 shrink-0 font-medium text-text-dim">{formatDate(game.date)}</span>
        <span className="w-16 shrink-0 text-text-dim/60">{t || '—'}</span>
        <span className="min-w-[140px] text-text">{game.venue.name}</span>
        <span className="flex flex-wrap items-center gap-x-2">
          {players.map((p) => (
            <span
              key={p.playerName}
              className="inline-flex cursor-pointer items-center gap-1 font-medium text-text hover:text-accent-blue"
              onClick={() => onPlayerClick(p.playerName)}
              title={`See ${p.playerName}'s full schedule in this window`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${TIER_DOT_COLORS[p.tier] ?? 'bg-gray-500'}`} />
              {p.playerName}
            </span>
          ))}
        </span>
        <span
          className={`ml-auto shrink-0 font-medium ${driveTierClass(driveMinutes)}`}
          title={`Estimated drive from ${homeBaseName} (straight-line based; real traffic can add time)`}
        >
          est. {formatDriveTime(driveMinutes)} from {homeBaseName}
        </span>
        {players.some((p) => !priorityPlayers.includes(p.playerName)) && (
          <button
            onClick={() => players.forEach((p) => onAddPriority(p.playerName))}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-blue hover:bg-accent-blue/10 transition-colors"
            title="Add this game's players to the priority list below, then Generate Trips builds around them"
          >
            + Priority
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/40 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-text">
          What&rsquo;s around {homeBaseName}
        </h3>
        <span className="text-[11px] text-text-dim">
          {formatDate(startDate)} – {formatDate(endDate)} · {inRange.length} game{inRange.length !== 1 ? 's' : ''} within {driveHoursLabel}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[10px]">
          <span className="text-text-dim/50 uppercase tracking-wide">Sort</span>
          {(['date', 'drive'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              className={`rounded px-1.5 py-0.5 font-medium transition-colors ${
                sortKey === k ? 'bg-accent-blue/15 text-accent-blue' : 'text-text-dim hover:text-text'
              }`}
            >
              {k === 'date' ? 'By date' : 'By drive'}
            </button>
          ))}
        </span>
      </div>

      {inRange.length === 0 ? (
        <p className="px-4 py-3 text-xs text-text-dim">
          No client games within {driveHoursLabel} of {homeBaseName} on these dates.
          {beyond.length > 0 && <> {beyond.length} game{beyond.length !== 1 ? 's are' : ' is'} beyond that drive: widen the Max drive slider or expand below.</>}
        </p>
      ) : (
        <div className="divide-y divide-border/20">
          {visible.map((row, i) => (
            <Row key={`${row.game.id}-${i}`} row={row} />
          ))}
        </div>
      )}

      {!showAll && inRange.length > INITIAL_ROWS && (
        <button
          onClick={() => setShowAll(true)}
          className="block w-full border-t border-border/40 px-4 py-2 text-left text-[11px] font-medium text-accent-blue hover:bg-accent-blue/5 transition-colors"
        >
          Show all {inRange.length} games
        </button>
      )}

      {beyond.length > 0 && (
        <div className="border-t border-border/40">
          <button
            onClick={() => setShowBeyond((s) => !s)}
            className="block w-full px-4 py-2 text-left text-[11px] text-text-dim hover:text-text transition-colors"
          >
            {showBeyond ? '▾' : '▸'} {beyond.length} more game{beyond.length !== 1 ? 's' : ''} beyond your {driveHoursLabel} drive
          </button>
          {showBeyond && (
            <div className="divide-y divide-border/20">
              {beyond.slice(0, 25).map((row, i) => (
                <Row key={`b-${row.game.id}-${i}`} row={row} />
              ))}
              {beyond.length > 25 && (
                <p className="px-4 py-1.5 text-[10px] text-text-dim/50">…and {beyond.length - 25} more. Narrow the dates to see them all.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
