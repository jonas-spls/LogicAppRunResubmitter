import { app, BrowserWindow, ipcMain, shell, nativeImage } from 'electron'
import { join } from 'path'
import { AzureService } from './azure-service'

const GITHUB_REPO = 'jonas-spls/LogicAppRunResubmitter'

let mainWindow: BrowserWindow | null = null
const azureService = new AzureService()
let resubmitCancelled = false
let resubmitAbortController: AbortController | null = null

function createWindow(): void {
  const iconPath = join(__dirname, '../../resources/icon.png')

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 640,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Logic App Run Resubmitter',
    show: false,
    autoHideMenuBar: true
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('azure:login', async (_event, tenantId?: string) => {
  try {
    await azureService.login(tenantId)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('azure:logout', async () => {
  azureService.logout()
})

ipcMain.handle('azure:getSubscriptions', async () => {
  return azureService.getSubscriptions()
})

ipcMain.handle('azure:getResourceGroups', async (_event, subscriptionId: string) => {
  return azureService.getResourceGroups(subscriptionId)
})

ipcMain.handle(
  'azure:getLogicApps',
  async (_event, subscriptionId: string, resourceGroup: string) => {
    return azureService.getLogicApps(subscriptionId, resourceGroup)
  }
)

ipcMain.handle(
  'azure:getWorkflows',
  async (_event, subscriptionId: string, resourceGroup: string, logicAppName: string) => {
    return azureService.getWorkflows(subscriptionId, resourceGroup, logicAppName)
  }
)

ipcMain.handle('azure:getRuns', async (_event, params) => {
  return azureService.getRuns(
    params.subscriptionId,
    params.resourceGroup,
    params.logicAppName,
    params.workflowName,
    params.startTime,
    params.endTime,
    params.statusFilter
  )
})

ipcMain.handle('azure:cancelResubmit', async () => {
  resubmitCancelled = true
  resubmitAbortController?.abort()
})

ipcMain.handle(
  'azure:getTriggerType',
  async (_event, subscriptionId: string, resourceGroup: string, logicAppName: string, workflowName: string) => {
    return azureService.getTriggerType(subscriptionId, resourceGroup, logicAppName, workflowName)
  }
)

ipcMain.handle('azure:resubmitRuns', async (_event, params) => {
  const { subscriptionId, resourceGroup, logicAppName, workflowName, runIds, sequential, useCallbackUrl } = params
  const results = { success: 0, failed: 0, cancelled: false, errors: [] as { runId: string; error: string }[] }
  resubmitCancelled = false
  resubmitAbortController = new AbortController()
  const abortSignal = resubmitAbortController.signal
  let completedCount = 0

  const submitFn = useCallbackUrl
    ? azureService.replayRunWithRetry.bind(azureService)
    : azureService.resubmitRunWithRetry.bind(azureService)

  // Pre-fetch all trigger histories to avoid per-run management API calls
  if (useCallbackUrl) {
    try {
      mainWindow?.webContents.send('azure:resubmit-progress', {
        runId: '',
        status: 'prefetching',
        current: 0,
        total: runIds.length
      })
      await azureService.prefetchTriggerHistories(
        subscriptionId, resourceGroup, logicAppName, workflowName, runIds
      )
    } catch (err: any) {
      // Non-fatal: individual runs will fall back to per-run fetch
      console.warn('Prefetch failed, falling back to per-run fetch:', err.message)
    }
  }

  const processRun = async (runId: string): Promise<void> => {
    if (resubmitCancelled) return
    try {
      await submitFn(
        subscriptionId,
        resourceGroup,
        logicAppName,
        workflowName,
        runId,
        (retryInfo) => {
          mainWindow?.webContents.send('azure:resubmit-progress', {
            runId,
            status: 'retrying',
            current: completedCount,
            total: runIds.length,
            retryAttempt: retryInfo.attempt,
            retryReason: retryInfo.reason,
            retryDelay: retryInfo.delayMs
          })
        },
        abortSignal
      )
      results.success++
      completedCount++
      mainWindow?.webContents.send('azure:resubmit-progress', {
        runId,
        status: 'success',
        current: completedCount,
        total: runIds.length
      })
    } catch (error: any) {
      if (error.name === 'AbortError' || resubmitCancelled) return
      results.failed++
      completedCount++
      results.errors.push({ runId, error: error.message })
      mainWindow?.webContents.send('azure:resubmit-progress', {
        runId,
        status: 'error',
        current: completedCount,
        total: runIds.length,
        error: error.message
      })
    }
  }

  if (sequential) {
    // Sequential: one at a time, no artificial delay
    for (let i = 0; i < runIds.length; i++) {
      if (resubmitCancelled) {
        results.cancelled = true
        mainWindow?.webContents.send('azure:resubmit-progress', {
          runId: '',
          status: 'cancelled',
          current: completedCount,
          total: runIds.length
        })
        break
      }
      await processRun(runIds[i])
    }
  } else {
    // Parallel: fire runs in concurrent batches
    const CONCURRENCY = 10
    for (let i = 0; i < runIds.length; i += CONCURRENCY) {
      if (resubmitCancelled) {
        results.cancelled = true
        mainWindow?.webContents.send('azure:resubmit-progress', {
          runId: '',
          status: 'cancelled',
          current: completedCount,
          total: runIds.length
        })
        break
      }
      const batch = runIds.slice(i, i + CONCURRENCY)
      await Promise.all(batch.map(processRun))
    }
  }

  // Clean up the inputsLink cache after replay completes
  if (useCallbackUrl) {
    azureService.clearInputsLinkCache()
  }

  return results
})

// ── Update check ──────────────────────────────────────────────────────────────

ipcMain.handle('app:checkForUpdates', async () => {
  try {
    const currentVersion = app.getVersion()
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'LogicAppRunResubmitter' },
        signal: AbortSignal.timeout(10_000)
      }
    )
    if (!response.ok) return null

    const release = await response.json()
    const latestVersion = (release.tag_name || '').replace(/^v/, '')
    if (!latestVersion) return null

    const isNewer = compareVersions(latestVersion, currentVersion) > 0
    if (!isNewer) return null

    return {
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url as string,
      releaseName: (release.name || release.tag_name) as string
    }
  } catch {
    // Silently ignore — update check is best-effort
    return null
  }
})

ipcMain.handle('app:openExternal', async (_event, url: string) => {
  shell.openExternal(url)
})

/** Simple semver comparison: returns >0 if a > b, <0 if a < b, 0 if equal */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

// ── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
