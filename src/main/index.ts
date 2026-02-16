import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { AzureService } from './azure-service'

let mainWindow: BrowserWindow | null = null
const azureService = new AzureService()
let resubmitCancelled = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Logic App Run Resubmitter',
    show: false
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
})

ipcMain.handle('azure:resubmitRuns', async (_event, params) => {
  const { subscriptionId, resourceGroup, logicAppName, workflowName, runIds, sequential } = params
  const results = { success: 0, failed: 0, cancelled: false, errors: [] as { runId: string; error: string }[] }
  resubmitCancelled = false
  let completedCount = 0

  const processRun = async (runId: string): Promise<void> => {
    try {
      await azureService.resubmitRunWithRetry(
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
        }
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

  return results
})

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
