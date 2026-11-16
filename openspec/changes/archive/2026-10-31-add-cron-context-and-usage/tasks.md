# Tasks

## 1. Ejecución

- [x] 1.1 Añadir `--standalone` al runner `opencode` y una instrucción de cron fija gestionada por LAICron (fichero reescrito si difiere, inyectado con `instructions`), y verificar con `opencode` real que la configuración inline se aplica y que la sesión continua se conserva
- [x] 1.2 Parsear el consumo desde `opencode session export <sesión> --sanitize`, sumando solo los mensajes del asistente creados después del inicio del run, y verificar con un export de fixture un run normal, uno continuo y un export fallido

## 2. Datos y API

- [x] 2.1 Añadir a `runs` las columnas nullables de tokens y coste con migración idempotente, tipos, mapeo y persistencia, y verificar con tests que una base existente se migra y que un run sin consumo queda con `NULL`
- [x] 2.2 Implementar `usageByJob` y `GET /api/jobs/:id/usage`, y verificar que suma runs, ignora los `NULL` y devuelve ceros solo cuando hay datos

## 3. Interfaz

- [x] 3.1 Añadir la tarjeta de consumo (coste total, tokens, ejecuciones con datos y nota de modo continuo) y las columnas de tokens/coste en el historial, y verificar en la ventana que un run con datos se ve y uno antiguo muestra `—`

## 4. Integración y documentación

- [x] 4.1 Probar con `opencode` real un cron con un MCP fijado y otro en `inherit`, comprobar que el overlay se envía con `--standalone`, que el consumo aparece y que la instrucción oculta no está en el chat; la aplicación efectiva del overlay de MCPs se verifica en el cambio `fix-mcp-selection-application`
- [x] 4.2 Documentar `--standalone`, la instrucción oculta, el consumo y sus limitaciones en `README.md` y `~/Documents/Documentation/LAICron.md`
- [x] 4.3 Ejecutar `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check` y `openspec validate add-cron-context-and-usage`, y verificar que todo pasa

## Workflow follow-up

- Archivar el cambio con `openspec archive add-cron-context-and-usage` cuando la implementación esté verificada.
