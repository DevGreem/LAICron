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

- Crons con **prompt de IA** (`opencode run --standalone --format json`) o **comando de shell**
  (`sh -lc`).
- Formulario con listas de **modelos, variantes y agentes** leídas de `opencode`, selector de zona
  horaria con la hora actual y constructor de cron por campos con vista previa.
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
- **Consumo por ejecución**: coste en USD y tokens de entrada, salida, razonamiento y caché, con
  totales por cron.
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
| `opencode` en el `PATH` | Crons de IA y listas de modelo/agente del formulario (sin él se escriben a mano) |

`scripts/install.sh` comprueba Node, pnpm y `systemctl`; Python, GTK/WebKit, `notify-send` y
`opencode` se usan en tiempo de ejecución. Si falta alguno, la instalación no falla, pero la ventana,
las notificaciones o los crons de IA no funcionarán (ver *Solución de problemas*).

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
   - `opencode (IA)`: el **prompt** es obligatorio. **Modelo**, **variante** y **agente** son
     opcionales y se eligen de las listas que LAICron lee de `opencode`.
   - `shell (comando)`: el **comando** es obligatorio y se ejecuta con `sh -lc`; el **directorio de
     trabajo** también es obligatorio (si no lo indicas al crear por API, se usa tu `$HOME`).
4. **Argumentos** (opcional, en *Ejecución*): uno por línea. En `shell` se pasan como parámetros
   posicionales (`$1`, `$2`…; `$0` es `laicron`). En `opencode` se insertan antes del prompt.
5. Elige la **repetición** y la **zona horaria** (campo con sugerencias que incluye `UTC`, la zona
   del equipo y las zonas IANA; debajo se muestra la hora actual y el desfase).
6. Ajusta la ejecución: política de catch-up, límite, solapamiento, tiempo máximo (1–86400 segundos;
   600 por defecto) y modo de sesión.
7. Configura la **notificación** si la quieres.
8. **Guardar**. El cron aparece en la lista con su próxima ejecución calculada.

