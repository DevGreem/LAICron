# Tasks

## 1. Datos y dominio

- [ ] 1.1 Añadir `jobs.mcp_overrides` (JSON, defecto `{}`) con migración idempotente, tipos, mapeo y validación de `on`/`off`, y verificar con tests que una base existente se migra y que un cron nuevo queda con `{}`
- [ ] 1.2 Exponer `mcpOverrides` en `Job`/`JobInput` y en los repositorios, y verificar con tests de creación y edición que se guarda, se devuelve y se normaliza (`inherit` = ausente)

## 2. Catálogo de MCPs

- [ ] 2.1 Implementar `listOpencodeMcps(cwd)` con `opencode mcp list`, parser tolerante y caché de 60 s por `cwd`, y verificar con un `exec` falso los estados `connected`, `disabled`, `failed`, una línea rara y un fallo total
- [ ] 2.2 Añadir `mcps` a `GET /api/opencode/options?cwd=...`, y verificar que sin token devuelve 401, con token 200, que el `cwd` cambia la clave de caché y que un fallo devuelve lista vacía sin 500

## 3. Ejecución

- [ ] 3.1 Aplicar los estados `on`/`off` en el runner `opencode` como `OPENCODE_CONFIG_CONTENT` (`mcp.servers.<nombre>.disabled`), filtrando por MCPs existentes y sin definir la variable si no hay nada fijado, y verificar con un `opencode` falso que el proceso recibe el overlay correcto y que `shell` no se ve afectado
- [ ] 3.2 Implementar la degradación cuando el listado falla al ejecutar: el run continúa con la configuración heredada, no se marca como fallido y queda un aviso en stderr, y verificarlo con un `exec` que falla

## 4. Interfaz

- [ ] 4.1 Añadir la sección MCPs al formulario con la tabla nombre / por defecto / estado / efectivo, selector `Heredado`/`Encendido`/`Apagado`, pin y leyenda, y verificar en la ventana que se guarda el `mcpOverrides` esperado
- [ ] 4.2 Recargar el catálogo al cambiar el `cwd` y con «Recargar opciones», mostrar un aviso si el catálogo falla y conservar los estados ya elegidos, y verificarlo cambiando el `cwd` en la ventana

## 5. Integración y documentación

- [ ] 5.1 Probar en la ventana real un cron con `github` en `on` y `xerj` en `off`, ejecutarlo y comprobar que el proceso de `opencode` recibe el overlay, que la configuración global no cambió y que los MCPs en `inherit` no se envían
- [ ] 5.2 Documentar la sección MCPs, la diferencia entre heredar y fijar, y el ejemplo de `OPENCODE_CONFIG_CONTENT` en `README.md` y `~/Documents/Documentation/LAICron.md`
- [ ] 5.3 Ejecutar `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check` y `openspec validate add-mcp-selection`, y verificar que todo pasa

## Workflow follow-up

- Archivar el cambio con `openspec archive add-mcp-selection` cuando la implementación esté verificada.
