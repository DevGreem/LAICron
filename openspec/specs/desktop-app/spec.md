# desktop-app Specification

## Purpose
Ofrece una ventana de escritorio para gestionar los crons y garantiza que el daemon que los ejecuta
siga vivo con la ventana cerrada, tras un cierre de sesión y después de un fallo.

## Requirements

### Requirement: Ventana de escritorio

El sistema DEBE ofrecer una ventana con la lista de crons, su próxima ejecución y su último estado,
desde la que se puedan crear, editar, pausar, borrar y ejecutar crons.

#### Scenario: Crear desde la ventana

- **WHEN** el usuario rellena el formulario y guarda
- **THEN** el cron aparece en la lista con su próxima ejecución calculada

#### Scenario: Ejecutar ahora

- **WHEN** el usuario pulsa "ejecutar ahora" en un cron
- **THEN** la ejecución empieza de inmediato y la lista refleja su estado

### Requirement: Cierre de la ventana

Cerrar la ventana NO DEBE detener el daemon ni las ejecuciones programadas.

#### Scenario: Cerrar y esperar

- **WHEN** el usuario cierra la ventana y llega la hora de un cron
- **THEN** el cron se ejecuta igualmente y queda en el historial

### Requirement: API local autenticada

La ventana DEBE comunicarse con el daemon mediante una API que escuche solo en `127.0.0.1` y exija
un token local.

#### Scenario: Petición sin token

- **WHEN** un proceso local llama a la API sin el token correcto
- **THEN** el sistema rechaza la petición con un error de autorización

### Requirement: Arranque con el sistema

El daemon DEBE arrancar con el sistema y DEBE seguir funcionando sin sesión gráfica iniciada.

#### Scenario: Reinicio del equipo

- **WHEN** el equipo se reinicia sin que el usuario abra la aplicación
- **THEN** el daemon arranca solo y los crons vuelven a ejecutarse a su hora

### Requirement: Supervivencia a fallos

Si el daemon termina de forma inesperada, el sistema DEBE reiniciarlo y la ventana DEBE avisar de
que el último latido es antiguo.

#### Scenario: Daemon caído

- **WHEN** el daemon se cae y no se reinicia
- **THEN** la ventana muestra un aviso de que el planificador no está respondiendo

### Requirement: Instalación y desinstalación

El sistema DEBE incluir un instalador que registre el daemon, cree la entrada de menú y prepare la
base de datos, y un desinstalador que lo revierta sin borrar los datos sin confirmación.

#### Scenario: Instalar

- **WHEN** el usuario ejecuta el instalador
- **THEN** el daemon queda registrado, arranca y la aplicación aparece en el menú

#### Scenario: Desinstalar

- **WHEN** el usuario ejecuta el desinstalador y confirma
- **THEN** el daemon y la entrada de menú desaparecen y los datos se conservan salvo confirmación expresa
