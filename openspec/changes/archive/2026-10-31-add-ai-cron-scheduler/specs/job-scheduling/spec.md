# Spec Delta

## Purpose

Permite definir, editar, pausar y eliminar crons, y calcula con exactitud cuándo debe ejecutarse
cada uno.

## ADDED Requirements

### Requirement: Creación de un cron

El sistema DEBE permitir crear un cron con nombre, destino (prompt o comando), repetición, política
de recuperación, notificación y tiempo máximo. Un cron inválido NO DEBE persistirse.

#### Scenario: Cron válido

- **WHEN** el usuario envía un cron con nombre, prompt y expresión `0 9 * * *`
- **THEN** el sistema lo guarda, calcula su próxima ejecución y lo muestra en la lista

#### Scenario: Expresión inválida

- **WHEN** el usuario envía una repetición que no se puede interpretar
- **THEN** el sistema rechaza la creación, señala el campo incorrecto y no guarda nada

### Requirement: Tipos de repetición

El sistema DEBE soportar expresión cron de cinco campos, intervalo de minutos u horas, y ejecución
única en una fecha y hora concretas.

#### Scenario: Intervalo

- **WHEN** el usuario crea un cron cada 15 minutos
- **THEN** la próxima ejecución queda 15 minutos después del momento de creación

#### Scenario: Ejecución única en el pasado

- **WHEN** el usuario crea una ejecución única con fecha anterior al momento actual
- **THEN** el sistema la rechaza y explica que la fecha ya pasó

### Requirement: Zona horaria y cambios de hora

El sistema DEBE interpretar la repetición en la zona horaria del equipo y guardar la próxima
ejecución en UTC. Los cambios de hora NO DEBEN duplicar ni omitir ejecuciones.

#### Scenario: Adelanto de hora

- **WHEN** un cron diario a las 02:30 cae en el hueco del adelanto de hora
- **THEN** se ejecuta una sola vez, en el primer instante válido posterior

#### Scenario: Atraso de hora

- **WHEN** un cron diario a las 02:30 cae en la hora repetida del atraso
- **THEN** se ejecuta una sola vez, no dos

### Requirement: Pausa y reanudación

Un cron pausado NO DEBE ejecutarse. Al reanudarlo, el sistema DEBE recalcular la próxima ejecución
desde el momento de la reanudación.

#### Scenario: Pausar

- **WHEN** el usuario pausa un cron cuya próxima ejecución es en 5 minutos
- **THEN** no se ejecuta a esa hora y la lista lo muestra como pausado

#### Scenario: Reanudar

- **WHEN** el usuario reanuda un cron pausado
- **THEN** la próxima ejecución se calcula desde ahora, no desde la fecha en que se pausó

### Requirement: Edición

Al cambiar la repetición, el sistema DEBE recalcular la próxima ejecución sin afectar a la
ejecución que ya esté en curso.

#### Scenario: Cambio de hora

- **WHEN** el usuario cambia un cron de las 09:00 a las 10:00
- **THEN** la próxima ejecución pasa a las 10:00 del mismo día o del siguiente

### Requirement: Borrado

Al borrar un cron, el sistema DEBE pedir confirmación y eliminar sus ejecuciones futuras y su
historial.

#### Scenario: Borrado confirmado

- **WHEN** el usuario confirma el borrado de un cron
- **THEN** deja de ejecutarse y sus ejecuciones y mensajes desaparecen del historial
