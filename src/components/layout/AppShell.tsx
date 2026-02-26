import { useState, type ReactNode } from 'react'

export type TabId = 'roster' | 'schedule' | 'trips' | 'map'

const TABS: { id: TabId; label: string }[] = [
  { id: 'roster', label: 'Roster' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'trips', label: 'Trips' },
  { id: 'map', label: 'Map' },
]

interface AppShellProps {
  children: Record<TabId, ReactNode>
}

export default function AppShell({ children }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<TabId>('roster')

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

      <main>{children[activeTab]}</main>
    </div>
  )
}
