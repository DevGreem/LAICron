# LAICron

Planificador local tipo cron para Linux. Ejecuta **prompts de IA** (con `opencode`) o **comandos de
shell** a la hora que definas, desde una ventana de escritorio, y sigue funcionando con la ventana
cerrada porque el reloj vive en un daemon de systemd.

## Qué es y qué problema resuelve

`cron` sabe *cuándo* ejecutar, pero lanza comandos ciegos: no tiene interfaz, ni historial, ni aviso
al terminar, y si el equipo estaba apagado no permite decidir qué hacer con las ejecuciones
perdidas. Los "crons con IA" de los proveedores cloud resuelven la parte de la IA, pero atan a su
nube, su modelo y su cuenta. Las apps de escritorio con tareas programadas, en cambio, suelen exigir
tener la app abierta.

LAICron cubre ese hueco en local: un daemon de systemd `--user` mantiene el reloj y ejecuta cada
cron con tu usuario, una ventana GTK3/WebKit2 4.1 sirve para crear y revisar los crons, y SQLite
guarda el historial. Cada cron puede ser un prompt para `opencode` o un comando arbitrario de shell.

El resultado: programas un prompt o un comando una vez y se ejecuta aunque hayas cerrado la ventana;
al terminar puedes recibir una notificación y consultar después qué pasó, cuándo y qué respondió el
modelo.

```
Ventana GTK3/WebKit2 4.1 ──HTTP──> daemon (systemd --user) ──> opencode / sh -lc
                                      │
                                      ├──> SQLite (~/.local/share/laicron/laicron.db)
                                      └──> notify-send
```

## Funciones

- Crons con **prompt de IA** (`opencode run --format json`) o **comando de shell** (`sh -lc`).
- **Argumentos por cron**: posicionales en los comandos de shell (`$1`, `$2`…) y extra antes del
  prompt en `opencode`.
- Tres formas de repetición: expresión cron de cinco campos, intervalo (`15m`, `2h`) y fecha única.
- **Catch-up configurable** si el equipo estaba apagado: no recuperar, recuperar una vez o recuperar
  todas las pérdidas (con un tope configurable).
- **Solapamiento configurable** si la ejecución anterior sigue en marcha: omitir la nueva, encolarla
  o terminar la anterior.
- Notificaciones de escritorio con `notify-send`, opcionales por cron y filtrables (siempre, solo
  fallos o solo éxito).
- Historial de ejecuciones por cron y conversación (prompt y respuesta) en los crons de IA.
- Sesión continua opcional: cada ejecución continúa la conversación anterior de `opencode`.
- Pausar, reanudar y "ejecutar ahora" desde la ventana.
- Cola de ejecuciones con un máximo de dos crons de IA concurrentes.
- Ejecución con la ventana cerrada y arranque automático con el gestor de usuario de systemd.

## Requisitos

| Requisito | Para qué |
| --- | --- |
| Linux con systemd de usuario | El daemon se instala como `laicron.service` en el gestor de usuario |
| Node.js 22 o superior | Daemon, compilación y CLI |
| pnpm | Instalación de dependencias y compilación |
| Python 3 con PyGObject (`gi`) | Lanzador de la ventana |
| GTK3 y WebKit2GTK 4.1 (se acepta 4.0) | Ventana de escritorio |
| `notify-send` (libnotify) | Notificaciones de escritorio |
| `opencode` en el `PATH` | Solo para los crons de IA |

`scripts/install.sh` comprueba Node, pnpm y `systemctl`; Python, GTK/WebKit, `notify-send` y
`opencode` se usan en tiempo de ejecución. Si falta alguno, la instalación no falla, pero la ventana
o las notificaciones no funcionarán (ver *Solución de problemas*).

En Debian/Ubuntu, los paquetes de la ventana son `gir1.2-gtk-3.0` y `gir1.2-webkit2-4.1`, como
indica el propio lanzador. En este sistema `WebKit2 4.1` es la variante GTK3 de WebKitGTK; usar GTK4
exigiría WebKitGTK 6.0, que no está instalado.

