import { InteractiveBrowserCredential, TokenCredential } from '@azure/identity'

/**
 * Azure service for authenticating and interacting with Azure Logic Apps Standard
 * via the Azure Management REST API.
 *
 * Uses InteractiveBrowserCredential for interactive login — opens the system browser
 * so the user can sign in with their Azure account. No app registration is required.
 */
export class AzureService {
  private credential: TokenCredential | null = null
  private triggerNameCache: Map<string, string> = new Map()

  // ── Authentication ────────────────────────────────────────────────────────

  async login(tenantId?: string): Promise<void> {
    this.credential = new InteractiveBrowserCredential({
      tenantId: tenantId || undefined
    })
    // Force an interactive sign-in now so the user sees the browser prompt immediately
    await this.credential.getToken('https://management.azure.com/.default')
  }

  logout(): void {
    this.credential = null
  }

  get isLoggedIn(): boolean {
    return this.credential !== null
  }

  private async getToken(): Promise<string> {
    if (!this.credential) {
      throw new Error('Not authenticated. Please sign in first.')
    }
    const tokenResponse = await this.credential.getToken('https://management.azure.com/.default')
    if (!tokenResponse) {
      throw new Error('Failed to obtain access token')
    }
    return tokenResponse.token
  }

  // ── Low-level HTTP helpers ────────────────────────────────────────────────

