# run-history Specification

## Purpose
Guarda cada ejecución y cada mensaje intercambiado con la IA, para que el usuario pueda consultar
qué pasó, cuándo y qué respondió el modelo.

## Requirements

### Requirement: Registro de ejecuciones

El sistema DEBE guardar, por cada ejecución, el cron, el inicio, el fin, la duración, el estado, el
código de salida, el disparador y la salida producida.

#### Scenario: Ejecución programada

- **WHEN** un cron se ejecuta por su horario
- **THEN** queda una ejecución nueva con disparador `scheduled` y todos sus datos

#### Scenario: Ejecución manual

- **WHEN** el usuario pulsa "ejecutar ahora"
- **THEN** la ejecución queda registrada con disparador `manual`

### Requirement: Mensajes de chat

El sistema DEBE guardar el prompt enviado y la respuesta recibida como mensajes asociados a la
ejecución, en orden cronológico.

#### Scenario: Respuesta guardada

- **WHEN** un cron de tipo opencode termina correctamente
- **THEN** el historial muestra el prompt y la respuesta como dos mensajes consecutivos

### Requirement: Sesión continua

Cada cron DEBE poder configurarse en modo sesión continua, de forma que cada ejecución continúe la
conversación anterior en lugar de empezar de cero.

#### Scenario: Contexto acumulado

- **WHEN** un cron en modo continuo se ejecuta por segunda vez
- **THEN** la IA recibe el contexto de la ejecución anterior y el historial las muestra enlazadas

#### Scenario: Modo independiente

- **WHEN** un cron en modo independiente se ejecuta por segunda vez
- **THEN** la ejecución empieza sin contexto previo y el historial las muestra separadas

### Requirement: Consulta del historial

El sistema DEBE permitir consultar las ejecuciones de un cron de la más reciente a la más antigua,
con paginación, y DEBE mostrar el estado y la duración de cada una.

#### Scenario: Historial largo

- **WHEN** un cron acumula 500 ejecuciones
- **THEN** el sistema devuelve las más recientes primero y permite pedir las siguientes páginas

### Requirement: Retención

El sistema DEBE aplicar una retención configurable por antigüedad y por número de ejecuciones, con
valores por defecto de 90 días y 200 ejecuciones por cron.

#### Scenario: Limpieza automática

- **WHEN** un cron supera las 200 ejecuciones guardadas
- **THEN** el sistema elimina las más antiguas y conserva las 200 más recientes

### Requirement: Consumo por ejecución

El sistema DEBE guardar, por cada ejecución de `opencode`, los tokens de entrada, salida,
razonamiento y caché, y el coste en USD. En modo continuo, el consumo DEBE contar solo los mensajes
generados después del inicio de esa ejecución. Si el consumo no se puede leer, la ejecución DEBE
guardarse sin datos y NO DEBE marcarse como fallida por ese motivo.

#### Scenario: Ejecución con consumo

- **WHEN** un cron de `opencode` termina correctamente
- **THEN** la ejecución guarda sus tokens y su coste

#### Scenario: Sesión continua

- **WHEN** un cron en modo continuo se ejecuta por tercera vez
- **THEN** su consumo cuenta solo los tokens de esa tercera ejecución, no los de las anteriores

#### Scenario: Consumo no disponible

- **WHEN** no se puede leer el consumo de una ejecución
- **THEN** la ejecución queda correcta, con los campos de consumo vacíos

### Requirement: Consumo total por cron

El sistema DEBE exponer, por cron, el coste total, los tokens totales y el número de ejecuciones con
datos. Las ejecuciones sin datos NO DEBEN contarse como consumo cero en los totales.

#### Scenario: Totales del cron

- **WHEN** el usuario abre el detalle de un cron con varias ejecuciones
- **THEN** ve el coste total, los tokens totales y cuántas ejecuciones tienen datos

#### Scenario: Modelo gratuito

- **WHEN** todas las ejecuciones usan un modelo con coste cero
- **THEN** el coste total se muestra como cero y los tokens siguen visibles
