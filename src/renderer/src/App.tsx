import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

type View = 'chat' | 'settings'

interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface ChatMessage {
  id: string
  role: string
  content: string
  provider_used?: string | null
  model_used?: string | null
  provider_type?: string | null
}

interface ProviderRow {
  id: string
  type: string
  displayName: string
  enabled: boolean
  sortOrder: number
  config: {
    baseUrl?: string
    model?: string
    hasApiKey?: boolean
  }
}

interface ProviderDefaults {
  baseUrl: string
  model: string
  requiresApiKey: boolean
  displayName: string
}

const api = () => window.electronAPI

export default function App() {
  const [view, setView] = useState<View>('chat')
  const [maximized, setMaximized] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [switchNote, setSwitchNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dbConnected, setDbConnected] = useState<boolean | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const refreshConversations = useCallback(async () => {
    try {
      const list = (await api().getConversations()) as Conversation[]
      setConversations(list)
      setDbConnected(true)
      return list
    } catch {
      setDbConnected(false)
      return []
    }
  }, [])

  useEffect(() => {
    api()
      .isMaximized()
      .then(setMaximized)
      .catch(() => undefined)
    const offMax = api().onMaximizeChange(setMaximized)
    const offChunk = api().onStreamChunk((chunk) => {
      if (chunk.content) setStreamText((prev) => prev + chunk.content)
    })
    const offReset = api().onStreamReset(() => setStreamText(''))
    const offSwitch = api().onProviderSwitch((data) => {
      setSwitchNote(`Sin cuota/límite — pasando a ${data.providerName}`)
    })
    void refreshConversations()
    void api()
      .getSettings()
      .then((s) => {
        const settings = s as { dbConnected?: boolean }
        setDbConnected(settings.dbConnected ?? null)
      })
      .catch(() => undefined)
    return () => {
      offMax()
      offChunk()
      offReset()
      offSwitch()
    }
  }, [refreshConversations])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, streamText])

  const openConversation = async (id: string) => {
    setActiveId(id)
    setView('chat')
    setError(null)
    const rows = (await api().getMessages(id)) as ChatMessage[]
    setMessages(rows)
  }

  const newChat = async () => {
    setError(null)
    const created = (await api().createConversation()) as Conversation
    await refreshConversations()
    await openConversation(created.id)
  }

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!draft.trim() || sending) return
    let conversationId = activeId
    if (!conversationId) {
      const created = (await api().createConversation()) as Conversation
      conversationId = created.id
      setActiveId(created.id)
      await refreshConversations()
    }

    const content = draft.trim()
    setDraft('')
    setSending(true)
    setStreamText('')
    setSwitchNote(null)
    setError(null)
    setMessages((prev) => [...prev, { id: 'temp-user', role: 'user', content }])

    try {
      const result = (await api().sendMessage(conversationId, content)) as {
        id: string
        content: string
        provider: string
        model: string
        providerType: string
        skippedProviders?: Array<{ name: string; reason: string }>
      }
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== 'temp-user'),
        { id: `u-${Date.now()}`, role: 'user', content },
        {
          id: result.id,
          role: 'assistant',
          content: result.content,
          provider_used: result.provider,
          model_used: result.model,
          provider_type: result.providerType
        }
      ])
      if (result.skippedProviders?.length) {
        setSwitchNote(
          `Failover: ${result.skippedProviders.map((s) => `${s.name} (${s.reason})`).join(' → ')}`
        )
      } else {
        setSwitchNote(null)
      }
      await refreshConversations()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setMessages((prev) => prev.filter((m) => m.id !== 'temp-user'))
    } finally {
      setSending(false)
      setStreamText('')
    }
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="titlebar-drag">
          <span className="logo-dot" />
          <strong>AI Router</strong>
        </div>
        <div className="window-controls">
          <button type="button" onClick={() => api().minimizeWindow()} aria-label="Minimizar">
            –
          </button>
          <button type="button" onClick={() => api().maximizeWindow()} aria-label="Maximizar">
            {maximized ? '❐' : '☐'}
          </button>
          <button type="button" className="close" onClick={() => api().closeWindow()} aria-label="Cerrar">
            ×
          </button>
        </div>
      </header>

      <div className="shell">
        <aside className="sidebar">
          <button className="primary" type="button" onClick={() => void newChat()}>
            Nuevo chat
          </button>
          <nav className="conv-list">
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                className={c.id === activeId ? 'active' : ''}
                onClick={() => void openConversation(c.id)}
              >
                <span>{c.title}</span>
                <i
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    void api()
                      .deleteConversation(c.id)
                      .then(() => {
                        if (activeId === c.id) {
                          setActiveId(null)
                          setMessages([])
                        }
                        void refreshConversations()
                      })
                  }}
                >
                  ×
                </i>
              </button>
            ))}
          </nav>
          <button
            className={view === 'settings' ? 'nav-bottom active' : 'nav-bottom'}
            type="button"
            onClick={() => setView('settings')}
          >
            Ajustes
          </button>
        </aside>

        <main className="main">
          {dbConnected === false && (
            <div className="banner warn">
              Base de datos local no disponible.
            </div>
          )}
          {view === 'chat' ? (
            <section className="chat">
              <div className="messages" ref={listRef}>
                {messages.length === 0 && !sending && (
                  <div className="empty">
                    <h1>Chat con failover automático</h1>
                    <p>
                      Escribe un mensaje. Si el proveedor actual se queda sin cuota, AI Router pasa al
                      siguiente sin que tengas que hacer nada.
                    </p>
                  </div>
                )}
                {messages.map((m) => (
                  <article key={m.id} className={`bubble ${m.role}`}>
                    <div className="bubble-body">{m.content}</div>
                    {m.role === 'assistant' && m.provider_used && (
                      <div className="meta">
                        {m.provider_used}
                        {m.model_used ? ` · ${m.model_used}` : ''}
                      </div>
                    )}
                  </article>
                ))}
                {sending && streamText && (
                  <article className="bubble assistant">
                    <div className="bubble-body">{streamText}</div>
                    <div className="meta">generando…</div>
                  </article>
                )}
              </div>
              {switchNote && <div className="banner info">{switchNote}</div>}
              {error && <div className="banner error">{error}</div>}
              <form className="composer" onSubmit={(e) => void send(e)}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Escribe un mensaje…"
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                />
                <button className="primary" type="submit" disabled={sending || !draft.trim()}>
                  Enviar
                </button>
              </form>
            </section>
          ) : (
            <SettingsView onDbStatus={setDbConnected} />
          )}
        </main>
      </div>
    </div>
  )
}

