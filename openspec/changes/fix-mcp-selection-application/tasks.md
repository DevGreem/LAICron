# Tasks

## 1. Resolución de configuración

- [ ] 1.1 Implementar el parser JSONC tolerante y la lectura de las configuraciones aplicables al `cwd` (global, proyecto y `.opencode`), con resolución de `{file:...}` y `{env:...}`, y verificar con tests de comentarios, comas finales, precedencia y ficheros anidados
- [ ] 1.2 Verificar con tests que una definición con `{file:...}` se resuelve, que una ruta inexistente degrada y que los valores resueltos no se registran en ningún log

## 2. Overlay de MCPs

- [ ] 2.1 Construir el overlay: política `mcp.use: deny` por cada `off`, definición completa con `disabled:false` solo para `on` de un servidor apagado, nada para `inherit` y para `on` ya activo, y verificar cada caso con tests
- [ ] 2.2 Consultar y cachear la versión de `opencode`, degradar `off` a `inherit` con aviso si es anterior a 2.2.5, y verificar con una versión simulada

## 3. Integración en el runner

- [ ] 3.1 Fusionar el overlay de MCPs con `instructions` en `OPENCODE_CONFIG_CONTENT`, sin definir la clave `mcp` cuando no haya definiciones y sin imprimir el overlay, y verificar con un `opencode` falso el JSON exacto y que el log no contiene secretos

## 4. Verificación real y documentación

- [ ] 4.1 Probar con `opencode` 2.2.5 real: `xerj` en `off` no se conecta, `github-write` en `on` se conecta aunque esté apagado globalmente, un cron todo heredado no envía políticas ni definiciones, y el consumo sigue registrándose
- [ ] 4.2 Documentar el mecanismo (política para apagar, definición completa para encender), la versión mínima y la degradación en `README.md` y `~/Documents/Documentation/LAICron.md`
- [ ] 4.3 Ejecutar `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check` y `openspec validate fix-mcp-selection-application`, y verificar que todo pasa

## Workflow follow-up

- Archivar el cambio con `openspec archive fix-mcp-selection-application` cuando la implementación esté verificada.
