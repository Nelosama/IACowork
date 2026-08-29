import { BaseOpenAIProvider, BaseOpenAIProviderOptions } from './base-openai'
import { ProviderType } from './types'

export class GenericOpenAIProvider extends BaseOpenAIProvider {
  constructor(options: Omit<BaseOpenAIProviderOptions, 'type'> & { type?: ProviderType }) {
    super({
      ...options,
      type: 'openai-compatible'
    })
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.getHeaders()
      })
      if (!response.ok) return []
      const data = (await response.json()) as { data?: Array<{ id: string }> }
      return (data.data || []).map((m) => m.id)
    } catch {
      return []
    }
  }
}
