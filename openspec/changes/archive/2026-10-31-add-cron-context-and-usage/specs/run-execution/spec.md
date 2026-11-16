# Spec Delta

## ADDED Requirements

### Requirement: Ejecución aislada con configuración por ejecución

El runner `opencode` DEBE ejecutar cada cron con un servidor privado (`--standalone`) para que la
configuración inline de esa ejecución se aplique. NO DEBE depender del servicio en segundo plano
compartido, que ignora `OPENCODE_CONFIG_CONTENT`.

#### Scenario: Overlay de MCPs aplicado

- **WHEN** un cron tiene MCPs fijados en `on` u `off`
- **THEN** el proceso de `opencode` arranca con `--standalone` y aplica el overlay de esa ejecución

#### Scenario: Sesión continua

- **WHEN** un cron en modo continuo se ejecuta con `--standalone` y `-s <sesión>`
- **THEN** la ejecución conserva el contexto de la sesión anterior

### Requirement: Instrucción de cron oculta

Cada ejecución de `opencode` DEBE incluir una instrucción fija que indique que es una tarea
programada y que no habrá respuesta del usuario. La instrucción NO DEBE ser editable desde la
ventana, NO DEBE guardarse como mensaje del chat y NO DEBE modificar la configuración del usuario.

#### Scenario: Instrucción aplicada

- **WHEN** se ejecuta un cron de `opencode`
- **THEN** el proceso recibe la instrucción de cron como contexto adicional de la ejecución

#### Scenario: Instrucción oculta en el chat

- **WHEN** el usuario abre el historial de un cron
- **THEN** solo ve el prompt que escribió y la respuesta, no la instrucción de cron

#### Scenario: Fallo al preparar la instrucción

- **WHEN** no se puede escribir el fichero de instrucciones
- **THEN** la ejecución continúa sin la instrucción y no se marca como fallida por ese motivo
