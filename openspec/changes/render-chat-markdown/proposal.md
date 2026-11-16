# Proposal: Markdown en el chat

## Why

El historial del chat guarda el texto que devuelve `opencode`, que es Markdown: títulos, negritas,
listas, enlaces y bloques de código. Hoy se pinta con `textContent` y `white-space: pre-wrap`, así
que el usuario ve los `#`, los `**` y las vallas ``` tal cual. Los mensajes largos con código son
difíciles de leer.

## What Changes

- El chat renderiza el Markdown del **asistente** en crons de `opencode` con un subconjunto seguro:
  títulos, énfasis, código inline, bloques de código, listas, citas, enlaces y tablas simples.
- Los bloques de código muestran el lenguaje y un botón «Copiar».
- El HTML crudo del mensaje se **escapa** y se muestra como texto; los enlaces peligrosos
  (`javascript:`, `data:`, `file:`) no se convierten en enlaces.
- Los mensajes del **usuario** y la salida de los crons **`shell`** se siguen mostrando como texto
  preformateado, porque no son Markdown.
- El mensaje se sigue guardando como texto en SQLite; solo cambia la forma de mostrarlo.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `desktop-app`: el chat renderiza Markdown de forma segura y mantiene el texto plano donde
  corresponde.

## Impact

- Código: `packages/ui/src/markdown.ts` (nuevo), `packages/ui/src/views/detail.ts`,
  `packages/ui/public/styles.css` y tests.
- Dependencias: ninguna nueva.
- Datos: sin cambios; el contenido sigue siendo Markdown en `messages.content`.
- Seguridad: el renderer escapa todo el HTML y valida los enlaces; es el único punto que genera
  HTML dinámico.
- Fuera de alcance: renderizar el prompt del usuario, HTML crudo, diagramas Mermaid y listas
  anidadas profundas.
