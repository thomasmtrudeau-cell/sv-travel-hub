import { useState } from 'react'
import type { RosterPlayer } from '../../types/roster'
import { useRosterStore } from '../../store/rosterStore'

const TIER_COLORS: Record<number, string> = {
  1: 'bg-accent-blue/20 text-accent-blue',
  2: 'bg-accent-green/20 text-accent-green',
  3: 'bg-accent-orange/20 text-accent-orange',
  4: 'bg-gray-500/20 text-gray-400',
}

export default function PlayerCard({ player }: { player: RosterPlayer }) {
  const [expanded, setExpanded] = useState(false)
  const setVisitOverride = useRosterStore((s) => s.setVisitOverride)
  const visitOverrides = useRosterStore((s) => s.visitOverrides)
  const hasOverride = !!visitOverrides[player.playerName]

  return (
    <>
      <tr
        className="cursor-pointer border-b border-border/50 transition-colors hover:bg-surface-hover"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-2.5 font-medium text-text">{player.playerName}</td>
        <td className="px-4 py-2.5 text-text-dim">{player.org}</td>
        <td className="px-4 py-2.5 text-text-dim">{player.position}</td>
        <td className="px-4 py-2.5">
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${TIER_COLORS[player.tier] ?? TIER_COLORS[4]}`}>
            {player.tier}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <span className={player.visitsRemaining > 0 ? 'text-accent-orange' : 'text-accent-green'}>
            {player.visitsRemaining}
          </span>
          <span className="text-text-dim">/{player.visitTarget2026}</span>
        </td>
        <td className="px-4 py-2.5 text-text-dim">
          {player.visitsCompleted}/{player.visitTarget2026}
          {hasOverride && <span className="ml-1 text-accent-blue" title="Manually overridden">*</span>}
        </td>
        <td className="px-4 py-2.5 text-text-dim">{player.leadAgent}</td>
      </tr>

      {expanded && (
        <tr className="border-b border-border/50 bg-surface">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              <Detail label="State" value={player.state} />
              <Detail label="Draft Class" value={player.draftClass} />
              <Detail label="DOB" value={player.dob} />
              <Detail label="Age" value={player.age?.toString() ?? '-'} />
              <Detail label="Phone" value={player.phone} />
              <Detail label="Email" value={player.email} />
              <Detail label="Father" value={player.father} />
              <Detail label="Mother" value={player.mother} />
            </div>

            {/* Manual visit override */}
            <div className="mt-4 border-t border-border/30 pt-3">
              <VisitEditor player={player} onSave={setVisitOverride} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function VisitEditor({
  player,
  onSave,
}: {
  player: RosterPlayer
  onSave: (name: string, visits: number, lastVisit: string | null) => void
}) {
  const [visits, setVisits] = useState(player.visitsCompleted)
  const [lastVisit, setLastVisit] = useState(player.lastVisitDate ?? '')
  const [dirty, setDirty] = useState(false)

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1 block text-xs text-text-dim">Visits Completed</label>
        <input
          type="number"
          min={0}
          max={player.visitTarget2026}
          value={visits}
          onChange={(e) => { setVisits(parseInt(e.target.value) || 0); setDirty(true) }}
          className="w-20 rounded-lg border border-border bg-gray-950 px-2 py-1 text-sm text-text"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-text-dim">Last Visit Date</label>
        <input
          type="date"
          value={lastVisit}
          onChange={(e) => { setLastVisit(e.target.value); setDirty(true) }}
          className="rounded-lg border border-border bg-gray-950 px-2 py-1 text-sm text-text"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      {dirty && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSave(player.playerName, visits, lastVisit || null)
            setDirty(false)
          }}
          className="rounded-lg bg-accent-blue px-3 py-1 text-xs font-medium text-white hover:bg-accent-blue/80"
        >
          Save
        </button>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  if (!value || value === '-') return null
  return (
    <div>
      <span className="text-xs text-text-dim">{label}: </span>
      <span className="text-text">{value}</span>
    </div>
  )
}
