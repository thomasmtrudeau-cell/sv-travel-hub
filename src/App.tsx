import { Component, type ReactNode } from 'react'
import AppShell from './components/layout/AppShell'
import RosterDashboard from './components/roster/RosterDashboard'
import ScheduleView from './components/schedule/ScheduleView'
import TripPlanner from './components/trips/TripPlanner'
import MapView from './components/map/MapView'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-2xl p-10">
          <h1 className="text-xl font-bold text-accent-red">Something went wrong</h1>
          <pre className="mt-4 overflow-auto rounded-lg bg-surface p-4 text-sm text-text-dim">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell>
        {{
          roster: <RosterDashboard />,
          schedule: <ScheduleView />,
          trips: <TripPlanner />,
          map: <MapView />,
        }}
      </AppShell>
    </ErrorBoundary>
  )
}
