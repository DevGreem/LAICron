# Tasks

## 1. Renderer

- [ ] 1.1 Implementar `packages/ui/src/markdown.ts` con escape de HTML, títulos, énfasis, código inline, bloques con lenguaje, listas, citas, enlaces y tablas, y verificar con tests unitarios cada constructo
- [ ] 1.2 Añadir tests de seguridad (`<script>`, `<img onerror>`, `[x](javascript:…)`, comillas) y el fallback a texto cuando la entrada no se puede renderizar

## 2. Integración en el chat

- [ ] 2.1 Integrar el renderer en `messageBubble`: Markdown solo para el asistente de `opencode`, texto para el usuario y `<pre>` para `shell`, con estilos de listas, tablas, enlaces y botón «Copiar» en los bloques, y verificar con `pnpm --filter @laicron/ui build` y los tests
- [ ] 2.2 Probar en la ventana real un mensaje con Markdown y otro de `shell`, y verificar que se ven negritas, listas, bloque de código con copiar, enlace seguro y que `<script>` se muestra como texto

## 3. Documentación y cierre

- [ ] 3.1 Documentar el renderizado Markdown, el subconjunto y la seguridad en `README.md` y `~/Documents/Documentation/LAICron.md`
- [ ] 3.2 Ejecutar `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check` y `openspec validate render-chat-markdown`, y verificar que todo pasa

## Workflow follow-up

- Archivar el cambio con `openspec archive render-chat-markdown` cuando la implementación esté verificada.
