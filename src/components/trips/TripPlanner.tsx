import { useTripStore } from '../../store/tripStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { isSpringTraining } from '../../data/springTraining'
import { isNcaaSeason, isHsSeason } from '../../lib/tripEngine'
import TripCard from './TripCard'

export default function TripPlanner() {
  const { startDate, endDate, tripPlan, computing, progressStep, progressDetail, setDateRange, generateTrips } = useTripStore()
  const proGames = useScheduleStore((s) => s.proGames)
  const players = useRosterStore((s) => s.players)

  // Allow generation when there's any visit data available:
  // - Fetched pro schedules, OR
  // - Spring training dates with Pro players, OR
  // - NCAA season dates with NCAA players, OR
  // - HS season dates with HS players
  const hasStDates = isSpringTraining(startDate) || isSpringTraining(endDate)
  const hasNcaaDates = isNcaaSeason(startDate) || isNcaaSeason(endDate)
  const hasHsDates = isHsSeason(startDate) || isHsSeason(endDate)
  const hasProPlayers = players.some((p) => p.level === 'Pro' && p.visitsRemaining > 0)
  const hasNcaaPlayers = players.some((p) => p.level === 'NCAA' && p.visitsRemaining > 0)
  const hasHsPlayers = players.some((p) => p.level === 'HS' && p.visitsRemaining > 0)

  const hasData = proGames.length > 0
    || (hasStDates && hasProPlayers)
    || (hasNcaaDates && hasNcaaPlayers)
    || (hasHsDates && hasHsPlayers)
  const canGenerate = hasData && players.length > 0 && !computing

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Trip Planner</h2>
        <p className="mb-4 text-xs text-text-dim">
          Generate optimized multi-day road trips anchored around Thursday games within 3hr driving radius of each venue.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-text-dim">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setDateRange(e.target.value, endDate)}
              className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dim">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setDateRange(startDate, e.target.value)}
              className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
            />
          </div>
          <button
            onClick={generateTrips}
            disabled={!canGenerate}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
          >
            {computing ? 'Computing...' : 'Generate Trips'}
          </button>
        </div>

        {!canGenerate && !computing && (
          <p className="mt-3 text-xs text-accent-orange">
            {players.length === 0
              ? 'Load the roster first.'
              : 'No visit data for the selected date range. Adjust dates to overlap a season (ST: Feb 15–Mar 28, NCAA: Feb 14–Jun 15, HS: Feb 14–May 15) or fetch Pro schedules in the Schedule tab.'}
          </p>
        )}

        {canGenerate && proGames.length === 0 && (
          <p className="mt-3 text-xs text-accent-green">
            {[
              hasStDates && hasProPlayers ? 'Spring training (Pro)' : '',
              hasNcaaDates && hasNcaaPlayers ? 'NCAA season' : '',
              hasHsDates && hasHsPlayers ? 'HS season' : '',
            ].filter(Boolean).join(', ')} data available — trips can be generated now.
            {hasProPlayers && ' For exact Pro regular season schedules, also fetch schedules in the Schedule tab.'}
          </p>
        )}

        {computing && (
          <div className="mt-4 rounded-lg border border-border/50 bg-gray-950 p-3">
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
              <span className="text-sm font-medium text-text">{progressStep}</span>
            </div>
            {progressDetail && <p className="mt-1 text-xs text-text-dim">{progressDetail}</p>}
          </div>
        )}
      </div>

      {/* Results */}
      {tripPlan && (
        <>
          {/* Coverage stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Trips Planned" value={tripPlan.trips.length} />
            <StatCard label="Players Covered" value={tripPlan.totalPlayersWithVisits} />
            <StatCard label="Coverage" value={`${tripPlan.coveragePercent}%`} accent={tripPlan.coveragePercent >= 70 ? 'green' : 'orange'} />
            <StatCard label="Unreachable" value={tripPlan.unvisitablePlayers.length} accent={tripPlan.unvisitablePlayers.length > 0 ? 'red' : 'green'} />
          </div>

          {/* Trip cards */}
          <div className="space-y-4">
            {tripPlan.trips.map((trip, i) => (
              <TripCard key={`trip-${i}`} trip={trip} index={i + 1} />
            ))}
          </div>

          {/* Unreachable players */}
          {tripPlan.unvisitablePlayers.length > 0 && (
            <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-5">
              <h3 className="mb-2 text-sm font-semibold text-accent-red">
                Unreachable Players ({tripPlan.unvisitablePlayers.length})
              </h3>
              <p className="mb-3 text-xs text-text-dim">
                These players have no games within the 3hr driving radius during the selected window.
              </p>
              <div className="flex flex-wrap gap-2">
                {tripPlan.unvisitablePlayers.map((name) => (
                  <span key={name} className="rounded-full bg-accent-red/10 px-3 py-1 text-xs text-accent-red">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {tripPlan.trips.length === 0 && (
            <div className="rounded-xl border border-border bg-surface p-10 text-center">
              <p className="text-text-dim">No trips could be generated for the selected date range.</p>
              <p className="mt-1 text-xs text-text-dim/60">Try expanding the date range or assigning more players.</p>
            </div>
          )}
        </>
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
