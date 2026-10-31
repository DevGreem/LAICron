# Local AI Cron

Planificador local tipo cron que ejecuta **prompts de IA** —o cualquier comando— cada cierto
tiempo, con aplicación de escritorio, notificaciones, historial tipo chat y recuperación de
ejecuciones perdidas.

> **Estado:** planificación. Todavía no hay código funcional; el diseño vive en `openspec/`.

## El problema

`cron` sabe *cuándo* ejecutar pero no *qué* ejecutar de forma útil: lanza comandos ciegos. Los
"crons con IA" de OpenAI y Anthropic resuelven eso, pero son en la nube, con su modelo y su
cuenta. Y las apps de escritorio con tareas programadas exigen tener la app abierta.

Local AI Cron junta las tres piezas que hoy están separadas:

- el **cuándo** de cron,
- el **qué** de `opencode` (o del comando que tú elijas),
- y una **app de escritorio** que sigue funcionando cuando la cierras.

## Cómo funciona

```
┌──────────────────────────┐
│ App de escritorio (UI)   │
└──────────────────────────┘
        │ CRUD de crons (HTTP local)
        ▼
    ┌──────────────────────────┐
    │ Daemon (systemd --user)  │
    └──────────────────────────┘
            │ ejecuta
            ▼
    ┌──────────────────────────┐
    │ opencode run / comando   │
    └──────────────────────────┘
            │ salida
            ▼
    ┌──────────────────────────┐
    │ SQLite + notify-send     │
    └──────────────────────────┘
```

El reloj vive en el daemon, no en la app. systemd solo se encarga de que el daemon no se muera
(`Restart=always` + `Linger`), así que los crons siguen corriendo con la app cerrada e incluso
sin sesión gráfica.

## Funciones previstas

- Crear crons desde una ventana: fecha, repetición, hora, prompt o comando.
- Ejecutar aunque la app esté cerrada.
- Notificación de escritorio al terminar (opcional por cron).
- Historial y chat por cron (sesión continua o ejecuciones independientes).
- **Catch-up configurable**: si el equipo estaba apagado, ejecutar una vez, todas las perdidas o
  ninguna.
- Runners: `opencode` y comandos de shell. La interfaz deja la puerta abierta a otros CLIs.

## Stack

| Pieza | Elección |
| --- | --- |
| Lenguaje | Node 22 + TypeScript |
| Persistencia | SQLite (`node:sqlite`) |
| Servicio | systemd `--user` (Linux); adaptadores para Windows/macOS más adelante |
| Ventana | GTK4 + WebKit2GTK (sin Electron) |
| IA | `opencode run --format json` |

## Desarrollo

El proyecto usa [OpenSpec](https://github.com/Fission-AI/OpenSpec) para acordar el diseño antes
de escribir código:

```sh
openspec list          # cambios activos
openspec show <cambio> # proposal + specs + design + tasks
```

## Licencia

Pendiente de decidir.
