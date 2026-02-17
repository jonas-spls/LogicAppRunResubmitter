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
  private callbackUrlCache: Map<string, string> = new Map()
  private triggerTypeCache: Map<string, string> = new Map()
  private inputsLinkCache: Map<string, string> = new Map()

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

  /**
   * POST with Azure auth that returns the parsed JSON response body.
   */
  private async azurePostJson<T = any>(url: string, body?: unknown): Promise<T> {
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
      throw new Error(`API call failed (${response.status}): ${errorText}`)
    }
    return response.json() as Promise<T>
  }

  /**
   * POST/PUT to a URL without Azure auth headers.
   * Used for callback URLs that have SAS auth baked into the query string.
   */
  private async rawPost(
    url: string,
    body: any,
    contentType: string,
    method: string = 'POST'
  ): Promise<void> {
    const serialized =
      body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': contentType
      },
      body: serialized,
      signal: AbortSignal.timeout(120_000)
    })
    if (!response.ok) {
      const errorText = await response.text()
      const err: any = new Error(`Callback URL call failed (${response.status}): ${errorText}`)
      err.statusCode = response.status
      throw err
    }
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
    statusFilter?: string[]
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
          if (!statusFilter || statusFilter.length === 0 || statusFilter.includes(runStatus)) {
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

  // ── Replay a single run via callback URL ──────────────────────────────────

  /**
   * Returns the trigger type for a workflow (e.g. "Request", "Recurrence", "ApiConnection").
   * Only "Request" (HTTP) triggers support the callback URL replay approach.
   */
  async getTriggerType(
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string,
    workflowName: string
  ): Promise<string> {
    const cacheKey = `triggerType:${subscriptionId}/${resourceGroup}/${logicAppName}/${workflowName}`
    const cached = this.triggerTypeCache.get(cacheKey)
    if (cached) return cached

    const baseUrl = this.buildBaseUrl(subscriptionId, resourceGroup, logicAppName)
    const data = await this.azureGet<any>(
      `${baseUrl}/hostruntime/runtime/webhooks/workflow/api/management/workflows/${workflowName}/triggers?api-version=2022-03-01`
    )
    const triggers = data.value || (Array.isArray(data) ? data : [])
    // Use the first trigger (Logic App Standard workflows typically have one)
    const trigger = triggers[0]
    // The logical trigger type (Request, Recurrence, ApiConnection, etc.) is in
    // properties.kind for Logic App Standard triggers. Fall back to checking the
    // trigger name against common patterns, or the ARM type as last resort.
    const triggerType =
      trigger?.properties?.kind ||
      trigger?.kind ||
      this.inferTriggerTypeFromName(trigger?.name) ||
      'Unknown'
    this.triggerTypeCache.set(cacheKey, triggerType)
    return triggerType
  }

  /**
   * Infer trigger type from name as a fallback heuristic.
   */
  private inferTriggerTypeFromName(name?: string): string | null {
    if (!name) return null
    const lower = name.toLowerCase()
    if (lower.includes('request') || lower.includes('http') || lower === 'manual') return 'Http'
    if (lower.includes('recurrence') || lower.includes('schedule')) return 'Recurrence'
    return null
  }

  /**
   * Bulk-prefetches trigger history inputsLink URIs for all requested runs.
   * This avoids per-run management API calls during callback URL replay.
   * Also warms the trigger name and callback URL caches.
   * Returns the number of histories successfully cached.
   */
  async prefetchTriggerHistories(
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string,
    workflowName: string,
    runIds: string[]
  ): Promise<number> {
    const baseUrl = this.buildBaseUrl(subscriptionId, resourceGroup, logicAppName)
    const cacheKey = `${subscriptionId}/${resourceGroup}/${logicAppName}/${workflowName}`
    const mgmtBase = `${baseUrl}/hostruntime/runtime/webhooks/workflow/api/management/workflows/${workflowName}`

    // 1. Ensure trigger name is resolved
    let triggerName = this.triggerNameCache.get(cacheKey)
    if (!triggerName) {
      const runDetails = await this.azureGet<any>(
        `${mgmtBase}/runs/${runIds[0]}?api-version=2022-03-01`
      )
      triggerName = runDetails.properties?.trigger?.name
      if (!triggerName) {
        throw new Error('Could not determine trigger name')
      }
      this.triggerNameCache.set(cacheKey, triggerName)
    }

    // 2. Ensure callback URL is resolved
    const callbackCacheKey = `callback:${cacheKey}/${triggerName}`
    if (!this.callbackUrlCache.has(callbackCacheKey)) {
      const callbackData = await this.azurePostJson<any>(
        `${mgmtBase}/triggers/${triggerName}/listCallbackUrl?api-version=2022-03-01`
      )
      if (callbackData.value) {
        this.callbackUrlCache.set(callbackCacheKey, callbackData.value)
      }
    }

    // 3. Fetch ALL trigger histories (paginated) and cache inputsLink URIs
    const runIdSet = new Set(runIds)
    let cached = 0
    let nextUrl: string | null =
      `${mgmtBase}/triggers/${triggerName}/histories?api-version=2022-03-01`

    while (nextUrl) {
      const data: any = await this.azureGet(nextUrl)
      const histories: any[] = data.value || []

      for (const hist of histories) {
        const histRunId = hist.name || hist.properties?.run?.name
        if (!histRunId || !runIdSet.has(histRunId)) continue

        const uri =
          hist.properties?.inputsLink?.uri ??
          hist.properties?.inputsLink?.contentLink?.uri ??
          hist.properties?.outputsLink?.uri ??
          hist.properties?.outputsLink?.contentLink?.uri

        if (uri) {
          this.inputsLinkCache.set(`${cacheKey}/${histRunId}`, uri)
          cached++
        }

        // Stop paginating once we've found all requested runs
        if (cached >= runIds.length) break
      }

      if (cached >= runIds.length) break
      nextUrl = data.nextLink || data['@odata.nextLink'] || null

      // Small delay between pages to avoid rate-limiting
      if (nextUrl) await this.sleep(300)
    }

    return cached
  }

  /**
   * Clears the inputsLink cache (call after a replay batch completes).
   */
  clearInputsLinkCache(): void {
    this.inputsLinkCache.clear()
  }

  /**
   * Replays a workflow run by fetching its original trigger inputs and POSTing
   * them directly to the workflow's callback URL. This bypasses the 56-per-5-min
   * management API resubmit throttle by creating a new run directly.
   *
   * When prefetchTriggerHistories() has been called first, this method makes
   * ZERO management API calls — only SAS URL fetches and callback URL POSTs.
   *
   * Trade-off: creates a new run with a new ID (not a true resubmit).
   */
  async replayRun(
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string,
    workflowName: string,
    runId: string
  ): Promise<void> {
    const baseUrl = this.buildBaseUrl(subscriptionId, resourceGroup, logicAppName)
    const cacheKey = `${subscriptionId}/${resourceGroup}/${logicAppName}/${workflowName}`
    const mgmtBase = `${baseUrl}/hostruntime/runtime/webhooks/workflow/api/management/workflows/${workflowName}`

    // 1. Trigger name (should be cached from prefetch)
    let triggerName = this.triggerNameCache.get(cacheKey)
    if (!triggerName) {
      const runDetails = await this.azureGet<any>(
        `${mgmtBase}/runs/${runId}?api-version=2022-03-01`
      )
      triggerName = runDetails.properties?.trigger?.name
      if (!triggerName) {
        throw new Error(`Could not determine trigger name for run ${runId}`)
      }
      this.triggerNameCache.set(cacheKey, triggerName)
    }

    // 2. Callback URL (should be cached from prefetch)
    const callbackCacheKey = `callback:${cacheKey}/${triggerName}`
    let callbackUrl = this.callbackUrlCache.get(callbackCacheKey)
    if (!callbackUrl) {
      const callbackData = await this.azurePostJson<any>(
        `${mgmtBase}/triggers/${triggerName}/listCallbackUrl?api-version=2022-03-01`
      )
      callbackUrl = callbackData.value
      if (!callbackUrl) {
        throw new Error(`Could not obtain callback URL for trigger "${triggerName}"`)
      }
      this.callbackUrlCache.set(callbackCacheKey, callbackUrl)
    }

    // 3. InputsLink URI — use prefetched cache, fall back to per-run fetch
    const inputsCacheKey = `${cacheKey}/${runId}`
    let inputsLinkUri = this.inputsLinkCache.get(inputsCacheKey)

    if (!inputsLinkUri) {
      // Fallback: fetch individual trigger history (hits management API)
      const triggerHistory = await this.azureGet<any>(
        `${mgmtBase}/triggers/${triggerName}/histories/${runId}?api-version=2022-03-01`
      )
      inputsLinkUri =
        triggerHistory.properties?.inputsLink?.uri ??
        triggerHistory.properties?.inputsLink?.contentLink?.uri ??
        triggerHistory.properties?.outputsLink?.uri ??
        triggerHistory.properties?.outputsLink?.contentLink?.uri
    }

    if (!inputsLinkUri) {
      throw new Error(
        `No trigger inputs/outputs link found for run ${runId}. The trigger may not produce input content (e.g. Recurrence triggers).`
      )
    }

    // 4. Fetch the actual trigger input content (SAS URL — no auth header needed)
    const inputsResponse = await fetch(inputsLinkUri, {
      signal: AbortSignal.timeout(30_000)
    })
    if (!inputsResponse.ok) {
      const errorText = await inputsResponse.text()
      throw new Error(`Failed to fetch trigger inputs (${inputsResponse.status}): ${errorText}`)
    }
    const triggerInputs = await inputsResponse.json()

    // 5. Extract body, content-type, and method from trigger inputs
    let body: any
    let contentType = 'application/json'
    let method = 'POST'
    let targetUrl = callbackUrl

    if (triggerInputs && typeof triggerInputs === 'object') {
      if (triggerInputs.method) {
        method = triggerInputs.method.toUpperCase()
      }
      if (triggerInputs.relativePath) {
        const urlObj = new URL(targetUrl)
        urlObj.pathname =
          urlObj.pathname.replace(/\/?$/, '/') +
          triggerInputs.relativePath.replace(/^\//, '')
        targetUrl = urlObj.toString()
      }
      const headers = triggerInputs.headers || {}
      contentType =
        headers['Content-Type'] || headers['content-type'] || 'application/json'
      if ('body' in triggerInputs) {
        const rawBody = triggerInputs.body
        if (rawBody && typeof rawBody === 'object' && '$content' in rawBody) {
          body = rawBody.$content
          if (rawBody['$content-type']) {
            contentType = rawBody['$content-type']
          }
        } else {
          body = rawBody
        }
      }
    } else {
      body = triggerInputs
    }

    // 6. POST to the callback URL (SAS-authenticated, no Bearer token needed)
    await this.rawPost(targetUrl, body, contentType, method)
  }

  // ── Retry logic ───────────────────────────────────────────────────────────

  /**
   * Executes an operation with retry + exponential backoff.
   * - Rate-limit (429): infinite retries, exponential backoff (1s, 2s, 4s... max 5 min)
   * - Transient errors (5xx, network): infinite retries, exponential backoff (max 60s)
   * - Permanent errors (4xx other than 429): gives up after 5 attempts
   * Supports cancellation via AbortSignal.
   */
  private async executeWithRetry(
    operation: () => Promise<void>,
    onRetry?: (info: { attempt: number; reason: string; delayMs: number }) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    let attempt = 0
    const MAX_PERMANENT_RETRIES = 5

    while (true) {
      if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError')
      attempt++
      try {
        await operation()
        return
      } catch (error: any) {
        if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const errMsg = error.message ? ` — ${error.message.slice(0, 200)}` : ''
        if (this.isRateLimitError(error)) {
          const backoff = Math.min(Math.pow(2, Math.min(attempt - 1, 10)) * 1000, 300_000)
          onRetry?.({ attempt, reason: `Rate-limited (429)${errMsg}`, delayMs: backoff })
          await this.cancellableSleep(backoff, abortSignal)
        } else if (this.isPermanentError(error)) {
          if (attempt >= MAX_PERMANENT_RETRIES) throw error
          const delay = Math.min(Math.pow(2, attempt - 1) * 1000, 10_000)
          onRetry?.({ attempt, reason: `Client error (${error.statusCode || '4xx'})${errMsg}`, delayMs: delay })
          await this.cancellableSleep(delay, abortSignal)
        } else {
          if (attempt >= MAX_PERMANENT_RETRIES) throw error
          const backoff = Math.min(Math.pow(2, Math.min(attempt - 1, 6)) * 1000, 60_000)
          onRetry?.({ attempt, reason: `Transient error${errMsg}`, delayMs: backoff })
          await this.cancellableSleep(backoff, abortSignal)
        }
      }
    }
  }

  async resubmitRunWithRetry(
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string,
    workflowName: string,
    runId: string,
    onRetry?: (info: { attempt: number; reason: string; delayMs: number }) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    return this.executeWithRetry(
      () => this.resubmitRun(subscriptionId, resourceGroup, logicAppName, workflowName, runId),
      onRetry,
      abortSignal
    )
  }

  async replayRunWithRetry(
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string,
    workflowName: string,
    runId: string,
    onRetry?: (info: { attempt: number; reason: string; delayMs: number }) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    return this.executeWithRetry(
      () => this.replayRun(subscriptionId, resourceGroup, logicAppName, workflowName, runId),
      onRetry,
      abortSignal
    )
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

  private cancellableSleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
    if (abortSignal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      if (abortSignal) {
        const onAbort = (): void => {
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        }
        abortSignal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }
}
