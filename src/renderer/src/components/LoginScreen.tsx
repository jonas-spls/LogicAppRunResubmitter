import { useRef, useState } from 'react'

interface Props {
  onLogin: () => void
}

export default function LoginScreen({ onLogin }: Props): JSX.Element {
  const [tenantId, setTenantId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loginAttemptRef = useRef(0)

  const handleLogin = async (): Promise<void> => {
    setLoading(true)
    setError('')
    const attemptId = ++loginAttemptRef.current
    try {
      const result = await window.api.login(tenantId || undefined)
      // Ignore result if this attempt was cancelled
      if (attemptId !== loginAttemptRef.current) return
      if (result.success) {
        onLogin()
      } else {
        setError(result.error || 'Login failed. Please try again.')
      }
    } catch (err: any) {
      if (attemptId !== loginAttemptRef.current) return
      setError(err.message || 'An unexpected error occurred during sign in.')
    } finally {
      if (attemptId === loginAttemptRef.current) {
        setLoading(false)
      }
    }
  }

  const handleCancel = (): void => {
    loginAttemptRef.current++
    setLoading(false)
    setError('Sign in cancelled. You can try again.')
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !loading) handleLogin()
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="./la-resubmitter.png" alt="Logic App Run Resubmitter" className="login-logo" />
        <h1>Logic App Run Resubmitter</h1>
        <p className="subtitle">
          Sign in to your Azure account to browse and resubmit Logic App Standard workflow runs.
        </p>

        <div className="form-group">
          <label htmlFor="tenantId">Tenant ID (optional)</label>
          <input
            id="tenantId"
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Leave empty for default tenant"
            disabled={loading}
          />
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="login-actions">
          <button className="btn-primary" onClick={handleLogin} disabled={loading}>
            {loading ? 'Signing in — check your browser...' : 'Sign in with Azure'}
          </button>
          {loading && (
            <button className="btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
