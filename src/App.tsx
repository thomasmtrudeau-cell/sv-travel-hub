import AppShell from './components/layout/AppShell'
import RosterDashboard from './components/roster/RosterDashboard'
import ScheduleView from './components/schedule/ScheduleView'
import TripPlanner from './components/trips/TripPlanner'
import MapView from './components/map/MapView'

export default function App() {
  return (
    <AppShell>
      {{
        roster: <RosterDashboard />,
        schedule: <ScheduleView />,
        trips: <TripPlanner />,
        map: <MapView />,
      }}
    </AppShell>
  )
}
