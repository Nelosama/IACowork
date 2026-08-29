// ============================================================
// Database Layer — SQLite connection and schema (better-sqlite3)
// Manages conversations, messages, and provider configurations locally.
// API keys are NOT stored here — they use safeStorage.
// ============================================================

import Database from 'better-sqlite3'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

let db: Database.Database | null = null

export interface DatabaseConfig {
  dbPath?: string
}

function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true })
  }
  return path.join(userDataPath, 'airouter.db')
}

/** Initialize the database connection and create tables if needed */
export async function initDatabase(config?: Partial<DatabaseConfig>): Promise<Database.Database> {
  if (db) return db

  const dbPath = config?.dbPath || getDbPath()

  try {
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')

    createTables()
    seedDefaultProviders()
    console.log('[DB] Connected to SQLite database at:', dbPath)
    return db
  } catch (error) {
    db = null
    console.error('[DB] Connection failed:', error)
    throw error
  }
}

/** Create tables if they don't exist */
function createTables(): void {
  if (!db) throw new Error('Database not connected')

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      provider_used TEXT NULL,
      model_used TEXT NULL,
      provider_type TEXT NULL,
      tokens_used INTEGER NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      base_url TEXT NULL,
      model TEXT NULL,
      custom_headers TEXT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS IX_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS IX_providers_sort_order ON providers(sort_order);
  `)
}

function seedDefaultProviders(): void {
  if (!db) throw new Error('Database not connected')
  const row = db.prepare('SELECT COUNT(*) AS c FROM providers').get() as { c: number }
  if (row.c > 0) return

  const { randomUUID } = require('crypto')
  db.prepare(
    `INSERT INTO providers (id, type, display_name, base_url, model, sort_order, enabled)
     VALUES (?, ?, ?, ?, ?, 0, 1)`
  ).run(
    randomUUID(),
    'ollama',
    'Ollama (Local)',
    'http://localhost:11434/v1',
    'llama3.2'
  )
}

export async function createConversation(id: string, title: string = 'New Chat'): Promise<void> {
  if (!db) throw new Error('Database not connected')
  db.prepare('INSERT INTO conversations (id, title) VALUES (?, ?)').run(id, title)
}

export async function getConversations(): Promise<
  Array<{ id: string; title: string; created_at: string; updated_at: string }>
> {
  if (!db) throw new Error('Database not connected')
  return db
    .prepare('SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC')
    .all() as Array<{ id: string; title: string; created_at: string; updated_at: string }>
}

export async function updateConversationTitle(id: string, title: string): Promise<void> {
  if (!db) throw new Error('Database not connected')
  db.prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, id)
}

export async function deleteConversation(id: string): Promise<void> {
  if (!db) throw new Error('Database not connected')
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export async function addMessage(
  id: string,
  conversationId: string,
  role: string,
  content: string,
  providerUsed?: string,
  modelUsed?: string,
  providerType?: string,
  tokensUsed?: number
): Promise<void> {
  if (!db) throw new Error('Database not connected')
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, provider_used, model_used, provider_type, tokens_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    conversationId,
    role,
    content,
    providerUsed || null,
    modelUsed || null,
    providerType || null,
    tokensUsed || null
  )

  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId)
}

export async function getMessages(conversationId: string): Promise<
  Array<{
    id: string
    conversation_id: string
    role: string
    content: string
    provider_used: string | null
    model_used: string | null
    provider_type: string | null
    tokens_used: number | null
    created_at: string
  }>
> {
  if (!db) throw new Error('Database not connected')
  return db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId) as Array<{
    id: string
    conversation_id: string
    role: string
    content: string
    provider_used: string | null
    model_used: string | null
    provider_type: string | null
    tokens_used: number | null
    created_at: string
  }>
}

export async function saveProvider(provider: {
  id: string
  type: string
  displayName: string
  baseUrl?: string
  model?: string
  customHeaders?: Record<string, string>
  sortOrder: number
  enabled: boolean
}): Promise<void> {
  if (!db) throw new Error('Database not connected')
  db.prepare(
    `INSERT INTO providers (id, type, display_name, base_url, model, custom_headers, sort_order, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type,
       display_name=excluded.display_name,
       base_url=excluded.base_url,
       model=excluded.model,
       custom_headers=excluded.custom_headers,
       sort_order=excluded.sort_order,
       enabled=excluded.enabled`
  ).run(
    provider.id,
    provider.type,
    provider.displayName,
    provider.baseUrl || null,
    provider.model || null,
    provider.customHeaders ? JSON.stringify(provider.customHeaders) : null,
    provider.sortOrder,
    provider.enabled ? 1 : 0
  )
}

export async function getProviders(): Promise<
  Array<{
    id: string
    type: string
    display_name: string
    base_url: string | null
    model: string | null
    custom_headers: string | null
    sort_order: number
    enabled: boolean
  }>
> {
  if (!db) throw new Error('Database not connected')
  const rows = db.prepare('SELECT * FROM providers ORDER BY sort_order ASC').all() as Array<{
    id: string
    type: string
    display_name: string
    base_url: string | null
    model: string | null
    custom_headers: string | null
    sort_order: number
    enabled: boolean
  }>
  return rows.map((r) => ({ ...r, enabled: Boolean(r.enabled) }))
}

export async function deleteProvider(id: string): Promise<void> {
  if (!db) throw new Error('Database not connected')
  db.prepare('DELETE FROM providers WHERE id = ?').run(id)
}

export async function updateProviderOrder(orderedIds: string[]): Promise<void> {
  if (!db) throw new Error('Database not connected')
  const stmt = db.prepare('UPDATE providers SET sort_order = ? WHERE id = ?')
  for (let i = 0; i < orderedIds.length; i++) {
    stmt.run(i, orderedIds[i])
  }
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    db.close()
    db = null
    console.log('[DB] SQLite connection closed')
  }
}

export function isDatabaseConnected(): boolean {
  return db !== null
}
