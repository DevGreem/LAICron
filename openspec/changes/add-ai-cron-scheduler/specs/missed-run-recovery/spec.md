# Spec Delta

## Purpose

Detecta los disparos que no llegaron a ejecutarse porque el equipo estaba apagado o el daemon
detenido, y aplica la política de recuperación configurada en cada cron.

## ADDED Requirements

### Requirement: Detección al arrancar

Al arrancar, el sistema DEBE comparar la próxima ejecución de cada cron activo con la hora actual
y DEBE identificar como perdidos todos los disparos anteriores a ese momento.

#### Scenario: Equipo apagado

- **WHEN** un cron diario de las 09:00 no se ejecutó porque el equipo estaba apagado y el daemon arranca a las 11:30
- **THEN** el sistema detecta un disparo perdido antes de iniciar el bucle normal

### Requirement: Política ninguna

Con la política `none`, el sistema NO DEBE ejecutar el disparo perdido y DEBE registrar que se
omitió antes de calcular la siguiente ejecución.

#### Scenario: Sin recuperación

- **WHEN** el daemon arranca y un cron tiene la política `none` y un disparo perdido
- **THEN** no se ejecuta, queda registrado como omitido y la próxima ejecución se calcula desde ahora

### Requirement: Política una vez

Con la política `once`, el sistema DEBE ejecutar el cron una sola vez, sin importar cuántos
disparos se hayan perdido, y DEBE informar de cuántos se perdieron.

#### Scenario: Cinco días apagado

- **WHEN** el equipo estuvo apagado cinco días y el cron es diario con política `once`
- **THEN** el sistema ejecuta el cron una vez y registra que se perdieron cuatro disparos

### Requirement: Política todas

Con la política `all`, el sistema DEBE ejecutar una vez por cada disparo perdido, con un máximo
configurable que por defecto es diez.

#### Scenario: Tope de recuperación

- **WHEN** un cron de cada hora estuvo tres días sin ejecutarse y su tope es diez
- **THEN** el sistema ejecuta diez veces y registra el resto como omitido

### Requirement: Suspensión y cambio de reloj

La detección DEBE funcionar también cuando el equipo estuvo suspendido o el reloj cambió, sin
depender de un temporizador que se haya podido desfasar.

#### Scenario: Despertar de suspensión

- **WHEN** el equipo se suspende durante seis horas y al despertar ya pasó la hora de un cron
- **THEN** el sistema aplica la política configurada en el siguiente ciclo, sin esperar a la hora siguiente
