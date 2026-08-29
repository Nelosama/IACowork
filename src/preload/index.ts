// ============================================================
// Preload Script — Secure bridge between Main and Renderer
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'

export interface ElectronAPI {
  sendMessage(conversationId: string, content: string): Promise<unknown>
  onStreamChunk(callback: (chunk: { content: string; done: boolean }) => void): () => void
  onStreamReset(callback: () => void): () => void
  onProviderSwitch(callback: (data: { providerName: string; attempt: number }) => void): () => void
  getConversations(): Promise<unknown[]>
  getMessages(conversationId: string): Promise<unknown[]>
  createConversation(title?: string): Promise<unknown>
  deleteConversation(id: string): Promise<void>
  renameConversation(id: string, title: string): Promise<void>

  getProviders(): Promise<unknown[]>
  addProvider(config: unknown): Promise<unknown>
  updateProvider(id: string, config: unknown): Promise<void>
  removeProvider(id: string): Promise<void>
  reorderProviders(orderedIds: string[]): Promise<void>
  testProvider(id: string): Promise<{ success: boolean; error?: string; models?: string[] }>
  getAvailableModels(providerId: string): Promise<string[]>
  getProviderTypes(): Promise<unknown>

  getSettings(): Promise<unknown>
  updateSettings(settings: unknown): Promise<void>

  minimizeWindow(): void
  maximizeWindow(): void
  closeWindow(): void
  isMaximized(): Promise<boolean>
  onMaximizeChange(callback: (isMaximized: boolean) => void): () => void
}

const api: ElectronAPI = {
  sendMessage: (conversationId, content) =>
    ipcRenderer.invoke('chat:sendMessage', conversationId, content),

  onStreamChunk: (callback) => {
    const handler = (_: unknown, chunk: { content: string; done: boolean }) => callback(chunk)
    ipcRenderer.on('chat:streamChunk', handler)
    return () => ipcRenderer.removeListener('chat:streamChunk', handler)
  },

  onStreamReset: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('chat:streamReset', handler)
    return () => ipcRenderer.removeListener('chat:streamReset', handler)
  },

  onProviderSwitch: (callback) => {
    const handler = (_: unknown, data: { providerName: string; attempt: number }) => callback(data)
    ipcRenderer.on('chat:providerSwitch', handler)
    return () => ipcRenderer.removeListener('chat:providerSwitch', handler)
  },

  getConversations: () => ipcRenderer.invoke('chat:getConversations'),
  getMessages: (conversationId) => ipcRenderer.invoke('chat:getMessages', conversationId),
  createConversation: (title) => ipcRenderer.invoke('chat:createConversation', title),
  deleteConversation: (id) => ipcRenderer.invoke('chat:deleteConversation', id),
  renameConversation: (id, title) => ipcRenderer.invoke('chat:renameConversation', id, title),

  getProviders: () => ipcRenderer.invoke('providers:getAll'),
  addProvider: (config) => ipcRenderer.invoke('providers:add', config),
  updateProvider: (id, config) => ipcRenderer.invoke('providers:update', id, config),
  removeProvider: (id) => ipcRenderer.invoke('providers:remove', id),
  reorderProviders: (orderedIds) => ipcRenderer.invoke('providers:reorder', orderedIds),
  testProvider: (id) => ipcRenderer.invoke('providers:test', id),
  getAvailableModels: (providerId) => ipcRenderer.invoke('providers:getModels', providerId),
  getProviderTypes: () => ipcRenderer.invoke('providers:getTypes'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),

  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (callback) => {
    const handler = (_: unknown, isMaximized: boolean) => callback(isMaximized)
    ipcRenderer.on('window:maximizeChange', handler)
    return () => ipcRenderer.removeListener('window:maximizeChange', handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
