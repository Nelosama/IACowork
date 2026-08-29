// ============================================================
// Provider Manager — Factory + Registry for AI providers
// Creates concrete provider instances from configuration.
// ============================================================

import { AIProvider, ProviderConfig, PROVIDER_DEFAULTS, ProviderType } from './types'
import { OllamaProvider } from './ollama'
import { GeminiProvider } from './gemini'
import { DeepSeekProvider } from './deepseek'
import { OpenRouterProvider } from './openrouter'
import { GenericOpenAIProvider } from './generic-openai'

const PROVIDER_CONSTRUCTORS: Record<
  ProviderType,
  new (options: {
    id: string
    type: ProviderType
    displayName: string
    baseUrl: string
    model: string
    apiKey?: string
    customHeaders?: Record<string, string>
  }) => AIProvider
> = {
  ollama: OllamaProvider,
  gemini: GeminiProvider,
  deepseek: DeepSeekProvider,
  openrouter: OpenRouterProvider,
  'openai-compatible': GenericOpenAIProvider
}

export class ProviderManager {
  private instances: Map<string, AIProvider> = new Map()

  createProvider(config: ProviderConfig): AIProvider {
    const Constructor = PROVIDER_CONSTRUCTORS[config.type]
    if (!Constructor) {
      throw new Error(`Unknown provider type: ${config.type}`)
    }

    const instance = new Constructor({
      id: config.id,
      type: config.type,
      displayName: config.displayName,
      baseUrl: config.config.baseUrl || '',
      model: config.config.model || '',
      apiKey: config.config.apiKey,
      customHeaders: config.config.customHeaders
    })

    this.instances.set(config.id, instance)
    return instance
  }

  getProvider(id: string): AIProvider | undefined {
    return this.instances.get(id)
  }

  removeProvider(id: string): void {
    this.instances.delete(id)
  }

  getAllProviders(): AIProvider[] {
    return Array.from(this.instances.values())
  }

  loadProviders(configs: ProviderConfig[]): void {
    this.instances.clear()
    const ordered = [...configs].sort((a, b) => a.sortOrder - b.sortOrder)
    for (const config of ordered) {
      if (!config.enabled) continue
      const requiresKey = PROVIDER_DEFAULTS[config.type]?.requiresApiKey
      if (requiresKey && !config.config.apiKey) {
        console.warn(`[ProviderManager] Skipping "${config.displayName}" — missing API key`)
        continue
      }
      this.createProvider(config)
    }
  }

  clear(): void {
    this.instances.clear()
  }
}
