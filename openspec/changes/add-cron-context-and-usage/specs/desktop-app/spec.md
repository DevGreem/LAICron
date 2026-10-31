# Spec Delta

## ADDED Requirements

### Requirement: Tarjeta de consumo

El detalle de un cron DEBE mostrar una tarjeta con el coste total, los tokens totales (entrada y
salida) y el número de ejecuciones con datos. En modo continuo DEBE aclarar que los tokens de
entrada incluyen el historial de la sesión.

#### Scenario: Totales visibles

- **WHEN** el usuario abre el detalle de un cron con ejecuciones
- **THEN** ve el coste total, los tokens totales y las ejecuciones con datos

#### Scenario: Modo continuo

- **WHEN** el cron usa sesión continua
- **THEN** la tarjeta indica que la entrada incluye el historial de la sesión

#### Scenario: Sin datos

- **WHEN** ninguna ejecución tiene consumo registrado
- **THEN** la tarjeta muestra que todavía no hay datos y no inventa ceros

### Requirement: Columnas de consumo en el historial

La tabla de ejecuciones DEBE mostrar los tokens y el coste de cada ejecución, y DEBE mostrar `—`
cuando no haya datos.

#### Scenario: Ejecución con datos

- **WHEN** una ejecución tiene tokens y coste
- **THEN** la fila muestra ambos valores

#### Scenario: Ejecución antigua

- **WHEN** una ejecución se guardó antes de existir el registro de consumo
- **THEN** la fila muestra `—` en tokens y coste
