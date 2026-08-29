import { BaseOpenAIProvider, BaseOpenAIProviderOptions } from './base-openai'
import {
  ProviderType,
  QuotaExceededError,
  RateLimitError,
  AuthenticationError,
  ProviderError
} from './types'

export class GeminiProvider extends BaseOpenAIProvider {
  constructor(options: Omit<BaseOpenAIProviderOptions, 'type'> & { type?: ProviderType }) {
    super({
      ...options,
      type: 'gemini',
      baseUrl: options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: options.model || 'gemini-2.5-flash'
    })
  }

  protected handleErrorResponse(status: number, body: string): never {
    const bodyLower = body.toLowerCase()

    if (status === 401 || status === 403) {
      throw new AuthenticationError(this.displayName, this.type, status)
    }

    if (status === 429) {
      if (bodyLower.includes('quota') || bodyLower.includes('resource_exhausted')) {
        throw new QuotaExceededError(this.displayName, this.type, status, body)
      }
      throw new RateLimitError(this.displayName, this.type, undefined, status)
    }

    if (bodyLower.includes('resource_exhausted') || bodyLower.includes('quota')) {
      throw new QuotaExceededError(this.displayName, this.type, status, body)
    }

    if (bodyLower.includes('rate_limit') || bodyLower.includes('too many requests')) {
      throw new RateLimitError(this.displayName, this.type, undefined, status)
    }

    throw new ProviderError(
      `Gemini returned error ${status}: ${body.substring(0, 200)}`,
      this.displayName,
      this.type,
      status,
      body
    )
  }

  async getModels(): Promise<string[]> {
    return [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro'
    ]
  }
}
