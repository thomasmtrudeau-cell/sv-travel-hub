import { useEffect, useMemo, useRef, useState } from 'react'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { resolveMLBTeamId, resolveNcaaName, MLB_ORG_IDS, NCAA_ALIASES } from '../../data/aliases'
import { NCAA_VENUES } from '../../data/ncaaVenues'
import { isSpringTraining, getSpringTrainingSite, isGrapefruitLeague } from '../../data/springTraining'
import { isNcaaSeason, isHsSeason, generateSpringTrainingEvents, generateNcaaEvents, generateHsEvents } from '../../lib/tripEngine'
import type { MLBAffiliate } from '../../lib/mlbApi'
import { useVenueStore } from '../../store/venueStore'
import type { GameEvent } from '../../types/schedule'
import type { Coordinates } from '../../types/roster'
import { D1_BASEBALL_SLUGS } from '../../data/d1baseballSlugs'
import ScheduleCalendar from './ScheduleCalendar'

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

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
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const ncaaLoading = useScheduleStore((s) => s.ncaaLoading)
  const ncaaProgress = useScheduleStore((s) => s.ncaaProgress)
  const ncaaError = useScheduleStore((s) => s.ncaaError)
  const fetchNcaaSchedules = useScheduleStore((s) => s.fetchNcaaSchedules)
  const proFetchedAt = useScheduleStore((s) => s.proFetchedAt)
  const ncaaFetchedAt = useScheduleStore((s) => s.ncaaFetchedAt)
  const customMlbAliases = useScheduleStore((s) => s.customMlbAliases)
  const customNcaaAliases = useScheduleStore((s) => s.customNcaaAliases)
  const setCustomAlias = useScheduleStore((s) => s.setCustomAlias)
  const rosterMoves = useScheduleStore((s) => s.rosterMoves)
  const rosterMovesLoading = useScheduleStore((s) => s.rosterMovesLoading)
  const rosterMovesCheckedAt = useScheduleStore((s) => s.rosterMovesCheckedAt)
  const checkRosterMoves = useScheduleStore((s) => s.checkRosterMoves)
  const autoAssignPlayers = useScheduleStore((s) => s.autoAssignPlayers)
  const autoAssignLoading = useScheduleStore((s) => s.autoAssignLoading)
  const autoAssignResult = useScheduleStore((s) => s.autoAssignResult)

  const [startDate, setStartDate] = useState('2026-03-01')
  const [endDate, setEndDate] = useState('2026-09-30')
  const [sourceFilters, setSourceFilters] = useState<Record<string, boolean>>({
    pro: true, st: true, ncaa: true, hs: true,
  })

  const venueState = useVenueStore((s) => s.venues)

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

  // Unresolved players (org not recognized even with custom aliases)
  const unresolvedPro = proPlayers.filter((p) => !resolveMLBTeamId(p.org, customMlbAliases))
  const unresolvedNcaa = ncaaPlayers.filter((p) => !resolveNcaaName(p.org, customNcaaAliases))
  const hasUnresolved = unresolvedPro.length > 0 || unresolvedNcaa.length > 0

  // Get unique canonical MLB org names for the dropdown
  const mlbOrgNames = useMemo(() => {
    const names = new Set<string>()
    for (const key of Object.keys(MLB_ORG_IDS)) {
      // Only include full names (contain space) to avoid duplicates like "Reds" and "Cincinnati Reds"
      if (key.includes(' ')) names.add(key)
    }
    return [...names].sort()
  }, [])

  // Get unique canonical NCAA school names for the dropdown
  const ncaaSchoolNames = useMemo(() => [...Object.keys(NCAA_ALIASES)].sort(), [])

  return (
    <div className="space-y-6">
      {/* Unresolved players — alias editor */}
      {hasUnresolved && (
        <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-accent-red">Unknown Team Names</h3>
          <p className="mb-3 text-xs text-text-dim">
            We couldn't match these team/school names from the roster. Pick the correct organization below so their schedules load properly.
          </p>
          <div className="space-y-2">
            {/* Group unresolved by unique org name */}
            {[...new Set(unresolvedPro.map((p) => p.org))].map((org) => {
              const orgPlayers = unresolvedPro.filter((p) => p.org === org)
              return (
                <div key={`pro-${org}`} className="flex items-center gap-3 rounded-lg border border-accent-red/20 bg-gray-950 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-accent-red">"{org}"</span>
                    <span className="ml-2 text-xs text-text-dim">(Pro — {orgPlayers.map((p) => p.playerName).join(', ')})</span>
                  </div>
                  <select
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-accent-blue focus:outline-none"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setCustomAlias('mlb', org, e.target.value)
                    }}
                  >
                    <option value="">Map to MLB org...</option>
                    {mlbOrgNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              )
            })}
            {[...new Set(unresolvedNcaa.map((p) => p.org))].map((org) => {
              const orgPlayers = unresolvedNcaa.filter((p) => p.org === org)
              return (
                <div key={`ncaa-${org}`} className="flex items-center gap-3 rounded-lg border border-accent-red/20 bg-gray-950 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-accent-red">"{org}"</span>
                    <span className="ml-2 text-xs text-text-dim">(NCAA — {orgPlayers.map((p) => p.playerName).join(', ')})</span>
                  </div>
                  <select
                    className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-accent-blue focus:outline-none"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setCustomAlias('ncaa', org, e.target.value)
                    }}
                  >
                    <option value="">Map to NCAA school...</option>
                    {ncaaSchoolNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Assignment section */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">Where Are Your Pro Players?</h2>
            <p className="text-xs text-text-dim">
              Pick which team each Pro player is currently on so we can find their games ({assignedCount}/{proPlayers.length} connected)
              {isStActive && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent-orange/15 px-2 py-0.5 text-[10px] font-medium text-accent-orange">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-orange" />
                  Spring Training Active — see ST locations below
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {affiliatesLoading && (
              <span className="flex items-center gap-2 text-xs text-text-dim">
                <span className="h-3 w-3 animate-spin rounded-full border border-text-dim border-t-transparent" />
                Loading affiliates...
              </span>
            )}
            {unassigned.length > 0 && affiliates.length > 0 && (
              <button
                onClick={autoAssignPlayers}
                disabled={autoAssignLoading}
                className="rounded-lg bg-accent-green px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-green/80 disabled:opacity-50"
              >
                {autoAssignLoading ? 'Scanning rosters...' : 'Auto-Assign'}
              </button>
            )}
          </div>
        </div>

        {autoAssignResult && (
          <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${autoAssignResult.assigned > 0 ? 'border border-accent-green/30 bg-accent-green/5 text-accent-green' : 'border border-accent-orange/30 bg-accent-orange/5 text-accent-orange'}`}>
            {autoAssignResult.assigned > 0 && `Auto-assigned ${autoAssignResult.assigned} player${autoAssignResult.assigned !== 1 ? 's' : ''} from MLB rosters. `}
            {autoAssignResult.notFound.length > 0 && (
              <span className="text-text-dim">
                Not found on any roster: {autoAssignResult.notFound.join(', ')}
              </span>
            )}
            {autoAssignResult.assigned === 0 && autoAssignResult.notFound.length === 0 && 'All Pro players already assigned.'}
          </div>
        )}

        {affiliatesError && (
          <div className="mb-4 rounded-lg border border-accent-red/30 bg-accent-red/5 px-4 py-2 text-sm text-accent-red">
            {affiliatesError}
            <button onClick={fetchAffiliates} className="ml-2 underline">Retry</button>
          </div>
        )}

        {unassigned.length > 0 && (
          <div className="space-y-2">
            {unassigned.map((player) => {
              const parentId = resolveMLBTeamId(player.org, customMlbAliases)
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
              const parentId = resolveMLBTeamId(player.org, customMlbAliases)
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
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-base font-semibold text-text">Pull Game Schedules</h2>
          {proFetchedAt && (
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${
              Date.now() - proFetchedAt > 24 * 60 * 60 * 1000
                ? 'bg-accent-orange/10 text-accent-orange'
                : 'bg-accent-green/10 text-accent-green'
            }`}>
              Pro: {formatTimeAgo(proFetchedAt)}
            </span>
          )}
          {!proFetchedAt && proGames.length === 0 && (
            <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] text-text-dim/60">Pro: never fetched</span>
          )}
        </div>
        <p className="mb-3 text-xs text-text-dim">
          Pick a date range and load every game for your connected Pro players. This covers all levels in each organization (MLB, AAA, AA, A, etc.) so you won't miss games if a player gets promoted or sent down.
        </p>
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
            {schedulesLoading ? 'Loading games...' : 'Load Game Schedules'}
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
            Loaded {proGames.length} games across all affiliate levels
          </p>
        )}
      </div>

      {/* Roster Moves Detection */}
      {proPlayers.length > 0 && Object.keys(playerTeamAssignments).length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-text">Player Movement Alerts</h2>
              {rosterMovesCheckedAt && (
                <span className="rounded px-2 py-0.5 text-[10px] font-medium bg-accent-green/10 text-accent-green">
                  checked {formatTimeAgo(new Date(rosterMovesCheckedAt).getTime())}
                </span>
              )}
            </div>
            <button
              onClick={checkRosterMoves}
              disabled={rosterMovesLoading}
              className="rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
            >
              {rosterMovesLoading ? 'Checking...' : 'Check for Roster Moves'}
            </button>
          </div>
          <p className="mb-3 text-xs text-text-dim">
            Checks if any of your Pro players have been promoted, demoted, or traded in the last 30 days.
          </p>

          {rosterMoves.length > 0 && (
            <div className="space-y-2">
              {rosterMoves.map((move, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-accent-orange/30 bg-accent-orange/5 px-3 py-2">
                  <span className="text-sm font-medium text-text">{move.player.fullName}</span>
                  <span className="text-xs text-text-dim">
                    {move.fromTeam?.name ?? '?'} → {move.toTeam?.name ?? '?'}
                  </span>
                  <span className="rounded bg-accent-orange/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-orange">
                    {move.typeDesc}
                  </span>
                  <span className="ml-auto text-[11px] text-text-dim">
                    {move.effectiveDate || move.date}
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-text-dim/70">
                These moves are detected from MLB transactions. Update the roster sheet to reflect permanent changes.
              </p>
            </div>
          )}

          {rosterMovesCheckedAt && rosterMoves.length === 0 && (
            <p className="text-sm text-accent-green">No roster moves detected in the last 30 days.</p>
          )}
        </div>
      )}

      {/* NCAA players section */}
      {ncaaPlayers.length > 0 && (
        <div className="rounded-xl border border-accent-green/30 bg-surface p-5">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-accent-green">College Players</h2>
              <span className="rounded-full bg-accent-green/15 px-2 py-0.5 text-[10px] font-medium text-accent-green">
                {ncaaPlayers.length} players
              </span>
              {ncaaFetchedAt && (
                <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                  Date.now() - ncaaFetchedAt > 24 * 60 * 60 * 1000
                    ? 'bg-accent-orange/10 text-accent-orange'
                    : 'bg-accent-green/10 text-accent-green'
                }`}>
                  loaded {formatTimeAgo(ncaaFetchedAt)}
                </span>
              )}
              {isNcaaSeason(new Date().toISOString().slice(0, 10)) && (
                <span className="rounded-full bg-accent-green/15 px-2 py-0.5 text-[10px] font-medium text-accent-green">
                  Season Active
                </span>
              )}
            </div>
            <button
              onClick={() => fetchNcaaSchedules(ncaaPlayers.map((p) => ({ playerName: p.playerName, org: p.org })))}
              disabled={ncaaLoading}
              className="rounded-lg bg-accent-green px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-green/80 disabled:opacity-50"
            >
              {ncaaLoading ? 'Loading...' : ncaaGames.length > 0 ? 'Refresh All' : 'Load All Schedules'}
            </button>
          </div>
          <p className="mb-3 text-xs text-text-dim">
            Your college players and their home stadiums. Load schedules from D1Baseball to get real game dates — or load a specific school below. Without real data, the trip planner uses estimated home game days.
          </p>

          {ncaaProgress && (
            <div className="mb-3">
              <div className="mb-1 text-xs text-text-dim">
                Loading schedules: {ncaaProgress.completed}/{ncaaProgress.total} schools
              </div>
              <div className="h-1.5 rounded-full bg-gray-800">
                <div
                  className="h-full rounded-full bg-accent-green transition-all"
                  style={{ width: `${(ncaaProgress.completed / ncaaProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {ncaaError && (
            <p className="mb-3 text-sm text-accent-red">{ncaaError}</p>
          )}

          {ncaaGames.length > 0 && (
            <p className="mb-3 text-sm text-accent-green">
              Loaded {ncaaGames.length} games ({ncaaGames.filter((g) => g.isHome).length} home, {ncaaGames.filter((g) => !g.isHome).length} away)
            </p>
          )}

          <div className="grid gap-1 sm:grid-cols-2">
            {ncaaPlayers.map((player) => {
              const canonical = resolveNcaaName(player.org, customNcaaAliases)
              const venue = canonical ? NCAA_VENUES[canonical] : null
              const hasRealSchedule = ncaaGames.some((g) => g.playerNames.includes(player.playerName))
              const slug = canonical ? D1_BASEBALL_SLUGS[canonical] : null
              return (
                <div key={player.playerName} className="flex items-center justify-between rounded-lg bg-gray-950/50 px-3 py-1.5 text-sm">
                  <span className="text-text">{player.playerName}</span>
                  <span className="flex items-center gap-1.5 text-xs text-text-dim">
                    {venue ? (
                      <>
                        <span className="text-accent-green">
                          {player.org} — {venue.venueName}
                        </span>
                        {hasRealSchedule && <span className="rounded bg-accent-blue/15 px-1 py-0.5 text-[10px] font-medium text-accent-blue">loaded</span>}
                        {!hasRealSchedule && !ncaaLoading && (
                          <button
                            onClick={() => fetchNcaaSchedules([{ playerName: player.playerName, org: player.org }])}
                            className="rounded bg-accent-green/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-green hover:bg-accent-green/25 transition-colors"
                          >
                            Load
                          </button>
                        )}
                        {slug && (
                          <a
                            href={`https://d1baseball.com/team/${slug}/schedule/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-text-dim hover:text-text transition-colors"
                            title="View on D1Baseball"
                          >
                            D1B ↗
                          </a>
                        )}
                      </>
                    ) : (
                      <span className="text-accent-orange">{player.org} — venue not mapped</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>

          {ncaaGames.length === 0 && (
            <div className="mt-3 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-2">
              <p className="text-[11px] text-accent-orange">
                Without real schedules loaded, college games are estimated based on typical home game days.
                Load real schedules above for actual dates including away games.
              </p>
            </div>
          )}
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
            Visit opportunities based on typical home game days (Tue/Thu).
            Players are generally at their school on weekdays.
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
              Note: High school schedules are estimated since we don't have exact game dates.
              Check the Map tab to verify that each school's location looks correct.
            </p>
          </div>
        </div>
      )}

      {/* All-source calendar */}
      <AllSourceCalendar
        proGames={proGames}
        ncaaGames={ncaaGames}
        players={players}
        venueState={venueState}
        sourceFilters={sourceFilters}
        setSourceFilters={setSourceFilters}
        customMlbAliases={customMlbAliases}
        customNcaaAliases={customNcaaAliases}
      />
    </div>
  )
}

function AllSourceCalendar({
  proGames, ncaaGames, players, venueState, sourceFilters, setSourceFilters,
  customMlbAliases, customNcaaAliases,
}: {
  proGames: GameEvent[]
  ncaaGames: GameEvent[]
  players: import('../../types/roster').RosterPlayer[]
  venueState: Record<string, { name: string; coords: Coordinates; source: string }>
  sourceFilters: Record<string, boolean>
  setSourceFilters: (f: Record<string, boolean>) => void
  customMlbAliases: Record<string, string>
  customNcaaAliases: Record<string, string>
}) {
  const combinedGames = useMemo(() => {
    const all: GameEvent[] = []

    // Pro regular season games
    if (sourceFilters.pro) {
      all.push(...proGames.filter((g) => g.awayTeam !== 'Spring Training'))
    }

    // Spring Training events (subset of Pro or synthetic)
    if (sourceFilters.st) {
      // ST games from proGames
      all.push(...proGames.filter((g) => g.awayTeam === 'Spring Training'))
      // Synthetic ST events
      const stEvents = generateSpringTrainingEvents(players, '2026-02-15', '2026-09-30', customMlbAliases)
      // Avoid duplicates with proGames by checking IDs
      const existingIds = new Set(all.map((g) => g.id))
      for (const e of stEvents) {
        if (!existingIds.has(e.id)) all.push(e)
      }
    }

    // NCAA games (real from D1Baseball + synthetic for uncovered players)
    if (sourceFilters.ncaa) {
      all.push(...ncaaGames)
      const ncaaPlayersWithReal = new Set(ncaaGames.flatMap((g) => g.playerNames))
      const syntheticNcaa = generateNcaaEvents(
        players.filter((p) => p.level === 'NCAA' && !ncaaPlayersWithReal.has(p.playerName)),
        '2026-02-14', '2026-06-15',
        customNcaaAliases,
      )
      all.push(...syntheticNcaa)
    }

    // HS events (synthetic)
    if (sourceFilters.hs) {
      const hsVenues = new Map<string, { name: string; coords: Coordinates }>()
      for (const [key, v] of Object.entries(venueState)) {
        if (v.source === 'hs-geocoded') {
          hsVenues.set(key.replace(/^hs-/, ''), { name: v.name, coords: v.coords })
        }
      }
      const hsEvents = generateHsEvents(players, '2026-02-14', '2026-05-15', hsVenues)
      all.push(...hsEvents)
    }

    all.sort((a, b) => a.date.localeCompare(b.date))
    return all
  }, [proGames, ncaaGames, players, venueState, sourceFilters, customMlbAliases, customNcaaAliases])

  const hasAnyGames = proGames.length > 0 || ncaaGames.length > 0 || players.some((p) => p.level === 'NCAA' || p.level === 'HS')

  if (!hasAnyGames) return null

  const toggleFilter = (key: string) => {
    setSourceFilters({ ...sourceFilters, [key]: !sourceFilters[key] })
  }

  return (
    <div>
      {/* Source filter toggles */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-text-dim">Show:</span>
        <button onClick={() => toggleFilter('pro')} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border ${sourceFilters.pro ? 'bg-accent-blue/20 text-accent-blue border-accent-blue/30' : 'bg-gray-800 text-text-dim/50 border-border/30'}`}>Pro</button>
        <button onClick={() => toggleFilter('st')} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border ${sourceFilters.st ? 'bg-pink-400/20 text-pink-400 border-pink-400/30' : 'bg-gray-800 text-text-dim/50 border-border/30'}`}>Spring Training</button>
        <button onClick={() => toggleFilter('ncaa')} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border ${sourceFilters.ncaa ? 'bg-accent-green/20 text-accent-green border-accent-green/30' : 'bg-gray-800 text-text-dim/50 border-border/30'}`}>NCAA</button>
        <button onClick={() => toggleFilter('hs')} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border ${sourceFilters.hs ? 'bg-accent-orange/20 text-accent-orange border-accent-orange/30' : 'bg-gray-800 text-text-dim/50 border-border/30'}`}>HS</button>
        <span className="text-[11px] text-text-dim/50">
          {combinedGames.length} events
        </span>
      </div>

      <ScheduleCalendar games={combinedGames} />
    </div>
  )
}
