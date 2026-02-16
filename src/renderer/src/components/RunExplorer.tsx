import { useState, useEffect } from 'react'
import type { WorkflowRun, ResubmitProgress, ResubmitResult } from '../types'
import StatusBadge from './StatusBadge'

interface Props {
  subscriptionId: string
  resourceGroup: string
  logicAppName: string
  workflowName: string
}

export default function RunExplorer({
  subscriptionId,
  resourceGroup,
  logicAppName,
  workflowName
}: Props): JSX.Element {
  // Default time range: last 24 hours
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const toLocalDateTimeString = (d: Date): string => {
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const [startTime, setStartTime] = useState(toLocalDateTimeString(yesterday))
  const [endTime, setEndTime] = useState(toLocalDateTimeString(now))
  const [statusFilter, setStatusFilter] = useState('')

  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [selectedRuns, setSelectedRuns] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [mode, setMode] = useState<'search' | 'manual'>('search')
  const [manualRunIds, setManualRunIds] = useState('')

  const [sequential, setSequential] = useState(false)
  const [resubmitting, setResubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState<ResubmitProgress[]>([])
  const [activeRetries, setActiveRetries] = useState<Map<string, ResubmitProgress>>(new Map())
  const [resubmitResult, setResubmitResult] = useState<ResubmitResult | null>(null)

  // Listen for resubmit progress events from main process
  useEffect(() => {
    const unsubscribe = window.api.onResubmitProgress((data) => {
      if (data.status === 'retrying') {
        // Track retrying runs separately
        setActiveRetries((prev) => {
          const next = new Map(prev)
          next.set(data.runId, data)
          return next
        })
      } else {
        // Success or error — remove from active retries and add to log
        setActiveRetries((prev) => {
          if (prev.has(data.runId)) {
            const next = new Map(prev)
            next.delete(data.runId)
            return next
          }
          return prev
        })
        setProgress((prev) => [...prev, data])
      }
    })
    return () => unsubscribe()
  }, [])

  // Reset state when the selected workflow changes
  useEffect(() => {
    setRuns([])
    setSelectedRuns(new Set())
    setError('')
    setProgress([])
    setActiveRetries(new Map())
    setResubmitResult(null)
  }, [subscriptionId, resourceGroup, logicAppName, workflowName])

  // ── Fetch runs ───────────────────────────────────────────────────────────

  const fetchRuns = async (): Promise<void> => {
    setLoading(true)
    setError('')
    setRuns([])
    setSelectedRuns(new Set())
    setResubmitResult(null)
    setProgress([])
    setActiveRetries(new Map())

    try {
      const result = await window.api.getRuns({
        subscriptionId,
        resourceGroup,
        logicAppName,
        workflowName,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        statusFilter: statusFilter || undefined
      })
      setRuns(result)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Selection helpers ────────────────────────────────────────────────────

  const toggleRun = (runId: string): void => {
    setSelectedRuns((prev) => {
      const next = new Set(prev)
      if (next.has(runId)) next.delete(runId)
      else next.add(runId)
      return next
    })
  }

  const toggleAll = (): void => {
    if (selectedRuns.size === runs.length) {
      setSelectedRuns(new Set())
    } else {
      setSelectedRuns(new Set(runs.map((r) => r.name)))
    }
  }

  // ── Resubmit ─────────────────────────────────────────────────────────────

  const resubmitSelected = async (): Promise<void> => {
    let runIds: string[]

    if (mode === 'manual') {
      runIds = manualRunIds
        .split('\n')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
      if (runIds.length === 0) {
        setError('Please enter at least one run ID.')
        return
      }
    } else {
      runIds = Array.from(selectedRuns)
      if (runIds.length === 0) {
        setError('Please select at least one run to resubmit.')
        return
      }
    }

    if (!window.confirm(`Are you sure you want to resubmit ${runIds.length} run(s)?`)) {
      return
    }

    setResubmitting(true)
    setCancelling(false)
    setProgress([])
    setActiveRetries(new Map())
    setResubmitResult(null)
    setError('')

    try {
      const result = await window.api.resubmitRuns({
        subscriptionId,
        resourceGroup,
        logicAppName,
        workflowName,
        runIds,
        sequential
      })
      setResubmitResult(result)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setResubmitting(false)
      setCancelling(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const latestProgress = progress.length > 0 ? progress[progress.length - 1] : null
  const progressPercent = latestProgress
    ? Math.round((latestProgress.current / latestProgress.total) * 100)
    : 0
  const activeRetryList = Array.from(activeRetries.values())

  return (
    <div className="run-explorer">
      {/* Mode Toggle */}
      <div className="mode-toggle">
        <button className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>
          Search Runs
        </button>
        <button className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>
          Manual Input
        </button>
      </div>

      {mode === 'search' ? (
        <>
          {/* Filters */}
          <div className="filters">
            <div className="filter-group">
              <label>Start Time</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="filter-group">
              <label>End Time</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="filter-group">
              <label>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                disabled={loading}
              >
                <option value="">All</option>
                <option value="Failed">Failed</option>
                <option value="Succeeded">Succeeded</option>
                <option value="Cancelled">Cancelled</option>
                <option value="Running">Running</option>
                <option value="Waiting">Waiting</option>
              </select>
            </div>
            <button className="btn-primary" onClick={fetchRuns} disabled={loading}>
              {loading ? 'Fetching...' : 'Fetch Runs'}
            </button>
          </div>

          {/* Runs table */}
          {runs.length > 0 && (
            <div className="runs-table-container">
              <div className="runs-summary">
                <span>
                  Found {runs.length} run(s) &middot; {selectedRuns.size} selected
                </span>
              </div>
              <div className="runs-table-scroll">
                <table className="runs-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>
                        <input
                          type="checkbox"
                          checked={selectedRuns.size === runs.length && runs.length > 0}
                          onChange={toggleAll}
                        />
                      </th>
                      <th>Run ID</th>
                      <th>Status</th>
                      <th>Start Time</th>
                      <th>End Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr
                        key={run.name}
                        className={selectedRuns.has(run.name) ? 'selected' : ''}
                        onClick={() => toggleRun(run.name)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedRuns.has(run.name)}
                            onChange={() => toggleRun(run.name)}
                          />
                        </td>
                        <td className="run-id">{run.name}</td>
                        <td>
                          <StatusBadge status={run.status} />
                        </td>
                        <td>{new Date(run.startTime).toLocaleString()}</td>
                        <td>{run.endTime ? new Date(run.endTime).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!loading && runs.length === 0 && !error && (
            <div className="placeholder">
              <p>Use the filters above and click &ldquo;Fetch Runs&rdquo; to search for workflow runs.</p>
            </div>
          )}
        </>
      ) : (
        /* Manual Input Mode */
        <div className="manual-input">
          <label>Enter Run IDs (one per line)</label>
          <textarea
            value={manualRunIds}
            onChange={(e) => setManualRunIds(e.target.value)}
            placeholder={'Paste run IDs here, one per line...\n\ne.g.\n08585292145263322218767040228CU00\n08585292145263322218767040229CU00'}
            rows={12}
            disabled={resubmitting}
          />
        </div>
      )}

      {/* Error */}
      {error && <div className="error-message">{error}</div>}

      {/* Options */}
      <div className="resubmit-options">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={sequential}
            onChange={(e) => setSequential(e.target.checked)}
            disabled={resubmitting}
          />
          Sequential processing
        </label>
      </div>

      {/* Resubmit Bar */}
      <div className="resubmit-bar">
        <button
          className="btn-primary"
          onClick={resubmitSelected}
          disabled={
            resubmitting ||
            (mode === 'search' && selectedRuns.size === 0) ||
            (mode === 'manual' && manualRunIds.trim().length === 0)
          }
        >
          {resubmitting
            ? `Resubmitting... ${progressPercent}%`
            : mode === 'search'
              ? `Resubmit ${selectedRuns.size} Run(s)`
              : 'Resubmit Entered Runs'}
        </button>
        {resubmitting && (
          <button
            className={cancelling ? 'btn-disabled' : 'btn-danger'}
            disabled={cancelling}
            onClick={() => {
              if (window.confirm('Are you sure you want to stop resubmitting?')) {
                setCancelling(true)
                window.api.cancelResubmit()
              }
            }}
          >
            {cancelling ? 'Stopping...' : 'Stop'}
          </button>
        )}
      </div>

      {/* Progress */}
      {(resubmitting || progress.length > 0 || activeRetryList.length > 0) && (
        <div className="resubmit-progress">
          <h3>Resubmission Progress</h3>
          {latestProgress && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          )}

          {/* Active retries banner */}
          {activeRetryList.length > 0 && (
            <div className="active-retries">
              <div className="active-retries-header">
                {'\u23F3'} {activeRetryList.length} run(s) currently retrying
              </div>
              {activeRetryList.map((p) => (
                <div key={p.runId} className="progress-entry retrying">
                  {'\u21BB'} {p.runId}
                  <span className="retry-detail">
                    {' '}&mdash; {p.retryReason}, attempt #{p.retryAttempt}, waiting{' '}
                    {((p.retryDelay || 0) / 1000).toFixed(1)}s
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="progress-log">
            {progress.map((p, i) => (
              <div key={i} className={`progress-entry ${p.status}`}>
                {p.status === 'success' ? '\u2713' : '\u2717'}{' '}
                [{p.current}/{p.total}] {p.runId}
                {p.error && <span className="error-detail"> &mdash; {p.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Result Summary */}
      {resubmitResult && (
        <div className="resubmit-result">
          <h3>{resubmitResult.cancelled ? 'Resubmission Stopped' : 'Resubmission Complete'}</h3>
          <p className="success-count">{resubmitResult.success} succeeded</p>
          {resubmitResult.failed > 0 && (
            <p className="failed-count">{resubmitResult.failed} failed</p>
          )}
          {resubmitResult.cancelled && (
            <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>Cancelled by user</p>
          )}
        </div>
      )}
    </div>
  )
}
