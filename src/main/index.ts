// ============================================================
// Electron Main Process — Entry Point
// Handles window creation, IPC handlers, database init,
// provider management, and failover routing.
// ============================================================

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { is } from '@electron-toolkit/utils'

import { ProviderConfig, ProviderConfigInput, PROVIDER_DEFAULTS, ProviderType } from './providers/types'
import { ProviderManager } from './providers/manager'
import { FailoverEngine } from './router/failover-engine'
import * as db from './database/db'
import * as secureStore from './storage/secure-store'

let mainWindow: BrowserWindow | null = null
const providerManager = new ProviderManager()
const failoverEngine = new FailoverEngine()

function createWindow(): void {
  const bounds = secureStore.getPreference<{
    width: number
    height: number
    x?: number
    y?: number
  }>('windowBounds')

  mainWindow = new BrowserWindow({
    width: bounds?.width || 1200,
    height: bounds?.height || 800,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('resized', () => saveBounds())
  mainWindow.on('moved', () => saveBounds())

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximizeChange', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximizeChange', false))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function saveBounds(): void {
  if (!mainWindow) return
  const bounds = mainWindow.getBounds()
  secureStore.setPreference('windowBounds', bounds)
}

async function loadProvidersFromDB(): Promise<ProviderConfig[]> {
  const rows = await db.getProviders()
  return rows.map((row) => ({
    id: row.id,
    type: row.type as ProviderType,
    displayName: row.display_name,
    enabled: Boolean(row.enabled),
    sortOrder: row.sort_order,
    config: {
      baseUrl: row.base_url || undefined,
      model: row.model || undefined,
      apiKey: secureStore.getApiKey(row.id) || undefined,
      customHeaders: row.custom_headers ? JSON.parse(row.custom_headers) : undefined
    }
  }))
}

async function refreshProviders(): Promise<void> {
  const configs = await loadProvidersFromDB()
  providerManager.loadProviders(configs)
}

function getOrderedProviders() {
  return providerManager.getAllProviders()
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function registerIpcHandlers(): void {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle('chat:sendMessage', async (event, conversationId: string, content: string) => {
    try {
      if (!db.isDatabaseConnected()) {
        throw new Error('Base de datos SQLite no está conectada.')
      }

      const userMsgId = randomUUID()
      await db.addMessage(userMsgId, conversationId, 'user', content)

      const history = await db.getMessages(conversationId)
      const messages = history.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content
      }))

      const providers = getOrderedProviders()

      const result = await failoverEngine.sendMessageStream(
        providers,
        { messages },
        (chunk) => {
          event.sender.send('chat:streamChunk', chunk)
        },
        (providerName, attempt) => {
          event.sender.send('chat:streamReset')
          event.sender.send('chat:providerSwitch', { providerName, attempt })
        }
      )

      const assistantMsgId = randomUUID()
      await db.addMessage(
        assistantMsgId,
        conversationId,
        'assistant',
        result.response.content,
        result.response.provider,
        result.response.model,
        result.response.providerType,
        result.response.tokensUsed?.total
      )

      const msgCount = history.length
      if (msgCount <= 1) {
        const title = content.substring(0, 60) + (content.length > 60 ? '...' : '')
        await db.updateConversationTitle(conversationId, title)
      }

      return {
        id: assistantMsgId,
        content: result.response.content,
        provider: result.response.provider,
        model: result.response.model,
        providerType: result.response.providerType,
        tokensUsed: result.response.tokensUsed,
        attemptCount: result.attemptCount,
        skippedProviders: result.skippedProviders
      }
    } catch (error) {
      console.error('[IPC:chat:sendMessage] Error:', error)
      throw new Error(toErrorMessage(error))
    }
  })

  ipcMain.handle('chat:getConversations', async () => {
    return await db.getConversations()
  })

  ipcMain.handle('chat:getMessages', async (_, conversationId: string) => {
    return await db.getMessages(conversationId)
  })

  ipcMain.handle('chat:createConversation', async (_, title?: string) => {
    const id = randomUUID()
    await db.createConversation(id, title || 'New Chat')
    return { id, title: title || 'New Chat', created_at: new Date(), updated_at: new Date() }
  })

  ipcMain.handle('chat:deleteConversation', async (_, id: string) => {
    await db.deleteConversation(id)
  })

  ipcMain.handle('chat:renameConversation', async (_, id: string, title: string) => {
    await db.updateConversationTitle(id, title)
  })

  ipcMain.handle('providers:getAll', async () => {
    const configs = await loadProvidersFromDB()
    return configs.map((c) => ({
      ...c,
      config: {
        ...c.config,
        apiKey: undefined,
        hasApiKey: !!c.config.apiKey
      }
    }))
  })

  ipcMain.handle('providers:add', async (_, input: ProviderConfigInput) => {
    const id = randomUUID()
    const defaults = PROVIDER_DEFAULTS[input.type]
    const existingProviders = await db.getProviders()
    const sortOrder = existingProviders.length

    await db.saveProvider({
      id,
      type: input.type,
      displayName: input.displayName || defaults.displayName,
      baseUrl: input.config.baseUrl || defaults.baseUrl,
      model: input.config.model || defaults.model,
      customHeaders: input.config.customHeaders,
      sortOrder,
      enabled: input.enabled !== false
    })

    if (input.config.apiKey) {
      secureStore.saveApiKey(id, input.config.apiKey)
    }

    await refreshProviders()
    return { id, type: input.type, displayName: input.displayName || defaults.displayName }
  })

  ipcMain.handle('providers:update', async (_, id: string, input: Partial<ProviderConfigInput>) => {
    const existing = await loadProvidersFromDB()
    const provider = existing.find((p) => p.id === id)
    if (!provider) throw new Error(`Provider ${id} not found`)

    await db.saveProvider({
      id,
      type: input.type || provider.type,
      displayName: input.displayName || provider.displayName,
      baseUrl: input.config?.baseUrl ?? provider.config.baseUrl,
      model: input.config?.model ?? provider.config.model,
      customHeaders: input.config?.customHeaders ?? provider.config.customHeaders,
      sortOrder: provider.sortOrder,
      enabled: input.enabled ?? provider.enabled
    })

    if (input.config?.apiKey !== undefined) {
      if (input.config.apiKey) {
        secureStore.saveApiKey(id, input.config.apiKey)
      } else {
        secureStore.removeApiKey(id)
      }
    }

    await refreshProviders()
  })

  ipcMain.handle('providers:remove', async (_, id: string) => {
    await db.deleteProvider(id)
    secureStore.removeApiKey(id)
    providerManager.removeProvider(id)
    await refreshProviders()
  })

  ipcMain.handle('providers:reorder', async (_, orderedIds: string[]) => {
    await db.updateProviderOrder(orderedIds)
    await refreshProviders()
  })

  ipcMain.handle('providers:test', async (_, id: string) => {
    const provider = providerManager.getProvider(id)
    if (!provider) {
      const configs = await loadProvidersFromDB()
      const config = configs.find((c) => c.id === id)
      if (!config) return { success: false, error: 'Provider not found' }
      const tempProvider = providerManager.createProvider(config)
      const result = await tempProvider.testConnection()
      if (!config.enabled) providerManager.removeProvider(id)
      return result
    }
    return await provider.testConnection()
  })

  ipcMain.handle('providers:getModels', async (_, id: string) => {
    const provider = providerManager.getProvider(id)
    if (!provider || !provider.getModels) return []
    return await provider.getModels()
  })

  ipcMain.handle('providers:getTypes', () => {
    return PROVIDER_DEFAULTS
  })

  ipcMain.handle('settings:get', () => {
    return {
      ...secureStore.getAllPreferences(),
      dbConnected: db.isDatabaseConnected()
    }
  })

  ipcMain.handle('settings:update', async (_, settings: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(settings)) {
      if (key === 'dbConnected') continue
      secureStore.setPreference(key, value)
    }
  })
}

app.whenReady().then(async () => {
  try {
    await db.initDatabase()
  } catch (error) {
    console.error('[App] Database initialization failed:', error)
  }

  try {
    if (db.isDatabaseConnected()) {
      await refreshProviders()
    }
  } catch (error) {
    console.error('[App] Provider loading failed:', error)
  }

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await db.closeDatabase()
  if (process.platform !== 'darwin') app.quit()
})
