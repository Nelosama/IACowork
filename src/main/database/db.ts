// ============================================================
// Database Layer — SQL Server connection and schema
// Manages conversations, messages, and provider configurations.
// API keys are NOT stored here — they use safeStorage.
// ============================================================

import sql from 'mssql'

let pool: sql.ConnectionPool | null = null

export interface DatabaseConfig {
  server: string
  database: string
  user?: string
  password?: string
  port?: number
  /** Use Windows authentication instead of SQL auth */
  trustedConnection?: boolean
  /** Full connection string (overrides individual fields) */
  connectionString?: string
}

const DEFAULT_CONFIG: DatabaseConfig = {
  server: 'localhost',
  database: 'AIRouter',
  port: 1433,
  trustedConnection: true
}

/** Initialize the database connection and create tables if needed */
export async function initDatabase(config?: Partial<DatabaseConfig>): Promise<sql.ConnectionPool> {
  if (pool) return pool

  const dbConfig = { ...DEFAULT_CONFIG, ...config }

  try {
    if (dbConfig.connectionString) {
      pool = await sql.connect(dbConfig.connectionString)
    } else {
      const sqlConfig: sql.config = {
        server: dbConfig.server,
        database: dbConfig.database,
        port: dbConfig.port ?? 1433,
        options: {
          encrypt: false,
          trustServerCertificate: true,
          enableArithAbort: true
        }
      }

      if (dbConfig.trustedConnection) {
        sqlConfig.authentication = {
          type: 'ntlm',
          options: {
            domain: '',
            userName: '',
            password: ''
          }
        }
      } else if (dbConfig.user && dbConfig.password) {
        sqlConfig.user = dbConfig.user
        sqlConfig.password = dbConfig.password
      }

      pool = await sql.connect(sqlConfig)
    }

    await createTables()
    await seedDefaultProviders()
    console.log('[DB] Connected to SQL Server:', dbConfig.server, '/', dbConfig.database)
    return pool
  } catch (error) {
    pool = null
    console.error('[DB] Connection failed:', error)
    throw error
  }
}

