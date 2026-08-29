# AI Router

Cliente de escritorio para Windows: chat con varios proveedores de IA y failover automático cuando el actual se queda sin cuota o responde rate-limit. La persistencia es **SQL Server**.

## Desarrollo

Requisitos: Node.js 20+, SQL Server accesible (por defecto `localhost` / base `AIRouter`, autenticación de Windows).

```bash
npm install
npm run dev
```

En **Ajustes** conecta SQL Server, agrega proveedores (Gemini, DeepSeek, OpenRouter, Ollama, u OpenAI-compatible) y ordena la prioridad con Subir/Bajar.

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
