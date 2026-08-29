// ============================================================
// Secure Store — Encrypted API key storage using Electron's safeStorage
// Uses DPAPI on Windows to encrypt API keys at rest.
// Non-sensitive preferences use electron-store.
// ============================================================

import { safeStorage, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import Store from 'electron-store'

const KEYS_FILENAME = 'encrypted-keys.json'

const preferencesStore = new Store({
  name: 'preferences',
  defaults: {
    windowBounds: { width: 1200, height: 800, x: undefined, y: undefined },
    sidebarCollapsed: false,
    theme: 'dark' as const,
    dbConfig: {
      server: 'localhost',
      database: 'AIRouter',
      port: 1433,
      trustedConnection: true
    }
  }
})

function getKeysFilePath(): string {
  return path.join(app.getPath('userData'), KEYS_FILENAME)
}

function readEncryptedKeys(): Record<string, string> {
  const filePath = getKeysFilePath()
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('[SecureStore] Failed to read encrypted keys:', error)
  }
  return {}
}

function writeEncryptedKeys(keys: Record<string, string>): void {
  const filePath = getKeysFilePath()
  try {
    fs.writeFileSync(filePath, JSON.stringify(keys, null, 2), 'utf-8')
  } catch (error) {
    console.error('[SecureStore] Failed to write encrypted keys:', error)
  }
}

export function saveApiKey(providerId: string, apiKey: string): void {
  const keys = readEncryptedKeys()

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(apiKey)
    keys[providerId] = encrypted.toString('base64')
  } else {
    console.warn('[SecureStore] safeStorage unavailable — using base64 fallback')
    keys[providerId] = `b64:${Buffer.from(apiKey).toString('base64')}`
  }

  writeEncryptedKeys(keys)
}

export function getApiKey(providerId: string): string | null {
  const keys = readEncryptedKeys()
  const stored = keys[providerId]

  if (!stored) return null

  try {
    if (stored.startsWith('b64:')) {
      return Buffer.from(stored.slice(4), 'base64').toString('utf-8')
    }

    if (safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(stored, 'base64')
      return safeStorage.decryptString(buffer)
    }

    return null
  } catch (error) {
    console.error('[SecureStore] Failed to decrypt API key for', providerId, error)
    return null
  }
}

export function removeApiKey(providerId: string): void {
  const keys = readEncryptedKeys()
  delete keys[providerId]
  writeEncryptedKeys(keys)
}

export function hasApiKey(providerId: string): boolean {
  const keys = readEncryptedKeys()
  return !!keys[providerId]
}

export function getPreference<T>(key: string): T {
  return preferencesStore.get(key) as T
}

export function setPreference<T>(key: string, value: T): void {
  preferencesStore.set(key, value)
}

export function getAllPreferences(): Record<string, unknown> {
  return preferencesStore.store
}

export { preferencesStore }
