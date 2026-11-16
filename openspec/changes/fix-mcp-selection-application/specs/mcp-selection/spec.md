# Spec Delta

## MODIFIED Requirements

### Requirement: Aplicación en la ejecución

Al ejecutar un cron de tipo `opencode`, el sistema DEBE aplicar `off` como una política `mcp.use`
con efecto `deny` en `OPENCODE_CONFIG_CONTENT`. Para `on`, si el servidor está apagado en la
configuración efectiva, DEBE enviar su definición completa con `disabled: false`; si ya está
encendido, NO DEBE enviar nada. NO DEBE enviar entradas parciales de servidor ni modificar ficheros
de configuración.

#### Scenario: Encendido y apagado

- **WHEN** un cron tiene `github` en `on` y `xerj` en `off`
- **THEN** el proceso recibe la política de apagado de `xerj` y, si `github` está apagado, su definición completa con `disabled: false`

#### Scenario: Apagado por política

- **WHEN** un cron tiene `xerj` en `off`
- **THEN** el proceso recibe una política `mcp.use: deny` para `xerj` y el servidor no se conecta

#### Scenario: Encendido de un servidor ya activo

- **WHEN** un cron tiene `github` en `on` y `github` ya está encendido en la configuración efectiva
- **THEN** no se envía una definición extra para `github`

#### Scenario: Encendido forzado

- **WHEN** un cron tiene `github-write` en `on` y está apagado en la configuración efectiva
- **THEN** el proceso recibe la definición completa de `github-write` con `disabled: false`

#### Scenario: Todo heredado

- **WHEN** todos los MCPs del cron están en `inherit`
- **THEN** no se envía ninguna política ni definición de MCPs

#### Scenario: Servidor desaparecido

- **WHEN** un MCP con estado guardado ya no existe en la configuración
- **THEN** su estado se ignora y no se crea una entrada inválida

#### Scenario: Ejecución shell

- **WHEN** el cron usa el runner `shell`
- **THEN** la selección de MCPs no tiene efecto

#### Scenario: Dos crons a la vez

- **WHEN** dos crons de `opencode` se ejecutan con selecciones distintas
- **THEN** cada proceso recibe solo su propio overlay y no se pisan

## ADDED Requirements

### Requirement: Resolución de la definición completa

El sistema DEBE obtener la definición completa de un servidor desde la configuración efectiva del
`cwd` del cron, resolviendo `{file:...}` y `{env:...}` en tiempo de ejecución. Los valores resueltos
NO DEBEN registrarse, persistirse ni mostrarse en la interfaz.

#### Scenario: Cabecera desde fichero

- **WHEN** la definición del servidor usa `{file:secrets/token}` en una cabecera
- **THEN** el overlay contiene el valor resuelto y el log no lo muestra

#### Scenario: Definición no resoluble

- **WHEN** la configuración no se puede leer o parsear
- **THEN** el estado `on` se degrada a `inherit`, el run continúa y queda un aviso

#### Scenario: Versión sin políticas

- **WHEN** `opencode` no soporta `mcp.use`
- **THEN** los estados `off` se degradan a `inherit` con un aviso y la ejecución no falla
