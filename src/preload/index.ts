import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload script — exposes a safe `window.api` object to the renderer process.
 * All Azure operations happen in the main process via IPC.
 */
contextBridge.exposeInMainWorld('api', {
  // Authentication
  login: (tenantId?: string) => ipcRenderer.invoke('azure:login', tenantId),
  logout: () => ipcRenderer.invoke('azure:logout'),

  // Resource discovery
  getSubscriptions: () => ipcRenderer.invoke('azure:getSubscriptions'),
  getResourceGroups: (subscriptionId: string) =>
    ipcRenderer.invoke('azure:getResourceGroups', subscriptionId),
  getLogicApps: (subscriptionId: string, resourceGroup: string) =>
    ipcRenderer.invoke('azure:getLogicApps', subscriptionId, resourceGroup),
  getWorkflows: (subscriptionId: string, resourceGroup: string, logicAppName: string) =>
    ipcRenderer.invoke('azure:getWorkflows', subscriptionId, resourceGroup, logicAppName),

  // Run operations
  getRuns: (params: {
    subscriptionId: string
    resourceGroup: string
    logicAppName: string
    workflowName: string
    startTime: string
    endTime: string
    statusFilter?: string[]
  }) => ipcRenderer.invoke('azure:getRuns', params),

  getTriggerType: (
    subscriptionId: string,
    resourceGroup: string,
    logicAppName: string,
    workflowName: string
  ) => ipcRenderer.invoke('azure:getTriggerType', subscriptionId, resourceGroup, logicAppName, workflowName),

  resubmitRuns: (params: {
    subscriptionId: string
    resourceGroup: string
    logicAppName: string
    workflowName: string
    runIds: string[]
    sequential?: boolean
    useCallbackUrl?: boolean
  }) => ipcRenderer.invoke('azure:resubmitRuns', params),

  cancelResubmit: () => ipcRenderer.invoke('azure:cancelResubmit'),

  // Update check
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates') as Promise<{
    currentVersion: string
    latestVersion: string
    releaseUrl: string
    releaseName: string
  } | null>,
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),

  // Progress events (main → renderer)
  onResubmitProgress: (
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
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any): void => callback(data)
    ipcRenderer.on('azure:resubmit-progress', handler)
    return () => {
      ipcRenderer.removeListener('azure:resubmit-progress', handler)
    }
  }
})
