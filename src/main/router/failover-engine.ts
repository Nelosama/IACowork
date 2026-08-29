// ============================================================
// Failover Router Engine
// Ordered provider list with automatic failover on quota,
// rate-limit, and network errors.
// ============================================================

import {
  AIProvider,
  AIResponse,
  SendMessageParams,
  StreamChunk,
  QuotaExceededError,
  RateLimitError,
  NetworkError,
  ProviderError
} from '../providers/types'

export interface FailoverResult {
  response: AIResponse
  attemptCount: number
  skippedProviders: Array<{ name: string; reason: string }>
}

export type FailoverStreamResult = FailoverResult

export function isFailoverError(
  error: unknown
): error is QuotaExceededError | RateLimitError | NetworkError {
  return (
    error instanceof QuotaExceededError ||
    error instanceof RateLimitError ||
    error instanceof NetworkError
  )
}

function failoverReason(error: QuotaExceededError | RateLimitError | NetworkError): string {
  if (error instanceof QuotaExceededError) return 'Quota exceeded'
  if (error instanceof RateLimitError) {
    return error.retryAfter ? `Rate limited (retry after ${error.retryAfter}s)` : 'Rate limited'
  }
  return 'Unavailable (network)'
}

export class FailoverEngine {
  async sendMessage(providers: AIProvider[], params: SendMessageParams): Promise<FailoverResult> {
    if (providers.length === 0) {
      throw new Error('No providers configured. Add at least one provider in Settings.')
    }

    const skippedProviders: Array<{ name: string; reason: string }> = []
    let attemptCount = 0

    for (const provider of providers) {
      attemptCount++
      console.log(
        `[Failover] Attempting provider ${attemptCount}/${providers.length}: "${provider.displayName}"`
      )

      try {
        const response = await provider.sendMessage(params)
        console.log(`[Failover] Success with "${provider.displayName}" (attempt ${attemptCount})`)
        return { response, attemptCount, skippedProviders }
      } catch (error) {
        if (isFailoverError(error)) {
          const reason = failoverReason(error)
          console.warn(`[Failover] "${provider.displayName}" — ${reason}. Trying next provider...`)
          skippedProviders.push({ name: provider.displayName, reason })
          continue
        }

        console.error(
          `[Failover] "${provider.displayName}" — Non-recoverable error:`,
          (error as Error).message
        )
        throw error
      }
    }

    const providerNames = skippedProviders.map((p) => `"${p.name}" (${p.reason})`).join(', ')
    throw new ProviderError(
      `All ${providers.length} providers exhausted. Tried: ${providerNames}. Check your API keys and quotas in Settings.`,
      'FailoverEngine',
      'openai-compatible'
    )
  }

  async sendMessageStream(
    providers: AIProvider[],
    params: SendMessageParams,
    onChunk: (chunk: StreamChunk) => void,
    onProviderSwitch?: (providerName: string, attemptNumber: number) => void
  ): Promise<FailoverStreamResult> {
    if (providers.length === 0) {
      throw new Error('No providers configured. Add at least one provider in Settings.')
    }

    const skippedProviders: Array<{ name: string; reason: string }> = []
    let attemptCount = 0

    for (const provider of providers) {
      attemptCount++
      console.log(
        `[Failover:Stream] Attempting provider ${attemptCount}/${providers.length}: "${provider.displayName}"`
      )

      if (onProviderSwitch && attemptCount > 1) {
        onProviderSwitch(provider.displayName, attemptCount)
      }

      try {
        const response = await provider.sendMessageStream(params, onChunk)
        console.log(
          `[Failover:Stream] Success with "${provider.displayName}" (attempt ${attemptCount})`
        )
        return { response, attemptCount, skippedProviders }
      } catch (error) {
        if (isFailoverError(error)) {
          const reason = failoverReason(error)
          console.warn(
            `[Failover:Stream] "${provider.displayName}" — ${reason}. Trying next provider...`
          )
          skippedProviders.push({ name: provider.displayName, reason })
          continue
        }

        console.error(
          `[Failover:Stream] "${provider.displayName}" — Non-recoverable error:`,
          (error as Error).message
        )
        throw error
      }
    }

    const providerNames = skippedProviders.map((p) => `"${p.name}" (${p.reason})`).join(', ')
    throw new ProviderError(
      `All ${providers.length} providers exhausted during streaming. Tried: ${providerNames}.`,
      'FailoverEngine',
      'openai-compatible'
    )
  }
}
