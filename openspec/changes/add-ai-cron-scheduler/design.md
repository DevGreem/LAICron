# Design

## Context

Proyecto nuevo. Ver `proposal.md` para la motivación.

Restricciones del entorno que condicionan el diseño:

- Node 22 y `node:sqlite` disponibles; no hay Rust (Tauri descartado).
- systemd de usuario con `Linger=yes`, y el entorno del gestor ya incluye `DISPLAY`,
  `WAYLAND_DISPLAY` y `DBUS_SESSION_BUS_ADDRESS`.
- `opencode run --format json` funciona sin TTY y devuelve eventos con `sessionID` y texto.
- WebKit2GTK 4.1 y PyGObject están instalados; no hace falta instalar nada para la ventana.
- Requisito de producto: los crons corren con la ventana cerrada.

## Goals / Non-Goals

**Goals:**

- Un solo proceso con el reloj, portable a otros sistemas operativos sin reescribir la lógica.
- Recuperación de ejecuciones perdidas con política por cron, no global.
- Historial consultable sin abrir la ventana.
- Instalación y desinstalación sin pasos manuales.

**Non-Goals:**

- Editor visual de workflows o encadenado de crons.
- Ejecución distribuida o multiusuario.
- Webhooks, Telegram o email en esta versión.
- Soporte de Windows/macOS ahora; solo dejar los adaptadores aislados.

## Decisions

### D1. Daemon propio, no un timer de systemd por cron

El daemon mantiene el bucle y ejecuta los crons. systemd solo lo supervisa
(`Restart=always`, `WantedBy=default.target`).

**Por qué:** la política de catch-up, el límite de concurrencia, la cola y las notificaciones
necesitan estado compartido. Con un timer por cron, ese estado se reparte entre unidades y el
catch-up queda fijado por `Persistent=true`, sin opción de desactivarlo.

**Alternativa descartada:** generar unidades `.timer` por cron (lo que hace `opencode-scheduler`).
Es más robusto frente a caídas del daemon, pero impide el catch-up configurable y multiplica los
ficheros a mantener.

**Mitigación de la desventaja:** `Restart=always` + latido en SQLite; la UI avisa si el latido
tiene más de 60 s.

### D2. SQLite con `node:sqlite`

Una sola base en `~/.local/share/laicron/laicron.db`, en modo WAL.

**Por qué:** el daemon escribe y la UI lee en paralelo; WAL permite eso sin bloqueos. `node:sqlite`
viene con Node 22 y evita compilar dependencias nativas.

**Alternativa descartada:** `better-sqlite3` (compilación nativa en cada actualización de Node) y
ficheros JSON (sin transacciones ni consultas).

### D3. Bucle de reloj cada 20 s, con hora en UTC

Cada ciclo: leer crons activos con `next_run_at <= ahora`, ejecutar y recalcular desde **ahora**.

- `next_run_at` se guarda en milisegundos UTC; la zona del equipo solo se usa al calcular.
- El cálculo usa `cron-parser` con zona horaria explícita, no sumas de 24 h.
- Recalcular desde ahora evita que un retraso de 3 s se arrastre indefinidamente.

**Alternativa descartada:** `setTimeout` hasta la próxima ejecución. Se desfasa con la suspensión
del equipo y con los cambios de hora.

### D4. Recuperación al arrancar, antes del bucle

Al arrancar, para cada cron activo con `next_run_at < ahora`:

| Política | Acción |
| --- | --- |
| `none` | registra `omitido` y avanza |
| `once` | ejecuta una vez con disparador `catch_up` |
| `all` | ejecuta una vez por disparo perdido, con tope (10 por defecto) |

Además, las ejecuciones que quedaron en estado `en curso` se marcan como `interrumpida`.

**Por qué el tope en `all`:** un cron de cada minuto con el equipo apagado una semana generaría
10 080 ejecuciones. El tope convierte un error de configuración en un aviso, no en una factura.

### D5. Runner como interfaz con dos implementaciones

```ts
interface Runner {
  run(job: Job, signal: AbortSignal): Promise<RunResult>
}
```

- `opencode`: `opencode run --format json [--model] [--agent] [-s sesión]`, parsea los eventos y
  concatena los `text`. Tolera tipos de evento desconocidos.
- `shell`: `sh -lc <comando>` en `cwd`, captura `stdout`, `stderr` y código.

**Por qué una interfaz:** añadir `claude`, `codex` u `ollama` después no toca el scheduler.

### D6. Concurrencia global de 2 y cola FIFO

Un semáforo compartido limita las ejecuciones de IA a dos. El resto espera en una cola en memoria,
persistida como `runs.status = queued`.

**Por qué:** cinco crons a las 09:00 no deben lanzar cinco sesiones de opencode a la vez. El límite
es configurable, pero 2 es el valor por defecto.

### D7. Solapamiento por cron

`skip` (por defecto), `queue` o `kill`. Se evalúa al disparar, comparando con la ejecución activa
del mismo cron.

