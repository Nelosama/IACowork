import {
  AIProvider,
  AIResponse,
  ChatMessage,
  ProviderType,
  QuotaExceededError,
  RateLimitError,
  SendMessageParams,
  StreamChunk
} from '../providers/types'
import { FailoverEngine } from './failover-engine'

class MockProvider implements AIProvider {
  readonly type: ProviderType = 'openai-compatible'

  constructor(
    readonly id: string,
    readonly displayName: string,
    private readonly behavior: 'ok' | 'quota' | 'rate'
  ) {}

  async sendMessage(_params: SendMessageParams): Promise<AIResponse> {
    if (this.behavior === 'quota') {
      throw new QuotaExceededError(this.displayName, this.type, 402, 'insufficient_quota')
    }
    if (this.behavior === 'rate') {
      throw new RateLimitError(this.displayName, this.type, undefined, 429)
    }
    return {
      content: `respuesta de ${this.displayName}`,
      model: 'mock',
      provider: this.displayName,
      providerType: this.type
    }
  }

  async sendMessageStream(
    params: SendMessageParams,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<AIResponse> {
    const response = await this.sendMessage(params)
    onChunk({ content: response.content, done: false })
    onChunk({ content: '', done: true })
    return response
  }

  async testConnection() {
    return { success: this.behavior === 'ok' }
  }

  async isAvailable() {
    return this.behavior === 'ok'
  }
}

async function run(): Promise<void> {
  const engine = new FailoverEngine()
  const messages: ChatMessage[] = [{ role: 'user', content: 'hola' }]

  const result = await engine.sendMessage(
    [
      new MockProvider('1', 'Gemini (sin cuota)', 'quota'),
      new MockProvider('2', 'DeepSeek (rate limit)', 'rate'),
      new MockProvider('3', 'Ollama', 'ok')
    ],
    { messages }
  )

  if (result.response.provider !== 'Ollama') {
    throw new Error(`Expected Ollama, got ${result.response.provider}`)
  }
  if (result.attemptCount !== 3) {
    throw new Error(`Expected 3 attempts, got ${result.attemptCount}`)
  }
  if (result.skippedProviders.length !== 2) {
    throw new Error(`Expected 2 skipped, got ${result.skippedProviders.length}`)
  }

  const stream = await engine.sendMessageStream(
    [new MockProvider('a', 'Broken', 'quota'), new MockProvider('b', 'Backup', 'ok')],
    { messages },
    () => undefined
  )
  if (stream.response.provider !== 'Backup') {
    throw new Error(`Stream failover failed, got ${stream.response.provider}`)
  }

  console.log('failover-engine.test.ts: OK')
  console.log('  skipped:', result.skippedProviders)
  console.log('  winner:', result.response.provider)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
