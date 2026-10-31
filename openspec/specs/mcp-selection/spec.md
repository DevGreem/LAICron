# mcp-selection Specification

## Purpose
Permite decidir, cron a cron, qué servidores MCP de `opencode` están disponibles al ejecutar un
prompt, sin modificar la configuración global ni la del proyecto.

## Requirements

### Requirement: Estado de MCPs por cron

Cada cron DEBE poder guardar un estado por servidor MCP: `inherit` (heredar), `on` (encendido) u
`off` (apagado). Un MCP sin estado guardado DEBE considerarse `inherit`, y un cron nuevo DEBE
empezar con todos sus MCPs en `inherit`.

#### Scenario: Cron nuevo

- **WHEN** el usuario crea un cron sin tocar la sección de MCPs
- **THEN** todos los MCPs quedan en `inherit` y el cron se comporta como antes

#### Scenario: Fijar encendido

- **WHEN** el usuario pone un MCP en `on`
- **THEN** el cron guarda ese estado y lo aplica en cada ejecución

#### Scenario: Fijar apagado

- **WHEN** el usuario pone un MCP en `off`
- **THEN** el cron guarda ese estado y lo aplica en cada ejecución

#### Scenario: Volver a heredar

- **WHEN** el usuario cambia un MCP de `on` o `off` a `inherit`
- **THEN** el cron deja de guardar un estado para ese MCP

### Requirement: Catálogo de MCPs disponibles

El sistema DEBE listar los MCPs disponibles para el `cwd` del cron, con su nombre y su estado por
defecto (encendido o apagado), y DEBE incluir los MCPs definidos en el proyecto de ese directorio.

#### Scenario: Listado con estados

- **WHEN** el usuario abre la sección de MCPs de un cron
- **THEN** ve cada MCP con su nombre y si está encendido o apagado por defecto

#### Scenario: MCP de proyecto

- **WHEN** el `cwd` del cron contiene un `.opencode` con MCPs propios
- **THEN** esos MCPs aparecen en la lista junto a los globales

#### Scenario: Catálogo no disponible

- **WHEN** `opencode mcp list` falla
- **THEN** la lista queda vacía, se muestra un aviso y el cron se puede guardar en `inherit`

### Requirement: Aplicación en la ejecución

Al ejecutar un cron de tipo `opencode`, el sistema DEBE aplicar los estados `on` y `off` como
`mcp.servers.<nombre>.disabled` dentro de `OPENCODE_CONFIG_CONTENT`, sin modificar ficheros de
configuración. NO DEBE enviar nada para los MCPs en `inherit` ni para servidores que ya no existan.

#### Scenario: Encendido y apagado

- **WHEN** un cron tiene `github` en `on` y `xerj` en `off`
- **THEN** el proceso de `opencode` recibe `github.disabled=false` y `xerj.disabled=true`

#### Scenario: Todo heredado

- **WHEN** todos los MCPs del cron están en `inherit`
- **THEN** no se define `OPENCODE_CONFIG_CONTENT` y `opencode` usa su configuración normal

#### Scenario: Servidor desaparecido

- **WHEN** un MCP con estado guardado ya no existe en la configuración
- **THEN** su estado se ignora y no se crea una entrada inválida

#### Scenario: Ejecución shell

- **WHEN** el cron usa el runner `shell`
- **THEN** la selección de MCPs no tiene efecto

#### Scenario: Dos crons a la vez

- **WHEN** dos crons de `opencode` se ejecutan con selecciones distintas
- **THEN** cada proceso recibe solo su propio overlay y no se pisan

### Requirement: Herencia frente a fijación

Un MCP en `inherit` DEBE seguir los cambios de la configuración de `opencode`. Un MCP en `on` u
`off` NO DEBE cambiar aunque la configuración global cambie después.

#### Scenario: Cambio global con herencia

- **WHEN** un MCP está en `inherit` y el usuario lo desactiva en su configuración
- **THEN** el cron deja de usarlo en la siguiente ejecución

#### Scenario: Cambio global con estado fijado

- **WHEN** un MCP está en `on` y el usuario lo desactiva en su configuración
- **THEN** el cron lo sigue encendiendo

#### Scenario: Apagado fijado

- **WHEN** un MCP está en `off` y el usuario lo activa en su configuración
- **THEN** el cron lo sigue apagando

### Requirement: Degradación sin listado

Si al ejecutar no se puede obtener la lista de MCPs, la ejecución NO DEBE fallar: DEBE continuar con
la configuración heredada y registrar que no se aplicó la selección.

#### Scenario: Fallo al listar en ejecución

- **WHEN** `opencode mcp list` falla en el momento de ejecutar un cron con estados fijados
- **THEN** el cron se ejecuta igualmente con la configuración heredada y el run no queda fallido por
  ese motivo
