// ============================================================
// Provider Types & Interfaces
// ============================================================

export type ProviderType =
  | 'ollama'
  | 'gemini'
  | 'deepseek'
  | 'openrouter'
  | 'openai-compatible'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface SendMessageParams {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface StreamChunk {
  content: string
  done: boolean
}

export interface AIResponse {
  content: string
  model: string
  provider: string
  providerType: ProviderType
  tokensUsed?: {
    prompt?: number
    completion?: number
    total?: number
  }
}

export interface ProviderConfig {
  id: string
  type: ProviderType
  displayName: string
  enabled: boolean
  sortOrder: number
  config: {
    baseUrl?: string
    model?: string
    apiKey?: string
    customHeaders?: Record<string, string>
  }
}

export interface ProviderConfigInput {
  type: ProviderType
  displayName: string
  enabled?: boolean
  config: {
    baseUrl?: string
    model?: string
    apiKey?: string
    customHeaders?: Record<string, string>
  }
}

export interface AIProvider {
  readonly id: string
  readonly type: ProviderType
  readonly displayName: string
  sendMessage(params: SendMessageParams): Promise<AIResponse>
  sendMessageStream(params: SendMessageParams, onChunk: (chunk: StreamChunk) => void): Promise<AIResponse>
  testConnection(): Promise<{ success: boolean; error?: string; models?: string[] }>
  isAvailable(): Promise<boolean>
  getModels?(): Promise<string[]>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly providerType: ProviderType,
    public readonly statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export class QuotaExceededError extends ProviderError {
  constructor(providerName: string, providerType: ProviderType, statusCode?: number, responseBody?: string) {
    super(`Quota exceeded for provider "${providerName}"`, providerName, providerType, statusCode, responseBody)
    this.name = 'QuotaExceededError'
  }
}

export class RateLimitError extends ProviderError {
  constructor(providerName: string, providerType: ProviderType, retryAfter?: number, statusCode?: number) {
    super(
      `Rate limit hit for provider "${providerName}"${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`,
      providerName,
      providerType,
      statusCode
    )
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
  readonly retryAfter?: number
}

export class NetworkError extends ProviderError {
  constructor(providerName: string, providerType: ProviderType, originalError?: Error) {
    super(
      `Network error connecting to "${providerName}": ${originalError?.message || 'Unknown'}`,
      providerName,
      providerType
    )
    this.name = 'NetworkError'
  }
}

export class AuthenticationError extends ProviderError {
  constructor(providerName: string, providerType: ProviderType, statusCode?: number) {
    super(
      `Authentication failed for provider "${providerName}" — check your API key`,
      providerName,
      providerType,
      statusCode
    )
    this.name = 'AuthenticationError'
  }
}

export const PROVIDER_DEFAULTS: Record<
  ProviderType,
  { baseUrl: string; model: string; requiresApiKey: boolean; displayName: string }
> = {
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    requiresApiKey: false,
    displayName: 'Ollama (Local)'
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    requiresApiKey: true,
    displayName: 'Google Gemini'
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    requiresApiKey: true,
    displayName: 'DeepSeek'
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    requiresApiKey: true,
    displayName: 'OpenRouter'
  },
  'openai-compatible': {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    requiresApiKey: true,
    displayName: 'OpenAI Compatible'
  }
}
