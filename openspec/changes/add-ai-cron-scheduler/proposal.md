# Proposal: Local AI Cron

## Why

`cron` sabe *cuándo* ejecutar pero no *qué* ejecutar de forma útil: lanza comandos ciegos. Los
"crons con IA" de OpenAI y Anthropic resuelven eso, pero solo existen en su nube y con su modelo.
Y las alternativas locales que existen hoy fallan por los extremos: las apps de escritorio con
tareas programadas (AgentCrew, forge, coworker) exigen tener la app abierta, y los plugins que sí
sobreviven al cierre (`opencode-scheduler`) no tienen interfaz, ni notificaciones, ni historial, ni
aceptan comandos que no sean de opencode.

Local AI Cron cubre ese hueco: un planificador local, con app de escritorio, que ejecuta prompts de
IA —o comandos arbitrarios— aunque la app esté cerrada, avisa al terminar y guarda el historial.

## What Changes

- Nuevo daemon de usuario que mantiene el reloj y ejecuta los crons con la app cerrada.
- Nueva app de escritorio (ventana GTK4 + WebKit2) para crear, editar, pausar y revisar crons.
- Nuevo esquema SQLite con `jobs`, `runs` y `messages`.
- Runner `opencode`: invoca `opencode run --format json` y parsea los eventos.
- Runner `shell`: ejecuta un comando arbitrario y captura `stdout`, `stderr` y código de salida.
- Catch-up configurable por cron: `once` (una vez), `all` (todas las perdidas) o `none`.
- Notificaciones de escritorio al terminar, opcionales por cron.
- Historial tipo chat por cron, con sesión continua opcional.
- Instalador que registra el daemon como servicio systemd `--user` y añade la entrada de menú.

No hay cambios incompatibles: el proyecto es nuevo.

## Capabilities

### New Capabilities

- `job-scheduling`: creación, edición, pausa y borrado de crons; repetición por expresión cron,
  intervalo o fecha única; cálculo de `next_run_at` con zona horaria y cambios de hora.
- `run-execution`: ejecución de un cron con los runners `opencode` y `shell`; timeout, política de
  solapamiento, límite de concurrencia y captura de la salida.
- `missed-run-recovery`: detección de ejecuciones perdidas al arrancar y política configurable
  (`once`, `all`, `none`).
- `run-history`: persistencia de ejecuciones y mensajes; consulta del historial y del chat por cron.
- `notifications`: aviso de escritorio al terminar una ejecución, con resultado y duración,
  opcional por cron.
- `desktop-app`: ventana de escritorio, API local y ciclo de vida del daemon (arranque con el
  sistema, supervivencia al cierre de la ventana y reinicio automático).

### Modified Capabilities

Ninguna: el proyecto no tiene specs previas.

## Impact

- Código nuevo en `packages/core`, `packages/daemon`, `packages/ui` y `packages/platform/linux`.
- Dependencias: Node 22, TypeScript, `node:sqlite`, `cron-parser`; PyGObject + WebKit2GTK del
  sistema para la ventana.
- Sistema: unidad systemd `--user` (`local-ai-cron.service`), entrada `.desktop` y base de datos en
  `~/.local/share/local-ai-cron/`.
- Seguridad: API solo en `127.0.0.1` con token; sin `--auto` de opencode por defecto; los crons
  corren con los permisos del usuario.
- Fuera de alcance en v1: Windows/macOS, webhooks/Telegram/email, encadenar crons y editor visual
  de workflows.
