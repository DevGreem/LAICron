# Proposal: Selección de MCPs por cron

## Why

Hoy todos los crons de `opencode` heredan la configuración global de MCPs: si `github`, `xerj` y
`super-productivity` están activos, cualquier cron los carga, aunque no los necesite. Eso tiene dos
problemas: un cron que solo debe leer un directorio arranca servidores y herramientas que no usa, y
no hay forma de dar a un cron un permiso concreto (por ejemplo, activar `github-write` solo para el
cron que publica) sin cambiar la configuración global, que afecta a todo lo demás.

## What Changes

- Cada cron guarda un estado por MCP: **Heredado**, **Encendido** o **Apagado**.
- El catálogo de MCPs se obtiene de `opencode mcp list` usando el `cwd` del cron, para incluir también
  los MCPs definidos en el proyecto.
- La ejecución de `opencode` recibe la selección como un overlay en `OPENCODE_CONFIG_CONTENT`
  (`mcp.servers.<nombre>.disabled`), **sin modificar** `~/.config/opencode/opencode.jsonc` ni la
  configuración del proyecto.
- La ventana muestra una lista con el nombre del MCP, su estado por defecto, el estado elegido y el
  estado efectivo, dejando claro que «Heredado» sigue la configuración y «Encendido/Apagado» la fija.
- El runner `shell` no se ve afectado: los MCPs solo existen en `opencode`.

No hay cambios incompatibles: los crons existentes quedan todos en «Heredado» y se comportan igual
que hoy.

## Capabilities

### New Capabilities

- `mcp-selection`: estado por MCP en cada cron, catálogo de servidores disponibles, aplicación del
  overlay en la ejecución, semántica de herencia frente a fijación y degradación sin catálogo.

### Modified Capabilities

Ninguna. El cambio se apoya en `job-scheduling`, `run-execution` y `desktop-app` sin alterar sus
requisitos actuales.

## Impact

- Datos: una columna nueva `jobs.mcp_overrides` (JSON), con migración idempotente. Sin pérdida de
  datos.
- Código: `packages/core/src/db` (columna, validación, mapeo), `packages/core/src/runners`
  (listado de MCPs y overlay), `packages/daemon/src/opencode-options.ts` y la API, y la SPA.
- Dependencias: ninguna nueva.
- Seguridad: el overlay solo contiene `disabled`; nunca comandos, URLs, cabeceras ni credenciales.
- Fuera de alcance: editar la configuración de MCPs desde LAICron, crear o autenticar servidores
  MCP, y aplicar MCPs a comandos `shell`.
