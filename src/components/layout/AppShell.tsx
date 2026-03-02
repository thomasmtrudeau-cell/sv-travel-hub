import { useState, type ReactNode } from 'react'

export type TabId = 'roster' | 'schedule' | 'trips' | 'map'

const TABS: { id: TabId; label: string; heading: string; description: string }[] = [
  {
    id: 'roster',
    label: 'Roster',
    heading: 'Client Roster',
    description: 'Your full list of players to visit this year. This pulls from the Google Sheet and shows each player\'s tier, visit targets, and progress.',
  },
  {
    id: 'schedule',
    label: 'Data Setup',
    heading: 'Data Setup',
    description: 'Connect each player to their current team so we can look up where and when they play. Once connected, the app pulls their game schedules automatically.',
  },
  {
    id: 'trips',
    label: 'Trip Planner',
    heading: 'Trip Planner',
    description: 'Pick a date range and the app builds optimized road trips from Orlando, grouping nearby players together. You can also export trips to your calendar.',
  },
  {
    id: 'map',
    label: 'Map',
    heading: 'Venue Map',
    description: 'See all player venues on a map with drive-time context from Orlando. Click "Map" on any trip card to highlight that trip\'s route.',
  },
]

interface AppShellProps {
  children: Record<TabId, ReactNode>
}

export default function AppShell({ children }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<TabId>('roster')
  const currentTab = TABS.find((t) => t.id === activeTab)!

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">SV Travel Hub</h1>
          <p className="text-xs text-text-dim">Road trip planner for client visits</p>
        </div>
      </header>

      <nav className="mb-6 flex gap-1 rounded-xl border border-border bg-surface p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-accent-blue/20 text-accent-blue'
                : 'text-text-dim hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab header */}
      <div className="mb-6 rounded-xl border border-border/50 bg-surface/50 px-5 py-4">
        <h2 className="text-base font-semibold text-text">{currentTab.heading}</h2>
        <p className="mt-1 text-sm text-text-dim">{currentTab.description}</p>
      </div>

      <main>{children[activeTab]}</main>
    </div>
  )
}
