# Design

## Context

Verificado en opencode 2.2.5:

- Una entrada parcial `{"disabled": true}` en `OPENCODE_CONFIG_CONTENT` se descarta
  (`skipped malformed recognized value`); el servidor sigue conectado.
- Una política `{"action":"mcp.use","resource":"xerj","effect":"deny"}` sí se aplica: `xerj` no se
  conecta.
- Una política `allow` **no** enciende un servidor con `disabled: true`; sigue sin conectarse.
- Una definición **completa** de servidor con `disabled: false` sí es válida.
- `--standalone` es necesario para que `OPENCODE_CONFIG_CONTENT` se aplique.

## Goals / Non-Goals

**Goals:**

- Que `off` apague de verdad, sin copiar secretos.
- Que `on` pueda encender un servidor apagado, con su definición completa.
- Que `inherit` no envíe nada.
- Degradar sin fallar si algo no se puede resolver.

**Non-Goals:**

- Editar la configuración del usuario.
- Crear o autenticar servidores MCP.
- Cambiar la UI o la base de datos.

## Decisions

### D1. `off` con política `mcp.use: deny`

Cada MCP en `off` añade a `OPENCODE_CONFIG_CONTENT`:

```json
{ "policies": [{ "action": "mcp.use", "resource": "<nombre>", "effect": "deny" }] }
```

**Por qué:** es la única forma limpia de apagar sin redefinir el servidor y sin secretos. Verificado
en 2.2.5.

**Límite:** requiere opencode ≥2.2.5. En versiones anteriores se degrada a `inherit` con aviso.

### D2. `on` con definición completa solo si hace falta

- Si el servidor ya está encendido en la configuración efectiva, no se envía nada.
- Si está apagado, se envía su definición completa con `disabled: false` en `mcp.servers`.

**Por qué:** `allow` no enciende; una entrada parcial no vale. La definición completa es la única
forma de forzar el encendido.

**Coste:** solo se resuelve la definición en el caso raro de encender un MCP apagado; el resto de
estados no toca secretos.

### D3. Resolución de la configuración efectiva

Para obtener la definición completa de un servidor se leen los ficheros de configuración aplicables,
en orden de precedencia (mayor primero):

1. `/etc/opencode/opencode.json(c)`
2. `.opencode/opencode.json(c)` desde el `cwd` hacia arriba (el más cercano primero)
3. `opencode.json(c)` desde el `cwd` hacia arriba
4. `~/.config/opencode/opencode.json(c)`

Para cada servidor se toma la **primera** definición encontrada. Se parsea JSONC con un parser
tolerante (comentarios y comas finales) y se resuelven recursivamente:

- `{file:ruta}`: relativa al fichero de configuración, absoluta o `~/`; se lee el contenido.
- `{env:VAR}`: valor de `process.env`.

**Por qué no `opencode debug config`:** devuelve las cabeceras enmascaradas (`***`), inservibles para
reconstruir un servidor remoto.

**Si no se puede resolver:** el estado `on` se degrada a `inherit` y se avisa por stderr.

### D4. Secretos

Las definiciones completas pueden contener cabeceras con tokens. Se resuelven en memoria y solo
viven en `OPENCODE_CONFIG_CONTENT` del proceso hijo de esa ejecución.

- No se escriben en logs, ficheros, base de datos ni en la UI.
- El overlay no se imprime nunca; los tests usan fixtures sin secretos reales.
- `off` no lleva secretos: solo la política.

### D5. Versión de opencode

Se consulta `opencode --version` una vez y se cachea. Si es anterior a 2.2.5:

- `off` se degrada a `inherit` con aviso (no se finge que se apagó).
- `on` sigue usando la definición completa, que no depende de políticas.

### D6. Sin cambios en datos, API ni UI

El trío `inherit`/`on`/`off` ya está en `jobs.mcp_overrides` y en el formulario. El arreglo es solo
de ejecución.

## Data Flow

```
job.mcpOverrides + cwd
        │
        ├── off  → policies[] deny
        ├── on   → si ya está activo: nada
        │          si está apagado: definición completa (resuelta) con disabled=false
        └── inherit → nada
        │
        ▼
OPENCODE_CONFIG_CONTENT = { policies?, mcp?, instructions: [...] }
        │
        ▼
opencode run --standalone …
```

## Risks / Trade-offs

- **Config remota de organización (`.well-known`)**: si un servidor solo está ahí, no se puede
  reconstruir; `on` degrada a `inherit`.
- **Parser JSONC**: se cubre con tests de comentarios, comas finales y strings con `//`.
- **Secretos en el entorno**: mismo usuario puede leer `/proc/<pid>/environ`; no se añade una
  exposición nueva fuera del proceso.
- **Precedencia de configs**: se toma la primera definición; si el usuario tiene configs muy
  anidadas, se documenta el orden.
- **Versión antigua**: `off` deja de aplicarse; se avisa y se documenta el mínimo 2.2.5.

## Migration Plan

Sin migración. Los crons guardados siguen igual; cambia cómo se aplican al ejecutar.

## Open Questions

Ninguna. Se elige el híbrido: política para apagar y definición completa para encender.
