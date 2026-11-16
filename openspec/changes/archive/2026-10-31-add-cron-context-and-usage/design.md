# Design

## Context

Verificado en esta máquina con `opencode 2.2.0`:

- `OPENCODE_CONFIG_CONTENT` **solo se aplica con `--standalone`**. Sin el flag, `opencode run`
  usa el servicio en segundo plano y la variable se ignora (`Agent not found` al probar un agente
  inline).
- Con `--standalone` la configuración inline funciona y la continuidad `-s <sesión>` se conserva
  (probado: una segunda ejecución recordó el dato de la primera).
- Con `--standalone` el CLI **no emite `step_finish`**, así que los tokens y el coste no llegan por
  stdout.
- `opencode session export <sesión> --sanitize` sí devuelve `info.cost`, `info.tokens` y el coste y
  tokens de cada mensaje. La sesión de un run standalone queda persistida.

## Goals / Non-Goals

**Goals:**

- Que la configuración por ejecución (MCPs) se aplique de verdad.
- Que el modelo reciba una instrucción de cron fija y oculta.
- Que el historial muestre tokens y coste por ejecución y en total.

**Non-Goals:**

- Calcular precios por cuenta propia, presupuestos o alertas.
- Cambiar el servicio compartido de opencode o la configuración del usuario.
- Renderizar Markdown (va en `render-chat-markdown`).

## Decisions

### D1. `--standalone` en todas las ejecuciones

El runner añade `--standalone` siempre. Es la única forma fiable de que `OPENCODE_CONFIG_CONTENT`
llegue a la ejecución.

**Trade-off:** cada run arranca un servidor privado (unos segundos y algo más de RAM). Los crons no
son sensibles a la latencia y el límite de concurrencia es 2, así que es asumible. Además, los
crons quedan aislados del opencode que use el usuario.

**Alternativa descartada:** reiniciar el servicio compartido con la variable por run; rompería la
sesión del usuario y las ejecuciones concurrentes.

### D2. Instrucción oculta con `instructions`

`OPENCODE_CONFIG_CONTENT` incluye:

```json
{ "instructions": ["/home/ian/.local/share/laicron/prompts/cron-system.md"] }
```

El fichero lo gestiona LAICron: el contenido es una constante del código y se reescribe si no
coincide. Así no se puede cambiar desde la ventana y una edición manual no persiste.

**Por qué no un agente inline:** `--agent` solo admite uno; definir un agente `laicron-cron` con el
`system` chocaría con el agente que elija el usuario.

**Por qué no prefijar el prompt:** funciona, pero la instrucción quedaría dentro del mensaje del
usuario, visible en la sesión de opencode y contando como contenido del usuario.

**Fallback:** si el fichero no se puede escribir, la ejecución sigue sin instrucción y se anota en
stderr. Si en la implementación `instructions` no se aplicara con `--standalone`, se cae a prefijar
el prompt (comportamiento equivalente, peor aislamiento).

### D3. Consumo desde `session export`

Después de que el proceso de `opencode` termine, el runner ejecuta:

```sh
opencode session export <sessionID> --sanitize --standalone
```

y suma los mensajes de tipo `assistant` con `time.created >= startedAt`:

| Campo | Suma |
| --- | --- |
| `cost_usd` | `message.cost` |
| `input_tokens` | `message.tokens.input` |
| `output_tokens` | `message.tokens.output` |
| `reasoning_tokens` | `message.tokens.reasoning` |
| `cache_read_tokens` | `message.tokens.cache.read` |
| `cache_write_tokens` | `message.tokens.cache.write` |

**Por qué filtrar por `startedAt`:** en modo continuo el export contiene toda la sesión; solo
interesan los mensajes de este run. Así no hace falta guardar snapshots ni restar totales.

**Coste del export:** crece con la sesión. Para un cron normal son pocos KB; en sesiones continuas
muy largas puede ser más. Se acepta a cambio de no depender de `step_finish`.

**Alternativa descartada:** leer la base de datos interna de opencode (`opencode.db`); es rápida
pero depende de un esquema ajeno.

### D4. Modelo de datos

Columnas nuevas y **nullables** en `runs`:

```sql
ALTER TABLE runs ADD COLUMN input_tokens INTEGER;
ALTER TABLE runs ADD COLUMN output_tokens INTEGER;
ALTER TABLE runs ADD COLUMN reasoning_tokens INTEGER;
ALTER TABLE runs ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE runs ADD COLUMN cache_write_tokens INTEGER;
ALTER TABLE runs ADD COLUMN cost_usd REAL;
```

Nullables para distinguir «sin datos» (runs antiguos o export fallido) de «cero tokens». Migración
idempotente con `PRAGMA table_info`, como la de `mcp_overrides`.

### D5. API y UI

- `GET /api/jobs/:id/usage` → `{ usage: { runs, runsWithUsage, costUsd, inputTokens, outputTokens,
  reasoningTokens, cacheReadTokens, cacheWriteTokens } }`.
- El detalle del cron pide el uso en paralelo con runs y mensajes.
- Tarjeta «Consumo» y columnas «Tokens»/«Coste» en el historial.
- Formato: tokens con separador de miles; coste con 4–6 decimales; `—` para `NULL`.

### D6. Degradación

- El export falla o no trae mensajes → `usage = null`; el run no se marca como fallido.
- El fichero de instrucciones falla → run sin instrucción, aviso en stderr.
- `--standalone` no arranca → el run falla como hoy (error de opencode), sin cambios.

## Risks / Trade-offs

- **`--standalone` añade latencia y RAM por run.** Aceptado por aislamiento y config real.
- **El export crece con sesiones continuas largas.** Se puede limitar en el futuro; hoy la retención
  de 200 runs acota el historial.
- **El usuario continúa la sesión por fuera de LAICron.** Los mensajes externos posteriores al
  inicio no se distinguen; el consumo del run podría incluir algo de esa actividad. Se documenta.
- **`instructions` no se aplique en alguna versión.** Se verifica en el E2E; si falla, se prefija el
  prompt.

## Migration Plan

Sin migración de datos. Columnas nullables; los runs antiguos quedan sin consumo y la UI muestra
`—`.

## Open Questions

Ninguna. Se aceptan las opciones recomendadas: `--standalone` siempre, `instructions` con fichero
gestionado y consumo vía `session export`.