## Instalación

Desde la raíz del repositorio, con tu usuario (sin `sudo`: la unidad es `--user` y todo se instala
en tu `$HOME`):

```sh
bash scripts/install.sh
```

El script hace, en este orden:

1. Comprueba que existen `node`, `pnpm` y `systemctl`.
2. Instala las dependencias con `pnpm install --frozen-lockfile`.
3. Compila todo con `pnpm build`.
4. Ejecuta `node packages/platform/linux/dist/service-installer.js install`, que:
   - escribe `~/.config/laicron/env` con el `PATH` de tu sesión (permisos `0600`);
   - escribe la unidad `~/.config/systemd/user/laicron.service`;
   - escribe la entrada de menú `~/.local/share/applications/laicron.desktop`;
   - recarga systemd y ejecuta `systemctl --user enable --now laicron`;
   - crea el enlace `~/.local/bin/laicron` → `packages/daemon/bin/laicron.js`;
   - avisa si `~/.local/bin` no está en tu `PATH`;
   - intenta activar *linger* con `loginctl enable-linger` para que el daemon siga tras cerrar
     sesión (si el sistema no lo permite, avisa y el servicio funciona mientras la sesión esté
     abierta).
5. Comprueba con `systemctl --user is-active --quiet laicron`. Si el servicio no está activo,
   muestra las últimas líneas del journal y sale con código 1.

La unidad apunta con rutas absolutas a este repositorio (`ExecStart` y `WorkingDirectory`). Si mueves
o renombras la carpeta, vuelve a ejecutar `scripts/install.sh`.

### Comprobar que quedó activo

```sh
systemctl --user status laicron --no-pager
laicron status
curl -sS http://127.0.0.1:7317/api/health
```

Deberías ver el servicio `active (running)`, el mensaje `LAICron está activo (versión 0.1.0).` y un
JSON con `"status":"ok"`.

> Si `laicron` no está en tu `PATH`, usa `~/.local/bin/laicron status` o añade `~/.local/bin` a tu
> perfil. El instalador avisa cuando esa carpeta no está en el `PATH`.

> Si el servicio no queda activo, `install.sh` muestra las últimas líneas del journal y termina con
> código 1; no imprime un éxito falso.

## Uso

### Abrir la ventana

- Desde el menú de aplicaciones: **LAICron**.
- Desde una terminal:

  ```sh
  laicron open
  ```

  Si el comando no existe, usa `~/.local/bin/laicron open` o añade `~/.local/bin` a tu `PATH`.

La ventana solo se abre si el daemon responde en el puerto configurado; si no, `open` termina con
`El daemon de LAICron no está activo. Arráncalo con: laicron start`.

La interfaz es una web local que sirve el propio daemon en `http://127.0.0.1:7317/` por defecto. La
ventana la carga con el token en el fragmento de la URL; si abres esa dirección en un navegador sin
token verás `Falta el token de acceso. Abre LAICron desde el menú.`

### Crear un cron

1. Pulsa **Crear cron**.
2. Pon un **nombre** (obligatorio, máximo 100 caracteres).
3. Elige el **ejecutor**:
   - `opencode (IA)`: el **prompt** es obligatorio. **Modelo** y **Agente** son opcionales y se pasan
     a `opencode` como `--model` y `--agent`.
   - `shell (comando)`: el **comando** es obligatorio y se ejecuta con `sh -lc`; el **directorio de
     trabajo** también es obligatorio (si no lo indicas al crear por API, se usa tu `$HOME`).
4. **Argumentos** (opcional, en *Ejecución*): uno por línea. En `shell` se pasan como parámetros
   posicionales (`$1`, `$2`…; `$0` es `laicron`). En `opencode` se insertan antes del prompt.
5. Elige la **repetición** y la **zona horaria** (nombre IANA, por ejemplo `Europe/Madrid`).
6. Ajusta la ejecución: política de catch-up, límite, solapamiento, tiempo máximo (1–86400 segundos;
   600 por defecto) y modo de sesión.
