import { useState, useEffect, useCallback } from 'react'
import type { Subscription, ResourceGroup, LogicApp, Workflow } from '../types'

interface Props {
  onSelectionChange: (
    sub: string | null,
    rg: string | null,
    la: string | null,
    wf: string | null
  ) => void
}

export default function ResourceSelector({ onSelectionChange }: Props): JSX.Element {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [resourceGroups, setResourceGroups] = useState<ResourceGroup[]>([])
  const [logicApps, setLogicApps] = useState<LogicApp[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])

  const [selectedSub, setSelectedSub] = useState('')
  const [selectedRg, setSelectedRg] = useState('')
  const [selectedLa, setSelectedLa] = useState('')
  const [selectedWf, setSelectedWf] = useState('')

  const [loading, setLoading] = useState({
    subs: false,
    rgs: false,
    las: false,
    wfs: false
  })
  const [error, setError] = useState('')

  // ── Load subscriptions on mount ──────────────────────────────────────────

  useEffect(() => {
    const loadSubs = async (): Promise<void> => {
      setLoading((prev) => ({ ...prev, subs: true }))
      setError('')
      try {
        const subs = await window.api.getSubscriptions()
        setSubscriptions(subs)
      } catch (err: any) {
        setError(`Failed to load subscriptions: ${err.message}`)
      } finally {
        setLoading((prev) => ({ ...prev, subs: false }))
      }
    }
    loadSubs()
  }, [])

  // ── Cascade: subscription → resource groups ──────────────────────────────

  useEffect(() => {
    setSelectedRg('')
    setSelectedLa('')
    setSelectedWf('')
    setResourceGroups([])
    setLogicApps([])
    setWorkflows([])

    if (!selectedSub) return

    const load = async (): Promise<void> => {
      setLoading((prev) => ({ ...prev, rgs: true }))
      setError('')
      try {
        const rgs = await window.api.getResourceGroups(selectedSub)
        setResourceGroups(rgs.sort((a, b) => a.name.localeCompare(b.name)))
      } catch (err: any) {
        setError(`Failed to load resource groups: ${err.message}`)
      } finally {
        setLoading((prev) => ({ ...prev, rgs: false }))
      }
    }
    load()
  }, [selectedSub])

  // ── Cascade: resource group → logic apps ─────────────────────────────────

  useEffect(() => {
    setSelectedLa('')
    setSelectedWf('')
    setLogicApps([])
    setWorkflows([])

    if (!selectedSub || !selectedRg) return

    const load = async (): Promise<void> => {
      setLoading((prev) => ({ ...prev, las: true }))
      setError('')
      try {
        const las = await window.api.getLogicApps(selectedSub, selectedRg)
        setLogicApps(las.sort((a, b) => a.name.localeCompare(b.name)))
      } catch (err: any) {
        setError(`Failed to load logic apps: ${err.message}`)
      } finally {
        setLoading((prev) => ({ ...prev, las: false }))
      }
    }
    load()
  }, [selectedSub, selectedRg])

  // ── Cascade: logic app → workflows ───────────────────────────────────────

  useEffect(() => {
    setSelectedWf('')
    setWorkflows([])

    if (!selectedSub || !selectedRg || !selectedLa) return

    const load = async (): Promise<void> => {
      setLoading((prev) => ({ ...prev, wfs: true }))
      setError('')
      try {
        const wfs = await window.api.getWorkflows(selectedSub, selectedRg, selectedLa)
        setWorkflows(wfs.sort((a, b) => a.name.localeCompare(b.name)))
      } catch (err: any) {
        setError(`Failed to load workflows: ${err.message}`)
      } finally {
        setLoading((prev) => ({ ...prev, wfs: false }))
      }
    }
    load()
  }, [selectedSub, selectedRg, selectedLa])

  // ── Notify parent whenever any selection changes ─────────────────────────

  const notifyParent = useCallback(() => {
    onSelectionChange(
      selectedSub || null,
      selectedRg || null,
      selectedLa || null,
      selectedWf || null
    )
  }, [selectedSub, selectedRg, selectedLa, selectedWf, onSelectionChange])

  useEffect(() => {
    notifyParent()
  }, [notifyParent])

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="resource-selector">
      <h2>Resources</h2>

      {error && <div className="error-message">{error}</div>}

      {/* Subscription */}
      <div className="form-group">
        <label htmlFor="sub">Subscription</label>
        <select
          id="sub"
          value={selectedSub}
          onChange={(e) => setSelectedSub(e.target.value)}
          disabled={loading.subs}
        >
          <option value="">
            {loading.subs ? 'Loading...' : '-- Select Subscription --'}
          </option>
          {subscriptions.map((s) => (
            <option key={s.subscriptionId} value={s.subscriptionId}>
              {s.displayName}
            </option>
          ))}
        </select>
        {loading.subs && <div className="loading-inline">Fetching subscriptions...</div>}
      </div>

      {/* Resource Group */}
      <div className="form-group">
        <label htmlFor="rg">Resource Group</label>
        <select
          id="rg"
          value={selectedRg}
          onChange={(e) => setSelectedRg(e.target.value)}
          disabled={!selectedSub || loading.rgs}
        >
          <option value="">
            {loading.rgs ? 'Loading...' : '-- Select Resource Group --'}
          </option>
          {resourceGroups.map((rg) => (
            <option key={rg.name} value={rg.name}>
              {rg.name}
            </option>
          ))}
        </select>
        {loading.rgs && <div className="loading-inline">Fetching resource groups...</div>}
      </div>

      {/* Logic App */}
      <div className="form-group">
        <label htmlFor="la">Logic App (Standard)</label>
        <select
          id="la"
          value={selectedLa}
          onChange={(e) => setSelectedLa(e.target.value)}
          disabled={!selectedRg || loading.las}
        >
          <option value="">
            {loading.las ? 'Loading...' : '-- Select Logic App --'}
          </option>
          {logicApps.map((la) => (
            <option key={la.name} value={la.name}>
              {la.name}
            </option>
          ))}
        </select>
        {loading.las && <div className="loading-inline">Fetching logic apps...</div>}
        {!loading.las && selectedRg && logicApps.length === 0 && resourceGroups.length > 0 && (
          <div className="loading-inline">No Logic Apps Standard found in this resource group.</div>
        )}
      </div>

      {/* Workflow */}
      <div className="form-group">
        <label htmlFor="wf">Workflow</label>
        <select
          id="wf"
          value={selectedWf}
          onChange={(e) => setSelectedWf(e.target.value)}
          disabled={!selectedLa || loading.wfs}
        >
          <option value="">
            {loading.wfs ? 'Loading...' : '-- Select Workflow --'}
          </option>
          {workflows.map((wf) => (
            <option key={wf.name} value={wf.name}>
              {wf.name}
            </option>
          ))}
        </select>
        {loading.wfs && <div className="loading-inline">Fetching workflows...</div>}
      </div>
    </div>
  )
}
