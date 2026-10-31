# notifications Specification

## Purpose
Avisa al usuario en el escritorio cuando un cron termina, con el resultado y la duración, sin
obligarle a abrir la aplicación para enterarse.

## Requirements

### Requirement: Aviso al terminar

Si el cron tiene la notificación activada, el sistema DEBE enviar un aviso de escritorio al
terminar cada ejecución.

#### Scenario: Ejecución correcta

- **WHEN** un cron con notificación activada termina correctamente
- **THEN** aparece un aviso de escritorio con el nombre del cron y el resultado

#### Scenario: Notificación desactivada

- **WHEN** un cron tiene la notificación desactivada
- **THEN** la ejecución termina sin enviar ningún aviso

### Requirement: Momento del aviso

Cada cron DEBE poder elegir si avisa siempre, solo cuando falla o solo cuando termina bien.

#### Scenario: Solo fallos

- **WHEN** un cron configurado para avisar solo de fallos termina correctamente
- **THEN** no se envía ningún aviso

#### Scenario: Fallo avisado

- **WHEN** ese mismo cron falla
- **THEN** se envía el aviso con el error y el código de salida

### Requirement: Contenido del aviso

El aviso DEBE incluir el nombre del cron, el estado, la duración y un resumen corto de la respuesta
o del error.

#### Scenario: Resumen largo

- **WHEN** la respuesta de la IA supera el espacio disponible en el aviso
- **THEN** el aviso muestra un resumen recortado y el historial conserva el texto completo

### Requirement: Fallo del sistema de notificaciones

Si no hay servidor de notificaciones disponible, la ejecución NO DEBE fallar por ello y el sistema
DEBE registrar que el aviso no se entregó.

#### Scenario: Sin sesión gráfica

- **WHEN** un cron termina y no hay bus de notificaciones disponible
- **THEN** la ejecución se guarda con normalidad y el aviso queda marcado como no entregado