/** Create tables if they don't exist */
async function createTables(): Promise<void> {
  if (!pool) throw new Error('Database not connected')

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='conversations' AND xtype='U')
    CREATE TABLE conversations (
      id NVARCHAR(36) PRIMARY KEY,
      title NVARCHAR(255) NOT NULL DEFAULT 'New Chat',
      created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    )
  `)

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='messages' AND xtype='U')
    CREATE TABLE messages (
      id NVARCHAR(36) PRIMARY KEY,
      conversation_id NVARCHAR(36) NOT NULL,
      role NVARCHAR(20) NOT NULL,
      content NVARCHAR(MAX) NOT NULL,
      provider_used NVARCHAR(100) NULL,
      model_used NVARCHAR(100) NULL,
      provider_type NVARCHAR(50) NULL,
      tokens_used INT NULL,
      created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `)

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='providers' AND xtype='U')
    CREATE TABLE providers (
      id NVARCHAR(36) PRIMARY KEY,
      type NVARCHAR(50) NOT NULL,
      display_name NVARCHAR(100) NOT NULL,
      base_url NVARCHAR(500) NULL,
      model NVARCHAR(200) NULL,
      custom_headers NVARCHAR(MAX) NULL,
      sort_order INT NOT NULL DEFAULT 0,
      enabled BIT NOT NULL DEFAULT 1,
      created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    )
  `)

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_messages_conversation_id')
    CREATE INDEX IX_messages_conversation_id ON messages(conversation_id)
  `)

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_providers_sort_order')
    CREATE INDEX IX_providers_sort_order ON providers(sort_order)
  `)
}

async function seedDefaultProviders(): Promise<void> {
  if (!pool) throw new Error('Database not connected')
  const result = await pool.request().query('SELECT COUNT(*) AS c FROM providers')
  const count = result.recordset[0]?.c ?? 0
  if (count > 0) return

  const { randomUUID } = await import('crypto')
  await pool
    .request()
    .input('id', sql.NVarChar(36), randomUUID())
    .input('type', sql.NVarChar(50), 'ollama')
    .input('displayName', sql.NVarChar(100), 'Ollama (Local)')
    .input('baseUrl', sql.NVarChar(500), 'http://localhost:11434/v1')
    .input('model', sql.NVarChar(200), 'llama3.2')
    .query(
      `INSERT INTO providers (id, type, display_name, base_url, model, sort_order, enabled)
       VALUES (@id, @type, @displayName, @baseUrl, @model, 0, 1)`
    )
}

export async function createConversation(id: string, title: string = 'New Chat'): Promise<void> {
  if (!pool) throw new Error('Database not connected')
  await pool
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('title', sql.NVarChar(255), title)
    .query('INSERT INTO conversations (id, title) VALUES (@id, @title)')
}

export async function getConversations(): Promise<
  Array<{ id: string; title: string; created_at: Date; updated_at: Date }>
> {
  if (!pool) throw new Error('Database not connected')
  const result = await pool
    .request()
    .query('SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC')
  return result.recordset
}

export async function updateConversationTitle(id: string, title: string): Promise<void> {
  if (!pool) throw new Error('Database not connected')
  await pool
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('title', sql.NVarChar(255), title)
    .query('UPDATE conversations SET title = @title, updated_at = GETUTCDATE() WHERE id = @id')
}

export async function deleteConversation(id: string): Promise<void> {
  if (!pool) throw new Error('Database not connected')
  await pool.request().input('id', sql.NVarChar(36), id).query('DELETE FROM conversations WHERE id = @id')
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
  if (!pool) throw new Error('Database not connected')
  await pool
    .request()
    .input('id', sql.NVarChar(36), id)
    .input('conversationId', sql.NVarChar(36), conversationId)
    .input('role', sql.NVarChar(20), role)
    .input('content', sql.NVarChar(sql.MAX), content)
    .input('providerUsed', sql.NVarChar(100), providerUsed || null)
    .input('modelUsed', sql.NVarChar(100), modelUsed || null)
    .input('providerType', sql.NVarChar(50), providerType || null)
    .input('tokensUsed', sql.Int, tokensUsed || null)
    .query(`INSERT INTO messages (id, conversation_id, role, content, provider_used, model_used, provider_type, tokens_used)
            VALUES (@id, @conversationId, @role, @content, @providerUsed, @modelUsed, @providerType, @tokensUsed)`)

  await pool
    .request()
    .input('cid', sql.NVarChar(36), conversationId)
    .query('UPDATE conversations SET updated_at = GETUTCDATE() WHERE id = @cid')
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
    created_at: Date
  }>
> {
  if (!pool) throw new Error('Database not connected')
  const result = await pool
    .request()
    .input('conversationId', sql.NVarChar(36), conversationId)
    .query('SELECT * FROM messages WHERE conversation_id = @conversationId ORDER BY created_at ASC')
  return result.recordset
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
  if (!pool) throw new Error('Database not connected')
  await pool
    .request()
    .input('id', sql.NVarChar(36), provider.id)
    .input('type', sql.NVarChar(50), provider.type)
    .input('displayName', sql.NVarChar(100), provider.displayName)
    .input('baseUrl', sql.NVarChar(500), provider.baseUrl || null)
    .input('model', sql.NVarChar(200), provider.model || null)
    .input(
      'customHeaders',
      sql.NVarChar(sql.MAX),
      provider.customHeaders ? JSON.stringify(provider.customHeaders) : null
    )
    .input('sortOrder', sql.Int, provider.sortOrder)
    .input('enabled', sql.Bit, provider.enabled ? 1 : 0)
    .query(`MERGE providers AS target
            USING (SELECT @id AS id) AS source ON target.id = source.id
            WHEN MATCHED THEN
              UPDATE SET type = @type, display_name = @displayName, base_url = @baseUrl,
                         model = @model, custom_headers = @customHeaders, sort_order = @sortOrder, enabled = @enabled
            WHEN NOT MATCHED THEN
              INSERT (id, type, display_name, base_url, model, custom_headers, sort_order, enabled)
              VALUES (@id, @type, @displayName, @baseUrl, @model, @customHeaders, @sortOrder, @enabled);`)
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
  if (!pool) throw new Error('Database not connected')
  const result = await pool.request().query('SELECT * FROM providers ORDER BY sort_order ASC')
  return result.recordset
}

export async function deleteProvider(id: string): Promise<void> {
  if (!pool) throw new Error('Database not connected')
  await pool.request().input('id', sql.NVarChar(36), id).query('DELETE FROM providers WHERE id = @id')
}

export async function updateProviderOrder(orderedIds: string[]): Promise<void> {
  if (!pool) throw new Error('Database not connected')
  for (let i = 0; i < orderedIds.length; i++) {
    await pool
      .request()
      .input('id', sql.NVarChar(36), orderedIds[i])
      .input('sortOrder', sql.Int, i)
      .query('UPDATE providers SET sort_order = @sortOrder WHERE id = @id')
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.close()
    pool = null
    console.log('[DB] Connection closed')
  }
}

export function isDatabaseConnected(): boolean {
  return pool !== null
}
