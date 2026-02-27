import { useEffect, useRef, useState } from 'react'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { resolveMLBTeamId, resolveNcaaName } from '../../data/aliases'
import { NCAA_VENUES } from '../../data/ncaaVenues'
import { isSpringTraining, getSpringTrainingSite, isGrapefruitLeague } from '../../data/springTraining'
import { isNcaaSeason, isHsSeason } from '../../lib/tripEngine'
import type { MLBAffiliate } from '../../lib/mlbApi'
import ScheduleCalendar from './ScheduleCalendar'

export default function ScheduleView() {
  const players = useRosterStore((s) => s.players)
  const proPlayers = players.filter((p) => p.level === 'Pro')
  const ncaaPlayers = players.filter((p) => p.level === 'NCAA')
  const hsPlayers = players.filter((p) => p.level === 'HS')

  const affiliates = useScheduleStore((s) => s.affiliates)
  const affiliatesLoading = useScheduleStore((s) => s.affiliatesLoading)
  const affiliatesError = useScheduleStore((s) => s.affiliatesError)
  const playerTeamAssignments = useScheduleStore((s) => s.playerTeamAssignments)
  const proGames = useScheduleStore((s) => s.proGames)
  const schedulesLoading = useScheduleStore((s) => s.schedulesLoading)
  const schedulesProgress = useScheduleStore((s) => s.schedulesProgress)
  const schedulesError = useScheduleStore((s) => s.schedulesError)
  const fetchAffiliates = useScheduleStore((s) => s.fetchAffiliates)
  const assignPlayerToTeam = useScheduleStore((s) => s.assignPlayerToTeam)
  const fetchProSchedules = useScheduleStore((s) => s.fetchProSchedules)

  const [startDate, setStartDate] = useState('2026-03-01')
  const [endDate, setEndDate] = useState('2026-09-30')

  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    if (affiliates.length === 0 && !affiliatesLoading) {
      initialized.current = true
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

  const isStActive = isSpringTraining(new Date().toISOString().slice(0, 10))

  return (
    <div className="space-y-6">
      {/* Assignment section */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Player Team Assignments</h2>
            <p className="text-xs text-text-dim">
              Assign each Pro player to their current MiLB/MLB team ({assignedCount}/{proPlayers.length} assigned)
              {isStActive && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent-orange/15 px-2 py-0.5 text-[10px] font-medium text-accent-orange">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-orange" />
                  Spring Training Active — see ST locations below
                </span>
              )}
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

      {/* Spring Training info */}
      {isSpringTraining(new Date().toISOString().slice(0, 10)) && (
        <div className="rounded-xl border border-accent-orange/30 bg-accent-orange/5 p-5">
          <h2 className="mb-2 text-base font-semibold text-accent-orange">Spring Training Active</h2>
          <p className="mb-3 text-xs text-text-dim">
            Pro players are at spring training facilities, not their regular season affiliates.
            Grapefruit League sites (Florida) are drivable from Orlando.
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {proPlayers.map((player) => {
              const parentId = resolveMLBTeamId(player.org)
              const site = parentId ? getSpringTrainingSite(parentId) : null
              if (!site) return null
              const drivable = parentId ? isGrapefruitLeague(parentId) : false
              return (
                <div key={player.playerName} className="flex items-center justify-between rounded-lg bg-gray-950/50 px-3 py-1.5 text-sm">
                  <span className="text-text">{player.playerName}</span>
                  <span className={`text-xs ${drivable ? 'text-accent-green' : 'text-accent-red'}`}>
                    {site.venueName} ({site.league})
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

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

      {/* NCAA players section */}
      {ncaaPlayers.length > 0 && (
        <div className="rounded-xl border border-accent-green/30 bg-surface p-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-base font-semibold text-accent-green">NCAA Players</h2>
            <span className="rounded-full bg-accent-green/15 px-2 py-0.5 text-[10px] font-medium text-accent-green">
              {ncaaPlayers.length} players
            </span>
            {isNcaaSeason(new Date().toISOString().slice(0, 10)) && (
              <span className="rounded-full bg-accent-green/15 px-2 py-0.5 text-[10px] font-medium text-accent-green">
                Season Active (Feb 14 – Jun 15)
              </span>
            )}
          </div>
          <p className="mb-3 text-xs text-text-dim">
            Visit opportunities generated for typical home game days (Tue/Fri/Sat).
            Non-game weekdays included with lower confidence — player may be traveling for away series.
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {ncaaPlayers.map((player) => {
              const canonical = resolveNcaaName(player.org)
              const venue = canonical ? NCAA_VENUES[canonical] : null
              return (
                <div key={player.playerName} className="flex items-center justify-between rounded-lg bg-gray-950/50 px-3 py-1.5 text-sm">
                  <span className="text-text">{player.playerName}</span>
                  <span className="text-xs text-text-dim">
                    {venue ? (
                      <span className="text-accent-green">{player.org} — {venue.venueName}</span>
                    ) : (
                      <span className="text-accent-orange">{player.org} — venue not mapped</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="mt-3 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-2">
            <p className="text-[11px] text-accent-orange">
              Note: NCAA schedules are estimated based on typical game days. We don't know exact away game dates.
              On non-game days, the player is generally assumed to be at their home school, but may travel the day before an away series.
            </p>
          </div>
        </div>
      )}

      {/* HS players section */}
      {hsPlayers.length > 0 && (
        <div className="rounded-xl border border-accent-orange/30 bg-surface p-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-base font-semibold text-accent-orange">High School Players</h2>
            <span className="rounded-full bg-accent-orange/15 px-2 py-0.5 text-[10px] font-medium text-accent-orange">
              {hsPlayers.length} players
            </span>
            {isHsSeason(new Date().toISOString().slice(0, 10)) && (
              <span className="rounded-full bg-accent-orange/15 px-2 py-0.5 text-[10px] font-medium text-accent-orange">
                Season Active (Feb 14 – May 15)
              </span>
            )}
          </div>
          <p className="mb-3 text-xs text-text-dim">
            Visit opportunities generated for typical home game days (Tue/Thu).
            Players assumed at their school on school days, but may travel for away games.
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {hsPlayers.map((player) => (
              <div key={player.playerName} className="flex items-center justify-between rounded-lg bg-gray-950/50 px-3 py-1.5 text-sm">
                <span className="text-text">{player.playerName}</span>
                <span className="text-xs text-text-dim">
                  {player.org}{player.state ? `, ${player.state}` : ''}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-2">
            <p className="text-[11px] text-accent-orange">
              Note: HS schedules are estimated. We don't have exact game dates.
              Players are generally at their school on weekdays but may travel the day before away games.
              Venues are geocoded from school name — verify accuracy on the Map tab.
            </p>
          </div>
        </div>
      )}

      {/* Calendar view */}
      {proGames.length > 0 && <ScheduleCalendar games={proGames} />}
    </div>
  )
}
