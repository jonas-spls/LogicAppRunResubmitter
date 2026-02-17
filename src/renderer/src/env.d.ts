/// <reference types="vite/client" />

interface AzureAPI {
  login(tenantId?: string): Promise<{ success: boolean; error?: string }>
  logout(): Promise<void>
  getSubscriptions(): Promise<
    Array<{ subscriptionId: string; displayName: string; tenantId: string }>
  >
  getResourceGroups(subscriptionId: string): Promise<Array<{ name: string; location: string }>>
  getLogicApps(
    subscriptionId: string,
    resourceGroup: string
  ): Promise<Array<{ name: string; location: string; kind: string }>>
  getWorkflows(
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string
  ): Promise<Array<{ name: string }>>
  getRuns(params: {
    subscriptionId: string
    resourceGroup: string
    logicAppName: string
    workflowName: string
    startTime: string
    endTime: string
    statusFilter?: string[]
  }): Promise<Array<{ id: string; name: string; status: string; startTime: string; endTime?: string }>>
  getTriggerType(
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string,
    workflowName: string
  ): Promise<string>
  resubmitRuns(params: {
    subscriptionId: string
    resourceGroup: string
    logicAppName: string
    workflowName: string
    runIds: string[]
    sequential?: boolean
    useCallbackUrl?: boolean
  }): Promise<{ success: number; failed: number; cancelled: boolean; errors: Array<{ runId: string; error: string }> }>
  cancelResubmit(): Promise<void>
  onResubmitProgress(
    callback: (data: {
      runId: string
      status: 'success' | 'error' | 'retrying' | 'prefetching' | 'cancelled'
      current: number
      total: number
      error?: string
      retryAttempt?: number
      retryReason?: string
      retryDelay?: number
    }) => void
  ): () => void
}

declare global {
  interface Window {
    api: AzureAPI
  }
}

export {}
