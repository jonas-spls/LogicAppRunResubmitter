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
    statusFilter?: string
  }) => ipcRenderer.invoke('azure:getRuns', params),

  resubmitRuns: (params: {
    subscriptionId: string
    resourceGroup: string
    logicAppName: string
    workflowName: string
    runIds: string[]
  }) => ipcRenderer.invoke('azure:resubmitRuns', params),

  cancelResubmit: () => ipcRenderer.invoke('azure:cancelResubmit'),

  // Progress events (main → renderer)
  onResubmitProgress: (
    callback: (data: {
      runId: string
      status: 'success' | 'error'
      current: number
      total: number
      error?: string
    }) => void
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any): void => callback(data)
    ipcRenderer.on('azure:resubmit-progress', handler)
    return () => {
      ipcRenderer.removeListener('azure:resubmit-progress', handler)
    }
  }
})
