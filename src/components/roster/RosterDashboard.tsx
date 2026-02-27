import { useEffect, useMemo, useRef, useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import type { RosterPlayer, PlayerLevel } from '../../types/roster'
import PlayerCard from './PlayerCard'

type SortField = 'playerName' | 'tier' | 'visitsRemaining' | 'org'
type SortDir = 'asc' | 'desc'

export default function RosterDashboard() {
  const players = useRosterStore((s) => s.players)
  const loading = useRosterStore((s) => s.loading)
  const error = useRosterStore((s) => s.error)
  const lastFetchedAt = useRosterStore((s) => s.lastFetchedAt)
  const fetchRoster = useRosterStore((s) => s.fetchRoster)

  const [levelFilter, setLevelFilter] = useState<PlayerLevel | 'All'>('All')
  const [sortField, setSortField] = useState<SortField>('tier')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [search, setSearch] = useState('')

  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    fetchRoster()
  }, [fetchRoster])

  const stats = useMemo(() => {
    const total = players.length
    const totalTarget = players.reduce((sum, p) => sum + p.visitTarget2026, 0)
    const totalCompleted = players.reduce((sum, p) => sum + p.visitsCompleted, 0)
    const coveragePercent = totalTarget > 0 ? Math.round((totalCompleted / totalTarget) * 100) : 0
    const needingVisits = players.filter((p) => p.visitsRemaining > 0).length

    // Per-tier breakdown
    const tiers = [1, 2, 3, 4].map((tier) => {
      const tierPlayers = players.filter((p) => p.tier === tier)
      const target = tierPlayers.reduce((sum, p) => sum + p.visitTarget2026, 0)
      const completed = tierPlayers.reduce((sum, p) => sum + p.visitsCompleted, 0)
      return { tier, count: tierPlayers.length, target, completed, percent: target > 0 ? Math.round((completed / target) * 100) : 0 }
    }).filter((t) => t.count > 0)

    return { total, totalTarget, totalCompleted, coveragePercent, needingVisits, tiers }
  }, [players])

  const filtered = players
    .filter((p) => levelFilter === 'All' || p.level === levelFilter)
    .filter((p) =>
      search === '' ||
      p.playerName.toLowerCase().includes(search.toLowerCase()) ||
      p.org.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1
      if (sortField === 'playerName') return mul * a.playerName.localeCompare(b.playerName)
      if (sortField === 'org') return mul * a.org.localeCompare(b.org)
      return mul * ((a[sortField] as number) - (b[sortField] as number))
    })

  const grouped: Record<PlayerLevel, RosterPlayer[]> = { Pro: [], NCAA: [], HS: [] }
  for (const p of filtered) {
    grouped[p.level].push(p)
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  if (loading && players.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
        <span className="ml-3 text-text-dim">Loading roster...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-6 text-center">
        <p className="text-accent-red font-medium">Failed to load roster</p>
        <p className="mt-1 text-sm text-text-dim">{error}</p>
        <button
          onClick={fetchRoster}
          className="mt-4 rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Players" value={stats.total} />
        <StatCard label="Visit Target" value={stats.totalTarget} />
        <StatCard label="Completed" value={stats.totalCompleted} />
        <StatCard
          label="Coverage"
          value={`${stats.coveragePercent}%`}
          accent={stats.coveragePercent >= 50 ? 'green' : stats.coveragePercent >= 25 ? 'orange' : 'red'}
        />
      </div>

      {/* Per-tier coverage */}
      {stats.tiers.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-2 text-xs font-medium text-text-dim">Coverage by Tier</h3>
          <div className="flex flex-wrap gap-4">
            {stats.tiers.map(({ tier, count, target, completed, percent }) => (
              <div key={tier} className="flex items-center gap-2">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  tier === 1 ? 'bg-accent-blue/20 text-accent-blue' :
                  tier === 2 ? 'bg-accent-green/20 text-accent-green' :
                  tier === 3 ? 'bg-accent-orange/20 text-accent-orange' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {tier}
                </span>
                <div className="w-20">
                  <div className="h-1.5 rounded-full bg-gray-800">
                    <div
                      className={`h-full rounded-full transition-all ${
                        percent >= 50 ? 'bg-accent-green' : percent >= 25 ? 'bg-accent-orange' : 'bg-accent-red'
                      }`}
                      style={{ width: `${Math.min(percent, 100)}%` }}
                    />
                  </div>
                </div>
                <span className="text-[11px] text-text-dim">
                  {completed}/{target} ({percent}%)
                </span>
                <span className="text-[10px] text-text-dim/50">{count} players</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search players or orgs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-dim/50 focus:border-accent-blue focus:outline-none"
        />

        <div className="flex rounded-lg border border-border">
          {(['All', 'Pro', 'NCAA', 'HS'] as const).map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter(level)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                levelFilter === level
                  ? 'bg-accent-blue/20 text-accent-blue'
                  : 'text-text-dim hover:text-text'
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        <button
          onClick={fetchRoster}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-dim hover:text-text disabled:opacity-50"
        >
          {loading ? (
            <span className="h-3 w-3 animate-spin rounded-full border border-text-dim border-t-transparent" />
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Refresh
        </button>
      </div>

      {lastFetchedAt && (
        <p className="text-xs text-text-dim/60">
          Last updated: {new Date(lastFetchedAt).toLocaleTimeString()}
        </p>
      )}

      {/* Player table grouped by level */}
      {(['Pro', 'NCAA', 'HS'] as const).map((level) => {
        const group = grouped[level]
        if (group.length === 0 && levelFilter !== 'All' && levelFilter !== level) return null
        if (group.length === 0) return null

        return (
          <div key={level}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text">
                {level === 'Pro' ? 'Professional' : level}
              </h3>
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-dim">
                {group.length}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface text-left text-xs font-medium text-text-dim">
                    <th className="cursor-pointer px-4 py-2.5 hover:text-text" onClick={() => toggleSort('playerName')}>
                      Name{sortIndicator('playerName')}
                    </th>
                    <th className="cursor-pointer px-4 py-2.5 hover:text-text" onClick={() => toggleSort('org')}>
                      Org{sortIndicator('org')}
                    </th>
                    <th className="px-4 py-2.5">Pos</th>
                    <th className="cursor-pointer px-4 py-2.5 hover:text-text" onClick={() => toggleSort('tier')}>
                      Tier{sortIndicator('tier')}
                    </th>
                    <th className="cursor-pointer px-4 py-2.5 hover:text-text" onClick={() => toggleSort('visitsRemaining')}>
                      Visits Left{sortIndicator('visitsRemaining')}
                    </th>
                    <th className="px-4 py-2.5">Target</th>
                    <th className="px-4 py-2.5">Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {group.map((player) => (
                    <PlayerCard key={player.normalizedName} player={player} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-text-dim">No players match your filters.</p>
      )}
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  const accentColor =
    accent === 'green' ? 'text-accent-green' :
    accent === 'orange' ? 'text-accent-orange' :
    accent === 'red' ? 'text-accent-red' :
    'text-text'

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium text-text-dim">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accentColor}`}>{value}</p>
    </div>
  )
}
