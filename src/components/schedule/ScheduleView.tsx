import { useEffect, useState } from 'react'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore, selectProPlayers } from '../../store/rosterStore'
import { resolveMLBTeamId } from '../../data/aliases'
import type { MLBAffiliate } from '../../lib/mlbApi'
import ScheduleCalendar from './ScheduleCalendar'

export default function ScheduleView() {
  const proPlayers = useRosterStore(selectProPlayers)
  const {
    affiliates,
    affiliatesLoading,
    affiliatesError,
    playerTeamAssignments,
    proGames,
    schedulesLoading,
    schedulesProgress,
    schedulesError,
    fetchAffiliates,
    assignPlayerToTeam,
    fetchProSchedules,
  } = useScheduleStore()

  const [startDate, setStartDate] = useState('2026-03-01')
  const [endDate, setEndDate] = useState('2026-09-30')

  useEffect(() => {
    if (affiliates.length === 0 && !affiliatesLoading) {
      fetchAffiliates()
    }
  }, [affiliates.length, affiliatesLoading, fetchAffiliates])

  // Group affiliates by parent org
  const affiliatesByParent = new Map<number, MLBAffiliate[]>()
  for (const aff of affiliates) {
    const existing = affiliatesByParent.get(aff.parentOrgId)
    if (existing) existing.push(aff)
    else affiliatesByParent.set(aff.parentOrgId, [aff])
  }

  const assignedCount = Object.keys(playerTeamAssignments).length
  const unassigned = proPlayers.filter((p) => !playerTeamAssignments[p.playerName])

  return (
    <div className="space-y-6">
      {/* Assignment section */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Player Team Assignments</h2>
            <p className="text-xs text-text-dim">
              Assign each Pro player to their current MiLB/MLB team ({assignedCount}/{proPlayers.length} assigned)
            </p>
          </div>
          {affiliatesLoading && (
            <span className="flex items-center gap-2 text-xs text-text-dim">
              <span className="h-3 w-3 animate-spin rounded-full border border-text-dim border-t-transparent" />
              Loading affiliates...
            </span>
          )}
        </div>

        {affiliatesError && (
          <div className="mb-4 rounded-lg border border-accent-red/30 bg-accent-red/5 px-4 py-2 text-sm text-accent-red">
            {affiliatesError}
            <button onClick={fetchAffiliates} className="ml-2 underline">Retry</button>
          </div>
        )}

        {unassigned.length > 0 && (
          <div className="space-y-2">
            {unassigned.map((player) => {
              const parentId = resolveMLBTeamId(player.org)
              const teamOptions = parentId ? affiliatesByParent.get(parentId) ?? [] : []

              return (
                <div key={player.playerName} className="flex items-center gap-3 rounded-lg border border-border/50 bg-gray-950 px-3 py-2">
                  <span className="min-w-[140px] text-sm font-medium text-text">{player.playerName}</span>
                  <span className="text-xs text-text-dim">{player.org}</span>
                  <select
                    className="ml-auto rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-accent-blue focus:outline-none"
                    value=""
                    onChange={(e) => {
                      const [teamId, sportId, teamName] = e.target.value.split('|')
                      if (teamId && sportId && teamName) {
                        assignPlayerToTeam(player.playerName, {
                          teamId: parseInt(teamId),
                          sportId: parseInt(sportId),
                          teamName,
                        })
                      }
                    }}
                  >
                    <option value="">Select team...</option>
                    {teamOptions
                      .sort((a, b) => a.sportId - b.sportId)
                      .map((t) => (
                        <option key={t.teamId} value={`${t.teamId}|${t.sportId}|${t.teamName}`}>
                          {t.teamName} ({t.sportName})
                        </option>
                      ))}
                    {teamOptions.length === 0 && parentId === null && (
                      <option disabled>Org not recognized — check aliases</option>
                    )}
                  </select>
                </div>
              )
            })}
          </div>
        )}

        {assignedCount > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-medium text-text-dim">Assigned Players</h3>
            <div className="grid gap-1 sm:grid-cols-2">
              {Object.entries(playerTeamAssignments).map(([name, assignment]) => (
                <div key={name} className="flex items-center justify-between rounded-lg bg-accent-green/5 px-3 py-1.5 text-sm">
                  <span className="text-text">{name}</span>
                  <span className="text-xs text-accent-green">{assignment.teamName}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Schedule fetch controls */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Fetch Schedules</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-text-dim">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dim">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
            />
          </div>
          <button
            onClick={() => fetchProSchedules(startDate, endDate)}
            disabled={schedulesLoading || assignedCount === 0}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
          >
            {schedulesLoading ? 'Fetching...' : 'Fetch Schedules'}
          </button>
        </div>

        {schedulesProgress && (
          <div className="mt-3">
            <div className="mb-1 text-xs text-text-dim">
              Loading schedules: {schedulesProgress.completed}/{schedulesProgress.total} teams
            </div>
            <div className="h-1.5 rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-accent-blue transition-all"
                style={{ width: `${(schedulesProgress.completed / schedulesProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {schedulesError && (
          <p className="mt-3 text-sm text-accent-red">{schedulesError}</p>
        )}

        {proGames.length > 0 && (
          <p className="mt-3 text-sm text-accent-green">
            Loaded {proGames.length} games across assigned teams
          </p>
        )}
      </div>

      {/* Calendar view */}
      {proGames.length > 0 && <ScheduleCalendar games={proGames} />}
    </div>
  )
}
