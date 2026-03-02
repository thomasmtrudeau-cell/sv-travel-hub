import { useState, useMemo } from 'react'
import type { GameEvent } from '../../types/schedule'

interface Props {
  games: GameEvent[]
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatTime(timeStr: string): string {
  const d = new Date(timeStr)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })
}

const SOURCE_COLORS: Record<string, string> = {
  'mlb-api': 'border-accent-blue/30 bg-accent-blue/5',
  'ncaa-lookup': 'border-accent-green/30 bg-accent-green/5',
  'hs-lookup': 'border-accent-orange/30 bg-accent-orange/5',
}

const SOURCE_DOT_COLORS: Record<string, string> = {
  'mlb-api': 'bg-accent-blue',
  'ncaa-lookup': 'bg-accent-green',
  'hs-lookup': 'bg-accent-orange',
}

const SOURCE_LABELS: Record<string, string> = {
  'mlb-api': 'Pro',
  'ncaa-lookup': 'NCAA',
  'hs-lookup': 'HS',
}

export default function ScheduleCalendar({ games }: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    // Start at the month of the first game
    if (games.length > 0) {
      const d = new Date(games[0]!.date + 'T12:00:00Z')
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
    }
    return { year: 2026, month: 2 } // March 2026
  })

  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const gamesByDate = useMemo(() => {
    const map = new Map<string, GameEvent[]>()
    for (const g of games) {
      const existing = map.get(g.date)
      if (existing) existing.push(g)
      else map.set(g.date, [g])
    }
    return map
  }, [games])

  // Build calendar grid
  const firstDay = new Date(Date.UTC(currentMonth.year, currentMonth.month, 1))
  const startOffset = firstDay.getUTCDay()
  const daysInMonth = new Date(Date.UTC(currentMonth.year, currentMonth.month + 1, 0)).getUTCDate()

  const cells: Array<{ date: string | null; day: number | null }> = []
  for (let i = 0; i < startOffset; i++) cells.push({ date: null, day: null })
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentMonth.year}-${String(currentMonth.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ date: dateStr, day: d })
  }

  const prevMonth = () => {
    setCurrentMonth((m) => {
      if (m.month === 0) return { year: m.year - 1, month: 11 }
      return { year: m.year, month: m.month - 1 }
    })
    setSelectedDate(null)
  }

  const nextMonth = () => {
    setCurrentMonth((m) => {
      if (m.month === 11) return { year: m.year + 1, month: 0 }
      return { year: m.year, month: m.month + 1 }
    })
    setSelectedDate(null)
  }

  const monthLabel = new Date(Date.UTC(currentMonth.year, currentMonth.month, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const selectedGames = selectedDate ? (gamesByDate.get(selectedDate) ?? []) : []

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={prevMonth} className="rounded-lg px-3 py-1 text-sm text-text-dim hover:text-text">
          &larr;
        </button>
        <h3 className="text-base font-semibold text-text">{monthLabel}</h3>
        <button onClick={nextMonth} className="rounded-lg px-3 py-1 text-sm text-text-dim hover:text-text">
          &rarr;
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px">
        {DAY_NAMES.map((name, i) => (
          <div
            key={name}
            className={`py-1 text-center text-xs font-medium ${
              i === 0 ? 'text-accent-red/60' : i === 4 ? 'text-accent-blue' : 'text-text-dim'
            }`}
          >
            {name}
          </div>
        ))}

        {cells.map((cell, i) => {
          if (cell.date === null) {
            return <div key={`empty-${i}`} className="min-h-[60px]" />
          }

          const dayGames = gamesByDate.get(cell.date) ?? []
          const dayOfWeek = new Date(cell.date + 'T12:00:00Z').getUTCDay()
          const isSunday = dayOfWeek === 0
          const isThursday = dayOfWeek === 4
          const isSelected = cell.date === selectedDate
          const gameCount = dayGames.length

          return (
            <div
              key={cell.date}
              onClick={() => setSelectedDate(isSelected ? null : cell.date)}
              className={`min-h-[60px] cursor-pointer rounded-lg border p-1 transition-colors ${
                isSelected
                  ? 'border-accent-blue bg-accent-blue/10 ring-1 ring-accent-blue/30'
                  : isSunday
                    ? 'border-accent-red/20 bg-accent-red/5 hover:bg-accent-red/10'
                    : isThursday
                      ? 'border-accent-blue/20 bg-accent-blue/5 hover:bg-accent-blue/10'
                      : 'border-border/30 bg-gray-950/50 hover:bg-gray-950/80'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs ${isSunday ? 'text-accent-red/60' : 'text-text-dim'}`}>
                  {cell.day}
                </span>
                {gameCount > 0 && (
                  <span className="rounded bg-accent-blue/20 px-1 text-[9px] font-bold text-accent-blue">
                    {gameCount}
                  </span>
                )}
              </div>
              {gameCount > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {dayGames.slice(0, 4).map((g) => {
                    const dotColor = SOURCE_DOT_COLORS[g.source] ?? 'bg-accent-blue'
                    return (
                      <div
                        key={g.id}
                        className={`h-2 w-2 rounded-full ${dotColor}`}
                        title={`${g.homeTeam} vs ${g.awayTeam} @ ${g.venue.name}`}
                      />
                    )
                  })}
                  {gameCount > 4 && (
                    <span className="text-[9px] text-text-dim">+{gameCount - 4}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Day detail panel */}
      {selectedDate && (
        <div className="mt-4 rounded-lg border border-accent-blue/20 bg-gray-950/50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-text">
              {new Date(selectedDate + 'T12:00:00Z').toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
              })}
            </h4>
            <span className="text-xs text-text-dim">{selectedGames.length} game{selectedGames.length !== 1 ? 's' : ''}</span>
          </div>
          {selectedGames.length === 0 ? (
            <p className="text-xs text-text-dim">No games on this date.</p>
          ) : (
            <div className="space-y-2">
              {selectedGames.map((g) => {
                const sourceColor = SOURCE_COLORS[g.source] ?? 'border-border/30 bg-gray-950/30'
                const sourceLabel = SOURCE_LABELS[g.source] ?? 'Unknown'
                const confirmLabel = g.source === 'mlb-api' ? 'Confirmed' :
                  g.confidence === 'high' ? 'D1Baseball' : 'Estimated'
                const confirmColor = confirmLabel === 'Estimated'
                  ? 'text-accent-orange' : 'text-accent-green'
                return (
                  <div key={g.id} className={`rounded-lg border p-3 ${sourceColor}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-text">{g.homeTeam}</span>
                          {g.awayTeam !== 'Spring Training' && g.awayTeam !== 'Home Game (estimated)' && g.awayTeam !== 'No game scheduled' && (
                            <span className="text-xs text-text-dim">vs {g.awayTeam}</span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="text-text-dim">{g.venue.name}</span>
                          <span className="text-text-dim/40">|</span>
                          <span className="text-text-dim">{g.isHome ? 'Home' : 'Away'}</span>
                          {formatTime(g.time) && (
                            <>
                              <span className="text-text-dim/40">|</span>
                              <span className="text-text-dim">{formatTime(g.time)}</span>
                            </>
                          )}
                        </div>
                        {g.playerNames.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {g.playerNames.map((name) => (
                              <span key={name} className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-text">
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          g.source === 'mlb-api' ? 'bg-accent-blue/15 text-accent-blue' :
                          g.source === 'ncaa-lookup' ? 'bg-accent-green/15 text-accent-green' :
                          'bg-accent-orange/15 text-accent-orange'
                        }`}>
                          {sourceLabel}
                        </span>
                        <span className={`text-[10px] font-medium ${confirmColor}`}>
                          {confirmLabel}
                        </span>
                        {g.gameStatus && g.gameStatus !== 'Final' && g.gameStatus !== 'Scheduled' && (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            g.gameStatus === 'Postponed' || g.gameStatus === 'Suspended'
                              ? 'bg-accent-red/15 text-accent-red'
                              : g.gameStatus === 'Cancelled' || g.gameStatus === 'Canceled'
                                ? 'bg-accent-red/15 text-accent-red line-through'
                                : 'bg-gray-800 text-text-dim'
                          }`}>
                            {g.gameStatus}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex gap-4 text-xs text-text-dim">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent-red/40" /> Sunday (blackout)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent-blue/40" /> Thursday (anchor)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent-blue" /> Pro
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent-green" /> NCAA
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent-orange" /> HS
        </span>
      </div>
    </div>
  )
}
