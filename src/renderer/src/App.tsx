import { useState } from 'react'
import LoginScreen from './components/LoginScreen'
import ResourceSelector from './components/ResourceSelector'
import RunExplorer from './components/RunExplorer'
import UpdateBanner from './components/UpdateBanner'

function App(): JSX.Element {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [selectedSub, setSelectedSub] = useState<string | null>(null)
  const [selectedRg, setSelectedRg] = useState<string | null>(null)
  const [selectedLa, setSelectedLa] = useState<string | null>(null)
  const [selectedWf, setSelectedWf] = useState<string | null>(null)

  if (!isLoggedIn) {
    return <LoginScreen onLogin={() => setIsLoggedIn(true)} />
  }

  const handleLogout = async (): Promise<void> => {
    if (!window.confirm('Are you sure you want to sign out?')) return
    await window.api.logout()
    setIsLoggedIn(false)
    setSelectedSub(null)
    setSelectedRg(null)
    setSelectedLa(null)
    setSelectedWf(null)
  }

  const handleSelectionChange = (
    sub: string | null,
    rg: string | null,
    la: string | null,
    wf: string | null
  ): void => {
    setSelectedSub(sub)
    setSelectedRg(rg)
    setSelectedLa(la)
    setSelectedWf(wf)
  }

  const allSelected = selectedSub && selectedRg && selectedLa && selectedWf

  return (
    <div className="app">
      <UpdateBanner />
      <header className="app-header">
        <h1>Logic App Run Resubmitter</h1>
        <button className="btn-secondary" onClick={handleLogout}>
          Sign out
        </button>
      </header>

      <div className="app-content">
        <aside className="sidebar">
          <ResourceSelector onSelectionChange={handleSelectionChange} />
        </aside>

        <main className="main-content">
          {allSelected ? (
            <RunExplorer
              subscriptionId={selectedSub}
              resourceGroup={selectedRg}
              logicAppName={selectedLa}
              workflowName={selectedWf}
            />
          ) : (
            <div className="placeholder">
              <p>Select a subscription, resource group, logic app, and workflow to view runs.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
