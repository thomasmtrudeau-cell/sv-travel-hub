import { useEffect, useRef, useState } from 'react'
import { useVenueStore } from '../../store/venueStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useTripStore } from '../../store/tripStore'
import { HOME_BASE } from '../../lib/tripEngine'

export default function MapView() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<import('leaflet').Map | null>(null)
  const leafletRef = useRef<typeof import('leaflet') | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showPro, setShowPro] = useState(true)
  const [showNcaa, setShowNcaa] = useState(true)
  const [showHs, setShowHs] = useState(true)
  const [showTrips, setShowTrips] = useState(true)

  const venues = useVenueStore((s) => s.venues)
  const proGames = useScheduleStore((s) => s.proGames)
  const tripPlan = useTripStore((s) => s.tripPlan)
  const loadNcaaVenues = useVenueStore((s) => s.loadNcaaVenues)
  const addProVenue = useVenueStore((s) => s.addProVenue)

  // Load NCAA venues once
  const ncaaLoaded = useRef(false)
  useEffect(() => {
    if (ncaaLoaded.current) return
    ncaaLoaded.current = true
    loadNcaaVenues()
  }, [loadNcaaVenues])

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
      const isNcaa = venue.source === 'ncaa-hardcoded'
      const isHs = venue.source === 'hs-geocoded'

      if (isPro && !showPro) continue
      if (isNcaa && !showNcaa) continue
      if (isHs && !showHs) continue

      const color = isPro ? '#60a5fa' : isNcaa ? '#34d399' : '#fb923c'

      const icon = L.divIcon({
        html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid ${color}44;"></div>`,
        className: '',
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      })

      L.marker([venue.coords.lat, venue.coords.lng], { icon })
        .bindPopup(`<b>${venue.name}</b><br><small>${key}</small>`)
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
  }, [venues, tripPlan, showPro, showNcaa, showHs, showTrips, loaded])

  return (
    <div className="space-y-4">
      {/* Layer toggles */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-surface p-3">
        <Toggle label="Pro Venues" color="bg-accent-blue" checked={showPro} onChange={setShowPro} />
        <Toggle label="NCAA Venues" color="bg-accent-green" checked={showNcaa} onChange={setShowNcaa} />
        <Toggle label="HS Venues" color="bg-accent-orange" checked={showHs} onChange={setShowHs} />
        <Toggle label="Trip Routes" color="bg-accent-purple" checked={showTrips} onChange={setShowTrips} />
      </div>

      {/* Map container */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div ref={mapRef} className="h-[600px] w-full bg-gray-900" />
      </div>

      {/* Venue count */}
      <p className="text-xs text-text-dim">
        {Object.keys(venues).length} venues loaded
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