**Por qué `skip` por defecto:** un cron lento no debe acumular ejecuciones encima de la anterior.

### D8. API local con token

HTTP en `127.0.0.1`, puerto fijo configurable (por defecto 7317), token de 32 bytes en
`~/.config/laicron/token` con permisos `0600`.

- `GET/POST/PATCH/DELETE /api/jobs`
- `POST /api/jobs/:id/run`
- `GET /api/jobs/:id/runs`, `GET /api/jobs/:id/messages`
- `GET /api/health` (latido)
- `GET /api/events` (SSE para actualizar la UI)

**Por qué token y no solo loopback:** cualquier proceso del usuario puede hablar con loopback; el
token evita que un script olvidado o una web local lo haga sin permiso.

### D9. UI web + ventana GTK3/WebKit2 4.1

La UI es una SPA estática servida por el daemon. La ventana es un lanzador Python de ~80 líneas que
usa PyGObject y WebKit2GTK del sistema, sin `pip install`.

**Por qué GTK3 y no GTK4:** en este equipo `WebKit2 4.1` es la variante GTK3 de WebKitGTK; para
GTK4 haría falta WebKitGTK 6.0 (`gir1.2-webkit-6.0`), que no está instalado. GTK3 + WebKit2 4.1 sí
carga y no añade dependencias. La spec solo exige una ventana de escritorio, no una versión de GTK.

**Por qué:** cero dependencias nuevas, arranque rápido y la UI se puede abrir también en el
navegador para depurar.

**Alternativa descartada:** Electron (~250 MB) y Tauri (requiere Rust, no instalado).

### D10. Notificaciones con `notify-send`

Se invoca `notify-send -a "LAICron"` con nombre, estado y duración. Un fallo del comando no
cambia el estado de la ejecución; solo marca `notification_delivered = false`.

**Por qué no un servidor de notificaciones propio:** GNOME ya tiene uno y el bus de sesión está
disponible desde el servicio.

### D11. Entorno y PATH completos

El instalador captura el `PATH` del usuario y lo fija en la unidad. El daemon pasa su entorno
completo a los hijos, con las variables del cron por encima.

**Por qué:** el error más común de los planificadores es que el proceso programado no encuentra
`uv`, `pnpm` o el propio CLI. `opencode-scheduler` recorta el PATH y ese es un fallo real que no
queremos repetir.

### D12. Modelo de datos

```sql
jobs(id, name, enabled, runner, prompt, command, args_json, cwd,
     model, agent, session_mode, session_id,
     schedule_kind, schedule_expr, timezone,
     catch_up, catch_up_limit, overlap, timeout_sec,
     notify, notify_on,
     next_run_at, last_run_at, last_status,
     created_at, updated_at)

runs(id, job_id, trigger, status, started_at, finished_at,
     duration_ms, exit_code, output, error, session_id,
     notification_delivered)

messages(id, job_id, run_id, role, content, created_at)
```

Índices: `jobs(enabled, next_run_at)`, `runs(job_id, started_at DESC)`,
`messages(job_id, created_at)`.

### D13. Portabilidad

Solo tres piezas son específicas del sistema, y cada una detrás de una interfaz:

| Interfaz | Linux | Windows | macOS |
| --- | --- | --- | --- |
| `ServiceInstaller` | systemd `--user` | Tarea programada | `LaunchAgent` |
| `Notifier` | `notify-send` | toast PowerShell | `osascript` |
| `WindowLauncher` | GTK3 + WebKit2 4.1 | Edge `--app` | Chrome `--app` |

El resto (scheduler, SQLite, runners, API, UI) no sabe en qué sistema corre.

## Risks / Trade-offs

- **El formato de `opencode run --format json` cambia** → parser tolerante a eventos desconocidos y
  una prueba de humo que ejecuta opencode real antes de cada release.
- **El daemon se cae y nadie se entera** → `Restart=always`, latido en SQLite y aviso en la UI.
- **La base de datos crece sin control** → retención por antigüedad y número de ejecuciones.
- **Un cron caro se dispara cada minuto** → límite de concurrencia, tope de catch-up y aviso en la
  UI al crear frecuencias agresivas.
- **Notificación perdida sin sesión gráfica** → la ejecución queda en el historial y se marca como
  no entregada.
- **Cambio de hora** → cálculo con zona horaria, nunca sumando 24 h.
- **Distribuciones sin systemd** → el instalador detecta y avisa; el daemon puede arrancarse a mano.

## Migration Plan

No hay migración: es la primera versión.

- Instalación: `install.sh` crea la unidad, la habilita, arranca el daemon y añade el `.desktop`.
- Desinstalación: `uninstall.sh` para y deshabilita la unidad, borra el `.desktop` y conserva la
  base salvo confirmación expresa.

## Open Questions

- Si el modo `all` de catch-up debe tener un límite distinto por tipo de cron.