function SettingsView({ onDbStatus }: { onDbStatus: (ok: boolean) => void }) {
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [types, setTypes] = useState<Record<string, ProviderDefaults>>({})
  const [addType, setAddType] = useState('gemini')
  const [status, setStatus] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const [plist, t, settings] = await Promise.all([
      api().getProviders() as Promise<ProviderRow[]>,
      api().getProviderTypes() as Promise<Record<string, ProviderDefaults>>,
      api().getSettings() as Promise<{ dbConnected?: boolean }>
    ])
    setProviders(plist)
    setTypes(t)
    if (typeof settings.dbConnected === 'boolean') onDbStatus(settings.dbConnected)
  }, [onDbStatus])

  useEffect(() => {
    void load()
  }, [load])

  const typeOptions = useMemo(() => Object.keys(types), [types])

  const move = async (index: number, dir: -1 | 1) => {
    const next = [...providers]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    const tmp = next[index]
    next[index] = next[target]
    next[target] = tmp
    setProviders(next)
    await api().reorderProviders(next.map((p) => p.id))
  }

  return (
    <section className="settings">
      <h1>Ajustes</h1>

      <h2>Persistencia Local</h2>
      <div className="card">
        <p className="hint">
          Los chats, mensajes y configuraciones de proveedores se guardan automáticamente en una base de datos local SQLite (<code>airouter.db</code>).
        </p>
      </div>

      <h2>Proveedores (orden de failover)</h2>
      <p className="hint">
        El primero de la lista se usa primero. Si responde cuota o rate-limit, se prueba el siguiente.
        Las API keys se guardan cifradas en el equipo (DPAPI).
      </p>
      <div className="provider-list">
        {providers.map((p, index) => (
          <article className="card provider" key={p.id}>
            <header>
              <strong>{p.displayName}</strong>
              <span className="pill">{p.type}</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={async (e) => {
                    await api().updateProvider(p.id, { enabled: e.target.checked })
                    await load()
                  }}
                />
                Activo
              </label>
            </header>
            <div className="grid">
              <label>
                Nombre
                <input
                  defaultValue={p.displayName}
                  onBlur={async (e) => {
                    if (e.target.value !== p.displayName) {
                      await api().updateProvider(p.id, { displayName: e.target.value })
                      await load()
                    }
                  }}
                />
              </label>
              <label>
                URL base
                <input
                  defaultValue={p.config.baseUrl || ''}
                  onBlur={async (e) => {
                    await api().updateProvider(p.id, { config: { baseUrl: e.target.value } })
                    await load()
                  }}
                />
              </label>
              <label>
                Modelo
                <input
                  defaultValue={p.config.model || ''}
                  onBlur={async (e) => {
                    await api().updateProvider(p.id, { config: { model: e.target.value } })
                    await load()
                  }}
                />
              </label>
              <label>
                API key {p.config.hasApiKey ? '(guardada)' : ''}
                <input
                  type="password"
                  placeholder={p.config.hasApiKey ? '••••••••' : 'Pegar key'}
                  onBlur={async (e) => {
                    if (!e.target.value) return
                    await api().updateProvider(p.id, { config: { apiKey: e.target.value } })
                    e.target.value = ''
                    await load()
                  }}
                />
              </label>
            </div>
            <div className="row">
              <button type="button" onClick={() => void move(index, -1)} disabled={index === 0}>
                Subir
              </button>
              <button
                type="button"
                onClick={() => void move(index, 1)}
                disabled={index === providers.length - 1}
              >
                Bajar
              </button>
              <button
                type="button"
                onClick={async () => {
                  const result = await api().testProvider(p.id)
                  setStatus({
                    ...status,
                    [p.id]: result.success
                      ? `OK${result.models?.length ? ` · ${result.models.slice(0, 3).join(', ')}` : ''}`
                      : result.error || 'Falló'
                  })
                }}
              >
                Probar
              </button>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  await api().removeProvider(p.id)
                  await load()
                }}
              >
                Quitar
              </button>
              {status[p.id] && <span className="hint">{status[p.id]}</span>}
            </div>
          </article>
        ))}
      </div>

      <div className="row add-row">
        <select value={addType} onChange={(e) => setAddType(e.target.value)}>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {types[t].displayName}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const defaults = types[addType]
            await api().addProvider({
              type: addType,
              displayName: defaults.displayName,
              enabled: true,
              config: { baseUrl: defaults.baseUrl, model: defaults.model }
            })
            await load()
          }}
        >
          Agregar proveedor
        </button>
      </div>
    </section>
  )
}