En el detalle de cada cron puedes **Pausar**/**Reanudar**, **Editar**, **Ejecutar ahora** y consultar
el historial de ejecuciones y la conversación.

#### Modelo, variante y agente

Con el ejecutor `opencode (IA)`, el formulario pide el catálogo al daemon
(`GET /api/opencode/options`) y muestra tres selectores:

- **Modelo**: agrupado por proveedor, con el nombre legible y el id. La opción vacía
  («Predeterminado del sistema») deja que `opencode` use su modelo por defecto.
- **Variante**: las variantes del modelo elegido (por ejemplo, niveles de razonamiento). Solo se
  habilita si ese modelo tiene alguna; «Predeterminada» no añade sufijo.
- **Agente**: solo los agentes **primarios**. Los subagentes y los ocultos no aparecen porque no se
  pueden ejecutar como agente principal del cron.

Si eliges una variante, el cron guarda el modelo como `proveedor/modelo#variante`, el mismo formato
que acepta `opencode run --model`; sin variante se guarda `proveedor/modelo`.

Los selectores de modelo y agente incluyen **Personalizado…** para escribir un valor que no esté en
la lista. Si `opencode` no está instalado o el catálogo falla, el formulario muestra un aviso y deja
los campos de texto en lugar de las listas: puedes seguir creando el cron escribiendo el modelo y el
agente a mano, o dejarlos vacíos. **Recargar opciones** vuelve a leerlo sin reiniciar el daemon.

#### MCPs

Con el ejecutor `opencode (IA)` el formulario muestra la sección **MCPs**, con una fila por servidor y
cuatro columnas: **MCP**, **Por defecto**, **Estado** y **Efectivo**.

| Columna | Qué muestra |
| --- | --- |
| **MCP** | Nombre del servidor MCP |
| **Por defecto** | Si `opencode` lo tiene encendido o apagado en el catálogo |
| **Estado** | Lo que marca este cron: **Heredado**, **Encendido** o **Apagado** |
| **Efectivo** | El valor del catálogo cuando está heredado; si está fijado, un 📌 |

- **Heredado** (por defecto): el cron usa lo que tenga `opencode` en ese momento. Si cambias tu
  configuración, el cron cambia con ella.
- **Encendido** / **Apagado**: marca el valor para este cron y **no cambia** aunque modifiques la
  configuración de `opencode`. El 📌 de la columna **Efectivo** identifica los MCPs fijados.
- También puedes marcar como encendido un MCP que por defecto esté apagado; la aplicación real de esa
  marca está pendiente (ver la limitación más abajo).

El catálogo se pide con el **directorio de trabajo** del cron (`opencode mcp list`), así que incluye
los MCPs definidos en el proyecto (`.opencode/opencode.jsonc`). Si dejas el directorio vacío, se usa el
del daemon para listar y el cron se ejecuta en tu `$HOME`. Al cambiarlo, la lista se recarga sola;
**Recargar opciones** la vuelve a leer sin reiniciar el daemon. Si la lectura falla, el formulario
muestra un aviso y conserva los estados ya guardados.

Al guardar, el cron solo almacena los MCPs **fijados**; los heredados no se guardan. En cada
ejecución, LAICron pasa esos valores a `opencode` con la variable `OPENCODE_CONFIG_CONTENT`
(`{"mcp":{"servers":{"<nombre>":{"disabled":true|false}}}}`), sin tocar
`~/.config/opencode/opencode.jsonc` ni la configuración del proyecto. Los MCPs que ya no existan se
ignoran y el ejecutor `shell` no usa esta sección.

**Limitación actual (opencode 2.2.5)**: el overlay se envía con `--standalone`, pero `opencode`
rechaza las entradas parciales (`{"disabled": true}`) y el servidor sigue conectado. Fijar
**Encendido** o **Apagado** todavía no cambia la ejecución real; la aplicación efectiva queda
pendiente del cambio `fix-mcp-selection-application`.

Para comprobar el mecanismo a mano hace falta `--standalone`: sin ese flag `opencode` usa el
servicio compartido e ignora `OPENCODE_CONFIG_CONTENT` (ver *Contexto de cron*). La comprobación
confirma que la configuración llega; con `opencode 2.2.5` el servidor sigue conectado (ver la
limitación de arriba).

```sh
OPENCODE_CONFIG_CONTENT='{"mcp":{"servers":{"xerj":{"disabled":true}}}}' \
  opencode run --standalone --format json "Di solo: ok"
```

Y para ver la configuración efectiva que aplicaría `opencode`:

```sh
OPENCODE_CONFIG_CONTENT='{"mcp":{"servers":{"xerj":{"disabled":true}}}}' \
  opencode debug config
```

Si `opencode mcp list` falla en el momento de ejecutar, el cron sigue con la configuración heredada,
no se marca como fallido y el journal deja el aviso
`[laicron] no se pudo leer la lista de MCPs; se usa la configuración heredada`.

#### Zona horaria y constructor de cron

La **zona horaria** se elige en un campo con sugerencias que incluye `UTC`, la zona del equipo y
todas las zonas IANA. Al escribir se filtra la lista; debajo aparece la hora actual de la zona y su
desfase respecto a UTC (`Ahora son las 09:00 (GMT+2)`). Se guarda el nombre IANA (`Europe/Madrid`,
`UTC`…).

Con la repetición **Cron**, la expresión se construye con cinco campos: **Minuto**, **Hora**, **Día
del mes**, **Mes** y **Día de la semana**. La **Plantilla** rellena los cinco de golpe (por ejemplo,
«De lunes a viernes a las 09:00») y la vista previa los describe en español. Minuto `0`, hora `9`,
día del mes `*`, mes `*` y día de la semana `1-5` producen `0 9 * * 1-5` («de lunes a viernes a las
09:00»).

Para expresiones que los campos no cubren, activa **Modo avanzado** y edítala entera. Al desactivarlo,
el formulario la reparte otra vez entre los cinco campos; si no tiene exactamente cinco, se queda en
avanzado y muestra el error.

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

El detalle del cron muestra las ejecuciones (estado, disparador, inicio, duración, tokens, coste,
código de salida y error) y, en los crons de IA, los mensajes de usuario y asistente. El historial se
conserva 90 días y un máximo de 200 ejecuciones por cron; las más antiguas se van borrando.

### Contexto de cron

Cada ejecución de `opencode (IA)` recibe una instrucción fija que le dice que es una tarea
programada, que no habrá respuesta del usuario y que debe ejecutar y terminar sin saludar, pedir
confirmación ni ofrecer ayuda. No se puede editar desde la ventana:

| Qué | Detalle |
| --- | --- |
| Fichero | `~/.local/share/laicron/prompts/cron-system.md` (o `$XDG_DATA_HOME/laicron/prompts/cron-system.md` si defines esa variable) |
| Contenido | Texto fijo del código; se reescribe en cada ejecución si no coincide |
| Cómo llega | `OPENCODE_CONFIG_CONTENT` con `{"instructions":["<ruta del fichero>"]}` |
| En el chat | No aparece: el historial solo guarda tu prompt y la respuesta |

Si editas el fichero a mano, la siguiente ejecución lo sobrescribe. Si LAICron no puede escribirlo, el
cron se ejecuta igual, sin instrucción, y el journal muestra
`[laicron] no se pudo preparar la instrucción de cron; se ejecuta sin ella`.

El runner añade `--standalone` a `opencode run` en **todas** las ejecuciones. `OPENCODE_CONFIG_CONTENT`
solo se aplica con ese flag: sin él, `opencode` usa el servicio compartido y se ignora la
configuración inline del cron (la instrucción y el overlay de MCPs). El precio es que cada ejecución
arranca un servidor privado de `opencode`: tarda unos segundos más y ocupa algo más de RAM, con un
máximo de 2 ejecuciones concurrentes de IA. A cambio, los crons quedan aislados del `opencode` que
uses tú. La instrucción sí se aplica; el overlay de MCPs se envía, pero `opencode 2.2.5` rechaza las
entradas parciales y los servidores siguen conectados (ver *MCPs*).

### Consumo

Cada ejecución de IA guarda el coste en USD y los tokens de entrada, salida, razonamiento y caché. Se
leen **después** del run con `opencode session export <sesión> --sanitize --standalone`; sin
`--standalone` el export consulta el servicio compartido y responde `Session not found`. Si el export
falla o agota los 10 segundos por intento (hay un reintento), la ejecución se guarda igual, sin datos
y sin marcarse como fallida.

En el detalle del cron:

- la tarjeta **Consumo** muestra el coste total, los tokens totales, el desglose de entrada y salida y
  cuántas ejecuciones tienen datos (`3 de 5 ejecuciones con datos`);
- la tabla **Historial de ejecuciones** tiene las columnas **Tokens** y **Coste** por ejecución.

Los runs anteriores a esta versión, los de `shell` y los que no pudieron leer el export muestran
`—`, que significa «sin datos» y no «cero». Un modelo gratuito sí muestra `$0.00` con sus tokens. El
coste se formatea con dos decimales si es cero, cuatro para importes normales y seis por debajo de un
céntimo.

En modo **Continua**, cada ejecución cuenta solo los mensajes del asistente creados desde su inicio,
pero los tokens de **entrada** incluyen todo el historial de la sesión: el modelo vuelve a leer la
conversación anterior en cada run y eso se paga. La tarjeta lo recuerda con una nota.

Limitaciones:

- el export crece con la sesión, así que en sesiones continuas muy largas tarda más en leerse;
- si continúas esa misma sesión por fuera de LAICron mientras el run está en marcha, los mensajes que
  se creen después del inicio también se suman al consumo del run.

Por API:

```sh
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/jobs/<ID>/usage"
```

```json
{
  "usage": {
    "runs": 5,
    "runsWithUsage": 3,
    "inputTokens": 16200,
    "outputTokens": 2340,
    "reasoningTokens": 0,
    "cacheReadTokens": 0,
    "cacheWriteTokens": 0,
    "costUsd": 0.0421
  }
}
```

`runs` cuenta todas las ejecuciones del cron y `runsWithUsage` solo las que tienen algún dato; los
totales suman únicamente las ejecuciones con datos.

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
- Los crons de IA se lanzan con `opencode run --standalone --format json` sin flags de
  auto-aprobación; `opencode` aplica su propia configuración de permisos. `--standalone` arranca un
  servidor privado por ejecución y evita depender del servicio compartido, que ignoraría la
  configuración inline del cron.
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

### El formulario no muestra modelos ni agentes

Al crear un cron de IA, en lugar de las listas de modelo y agente aparece un aviso. Significa que
LAICron no pudo leer el catálogo de `opencode`; el aviso indica el motivo:

- `opencode no está instalado o no está en el PATH`: instálalo o añade su directorio al `PATH` del
  servicio (ver *`opencode` no encontrado*).
- `opencode models agotó el tiempo de espera` o `opencode models falló (código N)`: el comando tardó
  más de cinco segundos o terminó con error. Comprueba que `opencode models` funciona en tu terminal.

Mientras el catálogo no esté disponible puedes crear el cron igualmente: escribe el modelo y el
agente en los campos de texto. **Recargar opciones** reintenta la lectura sin reiniciar el daemon.
Si solo falla la lectura de agentes, los modelos siguen apareciendo y la lista de agentes queda vacía;
usa **Personalizado…** para escribir el agente a mano.

### La sección MCPs aparece vacía o con un aviso

El aviso aparece cuando LAICron no pudo leer `opencode mcp list` en el directorio de trabajo del cron
o cuando el comando no devuelve ningún servidor. Comprueba que funciona en ese directorio:

```sh
cd /ruta/del/cron && opencode mcp list
```

El formulario conserva los estados ya guardados y **Recargar opciones** reintenta la lectura. Si el
listado falla al ejecutar el cron, la ejecución continúa con la configuración heredada de `opencode`,
no se marca como fallida y el journal muestra `[laicron] no se pudo leer la lista de MCPs; se usa la
configuración heredada`.

### El consumo muestra `—`

Significa que esa ejecución no tiene datos de consumo, no que gastara cero. Ocurre en:

- ejecuciones guardadas antes de que existiera el registro de consumo;
- crons de `shell`, que no pasan por `opencode`;
- ejecuciones cuyo `opencode session export <sesión> --sanitize --standalone` falló o agotó los 10
  segundos.

Comprueba el export a mano con una sesión reciente (el identificador está en `session_id`, en la
respuesta de `GET /api/jobs/<ID>/runs`):

```sh
opencode session export "<sesión>" --sanitize --standalone | head -c 400
```

Si falla siempre, revisa la versión de `opencode` y que la sesión siga existiendo.

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
