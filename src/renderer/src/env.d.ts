/// <reference types="vite/client" />

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
  testDatabase(dbConfig: unknown): Promise<{ success: boolean; error?: string }>
  minimizeWindow(): void
  maximizeWindow(): void
  closeWindow(): void
  isMaximized(): Promise<boolean>
  onMaximizeChange(callback: (isMaximized: boolean) => void): () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
