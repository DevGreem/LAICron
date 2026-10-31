# Design

## Context

Ver `proposal.md`. Hoy el runner `opencode` invoca `opencode run --format json` con el `cwd` y el
entorno del daemon. Los MCPs se configuran en `~/.config/opencode/opencode.jsonc` (y en
`.opencode/opencode.jsonc` del proyecto) bajo `mcp.servers`. No hay flag `--mcp` en `run`.

`opencode` admite dos variables para inyectar configuración sin tocar ficheros:

- `OPENCODE_CONFIG`: ruta a un fichero de config adicional.
- `OPENCODE_CONFIG_CONTENT`: JSON inline que se mezcla en tiempo de ejecución, con precedencia por
  encima de la config global y de proyecto.

## Goals / Non-Goals

**Goals:**

- Elegir MCPs por cron sin modificar la configuración del usuario.
- Distinguir claramente «heredar» (dinámico) de «fijar» (no cambia aunque cambie la config).
- No romper crons existentes ni el runner `shell`.

**Non-Goals:**

- Crear, editar o autenticar servidores MCP desde LAICron.
- Cambiar la config global o la del proyecto.
- Aplicar MCPs a comandos `shell`.

## Decisions

### D1. `OPENCODE_CONFIG_CONTENT`, no ficheros ni flags

El runner construye un JSON mínimo y lo pasa como variable de entorno del proceso:

```json
{ "mcp": { "servers": { "github": { "disabled": false }, "xerj": { "disabled": true } } } }
```

**Por qué:** `opencode run` no tiene un flag de MCP; `OPENCODE_CONFIG` obliga a escribir un fichero
temporal y a resolver rutas relativas de `{file:...}`; `OPENCODE_CONFIG_CONTENT` se mezcla en
memoria y no toca disco.

**Consecuencias:** el overlay solo lleva `disabled`; nunca `command`, `url`, `headers` ni secretos.
No se define la variable si no hay nada que fijar. Cada ejecución tiene su propio entorno, así que
dos crons concurrentes no se pisan.

### D2. Estado por MCP, no un modo global

Se guarda un objeto `{ "<nombre>": "on" | "off" }`; lo que no aparece es `inherit`.

**Por qué:** el usuario quiere poder fijar un MCP y dejar el resto siguiendo la config. Un modo
`all/none/selected` no distingue «heredar encendido» de «fijar encendido», y esa distinción es el
corazón de la funcionalidad.

**Alternativa descartada:** dos columnas `mcp_mode` + `mcp_servers`; no permiten estados mixtos ni
saben si un valor coincide con el estado por defecto por casualidad o por decisión.

### D3. Filtrar por servidores existentes al ejecutar

Antes de construir el overlay, el runner lista los MCPs del `cwd` y descarta overrides de servidores
que ya no existen.

**Por qué:** `OPENCODE_CONFIG_CONTENT` mezcla objetos; enviar `{ "foo": { "disabled": false } }` para
un servidor eliminado dejaría una entrada sin `type`/`command`/`url`. Filtrar evita configuraciones
inválidas y hace que un MCP borrado deje de aplicarse sin tocar el cron.

### D4. Catálogo con `cwd` y caché

`GET /api/opencode/options?cwd=<ruta>` añade `mcps: [{ name, enabled }]`. El servicio ejecuta
`opencode mcp list` en ese `cwd`, con timeout de 5 s y caché de 60 s **por ruta**.

**Por qué:** los MCPs pueden ser de proyecto; listar siempre desde el repo daría una lista
incompleta. La caché evita lanzar `opencode` en cada pulsación.

`opencode mcp list` no tiene salida JSON: se parsea con una expresión tolerante
(`^[✓○✗]\s+(\S+)\s+(.+)$`). `enabled = estado !== "disabled"`. El estado de conexión
(`connected`/`failed`) se puede mostrar como pista, pero no cambia la selección.

### D5. La UI muestra tres cosas: por defecto, elegido y efectivo

Tabla (o tarjetas en pantalla estrecha):

| MCP | Por defecto | Estado | Efectivo |
| --- | --- | --- | --- |
| `github` | Encendido | `Heredado` | Encendido |
| `xerj` | Encendido | `Apagado` 📌 | Apagado |
| `github-write` | Apagado | `Encendido` 📌 | Encendido |

- El selector tiene tres opciones: **Heredado**, **Encendido**, **Apagado**.
- «Efectivo» solo se muestra cuando el estado es `Heredado`, para que se vea qué hereda.
- Un pin indica que el valor está fijado y no sigue la config.
- Leyenda: «Heredado sigue tu configuración de opencode; Encendido/Apagado fija ese valor para este
  cron y no cambia aunque modifiques la configuración.»
- No hay avisos al fijar un MCP que está apagado por defecto: se enciende solo para esa ejecución.
- Al cambiar el `cwd`, se recarga la lista (con un pequeño debounce).

### D6. Migración aditiva

```sql
ALTER TABLE jobs ADD COLUMN mcp_overrides TEXT NOT NULL DEFAULT '{}';
```

Se aplica solo si la columna no existe (`PRAGMA table_info`), para no romper bases ya creadas. Los
crons existentes quedan con `{}` (todo heredado).

### D7. Degradación

- Catálogo de la UI caído → lista vacía + aviso; el cron se guarda con lo que ya tuviera.
- Listado caído al ejecutar → no se define el overlay; el run sigue con la config heredada y no se
  marca como fallido. Se escribe un aviso en stderr (queda en el journal del servicio).

## Data Model

```ts
// Job
mcpOverrides: Record<string, "on" | "off">;
```

- Columna: `jobs.mcp_overrides TEXT NOT NULL DEFAULT '{}'`.
- API: `JobInput.mcpOverrides?` (por defecto `{}`); la respuesta siempre lo incluye.
- Validación: claves no vacías, valores `on`/`off`, máximo 100 entradas.

## Risks / Trade-offs

- **Precedencia de `OPENCODE_CONFIG_CONTENT`**: la documentación la sitúa por encima de `.opencode`,
  pero hubo versiones con un bug de orden. Se verifica en el E2E con `opencode 2.2.0`; si un
  `.opencode` del proyecto ganara, se documentaría como limitación.
- **El formato de `opencode mcp list` cambia**: parser tolerante; si no se puede interpretar, se
  degrada a heredado.
- **MCPs de proyecto que aparecen o desaparecen**: el catálogo se pide con el `cwd`; los overrides
  de servidores ausentes se filtran al ejecutar.
- **Fijar un MCP que el usuario cree que hereda**: la columna «Efectivo», el pin y la leyenda lo
  hacen explícito.

## Migration Plan

Sin migración de datos. La columna se añade con defecto `{}` y los crons existentes no cambian de
comportamiento.

## Open Questions

Ninguna. Las decisiones de producto están cerradas: defecto heredado, se puede fijar cualquier MCP
(incluso uno apagado), catálogo por `cwd` y propuesta nueva.
