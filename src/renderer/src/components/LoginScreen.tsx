import { useState } from 'react'

interface Props {
  onLogin: () => void
}

export default function LoginScreen({ onLogin }: Props): JSX.Element {
  const [tenantId, setTenantId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const result = await window.api.login(tenantId || undefined)
      if (result.success) {
        onLogin()
      } else {
        setError(result.error || 'Login failed. Please try again.')
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during sign in.')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !loading) handleLogin()
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <span className="azure-icon" role="img" aria-label="Azure">
          &#9729;
        </span>
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

        <button className="btn-primary" onClick={handleLogin} disabled={loading}>
          {loading ? 'Signing in — check your browser...' : 'Sign in with Azure'}
        </button>
      </div>
    </div>
  )
}
