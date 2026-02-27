import { useMemo } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { isSpringTraining } from '../../data/springTraining'
import { isNcaaSeason, isHsSeason } from '../../lib/tripEngine'
import TripCard from './TripCard'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function getDayName(dateStr: string): string {
  return DAY_NAMES[new Date(dateStr + 'T12:00:00Z').getUTCDay()]!
}

function getDaysInRange(start: string, end: string): string[] {
  const days: string[] = []
  const cur = new Date(start + 'T12:00:00Z')
  const last = new Date(end + 'T12:00:00Z')
  while (cur <= last) {
    days.push(DAY_NAMES[cur.getUTCDay()]!)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return days
}

export default function TripPlanner() {
  const startDate = useTripStore((s) => s.startDate)
  const endDate = useTripStore((s) => s.endDate)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const priorityPlayers = useTripStore((s) => s.priorityPlayers)
  const tripPlan = useTripStore((s) => s.tripPlan)
  const computing = useTripStore((s) => s.computing)
  const progressStep = useTripStore((s) => s.progressStep)
  const progressDetail = useTripStore((s) => s.progressDetail)
  const setDateRange = useTripStore((s) => s.setDateRange)
  const setMaxDriveMinutes = useTripStore((s) => s.setMaxDriveMinutes)
  const setPriorityPlayers = useTripStore((s) => s.setPriorityPlayers)
  const generateTrips = useTripStore((s) => s.generateTrips)
  const proGames = useScheduleStore((s) => s.proGames)
  const players = useRosterStore((s) => s.players)

  // Players eligible for priority selection (have visits remaining)
  const eligibleForPriority = useMemo(
    () => players.filter((p) => p.visitsRemaining > 0).sort((a, b) => a.playerName.localeCompare(b.playerName)),
    [players],
  )

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

  function handlePriorityChange(slot: 0 | 1, value: string) {
    const next = [...priorityPlayers]
    if (value === '') {
      next.splice(slot, 1)
    } else {
      next[slot] = value
    }
    // Remove duplicates and empty slots
    setPriorityPlayers([...new Set(next.filter(Boolean))])
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Trip Planner</h2>
        <p className="mb-4 text-xs text-text-dim">
          Generate optimized road trips within driving radius. Thursdays are preferred anchor days, Sundays are blacked out.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-text-dim">Start Date</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setDateRange(e.target.value, endDate)}
                className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
              />
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs font-medium text-text-dim">
                {getDayName(startDate)}
              </span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dim">End Date</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setDateRange(startDate, e.target.value)}
                className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
              />
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs font-medium text-text-dim">
                {getDayName(endDate)}
              </span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dim">
              Max Drive: {Math.floor(maxDriveMinutes / 60)}h{maxDriveMinutes % 60 > 0 ? ` ${maxDriveMinutes % 60}m` : ''}
            </label>
            <input
              type="range"
              min={120}
              max={300}
              step={15}
              value={maxDriveMinutes}
              onChange={(e) => setMaxDriveMinutes(parseInt(e.target.value))}
              className="h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-gray-700 accent-accent-blue"
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

        {/* Day-of-week strip */}
        <DayStrip startDate={startDate} endDate={endDate} />

        {/* Priority players */}
        <div className="mt-4 rounded-lg border border-border/50 bg-gray-950/50 p-3">
          <label className="mb-2 block text-xs font-medium text-text-dim">
            Priority Players <span className="text-text-dim/50">(optional — build first trip around these players)</span>
          </label>
          <div className="flex flex-wrap gap-3">
            {[0, 1].map((slot) => (
              <select
                key={slot}
                value={priorityPlayers[slot] ?? ''}
                onChange={(e) => handlePriorityChange(slot as 0 | 1, e.target.value)}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:border-accent-blue focus:outline-none"
              >
                <option value="">{slot === 0 ? 'Select player 1...' : 'Select player 2...'}</option>
                {eligibleForPriority
                  .filter((p) => p.playerName !== priorityPlayers[slot === 0 ? 1 : 0])
                  .map((p) => (
                    <option key={p.playerName} value={p.playerName}>
                      {p.playerName} ({p.level} — {p.org})
                    </option>
                  ))}
              </select>
            ))}
            {priorityPlayers.length > 0 && (
              <button
                onClick={() => setPriorityPlayers([])}
                className="rounded-lg px-2 py-1 text-xs text-text-dim hover:text-text"
              >
                Clear
              </button>
            )}
          </div>
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
          {/* Priority player results */}
          {tripPlan.priorityResults && tripPlan.priorityResults.length > 0 && (
            <div className="rounded-xl border border-accent-blue/30 bg-accent-blue/5 p-4">
              <h3 className="mb-2 text-sm font-semibold text-accent-blue">Priority Player Results</h3>
              <div className="space-y-1.5">
                {tripPlan.priorityResults.map((r) => (
                  <div key={r.playerName} className="flex items-center gap-2 text-sm">
                    <span className={`h-2 w-2 rounded-full ${
                      r.status === 'included' ? 'bg-accent-green' :
                      r.status === 'separate-trip' ? 'bg-accent-orange' :
                      'bg-accent-red'
                    }`} />
                    <span className="font-medium text-text">{r.playerName}</span>
                    <span className="text-xs text-text-dim">
                      {r.status === 'included' && 'Included in Trip #1'}
                      {r.status === 'separate-trip' && 'Separate trip created'}
                      {r.status === 'unreachable' && 'Could not be reached'}
                    </span>
                    {r.reason && (
                      <span className="text-[11px] text-accent-orange">— {r.reason}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Coverage stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Road Trips" value={tripPlan.trips.length} />
            <StatCard label="Players Reachable" value={tripPlan.totalPlayersWithVisits} />
            <StatCard label="Player Coverage" value={`${tripPlan.coveragePercent}%`} accent={tripPlan.coveragePercent >= 70 ? 'green' : 'orange'} />
            <StatCard label="Not Reachable" value={tripPlan.unvisitablePlayers.length} accent={tripPlan.unvisitablePlayers.length > 0 ? 'red' : 'green'} />
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
                These players have no games within the {Math.floor(maxDriveMinutes / 60)}h{maxDriveMinutes % 60 > 0 ? ` ${maxDriveMinutes % 60}m` : ''} driving radius during the selected window.
                Try increasing the drive radius slider above.
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

function DayStrip({ startDate, endDate }: { startDate: string; endDate: string }) {
  const daysInRange = getDaysInRange(startDate, endDate)
  const dayCount = daysInRange.length

  if (dayCount < 1 || dayCount > 14) return null

  // Count occurrences of each day
  const dayCounts = new Map<string, number>()
  for (const d of daysInRange) {
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1)
  }

  const hasSunday = dayCounts.has('Sun')
  const hasThursday = dayCounts.has('Thu')

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="flex items-center gap-1">
        {DAY_NAMES.map((day) => {
          const inRange = dayCounts.has(day)
          const isSunday = day === 'Sun'
          const isThursday = day === 'Thu'

          return (
            <span
              key={day}
              className={`flex h-7 w-8 items-center justify-center rounded text-[11px] font-medium ${
                !inRange
                  ? 'text-text-dim/20'
                  : isSunday
                    ? 'bg-accent-red/15 text-accent-red line-through'
                    : isThursday
                      ? 'bg-accent-blue/15 text-accent-blue'
                      : 'bg-gray-800 text-text-dim'
              }`}
            >
              {day}
            </span>
          )
        })}
      </div>
      <span className="text-[11px] text-text-dim/60">
        {dayCount} day{dayCount !== 1 ? 's' : ''}
        {hasThursday && ' · Thu preferred'}
        {hasSunday && ' · Sun blacked out'}
      </span>
    </div>
  )
}
