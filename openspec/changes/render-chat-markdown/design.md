# Design

## Context

`messageBubble` (`packages/ui/src/views/detail.ts`) pinta el contenido con `textContent` y
`white-space: pre-wrap`. El texto del asistente de `opencode` es Markdown; el de `shell` es la
salida de un comando y no debe interpretarse.

La UI no tiene bundler: `tsc` emite módulos ES y `copy-static.mjs` copia `public/`. No hay forma
sencilla de importar un paquete de `node_modules` en el navegador sin vendorizarlo o añadir un
bundler.

## Goals / Non-Goals

**Goals:**

- Leer mejor los mensajes del asistente sin cambiar lo que se guarda.
- No introducir dependencias ni un bundler.
- No abrir una vía de XSS.

**Non-Goals:**

- Renderizar HTML crudo, Mermaid, listas anidadas profundas o footnotes.
- Renderizar el prompt del usuario.
- Resaltado de sintaxis con una librería.

## Decisions

### D1. Renderer propio, sin dependencias

`packages/ui/src/markdown.ts` implementa un subconjunto seguro y devuelve un string HTML. Se evita
`marked`/`DOMPurify` porque obligarían a vendorizar ESM o a meter un bundler en una UI que hoy es
`tsc` + estáticos.

**Por qué es asumible:** el subconjunto es pequeño y está cubierto por tests; lo que no se soporta
se muestra como texto, nunca se rompe.

### D2. Subconjunto

| Sintaxis | Resultado |
| --- | --- |
| `#` … `######` | `h1`–`h6` |
| `**x**`, `*x*`, `~~x~~` | `strong`, `em`, `del` |
| `` `x` `` | `code` inline |
| Vallas de código con lenguaje | `pre > code.language-…` |
| `-`, `1.` | `ul`/`ol` (un nivel) |
| `>` | `blockquote` |
| `[texto](https://…)` | enlace externo seguro |
| Tablas `|` simples | `table` |
| `---` | `hr` |

Fuera del subconjunto: HTML, listas anidadas, imágenes, footnotes. Se muestran como texto.

### D3. Seguridad

1. **Se escapa todo el texto** antes de aplicar el formato; el HTML del mensaje nunca se interpreta.
2. **Enlaces:** solo `http:`, `https:` y `mailto:`. Cualquier otro esquema se deja como texto.
   Los enlaces llevan `target="_blank"` y `rel="noopener noreferrer"`.
3. **Un solo productor de HTML:** `markdown.ts` construye las etiquetas y escapa cada fragmento. Es
   el único lugar que puede usar `innerHTML` con contenido dinámico.
4. **Tests de seguridad** con `<script>`, `<img onerror>`, `javascript:` y comillas.

### D4. Solo el asistente de `opencode`

- Asistente + `job.runner === "opencode"` → Markdown.
- Usuario → texto (un `#` del prompt no debe convertirse en título).
- `shell` → `<pre class="message-content">` para conservar el espaciado.

La vista ya tiene el `Job`; la decisión es local a `messageBubble`.

### D5. Bloques de código

`pre` con scroll horizontal, etiqueta del lenguaje y botón «Copiar» (`navigator.clipboard`, con
fallback a seleccionar el texto). El botón se añade después de renderizar, no dentro del HTML del
renderer.

### D6. Degradación

Si el renderer lanza (entrada rara), la burbuja cae a `textContent` con el texto original. Un
mensaje nunca deja de mostrarse.

## Risks / Trade-offs

- **Bugs del parser en casos límite** → subconjunto acotado, tests y fallback a texto.
- **El renderer crece** → se mantiene en un módulo puro, sin estado y con tests.
- **Enlaces externos** → `noopener noreferrer` y esquemas permitidos.
- **`shell` con Markdown aparente** → no se renderiza; se conserva el texto.

## Migration Plan

Sin migración: el contenido sigue siendo Markdown en `messages.content`.

## Open Questions

Ninguna. Se aceptan las opciones recomendadas: renderer propio, solo asistente de `opencode`,
botón de copiar y tablas simples.
