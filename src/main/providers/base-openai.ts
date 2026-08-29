// ============================================================
// BaseOpenAIProvider — OpenAI-compatible chat/completions API
// ============================================================

import {
  AIProvider,
  AIResponse,
  SendMessageParams,
  StreamChunk,
  ProviderType,
  ProviderError,
  QuotaExceededError,
  RateLimitError,
  NetworkError,
  AuthenticationError
} from './types'

export interface BaseOpenAIProviderOptions {
  id: string
  type: ProviderType
  displayName: string
  baseUrl: string
  model: string
  apiKey?: string
  customHeaders?: Record<string, string>
}

export abstract class BaseOpenAIProvider implements AIProvider {
  readonly id: string
  readonly type: ProviderType
  readonly displayName: string
  protected baseUrl: string
  protected model: string
  protected apiKey?: string
  protected customHeaders: Record<string, string>

  constructor(options: BaseOpenAIProviderOptions) {
    this.id = options.id
    this.type = options.type
    this.displayName = options.displayName
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.model = options.model
    this.apiKey = options.apiKey
    this.customHeaders = options.customHeaders || {}
  }

  protected getChatCompletionsUrl(): string {
    return `${this.baseUrl}/chat/completions`
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.customHeaders
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    return headers
  }

  protected buildRequestBody(params: SendMessageParams, stream: boolean): Record<string, unknown> {
    return {
      model: params.model || this.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens,
      stream
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

    if (status === 402) {
      throw new QuotaExceededError(this.displayName, this.type, status, body)
    }

    if (
      bodyLower.includes('insufficient_quota') ||
      bodyLower.includes('quota') ||
      bodyLower.includes('billing') ||
      bodyLower.includes('exceeded') ||
      bodyLower.includes('limit_reached')
    ) {
      throw new QuotaExceededError(this.displayName, this.type, status, body)
    }

    if (
      bodyLower.includes('rate_limit') ||
      bodyLower.includes('rate limit') ||
      bodyLower.includes('too many requests')
    ) {
      throw new RateLimitError(this.displayName, this.type, undefined, status)
    }

    throw new ProviderError(
      `Provider "${this.displayName}" returned error ${status}: ${body.substring(0, 200)}`,
      this.displayName,
      this.type,
      status,
      body
    )
  }

  async sendMessage(params: SendMessageParams): Promise<AIResponse> {
    try {
      const response = await fetch(this.getChatCompletionsUrl(), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(this.buildRequestBody(params, false)),
        signal: params.signal
      })

      if (!response.ok) {
        const body = await response.text()
        this.handleErrorResponse(response.status, body)
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        model?: string
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
        }
      }
      const choice = data.choices?.[0]

      return {
        content: choice?.message?.content || '',
        model: data.model || this.model,
        provider: this.displayName,
        providerType: this.type,
        tokensUsed: data.usage
          ? {
              prompt: data.usage.prompt_tokens,
              completion: data.usage.completion_tokens,
              total: data.usage.total_tokens
            }
          : undefined
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (error instanceof TypeError || (error instanceof Error && error.message.includes('fetch'))) {
        throw new NetworkError(this.displayName, this.type, error as Error)
      }
      throw new ProviderError(
        `Unexpected error from "${this.displayName}": ${(error as Error).message}`,
        this.displayName,
        this.type
      )
    }
  }

  async sendMessageStream(
    params: SendMessageParams,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<AIResponse> {
    try {
      const response = await fetch(this.getChatCompletionsUrl(), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(this.buildRequestBody(params, true)),
        signal: params.signal
      })

      if (!response.ok) {
        const body = await response.text()
        this.handleErrorResponse(response.status, body)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new ProviderError('No response body for streaming', this.displayName, this.type)
      }

      const decoder = new TextDecoder()
      let fullContent = ''
      let modelName = this.model
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') {
              onChunk({ content: '', done: true })
              continue
            }

            try {
              const parsed = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta?.content || ''
              if (parsed.model) modelName = parsed.model

              if (delta) {
                fullContent += delta
                onChunk({ content: delta, done: false })
              }
            } catch {
              // Skip malformed SSE chunks
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      return {
        content: fullContent,
        model: modelName,
        provider: this.displayName,
        providerType: this.type
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (error instanceof TypeError || (error instanceof Error && error.message.includes('fetch'))) {
        throw new NetworkError(this.displayName, this.type, error as Error)
      }
      throw new ProviderError(
        `Streaming error from "${this.displayName}": ${(error as Error).message}`,
        this.displayName,
        this.type
      )
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string; models?: string[] }> {
    try {
      const response = await this.sendMessage({
        messages: [{ role: 'user', content: 'Hello. Reply with just "OK".' }],
        maxTokens: 10
      })
      return { success: true, models: [response.model] }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(this.baseUrl, {
        method: 'GET',
        signal: controller.signal
      })
      clearTimeout(timeout)

      return response.ok || response.status === 404
    } catch {
      return false
    }
  }
}
