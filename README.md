# AI Router

Cliente de escritorio para Windows: chat con varios proveedores de IA y failover automático transparente cuando el proveedor actual se queda sin cuota o responde rate-limit. La persistencia local se maneja con **SQLite** (`better-sqlite3`).

## Proveedores soportados

1. **Ollama** (local, `http://localhost:11434/v1`) — respaldo sin límite.
2. **Google AI Studio (Gemini)** — API oficial con key.
3. **DeepSeek** — API oficial con key.
4. **OpenRouter** — API compatible con formato OpenAI.
5. **Conector genérico OpenAI-compatible** — configurable con URL base + key + modelo.

## Desarrollo


```bash
npm install
npm run dev
```

En **Ajustes** puedes agregar proveedores, colocar tus API keys y reordenar la prioridad de failover con Subir/Bajar.

Ollama local: `http://localhost:11434` (sin API key). Las keys se cifran en el equipo con DPAPI.

## Instalador Windows (NSIS)

```bash
npm run dist
```

El `.exe` queda en `dist/`, por ejemplo `AI-Router-Setup-1.0.0.exe`. Instálalo y ábrelo desde el escritorio o el menú Inicio.

## Probar el failover (sin APIs)

```bash
npm run test:failover
```

Simula cuota y rate-limit y comprueba que responde el siguiente proveedor.
