# run-execution Specification

## Purpose
Ejecuta cada cron con el runner adecuado, aplicando límites de tiempo, solapamiento y
concurrencia, y captura el resultado para su consulta.

## Requirements

### Requirement: Runner opencode

El sistema DEBE ejecutar un cron de tipo opencode invocando `opencode run` en modo no interactivo y
DEBE extraer el texto de respuesta de su salida estructurada.

#### Scenario: Ejecución correcta

- **WHEN** un cron de tipo opencode se ejecuta y opencode termina con código 0
- **THEN** el sistema guarda el texto de la respuesta y marca la ejecución como correcta

#### Scenario: Fallo de opencode

- **WHEN** opencode termina con un código distinto de 0
- **THEN** el sistema marca la ejecución como fallida y guarda el error y el código de salida

### Requirement: Runner shell

El sistema DEBE ejecutar un cron de tipo shell como un comando en un directorio de trabajo
concreto y DEBE capturar su salida estándar, su error estándar y su código de salida.

#### Scenario: Comando correcto

- **WHEN** un cron shell ejecuta un comando que termina con código 0
- **THEN** la ejecución queda marcada como correcta con su salida guardada

#### Scenario: Comando inexistente

- **WHEN** el comando configurado no existe
- **THEN** la ejecución queda marcada como fallida con un mensaje que lo indica

### Requirement: Tiempo máximo

Cada cron DEBE tener un tiempo máximo de ejecución. Al superarlo, el sistema DEBE terminar el
proceso y sus hijos y marcar la ejecución como agotada.

#### Scenario: Timeout

- **WHEN** una ejecución supera su tiempo máximo
- **THEN** el sistema la termina, la marca como `timeout` y guarda la salida producida hasta ese momento

### Requirement: Política de solapamiento

Si un cron sigue ejecutándose cuando llega su siguiente disparo, el sistema DEBE aplicar la
política configurada: omitir el nuevo disparo, encolarlo o terminar el anterior.

#### Scenario: Omitir por defecto

- **WHEN** llega el siguiente disparo y la ejecución anterior sigue activa
- **THEN** el sistema no lanza una segunda ejecución y registra el disparo como omitido

### Requirement: Límite de concurrencia

El sistema NO DEBE ejecutar más de dos crons de IA a la vez. Los disparos que excedan el límite
DEBEN quedar en cola y ejecutarse en orden.

#### Scenario: Tres crons a la misma hora

- **WHEN** tres crons de IA coinciden en el mismo minuto
- **THEN** dos se ejecutan y el tercero espera en cola hasta que se libere una plaza

### Requirement: Estados de ejecución

Cada ejecución DEBE estar en uno de estos estados: en cola, en curso, correcta, fallida, agotada,
omitida o interrumpida.

#### Scenario: Interrupción del daemon

- **WHEN** el daemon se detiene mientras una ejecución está en curso
- **THEN** al arrancar de nuevo esa ejecución queda marcada como interrumpida

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
