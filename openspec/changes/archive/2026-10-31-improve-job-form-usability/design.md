# Design

## Context

Ver `proposal.md`. El proyecto ya tiene un daemon con API local autenticada, una SPA servida por ese
daemon y un formulario de creación/edición que guarda `model`, `agent`, `timezone` y
`scheduleExpr` como texto. `opencode run --model` acepta el formato `proveedor/modelo#variante`, y
`opencode` ya conoce sus modelos, variantes y agentes.

Restricciones del entorno:

- `opencode models` lista los `proveedor/modelo`, pero no las variantes.
- `~/.cache/opencode/models.json` contiene el nombre legible y `reasoning_options[].values`.
- `opencode debug agents` devuelve JSON con todos los agentes, incluidos los ocultos y los
  subagentes, y con el `system` completo de cada uno.
- WebKitGTK 2.52 debería exponer `Intl.supportedValuesOf("timeZone")`; si no, hace falta respaldo.

## Goals / Non-Goals

**Goals:**

- Que el humano elija de una lista en vez de escribir cadenas que pueden fallar en silencio.
- Que el formulario siga funcionando sin `opencode` y con modelos personalizados.
- No tocar la base de datos ni el formato de las expresiones cron guardadas.

**Non-Goals:**

- Validar en el servidor que el modelo elegido existe (se mantiene la entrada libre).
- Editar la configuración de `opencode` desde LAICron.
- Añadir un selector visual de calendario o un editor de cron con drag-and-drop.

## Decisions

### D1. El daemon agrega el catálogo, la ventana no llama a `opencode`

La SPA no ejecuta procesos ni lee el cache de `opencode`: pide `GET /api/opencode/options` al
daemon, que ya corre con el usuario y tiene acceso al binario y a `~/.cache`.

**Por qué:** la ventana es WebKit sin acceso a procesos; además el catálogo se cachea una vez y lo
comparten todas las ventanas. El endpoint va detrás del token como el resto de `/api/*`.

**Alternativa descartada:** que la UI llame a `opencode` a través de un endpoint genérico de shell;
sería una superficie de ejecución arbitraria innecesaria.

### D2. Tres fuentes, un resultado tolerante

| Dato | Fuente | Si falla |
| --- | --- | --- |
| Ids de modelo | `opencode models` | catálogo no disponible |
| Nombre y variantes | `~/.cache/opencode/models.json` | solo el id, sin variantes |
| Agentes | `opencode debug agents` (JSON) | lista vacía |

El parser de agentes **descarta** `system`, `permissions` y cualquier campo que no sea `id`,
`name`, `description` y `mode`. El catálogo se cachea 60 s en memoria; `?refresh=1` lo invalida.

**Por qué el filtro:** `opencode debug agents` devuelve prompts internos largos y datos de
configuración. La API solo debe devolver lo que la ventana necesita para pintar la lista.

### D3. Solo agentes primarios

Se incluyen los agentes con `hidden !== true` y `mode !== "subagent"`. En `opencode`, `mode` puede
ser `primary`, `subagent` o `all`; `all` sí puede ejecutarse como primario, así que se incluye.

### D4. La variante vive dentro de `model`

No se añade columna. Al guardar se compone `modelo#variante`; al editar se separa por el **último**
`#`. Si el modelo no declara variantes, el selector solo ofrece «Predeterminada».

**Por qué:** es exactamente el formato que acepta `opencode run --model` y evita una migración de
SQLite y un cambio en la API de jobs.

### D5. Zona horaria: lista + UTC + desfase

El selector se construye con `Intl.supportedValuesOf("timeZone")`, añadiendo `UTC` y la zona del
sistema al principio. Si la API no existe en el WebKit instalado, se usa una lista de respaldo de
zonas frecuentes. El valor guardado sigue siendo el id IANA.

La pista de desfase se calcula con `Intl.DateTimeFormat` (`timeZoneName: "shortOffset"`), no con
sumas manuales, para que los cambios de hora se reflejen solos.

### D6. Constructor de cron en el cliente, validación en el servidor

`packages/ui/src/cron.ts` es puro: `parseCron`, `composeCron`, `describeCron`. El formulario compone
la expresión de cinco campos y la envía como siempre; el servidor sigue validando con
`validateSchedule`.

**Por qué no mover la validación al cliente:** el cliente es una comodidad, no la frontera de
confianza. Un cliente antiguo o la API directa deben seguir rechazando expresiones inválidas.

**Modo avanzado:** si al editar la expresión no se puede dividir en cinco campos, se abre el campo
de texto crudo con un aviso; el usuario puede corregirla o guardarla tal cual (el servidor decidirá).

### D7. Degradación explícita

Si el catálogo no está disponible, el formulario muestra los inputs de texto actuales y una franja
de aviso con el motivo. No se bloquea la creación de crons ni se oculta el campo.

## Risks / Trade-offs

- **El formato de `opencode debug agents` o del cache cambia** → parser tolerante; si no se puede
  interpretar, el catálogo queda vacío y se degrada a texto.
- **El cache de modelos está desactualizado** → botón de recarga y `?refresh=1`; el id siempre sale
  de `opencode models`, que es la fuente viva.
- **Un modelo declara variantes que el proveedor ya no acepta** → el error lo devuelve `opencode`
  al ejecutar; el historial lo muestra.
- **`Intl.supportedValuesOf` no existe** → lista de respaldo; se comprueba en el WebKit real antes
  de dar la tarea por hecha.
- **El endpoint se convierte en una fuga de información** → solo ids, nombres, descripciones y
  modos; nunca prompts ni permisos.

## Migration Plan

No hay migración. Los crons existentes conservan `model`, `agent`, `timezone` y `scheduleExpr`; el
formulario los interpreta al editar.

## Open Questions

Ninguna pendiente. Las tres decisiones de producto (propuesta nueva, zona horaria sin interruptor
global de UTC y solo agentes primarios) están cerradas.