  private async azureGet<T = any>(url: string): Promise<T> {
    const token = await this.getToken()
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API call failed (${response.status}): ${errorText}`)
    }
    return response.json() as Promise<T>
  }

  private async azurePost(url: string, body?: unknown): Promise<void> {
    const token = await this.getToken()
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) {
      const errorText = await response.text()
      const retryAfter = this.parseRetryAfter(response)
      const err: any = new Error(`API call failed (${response.status}): ${errorText}`)
      err.retryAfterMs = retryAfter
      err.statusCode = response.status
      throw err
    }
  }

  /**
   * Parses the Retry-After header from a response.
   * Returns delay in milliseconds, or 0 if not present.
   */
  private parseRetryAfter(response: Response): number {
    const header = response.headers.get('Retry-After')
    if (!header) return 0
    const seconds = Number(header)
    if (!isNaN(seconds)) return seconds * 1000
    const date = Date.parse(header)
    if (!isNaN(date)) return Math.max(0, date - Date.now())
    return 0
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  async getSubscriptions(): Promise<
    Array<{ subscriptionId: string; displayName: string; tenantId: string }>
  > {
    const data = await this.azureGet<any>(
      'https://management.azure.com/subscriptions?api-version=2022-12-01'
    )
    return (data.value || []).map((s: any) => ({
      subscriptionId: s.subscriptionId,
      displayName: s.displayName,
      tenantId: s.tenantId
    }))
  }

  // ── Resource Groups ───────────────────────────────────────────────────────

  async getResourceGroups(
    subscriptionId: string
  ): Promise<Array<{ name: string; location: string }>> {
    const data = await this.azureGet<any>(
      `https://management.azure.com/subscriptions/${subscriptionId}/resourcegroups?api-version=2021-04-01`
    )
    return (data.value || []).map((rg: any) => ({
      name: rg.name,
      location: rg.location
    }))
  }

  // ── Logic Apps Standard (Web Sites with kind "workflowapp") ───────────────

  async getLogicApps(
    subscriptionId: string,
    resourceGroup: string
  ): Promise<Array<{ name: string; location: string; kind: string }>> {
    const data = await this.azureGet<any>(
      `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites?api-version=2022-03-01`
    )
    const sites = data.value || []
    return sites
      .filter((site: any) => site.kind && site.kind.toLowerCase().includes('workflowapp'))
      .map((site: any) => ({
        name: site.name,
        location: site.location,
        kind: site.kind
      }))
  }

  // ── Workflows within a Logic App Standard ─────────────────────────────────

  async getWorkflows(
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string
  ): Promise<Array<{ name: string }>> {
    const baseUrl = this.buildBaseUrl(subscriptionId, resourceGroup, logicAppName)
    const data = await this.azureGet<any>(
      `${baseUrl}/hostruntime/runtime/webhooks/workflow/api/management/workflows?api-version=2022-03-01`
    )
    const workflows = data.value || (Array.isArray(data) ? data : [])
    return workflows.map((wf: any) => ({ name: wf.name }))
  }

  // ── Workflow Runs ─────────────────────────────────────────────────────────

  /**
   * Fetches all workflow runs within a time window.
   * Handles API pagination and stops when runs are older than startTime.
   */
  async getRuns(
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string,
    workflowName: string,
    startTime: string,
    endTime: string,
    statusFilter?: string
  ): Promise<
    Array<{ id: string; name: string; status: string; startTime: string; endTime?: string }>
  > {
    const baseUrl = this.buildBaseUrl(subscriptionId, resourceGroup, logicAppName)
    const startDate = new Date(startTime)
    const endDate = new Date(endTime)
    const allRuns: Array<{
      id: string
      name: string
      status: string
      startTime: string
      endTime?: string
    }> = []

    let nextUrl: string | null =
      `${baseUrl}/hostruntime/runtime/webhooks/workflow/api/management/workflows/${workflowName}/runs?api-version=2022-03-01`

    while (nextUrl) {
      const data: any = await this.azureGet(nextUrl)
      const runs: any[] = data.value || []
      let shouldContinue = true

      for (const run of runs) {
        const runStartTimeStr = run.properties?.startTime
        if (!runStartTimeStr) continue

        const runStartTime = new Date(runStartTimeStr)

        // Runs are ordered descending by startTime — stop if we've passed the window
        if (runStartTime < startDate) {
          shouldContinue = false
          break
        }

        // Only include runs within the window
        if (runStartTime <= endDate) {
          const runStatus = run.properties?.status || 'Unknown'
          if (!statusFilter || runStatus === statusFilter) {
            allRuns.push({
              id: run.id,
              name: run.name,
              status: runStatus,
              startTime: runStartTimeStr,
              endTime: run.properties?.endTime
            })
          }
        }
      }

      if (!shouldContinue) break
      nextUrl = data.nextLink || data['@odata.nextLink'] || null

      // Small delay between pages to avoid rate-limiting
      if (nextUrl) await this.sleep(300)
    }

    return allRuns
  }

  // ── Resubmit a single run ─────────────────────────────────────────────────

  /**
   * Resubmits a workflow run via the trigger-histories resubmit API.
   * Reference: POST .../triggers/{trigger}/histories/{runId}/resubmit
   */
  async resubmitRun(
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string,
    workflowName: string,
    runId: string
  ): Promise<void> {
    const baseUrl = this.buildBaseUrl(subscriptionId, resourceGroup, logicAppName)
    const cacheKey = `${subscriptionId}/${resourceGroup}/${logicAppName}/${workflowName}`

    // Use cached trigger name if available (avoids an extra API call per run)
    let triggerName = this.triggerNameCache.get(cacheKey)
    if (!triggerName) {
      const runDetails = await this.azureGet<any>(
        `${baseUrl}/hostruntime/runtime/webhooks/workflow/api/management/workflows/${workflowName}/runs/${runId}?api-version=2022-03-01`
      )
      triggerName = runDetails.properties?.trigger?.name
      if (!triggerName) {
        throw new Error(`Could not determine trigger name for run ${runId}`)
      }
      this.triggerNameCache.set(cacheKey, triggerName)
    }

    // Resubmit via trigger history endpoint (no body required)
    await this.azurePost(
      `${baseUrl}/hostruntime/runtime/webhooks/workflow/api/management/workflows/${workflowName}/triggers/${triggerName}/histories/${runId}/resubmit?api-version=2018-11-01`
    )
  }

  /**
   * Resubmits a run with retry + exponential backoff.
   * - Rate-limit (429): infinite retries, uses Retry-After header when available
   * - Transient errors (5xx, network): infinite retries, exponential backoff (max 60s)
   * - Permanent errors (4xx other than 429): gives up after 5 attempts
   */
  async resubmitRunWithRetry(
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string,
    workflowName: string,
    runId: string,
    onRetry?: (info: { attempt: number; reason: string; delayMs: number }) => void
  ): Promise<void> {
    let attempt = 0
    const MAX_PERMANENT_RETRIES = 5

    while (true) {
      attempt++
      try {
        await this.resubmitRun(subscriptionId, resourceGroup, logicAppName, workflowName, runId)
        return
      } catch (error: any) {
        if (this.isRateLimitError(error)) {
          const retryAfterMs = error.retryAfterMs || 0
          const backoff = Math.min(Math.pow(2, Math.min(attempt - 1, 10)) * 1000, 300_000)
          const delay = retryAfterMs > 0 ? retryAfterMs : backoff
          onRetry?.({ attempt, reason: 'Rate-limited (429)', delayMs: delay })
          await this.sleep(delay)
        } else if (this.isPermanentError(error)) {
          if (attempt >= MAX_PERMANENT_RETRIES) throw error
          const delay = Math.min(Math.pow(2, attempt - 1) * 1000, 10_000)
          onRetry?.({ attempt, reason: `Client error (${error.statusCode || '4xx'})`, delayMs: delay })
          await this.sleep(delay)
        } else {
          const backoff = Math.min(Math.pow(2, Math.min(attempt - 1, 6)) * 1000, 60_000)
          onRetry?.({ attempt, reason: 'Transient error', delayMs: backoff })
          await this.sleep(backoff)
        }
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildBaseUrl(
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string
  ): string {
    return `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${logicAppName}`
  }

  private isRateLimitError(error: any): boolean {
    if (error.statusCode === 429) return true
    const msg = error.message.toLowerCase()
    return (
      msg.includes('429') ||
      msg.includes('throttl') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests')
    )
  }

  /**
   * Returns true for permanent client errors (4xx other than 429) that will never
   * succeed no matter how many times we retry.
   */
  private isPermanentError(error: any): boolean {
    const code = error.statusCode
    return typeof code === 'number' && code >= 400 && code < 500 && code !== 429
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
