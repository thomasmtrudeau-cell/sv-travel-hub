import { useEffect, useMemo, useRef, useState } from 'react'
import { useVenueStore } from '../../store/venueStore'
import { useRosterStore } from '../../store/rosterStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useTripStore } from '../../store/tripStore'
import { HOME_BASE } from '../../lib/tripEngine'
import { resolveMLBTeamId, resolveNcaaName } from '../../data/aliases'
import { isSpringTraining } from '../../data/springTraining'

// Build a mapping from venue key → player names at that venue
function useVenuePlayerMap() {
  const players = useRosterStore((s) => s.players)
  const proGames = useScheduleStore((s) => s.proGames)

  return useMemo(() => {
    const map = new Map<string, Array<{ name: string; tier: number; level: string }>>()

    function add(key: string, name: string, tier: number, level: string) {
      const existing = map.get(key)
      const entry = { name, tier, level }
      if (existing) {
        if (!existing.some((e) => e.name === name)) existing.push(entry)
      } else {
        map.set(key, [entry])
      }
    }

    // ST venues: key = "st-{teamId}" → Pro players via parent org
    for (const p of players) {
      if (p.level !== 'Pro') continue
      const orgId = resolveMLBTeamId(p.org)
      if (!orgId) continue
      add(`st-${orgId}`, p.playerName, p.tier, 'Pro')
    }

    // NCAA venues: key = "ncaa-{school lowercase}" → NCAA players via canonical name
    for (const p of players) {
      if (p.level !== 'NCAA') continue
      const canonical = resolveNcaaName(p.org)
      if (!canonical) continue
      add(`ncaa-${canonical.toLowerCase()}`, p.playerName, p.tier, 'NCAA')
    }

    // HS venues: key = "hs-{school|state}" → HS players by org+state
    for (const p of players) {
      if (p.level !== 'HS') continue
      const key = `hs-${p.org.toLowerCase().trim()}|${p.state.toLowerCase().trim()}`
      add(key, p.playerName, p.tier, 'HS')
    }

    // Pro venues from schedule: key = "pro-{venue-name}" → players from game data
    const proVenuePlayers = new Map<string, Set<string>>()
    for (const game of proGames) {
      const key = `pro-${game.venue.name.toLowerCase().replace(/\s+/g, '-')}`
      const existing = proVenuePlayers.get(key)
      if (existing) {
        for (const name of game.playerNames) existing.add(name)
      } else {
        proVenuePlayers.set(key, new Set(game.playerNames))
      }
    }
    for (const [key, names] of proVenuePlayers) {
      for (const name of names) {
        const player = players.find((p) => p.playerName === name)
        add(key, name, player?.tier ?? 4, 'Pro')
      }
    }

    return map
  }, [players, proGames])
}

function buildPopupHtml(
  venueName: string,
  source: string,
  playerList: Array<{ name: string; tier: number; level: string }> | undefined,
): string {
  const tierColors: Record<number, string> = {
    1: '#ef4444', 2: '#f97316', 3: '#eab308', 4: '#6b7280',
  }
  let html = `<div style="font-family:system-ui;min-width:160px">`
  html += `<div style="font-weight:600;font-size:13px;margin-bottom:4px">${venueName}</div>`
  html += `<div style="font-size:10px;color:#888;margin-bottom:6px">${source}</div>`

  if (playerList && playerList.length > 0) {
    const sorted = [...playerList].sort((a, b) => a.tier - b.tier)
    for (const p of sorted) {
      const color = tierColors[p.tier] ?? '#6b7280'
      html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;font-size:12px">`
      html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0" title="Tier ${p.tier}"></span>`
      html += `<span>${p.name}</span>`
      html += `<span style="color:#888;font-size:10px;margin-left:auto">T${p.tier}</span>`
      html += `</div>`
    }
  } else {
    html += `<div style="font-size:11px;color:#666">No players mapped</div>`
  }

  html += `</div>`
  return html
}

