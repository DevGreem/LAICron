# Tasks

## 1. Ejecución

- [ ] 1.1 Añadir `--standalone` al runner `opencode` y una instrucción de cron fija gestionada por LAICron (fichero reescrito si difiere, inyectado con `instructions`), y verificar con `opencode` real que la configuración inline se aplica y que la sesión continua se conserva
- [ ] 1.2 Parsear el consumo desde `opencode session export <sesión> --sanitize`, sumando solo los mensajes del asistente creados después del inicio del run, y verificar con un export de fixture un run normal, uno continuo y un export fallido

## 2. Datos y API

- [ ] 2.1 Añadir a `runs` las columnas nullables de tokens y coste con migración idempotente, tipos, mapeo y persistencia, y verificar con tests que una base existente se migra y que un run sin consumo queda con `NULL`
- [ ] 2.2 Implementar `usageByJob` y `GET /api/jobs/:id/usage`, y verificar que suma runs, ignora los `NULL` y devuelve ceros solo cuando hay datos

## 3. Interfaz

- [ ] 3.1 Añadir la tarjeta de consumo (coste total, tokens, ejecuciones con datos y nota de modo continuo) y las columnas de tokens/coste en el historial, y verificar en la ventana que un run con datos se ve y uno antiguo muestra `—`

## 4. Integración y documentación

- [ ] 4.1 Probar con `opencode` real un cron con un MCP fijado y otro en `inherit`, comprobar que el overlay se aplica de verdad (no solo que se envía), que el consumo aparece y que la instrucción oculta no está en el chat
- [ ] 4.2 Documentar `--standalone`, la instrucción oculta, el consumo y sus limitaciones en `README.md` y `~/Documents/Documentation/LAICron.md`
- [ ] 4.3 Ejecutar `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check` y `openspec validate add-cron-context-and-usage`, y verificar que todo pasa

## Workflow follow-up

- Archivar el cambio con `openspec archive add-cron-context-and-usage` cuando la implementación esté verificada.
