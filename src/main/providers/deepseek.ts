import { BaseOpenAIProvider, BaseOpenAIProviderOptions } from './base-openai'
import {
  ProviderType,
  QuotaExceededError,
  RateLimitError,
  AuthenticationError,
  ProviderError
} from './types'

export class DeepSeekProvider extends BaseOpenAIProvider {
  constructor(options: Omit<BaseOpenAIProviderOptions, 'type'> & { type?: ProviderType }) {
    super({
      ...options,
      type: 'deepseek',
      baseUrl: options.baseUrl || 'https://api.deepseek.com',
      model: options.model || 'deepseek-chat'
    })
  }

  protected handleErrorResponse(status: number, body: string): never {
    const bodyLower = body.toLowerCase()

    if (status === 401) {
      throw new AuthenticationError(this.displayName, this.type, status)
    }

    if (status === 429) {
      throw new RateLimitError(this.displayName, this.type, undefined, status)
    }

    if (status === 402 || bodyLower.includes('insufficient_quota') || bodyLower.includes('billing')) {
      throw new QuotaExceededError(this.displayName, this.type, status, body)
    }

    if (status === 503 && bodyLower.includes('overloaded')) {
      throw new RateLimitError(this.displayName, this.type, undefined, status)
    }

    throw new ProviderError(
      `DeepSeek returned error ${status}: ${body.substring(0, 200)}`,
      this.displayName,
      this.type,
      status,
      body
    )
  }

  async getModels(): Promise<string[]> {
    return ['deepseek-chat', 'deepseek-reasoner']
  }
}
