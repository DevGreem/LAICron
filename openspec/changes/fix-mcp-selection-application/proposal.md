# Proposal: Aplicar de verdad la selección de MCPs

## Why

La selección de MCPs por cron guarda el estado y lo envía, pero **opencode lo descarta**. La
configuración de mayor precedencia reemplaza el objeto del servidor entero, y una entrada parcial
como `{"disabled": true}` no es válida:

```
configuration normalization diagnostic source=OPENCODE_CONFIG_CONTENT
  path=$.mcp.servers.xerj kind=invalid
  action="skipped malformed recognized value"
mcp connected server=xerj tools=13
```

Por eso un cron con `xerj` en `off` sigue conectando `xerj`. La spec `mcp-selection` promete algo
que hoy no ocurre.

## What Changes

- **Apagar (`off`)**: se envía una política `mcp.use` con efecto `deny` en
  `OPENCODE_CONFIG_CONTENT`. Verificado en opencode 2.2.5: el servidor no se conecta. No lleva
  secretos.
- **Encender (`on`)**:
  - si el MCP ya está encendido en la configuración efectiva, no se envía nada;
  - si está apagado, se envía su **definición completa** con `disabled: false`, leída de la
    configuración efectiva del `cwd` del cron.
- **Resolución de la definición**: se leen los ficheros de configuración aplicables (global y
  proyecto), se resuelven `{file:...}` y `{env:...}` en tiempo de ejecución y el resultado vive solo
  en el entorno del proceso de esa ejecución. Nunca se registra ni se persiste.
- **Degradación**: si la definición no se puede resolver o la versión de `opencode` no soporta
  `mcp.use`, el estado se degrada a `inherit` con un aviso; la ejecución no falla.
- Sin cambios en la base de datos, la API ni la UI: el trío `inherit`/`on`/`off` sigue igual.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `mcp-selection`: la aplicación en la ejecución pasa de «enviar `disabled` parcial» a «política para
  apagar y definición completa para encender», con resolución segura y degradación.

## Impact

- Código: `packages/core/src/runners` (nuevo resolvedor de configuración y constructor del overlay),
  tests del runner.
- Dependencias: ninguna nueva.
- Seguridad: las definiciones completas pueden incluir cabeceras resueltas (secretos) en el entorno
  del proceso; no se escriben en logs, ficheros ni base de datos.
- Compatibilidad: `mcp.use` requiere opencode 2.2.5 o superior; en versiones anteriores `off` se
  degrada a `inherit` con aviso.
- Fuera de alcance: editar la configuración del usuario, crear servidores MCP y cambiar la UI.
