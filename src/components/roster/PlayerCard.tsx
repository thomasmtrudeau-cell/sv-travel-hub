import { useState } from 'react'
import type { RosterPlayer } from '../../types/roster'

const TIER_COLORS: Record<number, string> = {
  1: 'bg-accent-blue/20 text-accent-blue',
  2: 'bg-accent-green/20 text-accent-green',
  3: 'bg-accent-orange/20 text-accent-orange',
  4: 'bg-gray-500/20 text-gray-400',
}

export default function PlayerCard({ player }: { player: RosterPlayer }) {
  const [expanded, setExpanded] = useState(false)

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
              <Detail label="Last Visit" value={player.lastVisitDate ?? 'None'} />
            </div>
          </td>
        </tr>
      )}
    </>
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
