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
  const { subscriptionId, resourceGroup, logicAppName, workflowName, runIds } = params
  const results = { success: 0, failed: 0, cancelled: false, errors: [] as { runId: string; error: string }[] }
  resubmitCancelled = false

  // Adaptive delay: starts at 1.5s, increases on 429, decreases on success
  let interRunDelay = 1500
  const MIN_DELAY = 1000
  const MAX_DELAY = 30_000

  for (let i = 0; i < runIds.length; i++) {
    if (resubmitCancelled) {
      results.cancelled = true
      mainWindow?.webContents.send('azure:resubmit-progress', {
        runId: '',
        status: 'cancelled',
        current: i,
        total: runIds.length
      })
      break
    }
    const runId = runIds[i]
    try {
      await azureService.resubmitRunWithRetry(
        subscriptionId,
        resourceGroup,
        logicAppName,
        workflowName,
        runId
      )
      results.success++
      // Gradually reduce delay on consecutive successes (min 1s)
      interRunDelay = Math.max(MIN_DELAY, Math.floor(interRunDelay * 0.9))
      mainWindow?.webContents.send('azure:resubmit-progress', {
        runId,
        status: 'success',
        current: i + 1,
        total: runIds.length
      })
    } catch (error: any) {
      results.failed++
      results.errors.push({ runId, error: error.message })
      // Increase delay on failure (max 30s)
      interRunDelay = Math.min(MAX_DELAY, interRunDelay * 2)
      mainWindow?.webContents.send('azure:resubmit-progress', {
        runId,
        status: 'error',
        current: i + 1,
        total: runIds.length,
        error: error.message
      })
    }

    // Adaptive rate-limiting delay between runs
    if (i < runIds.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, interRunDelay))
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
