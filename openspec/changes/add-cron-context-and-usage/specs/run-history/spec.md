# Spec Delta

## ADDED Requirements

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
