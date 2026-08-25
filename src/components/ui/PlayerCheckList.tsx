// Checkbox roster list for the Map's Player filter.
//
// Kent 2026-08-25: "To filter the players right now I need to click on each
// individual player then it exits out after each one - can we add box check
// aspect so I can add/subtract all the players at once?" The old typeahead
// closed after every pick. This is a persistent, searchable checklist
// grouped by level with All / None per group, so a whole set of players can
// be checked or cleared in one motion. Empty selection = everyone shown.

import { useMemo, useState } from 'react'
import type { RosterPlayer } from '../../types/roster'
import { TIER_DOT_COLORS } from '../../lib/formatters'

const LEVEL_ORDER: Record<string, number> = { Pro: 0, NCAA: 1, HS: 2 }
const LEVEL_LABELS: Record<string, string> = { Pro: 'Pro', NCAA: 'College', HS: 'High School' }
const LEVEL_COLORS: Record<string, string> = {
  Pro: 'text-accent-green',
  NCAA: 'text-accent-blue',
  HS: 'text-accent-orange',
}

interface PlayerCheckListProps {
  players: RosterPlayer[]
  selected: string[]
  onChange: (names: string[]) => void
}

export default function PlayerCheckList({ players, selected, onChange }: PlayerCheckListProps) {
  const [search, setSearch] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = players
      .filter((p) => q === '' || p.playerName.toLowerCase().includes(q) || p.org.toLowerCase().includes(q))
      .sort((a, b) =>
        (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9) || a.tier - b.tier || a.playerName.localeCompare(b.playerName))
    const byLevel = new Map<string, RosterPlayer[]>()
    for (const p of list) {
      const arr = byLevel.get(p.level) ?? []
      arr.push(p)
      byLevel.set(p.level, arr)
    }
    return [...byLevel.entries()]
  }, [players, search])

  const visibleNames = groups.flatMap(([, ps]) => ps.map((p) => p.playerName))

  function setMany(names: string[], on: boolean) {
    const next = new Set(selected)
    for (const n of names) on ? next.add(n) : next.delete(n)
    onChange([...next])
  }
  function toggle(name: string) {
    setMany([name], !selectedSet.has(name))
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or team..."
          className="min-w-0 flex-1 rounded-md border border-border bg-gray-900/60 px-2 py-0.5 text-[11px] text-text placeholder:text-text-dim/40 focus:border-accent-blue/60 focus:outline-none"
        />
        <button
          onClick={() => setMany(visibleNames, true)}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-text-dim/70 hover:bg-gray-800/50 hover:text-text"
          title={search ? 'Check every player matching the search' : 'Check every player'}
        >
          All
        </button>
        <button
          onClick={() => (search ? setMany(visibleNames, false) : onChange([]))}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-text-dim/70 hover:bg-gray-800/50 hover:text-text"
          title={search ? 'Uncheck every player matching the search' : 'Clear the selection (shows everyone)'}
        >
          None
        </button>
      </div>
      <div className="text-[10px] text-text-dim/60">
        {selected.length === 0
          ? 'Everyone shown. Check names to narrow the map.'
          : `${selected.length} checked · only these show on the map`}
      </div>
      <div className="max-h-44 overflow-y-auto rounded-md border border-border/60 bg-gray-900/40">
        {groups.length === 0 && (
          <div className="px-2 py-1.5 text-[11px] text-text-dim/50">No players match.</div>
        )}
        {groups.map(([level, ps]) => {
          const names = ps.map((p) => p.playerName)
          const checkedHere = names.filter((n) => selectedSet.has(n)).length
          return (
            <div key={level}>
              <div className="sticky top-0 flex items-center gap-2 bg-gray-900/95 px-2 py-1 backdrop-blur">
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${LEVEL_COLORS[level] ?? 'text-text-dim'}`}>
                  {LEVEL_LABELS[level] ?? level}
                </span>
                <span className="text-[10px] text-text-dim/50">{checkedHere}/{names.length}</span>
                <span className="ml-auto flex gap-1">
                  <button onClick={() => setMany(names, true)} className="text-[10px] text-text-dim/60 hover:text-text">all</button>
                  <button onClick={() => setMany(names, false)} className="text-[10px] text-text-dim/60 hover:text-text">none</button>
                </span>
              </div>
              {ps.map((p) => {
                const on = selectedSet.has(p.playerName)
                return (
                  <label
                    key={p.playerName}
                    className={`flex cursor-pointer items-center gap-2 px-2 py-0.5 text-[11px] hover:bg-gray-800/60 ${on ? 'text-text' : 'text-text-dim'}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(p.playerName)}
                      className="h-3 w-3 accent-accent-blue"
                    />
                    <span className={`h-2 w-2 shrink-0 rounded-full ${TIER_DOT_COLORS[p.tier] ?? 'bg-gray-500'}`} />
                    <span className="truncate">{p.playerName}</span>
                    <span className="ml-auto truncate pl-2 text-[10px] text-text-dim/50">{p.org}</span>
                  </label>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
