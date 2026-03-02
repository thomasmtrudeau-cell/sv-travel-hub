import type { TripCandidate } from '../types/schedule'
import type { RosterPlayer } from '../types/roster'

function formatIcsDate(dateStr: string, timeStr?: string): string {
  // Format: YYYYMMDD or YYYYMMDDTHHMMSSZ
  if (timeStr) {
    const d = new Date(timeStr)
    if (!isNaN(d.getTime())) {
      return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    }
  }
  return dateStr.replace(/-/g, '')
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export function generateTripIcs(
  trip: TripCandidate,
  index: number,
  playerMap: Map<string, RosterPlayer>,
): string {
  const startDate = trip.suggestedDays[0]!
  const endDate = trip.suggestedDays[trip.suggestedDays.length - 1]!
  const dayCount = trip.suggestedDays.length

  // Collect all unique players
  const allPlayerNames = new Set<string>()
  for (const name of trip.anchorGame.playerNames) allPlayerNames.add(name)
  for (const g of trip.nearbyGames) {
    for (const name of g.playerNames) allPlayerNames.add(name)
  }

  const playerList = [...allPlayerNames].map((name) => {
    const p = playerMap.get(name)
    return p ? `${name} (T${p.tier})` : name
  }).join(', ')

  const venueName = trip.anchorGame.venue.name
  const driveH = Math.floor(trip.driveFromHomeMinutes / 60)
  const driveM = trip.driveFromHomeMinutes % 60
  const driveStr = driveM > 0 ? `${driveH}h ${driveM}m` : `${driveH}h`

  const description = [
    `Trip #${index} — ${dayCount} day${dayCount !== 1 ? 's' : ''}`,
    `Drive from Orlando: ~${driveStr}`,
    `Players: ${playerList}`,
    trip.scoreBreakdown ? `Score: ${trip.scoreBreakdown.finalScore} pts` : '',
  ].filter(Boolean).join('\\n')

  // Use all-day events spanning the trip window
  // End date for DTEND;VALUE=DATE is exclusive, so add 1 day
  const endExclusive = new Date(endDate + 'T12:00:00Z')
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
  const endExclusiveStr = endExclusive.toISOString().split('T')[0]!.replace(/-/g, '')

  const uid = `sv-trip-${index}-${startDate}-${trip.anchorGame.venue.coords.lat.toFixed(4)}@sv-travel-hub`

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SV Travel Hub//Trip Export//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${formatIcsDate(startDate)}`,
    `DTEND;VALUE=DATE:${endExclusiveStr}`,
    `SUMMARY:${escapeIcs(`Trip #${index}: ${venueName}`)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `LOCATION:${escapeIcs(venueName)}`,
    `GEO:${trip.anchorGame.venue.coords.lat};${trip.anchorGame.venue.coords.lng}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return lines.join('\r\n')
}

export function generateAllTripsIcs(
  trips: TripCandidate[],
  playerMap: Map<string, RosterPlayer>,
): string {
  const events: string[] = []

  for (let i = 0; i < trips.length; i++) {
    const trip = trips[i]!
    const startDate = trip.suggestedDays[0]!
    const endDate = trip.suggestedDays[trip.suggestedDays.length - 1]!
    const dayCount = trip.suggestedDays.length

    const allPlayerNames = new Set<string>()
    for (const name of trip.anchorGame.playerNames) allPlayerNames.add(name)
    for (const g of trip.nearbyGames) {
      for (const name of g.playerNames) allPlayerNames.add(name)
    }

    const playerList = [...allPlayerNames].map((name) => {
      const p = playerMap.get(name)
      return p ? `${name} (T${p.tier})` : name
    }).join(', ')

    const venueName = trip.anchorGame.venue.name
    const driveH = Math.floor(trip.driveFromHomeMinutes / 60)
    const driveM = trip.driveFromHomeMinutes % 60
    const driveStr = driveM > 0 ? `${driveH}h ${driveM}m` : `${driveH}h`

    const description = [
      `Trip #${i + 1} — ${dayCount} day${dayCount !== 1 ? 's' : ''}`,
      `Drive from Orlando: ~${driveStr}`,
      `Players: ${playerList}`,
      trip.scoreBreakdown ? `Score: ${trip.scoreBreakdown.finalScore} pts` : '',
    ].filter(Boolean).join('\\n')

    const endExclusive = new Date(endDate + 'T12:00:00Z')
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
    const endExclusiveStr = endExclusive.toISOString().split('T')[0]!.replace(/-/g, '')

    const uid = `sv-trip-${i + 1}-${startDate}-${trip.anchorGame.venue.coords.lat.toFixed(4)}@sv-travel-hub`

    events.push([
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART;VALUE=DATE:${formatIcsDate(startDate)}`,
      `DTEND;VALUE=DATE:${endExclusiveStr}`,
      `SUMMARY:${escapeIcs(`Trip #${i + 1}: ${venueName}`)}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      `LOCATION:${escapeIcs(venueName)}`,
      `GEO:${trip.anchorGame.venue.coords.lat};${trip.anchorGame.venue.coords.lng}`,
      'END:VEVENT',
    ].join('\r\n'))
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SV Travel Hub//Trip Export//EN',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n')
}

export function downloadIcs(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