export default function MapView() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<import('leaflet').Map | null>(null)
  const leafletRef = useRef<typeof import('leaflet') | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showPro, setShowPro] = useState(true)
  const [showSt, setShowSt] = useState(true)
  const [showNcaa, setShowNcaa] = useState(true)
  const [showHs, setShowHs] = useState(true)
  const [showTrips, setShowTrips] = useState(true)

  const venues = useVenueStore((s) => s.venues)
  const hsGeocodingProgress = useVenueStore((s) => s.hsGeocodingProgress)
  const hsGeocodingError = useVenueStore((s) => s.hsGeocodingError)
  const proGames = useScheduleStore((s) => s.proGames)
  const tripPlan = useTripStore((s) => s.tripPlan)
  const players = useRosterStore((s) => s.players)
  const loadNcaaVenues = useVenueStore((s) => s.loadNcaaVenues)
  const loadSpringTrainingVenues = useVenueStore((s) => s.loadSpringTrainingVenues)
  const addProVenue = useVenueStore((s) => s.addProVenue)
  const geocodeHsVenues = useVenueStore((s) => s.geocodeHsVenues)

  const venuePlayerMap = useVenuePlayerMap()

  // Venue counts by type
  const venueCounts = useMemo(() => {
    const counts = { pro: 0, st: 0, ncaa: 0, hs: 0 }
    for (const v of Object.values(venues)) {
      if (v.source === 'mlb-api') counts.pro++
      else if (v.source === 'spring-training') counts.st++
      else if (v.source === 'ncaa-hardcoded') counts.ncaa++
      else if (v.source === 'hs-geocoded') counts.hs++
    }
    return counts
  }, [venues])

  const isStActive = isSpringTraining(new Date().toISOString().slice(0, 10))
  const hasProPlayers = players.some((p) => p.level === 'Pro')
  const hasHsPlayers = players.some((p) => p.level === 'HS')

  // Load NCAA + Spring Training venues once
  const venuesLoaded = useRef(false)
  useEffect(() => {
    if (venuesLoaded.current) return
    venuesLoaded.current = true
    loadNcaaVenues()
    loadSpringTrainingVenues()
  }, [loadNcaaVenues, loadSpringTrainingVenues])

  // Geocode HS venues once when players are available
  const hsGeocodeStarted = useRef(false)
  useEffect(() => {
    if (hsGeocodeStarted.current) return
    const hsPlayers = players.filter((p) => p.level === 'HS')
    if (hsPlayers.length === 0) return
    hsGeocodeStarted.current = true
    const schools = hsPlayers.map((p) => ({
      schoolName: p.org,
      city: '',
      state: p.state,
    }))
    geocodeHsVenues(schools)
  }, [players, geocodeHsVenues])

  // Add pro venues from schedule data
  const lastProGamesLen = useRef(0)
  useEffect(() => {
    if (proGames.length === lastProGamesLen.current) return
    lastProGamesLen.current = proGames.length
    for (const game of proGames) {
      const key = `pro-${game.venue.name.toLowerCase().replace(/\s+/g, '-')}`
      addProVenue(key, game.venue.name, game.venue.coords)
    }
  }, [proGames, addProVenue])

  // Initialize Leaflet
  const mapInitialized = useRef(false)
  useEffect(() => {
    if (mapInitialized.current) return
    mapInitialized.current = true

    let cancelled = false

    async function init() {
      const L = await import('leaflet')
      leafletRef.current = L

      // Add CSS
      if (!document.querySelector('link[href*="leaflet"]')) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        document.head.appendChild(link)
      }

      if (cancelled || !mapRef.current) return

      const map = L.map(mapRef.current).setView([HOME_BASE.lat, HOME_BASE.lng], 6)

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19,
      }).addTo(map)

      mapInstance.current = map
      setLoaded(true)
    }

    init()
    return () => { cancelled = true }
  }, [])

  // Update markers when data/filters change
  useEffect(() => {
    const L = leafletRef.current
    if (!mapInstance.current || !L || !loaded) return

    const map = mapInstance.current

    // Clear existing markers
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline || layer instanceof L.Circle) {
        map.removeLayer(layer)
      }
    })

    // Home base star
    const homeIcon = L.divIcon({
      html: '<div style="font-size:20px;text-align:center;line-height:1">&#9733;</div>',
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    })
    L.marker([HOME_BASE.lat, HOME_BASE.lng], { icon: homeIcon })
      .bindPopup('Orlando, FL (Home Base)')
      .addTo(map)

    // Venue markers
    for (const [key, venue] of Object.entries(venues)) {
      const isPro = venue.source === 'mlb-api'
      const isSt = venue.source === 'spring-training'
      const isNcaa = venue.source === 'ncaa-hardcoded'
      const isHs = venue.source === 'hs-geocoded'

      if (isPro && !showPro) continue
      if (isSt && !showSt) continue
      if (isNcaa && !showNcaa) continue
      if (isHs && !showHs) continue

      const color = isPro ? '#60a5fa' : isSt ? '#f472b6' : isNcaa ? '#34d399' : '#fb923c'
      const size = isSt ? 12 : 10

      const icon = L.divIcon({
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid ${color}44;cursor:pointer"></div>`,
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      })

      const sourceLabel = isPro ? 'Pro Venue (from schedule)' : isSt ? 'Spring Training Site' : isNcaa ? 'NCAA Venue' : 'HS Venue (geocoded)'
      const playerList = venuePlayerMap.get(key)
      const popup = buildPopupHtml(venue.name, sourceLabel, playerList)

      L.marker([venue.coords.lat, venue.coords.lng], { icon })
        .bindPopup(popup, { maxWidth: 280 })
        .addTo(map)
    }

    // Trip routes
    if (showTrips && tripPlan) {
      for (const trip of tripPlan.trips) {
        const points: [number, number][] = [
          [HOME_BASE.lat, HOME_BASE.lng],
          [trip.anchorGame.venue.coords.lat, trip.anchorGame.venue.coords.lng],
        ]

        for (const game of trip.nearbyGames) {
          points.push([game.venue.coords.lat, game.venue.coords.lng])
        }

        points.push([HOME_BASE.lat, HOME_BASE.lng])

        L.polyline(points, {
          color: '#a78bfa',
          weight: 2,
          opacity: 0.7,
          dashArray: '8 4',
        }).addTo(map)

        // 3hr radius circle around anchor
        L.circle([trip.anchorGame.venue.coords.lat, trip.anchorGame.venue.coords.lng], {
          radius: 240000,
          color: '#a78bfa',
          weight: 1,
          opacity: 0.3,
          fillOpacity: 0.05,
        }).addTo(map)
      }
    }
  }, [venues, venuePlayerMap, tripPlan, showPro, showSt, showNcaa, showHs, showTrips, loaded])

  return (
    <div className="space-y-4">
      {/* Layer toggles */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-surface p-3">
        <Toggle label={`Pro Venues (${venueCounts.pro})`} color="bg-accent-blue" checked={showPro} onChange={setShowPro} />
        <Toggle label={`Spring Training (${venueCounts.st})`} color="bg-pink-500" checked={showSt} onChange={setShowSt} />
        <Toggle label={`NCAA Venues (${venueCounts.ncaa})`} color="bg-accent-green" checked={showNcaa} onChange={setShowNcaa} />
        <Toggle label={`HS Venues (${venueCounts.hs})`} color="bg-accent-orange" checked={showHs} onChange={setShowHs} />
        <Toggle label="Trip Routes" color="bg-accent-purple" checked={showTrips} onChange={setShowTrips} />
      </div>

      {/* Status messages */}
      <div className="flex flex-wrap gap-2">
        {hasProPlayers && venueCounts.pro === 0 && (
          <div className="rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-3 py-1.5 text-[11px] text-accent-blue">
            {isStActive
              ? 'Pro players are at Spring Training sites (pink dots). Fetch schedules on the Schedule tab for regular season venues.'
              : 'Fetch Pro schedules on the Schedule tab to see regular season venues on the map.'}
          </div>
        )}
        {hasHsPlayers && venueCounts.hs === 0 && !hsGeocodingProgress && (
          <div className="rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-1.5 text-[11px] text-accent-orange">
            {hsGeocodingError
              ? `HS geocoding failed: ${hsGeocodingError}. Try refreshing.`
              : 'HS venues are geocoded from school names. Load roster first, then revisit this tab.'}
          </div>
        )}
      </div>

      {/* Map container */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div ref={mapRef} className="h-[600px] w-full bg-gray-900" />
      </div>

      {/* Geocoding progress */}
      {hsGeocodingProgress && (
        <div className="flex items-center gap-2 text-xs text-text-dim">
          <span className="h-3 w-3 animate-spin rounded-full border border-text-dim border-t-transparent" />
          Geocoding HS venues: {hsGeocodingProgress.completed}/{hsGeocodingProgress.total}
        </div>
      )}

      {/* Venue summary */}
      <p className="text-xs text-text-dim">
        {Object.keys(venues).length} venues loaded — click any marker to see players at that venue
      </p>
    </div>
  )
}

function Toggle({ label, color, checked, onChange }: { label: string; color: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-text-dim">
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div className={`h-4 w-8 rounded-full transition-colors ${checked ? color : 'bg-gray-700'}`} />
        <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${checked ? 'left-4.5' : 'left-0.5'}`} />
      </div>
      {label}
    </label>
  )
}
