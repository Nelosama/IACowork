import { BaseOpenAIProvider, BaseOpenAIProviderOptions } from './base-openai'
import {
  ProviderType,
  QuotaExceededError,
  RateLimitError,
  AuthenticationError,
  ProviderError
} from './types'

export class OpenRouterProvider extends BaseOpenAIProvider {
  constructor(options: Omit<BaseOpenAIProviderOptions, 'type'> & { type?: ProviderType }) {
    super({
      ...options,
      type: 'openrouter',
      baseUrl: options.baseUrl || 'https://openrouter.ai/api/v1',
      model: options.model || 'openai/gpt-4o-mini'
    })
  }

  protected getHeaders(): Record<string, string> {
    return {
      ...super.getHeaders(),
      'HTTP-Referer': 'https://ai-router.app',
      'X-Title': 'AI Router'
    }
  }

  protected handleErrorResponse(status: number, body: string): never {
    const bodyLower = body.toLowerCase()

    if (status === 401 || status === 403) {
      throw new AuthenticationError(this.displayName, this.type, status)
    }

    if (status === 429) {
      throw new RateLimitError(this.displayName, this.type, undefined, status)
    }

    if (status === 402 || bodyLower.includes('insufficient credits') || bodyLower.includes('no credits')) {
      throw new QuotaExceededError(this.displayName, this.type, status, body)
    }

    if (bodyLower.includes('rate_limit') || bodyLower.includes('upstream')) {
      throw new RateLimitError(this.displayName, this.type, undefined, status)
    }

    throw new ProviderError(
      `OpenRouter returned error ${status}: ${body.substring(0, 200)}`,
      this.displayName,
      this.type,
      status,
      body
    )
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: this.getHeaders()
      })
      if (!response.ok) return this.getDefaultModels()
      const data = await response.json()
      return (data.data || []).map((m: { id: string }) => m.id)
    } catch {
      return this.getDefaultModels()
    }
  }

  private getDefaultModels(): string[] {
    return [
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
      'anthropic/claude-3-haiku',
      'google/gemini-2.5-flash',
      'google/gemini-2.5-pro',
      'meta-llama/llama-3.1-70b-instruct',
      'meta-llama/llama-3.1-8b-instruct',
      'mistralai/mistral-large',
      'deepseek/deepseek-chat'
    ]
  }
}
