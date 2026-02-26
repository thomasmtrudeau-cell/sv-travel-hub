import { useState, useMemo } from 'react'
import type { GameEvent } from '../../types/schedule'

interface Props {
  games: GameEvent[]
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function ScheduleCalendar({ games }: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    // Start at the month of the first game
    if (games.length > 0) {
      const d = new Date(games[0]!.date + 'T12:00:00Z')
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
    }
    return { year: 2026, month: 2 } // March 2026
  })

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
  }

  const nextMonth = () => {
    setCurrentMonth((m) => {
      if (m.month === 11) return { year: m.year + 1, month: 0 }
      return { year: m.year, month: m.month + 1 }
    })
  }

  const monthLabel = new Date(Date.UTC(currentMonth.year, currentMonth.month, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

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

          return (
            <div
              key={cell.date}
              className={`min-h-[60px] rounded-lg border p-1 ${
                isSunday
                  ? 'border-accent-red/20 bg-accent-red/5'
                  : isThursday
                    ? 'border-accent-blue/20 bg-accent-blue/5'
                    : 'border-border/30 bg-gray-950/50'
              }`}
            >
              <span className={`text-xs ${isSunday ? 'text-accent-red/60' : 'text-text-dim'}`}>
                {cell.day}
              </span>
              {dayGames.length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {dayGames.slice(0, 3).map((g) => (
                    <div
                      key={g.id}
                      className="h-2 w-2 rounded-full bg-accent-blue"
                      title={`${g.homeTeam} vs ${g.awayTeam} @ ${g.venue.name}`}
                    />
                  ))}
                  {dayGames.length > 3 && (
                    <span className="text-[9px] text-text-dim">+{dayGames.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex gap-4 text-xs text-text-dim">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent-red/40" /> Sunday (blackout)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent-blue/40" /> Thursday (anchor)
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-accent-blue" /> Game
        </span>
      </div>
    </div>
  )
}
