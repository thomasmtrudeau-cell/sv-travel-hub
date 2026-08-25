import { type ReactNode } from 'react'
import { useTripStore } from '../../store/tripStore'
import { formatDate } from '../../lib/formatters'

// The map toolbar is now a Filters button + a passive readout (Tom
// 2026-08-18, from the Maptive flow: "the first move for the user is to go
// to the filters" — every control, dates and origin included, lives inside
// the Filters popover). This bar just says what's currently applied so a
// narrowed map is never a mystery with the popover closed.
interface DateRangeBarProps {
  filterStart: string
  filterEnd: string
  /** Leading slot — MapView injects the Filters popover and help button. */
  children?: ReactNode
}

export default function DateRangeBar({ filterStart, filterEnd, children }: DateRangeBarProps) {
  const homeBase = useTripStore((s) => s.homeBase)
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const radiusEnabled = useTripStore((s) => s.radiusEnabled)

  const hours = Math.floor(maxDriveMinutes / 60)
  const mins = maxDriveMinutes % 60
  const radiusLabel = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface border border-border/50 px-3 py-2">
      {children}

      {/* Current-state readout — filters are the source, this just reports */}
      <span className="text-xs text-text">
        {formatDate(filterStart)} to {formatDate(filterEnd)}
      </span>
      <span className="text-text-dim/20">|</span>
      {homeBase ? (
        <span className="text-xs text-text" title="Trip origin — the star on the map. Distances and the drive radius read from here.">
          from <span className="font-medium">{homeBaseName}</span>
          <span className="text-text-dim"> · {radiusEnabled ? `${radiusLabel} radius` : 'radius off'}</span>
        </span>
      ) : (
        <span className="text-xs text-text-dim/60" title="No trip origin yet, so the map shows every game. Pick an origin in Filters to get the star, drive radius, and distances.">
          no trip origin yet: set one in Filters for distances
        </span>
      )}

      <span className="ml-auto text-[11px] text-text-dim/50 whitespace-nowrap" title="Date range, drive radius, and trip origin are shared between Map and Trip Planner. Change in either, both update.">
        synced w/ Trip Planner
      </span>
    </div>
  )
}
