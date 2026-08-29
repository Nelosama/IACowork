import { BaseOpenAIProvider, BaseOpenAIProviderOptions } from './base-openai'
import { ProviderType } from './types'

export class OllamaProvider extends BaseOpenAIProvider {
  constructor(options: Omit<BaseOpenAIProviderOptions, 'type'> & { type?: ProviderType }) {
    super({
      ...options,
      type: 'ollama',
      baseUrl: options.baseUrl || 'http://localhost:11434/v1',
      model: options.model || 'llama3.2'
    })
  }

  async getModels(): Promise<string[]> {
    try {
      const nativeUrl = this.baseUrl.replace('/v1', '')
      const response = await fetch(`${nativeUrl}/api/tags`)
      if (!response.ok) return []
      const data = (await response.json()) as { models?: Array<{ name: string }> }
      return (data.models || []).map((m) => m.name)
    } catch {
      return []
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const nativeUrl = this.baseUrl.replace('/v1', '')
      const response = await fetch(`${nativeUrl}/api/tags`, { signal: controller.signal })
      clearTimeout(timeout)
      return response.ok
    } catch {
      return false
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string; models?: string[] }> {
    try {
      const available = await this.isAvailable()
      if (!available) {
        return { success: false, error: 'Ollama is not running. Start it with "ollama serve".' }
      }
      const models = await this.getModels()
      if (models.length === 0) {
        return {
          success: false,
          error: 'Ollama is running but has no models. Pull one with "ollama pull llama3.2".'
        }
      }
      return { success: true, models }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }
}