7. Configura la **notificación** si la quieres.
8. **Guardar**. El cron aparece en la lista con su próxima ejecución calculada.

En el detalle de cada cron puedes **Pausar**/**Reanudar**, **Editar**, **Ejecutar ahora** y consultar
el historial de ejecuciones y la conversación.

### Tipos de repetición

| Tipo | Expresión | Ejemplo | Notas |
| --- | --- | --- | --- |
| `cron` | Cinco campos: minuto, hora, día del mes, mes y día de la semana | `0 9 * * 1-5` | Se interpreta en la zona horaria del cron y se guarda en UTC. Los cambios de hora no duplican ni omiten ejecuciones |
| `interval` | `<n>m` o `<n>h` | `15m`, `2h` | La siguiente ejecución se calcula desde el momento de ejecutar la anterior |
| `once` | Fecha ISO-8601 con offset o `Z` | `2026-11-01T09:00:00+01:00` | La interfaz usa un selector de fecha y hora local y guarda el instante en ISO. Una fecha pasada se rechaza. Tras ejecutarse, el cron queda sin próxima ejecución |

### Catch-up (equipo apagado o daemon detenido)

Al arrancar, el daemon revisa los crons activos cuya próxima ejecución ya pasó y aplica la política
de cada uno. También la aplica en el primer ciclo tras una suspensión si se han perdido dos o más
ocurrencias; si solo se perdió una, la ejecuta como programada:

| Política | Qué hace |
| --- | --- |
| `none` | No ejecuta nada; registra una ejecución `Omitida` con el número de disparos perdidos y avanza |
| `once` | Ejecuta una sola vez, con disparador `Recuperada`, aunque se hayan perdido varios disparos |
| `all` | Ejecuta una vez por cada disparo perdido, hasta el **límite de recuperación** (1–100; 10 por defecto). El resto queda registrado como omitido |

Las ejecuciones que quedaron `En curso` cuando se paró el daemon se marcan como `Interrumpida`.

### Solapamiento

Si llega un disparo mientras la ejecución anterior del mismo cron sigue activa:

| Política | Qué hace |
| --- | --- |
| `skip` (por defecto) | No lanza otra; registra el disparo como `Omitida` |
| `queue` | Espera a que termine la anterior y entonces ejecuta la nueva |
| `kill` | Termina la ejecución anterior y arranca la nueva |

### Notificación

Con **Avisar al terminar** activado, el daemon llama a `notify-send -a "LAICron"` con el nombre del
cron, el estado, la duración y un resumen de la respuesta o del error. Puedes elegir avisar
**siempre**, **solo si falla** o **solo si va bien**. Si no hay servidor de notificaciones, la
ejecución no falla: queda registrada y el aviso se marca como no entregado.

### Historial y conversación

El detalle del cron muestra las ejecuciones (estado, disparador, inicio, duración, código de salida y
error) y, en los crons de IA, los mensajes de usuario y asistente. El historial se conserva 90 días y
un máximo de 200 ejecuciones por cron; las más antiguas se van borrando.

## Datos y seguridad

| Qué | Dónde | Detalles |
| --- | --- | --- |
| Base de datos | `~/.local/share/laicron/laicron.db` | SQLite en modo WAL; también aparecen `laicron.db-wal` y `laicron.db-shm` |
| Token de la API | `~/.config/laicron/token` | 32 bytes aleatorios en hexadecimal, permisos `0600`; el directorio se crea `0700` |
| `PATH` del servicio | `~/.config/laicron/env` | Lo escribe el instalador con permisos `0600` |
| Unidad systemd | `~/.config/systemd/user/laicron.service` | `Restart=always`, `RestartSec=3` |
| Entrada de menú | `~/.local/share/applications/laicron.desktop` | Lanza `packages/daemon/bin/laicron.js open` |
| CLI | `~/.local/bin/laicron` | Enlace a `packages/daemon/bin/laicron.js` |

- La API escucha solo en `127.0.0.1:7317` por defecto y exige `Authorization: Bearer <token>` en
  todo `/api/*`, salvo `GET /api/health`, que es público. Los ficheros estáticos de la interfaz se
  sirven sin token, pero no contienen datos.
- Los crons se ejecutan **con tu usuario y tus permisos**, sin sandbox ni privilegios adicionales. Un
  cron de shell puede hacer cualquier cosa que puedas hacer tú en una terminal; un cron de IA ejecuta
  `opencode` con tu configuración y tus permisos de `opencode`.
- Los crons de IA se lanzan con `opencode run --format json` sin flags de auto-aprobación; `opencode`
  aplica su propia configuración de permisos.
- El daemon pasa a los crons su entorno y el `PATH` capturado en la instalación. No hay variables de
  entorno por cron: todos heredan el entorno del servicio. Si `opencode` no estaba en el `PATH` al
  instalar, los crons de IA fallarán con `opencode no está instalado o no está en el PATH`.
- No expongas `LAICRON_HOST` a `0.0.0.0` en una red que no controles: la API seguiría pidiendo token,
  pero dejaría de ser local.

## Comandos de la CLI

La instalación crea el enlace `~/.local/bin/laicron`, que apunta a
`packages/daemon/bin/laicron.js` dentro del repo. Si `~/.local/bin` no está en tu `PATH`, el
instalador lo avisa: añádelo a tu perfil o usa `~/.local/bin/laicron` (o la ruta completa al script).

| Comando | Qué hace |
| --- | --- |
| `laicron start` | Arranca el daemon en primer plano. Es el comando por defecto. No lo uses si el servicio de systemd ya está activo: el puerto estará ocupado |
| `laicron open` | Abre la ventana (exige que el daemon esté activo) |
| `laicron status` | Comprueba el daemon y muestra la versión y el último latido |
| `laicron token` | Muestra la **ruta** del fichero del token, nunca su contenido |
| `laicron --help` | Muestra la ayuda |
| `laicron --version` | Muestra la versión instalada |

## Variables de entorno

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `LAICRON_PORT` | `7317` | Puerto de la API y de la interfaz |
| `LAICRON_HOST` | `127.0.0.1` | Interfaz de escucha de la API |
| `LAICRON_DB_PATH` | `$XDG_DATA_HOME/laicron/laicron.db` (o `~/.local/share/laicron/laicron.db`) | Ruta de la base de datos |
| `LAICRON_CONFIG_DIR` | `$XDG_CONFIG_HOME/laicron` (o `~/.config/laicron`) | Directorio del token y del fichero `env` |
| `LAICRON_UI_ROOT` | `packages/ui/dist` dentro del repo | Directorio de los ficheros estáticos de la interfaz |

El daemon que arranca systemd lee `~/.config/laicron/env`. Para cambiar, por ejemplo, el puerto:
añade `LAICRON_PORT=7400` a ese fichero, ejecuta `systemctl --user restart laicron` y exporta la misma
variable en tu terminal para que `open` y `status` consulten el puerto correcto. Ten en cuenta que
`scripts/install.sh` reescribe `~/.config/laicron/env` en cada instalación.

No uses `LAICRON_PORT=0`: el servidor elige un puerto aleatorio, pero `open` y `status` seguirían
consultando el puerto 0 y no encontrarían el daemon.

## Desarrollo

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

`pnpm test` compila todos los paquetes antes de ejecutar Vitest. Para formatear:

```sh
pnpm format        # prettier --write .
pnpm format:check  # prettier --check .
```

## Solución de problemas

### El daemon está caído

```sh
systemctl --user status laicron
journalctl --user -u laicron -n 50 --no-pager
```

Si la unidad no existe, vuelve a ejecutar `bash scripts/install.sh`. Si existe pero falla, el journal
muestra el error de arranque; systemd lo reintenta cada 3 segundos (`Restart=always`). Si acabas de
instalar, `scripts/install.sh` ya comprueba el arranque y muestra el journal si no queda activo.

### La ventana dice "El planificador no responde"

El aviso aparece cuando la interfaz no puede confirmar que el daemon esté vivo: el proceso está caído
o el último latido tiene más de 60 segundos. Comprueba:

```sh
systemctl --user status laicron
laicron status
journalctl --user -u laicron -n 50 --no-pager
```

Si el servicio no está activo, revisa el journal y vuelve a arrancarlo con `systemctl --user start
laicron`.

### La ventana no abre

- Comprueba primero el daemon (`systemctl --user status laicron`).
- Si `open` dice `No se pudo abrir la ventana (¿está instalado python3?)`, falta `python3` en el
  `PATH`.
- Si `python3` existe pero la ventana no aparece, faltan GTK3 o WebKit2 (4.1, con 4.0 como
  alternativa). `open` lanza el lanzador con la salida silenciada, así que el error no se ve;
  compruébalo a mano:

  ```sh
  python3 packages/platform/linux/src/window.py http://127.0.0.1:7317/
  ```

  Si faltan las bibliotecas, el lanzador imprime `Error: no se encontró GTK3 o WebKit2 4.1...` y los
  paquetes de ejemplo (`gir1.2-gtk-3.0`, `gir1.2-webkit2-4.1`). La ventana mostrará el aviso de token
  si las bibliotecas están bien: eso confirma que el problema era otro.

### `laicron: command not found`

El enlace existe, pero `~/.local/bin` no está en tu `PATH`. Añádelo a tu perfil de shell o ejecuta
`~/.local/bin/laicron` con la ruta completa. El instalador avisa cuando detecta este caso.

### `opencode` no encontrado

El error de la ejecución es `opencode no está instalado o no está en el PATH`. Comprueba con
`command -v opencode`. El servicio no usa el `PATH` de tu terminal, sino el de
`~/.config/laicron/env`; añade allí el directorio que contiene `opencode`, ejecuta
`systemctl --user restart laicron` o vuelve a instalar con `opencode` ya visible en tu `PATH`.

### Las notificaciones no llegan

Prueba el mismo binario que usa el daemon:

```sh
notify-send -a LAICron "Prueba" "Notificación de LAICron"
```

Si no aparece nada, no hay servidor de notificaciones o falta `notify-send`. La ejecución se guarda
igual, pero con `notification_delivered = 0`. El journal también avisa si el notificador no se pudo
cargar: `Aviso: no se pudo cargar el notificador de escritorio...`.

### El puerto está ocupado

El journal muestra `No se pudo arrancar LAICron: listen EADDRINUSE...` y systemd reintenta cada 3
segundos. Libera el puerto o cambia `LAICRON_PORT` (ver *Variables de entorno*). Recuerda exportar la
misma variable al usar `open` y `status`.

### El menú o el servicio apuntan a una ruta antigua

La unidad, la entrada `.desktop` y el enlace `~/.local/bin/laicron` guardan rutas absolutas al
repositorio. Si has movido la carpeta, vuelve a ejecutar `bash scripts/install.sh`.

### Aviso de SQLite experimental

Node 22 puede imprimir `ExperimentalWarning: SQLite is an experimental feature`. Es un aviso del
propio Node al cargar `node:sqlite`; no impide el funcionamiento.

## Desinstalación

```sh
bash scripts/uninstall.sh
```

El script pregunta si quieres borrar también la base de datos y el historial. Si respondes que no (o
pulsas Enter), detiene y deshabilita `laicron.service`, borra la unidad, la entrada de menú y el
enlace `~/.local/bin/laicron`, y **conserva** los datos en `~/.local/share/laicron`. Para borrarlos sin
preguntar:

```sh
LAICRON_PURGE_DATA=1 bash scripts/uninstall.sh
```

La desinstalación no borra `~/.config/laicron` (token y fichero `env`); puedes eliminarlo a mano si
quieres borrar también el token. Para volver a instalar, ejecuta `scripts/install.sh` otra vez.

## Licencia

MIT. Ver [LICENSE](LICENSE).
