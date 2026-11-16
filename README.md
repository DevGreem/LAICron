# LAICron

A local cron-style scheduler for Linux. It runs **AI prompts** (through `opencode`) or **shell
commands** at the time you set, from a desktop window, and keeps running with the window closed
because the clock lives in a systemd daemon.

## What it is and what problem it solves

`cron` knows *when* to run, but it launches blind commands: no interface, no history, no notice when
a job finishes, and if the machine was off it gives you no say in what happens to the missed runs.
The "AI crons" from cloud providers solve the AI part, but tie you to their cloud, their model and
their account. Desktop apps with scheduled tasks, on the other hand, usually require the app to be
open.

LAICron fills that gap locally: a systemd `--user` daemon keeps the clock and runs each cron with
your user, a GTK3/WebKit2 4.1 window lets you create and review the crons, and SQLite stores the
history. Each cron can be a prompt for `opencode` or an arbitrary shell command.

The result: you schedule a prompt or a command once and it runs even after you close the window;
when it finishes you can get a notification and later check what happened, when, and what the model
answered.

```
GTK3/WebKit2 4.1 window ──HTTP──> daemon (systemd --user) ──> opencode / sh -lc
                                      │
                                      ├──> SQLite (~/.local/share/laicron/laicron.db)
                                      └──> notify-send
```

## Features

- Crons with an **AI prompt** (`opencode run --standalone --format json`) or a **shell command**
  (`sh -lc`).
- Form with **model, variant and agent** lists read from `opencode`, a time zone picker with the
  current time, and a field-based cron builder with a preview.
- **Per-cron arguments**: positional in shell commands (`$1`, `$2`…) and extra ones before the
  prompt in `opencode`.
- Three repetition modes: a five-field cron expression, an interval (`15m`, `2h`) and a one-off date.
- **Configurable catch-up** when the machine was off: don't recover, recover once, or recover all
  missed runs (with a configurable cap).
- **Configurable overlap** when the previous run is still going: skip the new one, queue it, or kill
  the previous one.
- Desktop notifications through `notify-send`, optional per cron and filterable (always, failures
  only, or success only).
- Run history per cron, plus the conversation (prompt and answer) for AI crons.
- **Per-run usage**: cost in USD and input, output, reasoning and cache tokens, with totals per cron.
- Optional continuous session: each run continues the previous `opencode` conversation.
- Pause, resume and "run now" from the window.
- Run queue with a maximum of two concurrent AI crons.
- Runs with the window closed and starts automatically with the systemd user manager.

## Requirements

| Requirement | What for |
| --- | --- |
| Linux with systemd user instance | The daemon is installed as `laicron.service` in the user manager |
| Node.js 22 or newer | Daemon, build and CLI |
| pnpm | Installing dependencies and building |
| Python 3 with PyGObject (`gi`) | Window launcher |
| GTK3 and WebKit2GTK 4.1 (4.0 is accepted) | Desktop window |
| `notify-send` (libnotify) | Desktop notifications |
| `opencode` on `PATH` | AI crons and the form's model/agent lists (without it you type them by hand) |

`scripts/install.sh` checks Node, pnpm and `systemctl`; Python, GTK/WebKit, `notify-send` and
`opencode` are used at run time. If any of them is missing the installation does not fail, but the
window, the notifications or the AI crons will not work (see *Troubleshooting*).

On Debian/Ubuntu the window packages are `gir1.2-gtk-3.0` and `gir1.2-webkit2-4.1`, as the launcher
itself reports. On this system `WebKit2 4.1` is the GTK3 flavour of WebKitGTK; using GTK4 would
require WebKitGTK 6.0, which is not installed.

## Installation

From the repository root, with your user (no `sudo`: the unit is `--user` and everything is installed
into your `$HOME`):

```sh
bash scripts/install.sh
```

The script does the following, in this order:

1. Checks that `node`, `pnpm` and `systemctl` exist.
2. Installs dependencies with `pnpm install --frozen-lockfile`.
3. Builds everything with `pnpm build`.
4. Runs `node packages/platform/linux/dist/service-installer.js install`, which:
   - writes `~/.config/laicron/env` with your session's `PATH` (permissions `0600`);
   - writes the `~/.config/systemd/user/laicron.service` unit;
   - writes the menu entry `~/.local/share/applications/laicron.desktop`;
   - reloads systemd and runs `systemctl --user enable --now laicron`;
   - creates the `~/.local/bin/laicron` symlink → `packages/daemon/bin/laicron.js`;
   - warns if `~/.local/bin` is not on your `PATH`;
   - tries to enable *linger* with `loginctl enable-linger` so the daemon survives logout (if the
     system does not allow it, it warns and the service works while the session is open).
5. Checks with `systemctl --user is-active --quiet laicron`. If the service is not active, it shows
   the last journal lines and exits with code 1.

The unit points at this repository with absolute paths (`ExecStart` and `WorkingDirectory`). If you
move or rename the folder, run `scripts/install.sh` again.

### Checking that it is running

```sh
systemctl --user status laicron --no-pager
laicron status
curl -sS http://127.0.0.1:7317/api/health
```

You should see the service as `active (running)`, the message `LAICron está activo (versión 0.1.0).`
and a JSON body with `"status":"ok"`.

> If `laicron` is not on your `PATH`, use `~/.local/bin/laicron status` or add `~/.local/bin` to your
> profile. The installer warns when that folder is not on `PATH`.

> If the service does not become active, `install.sh` shows the last journal lines and exits with
> code 1; it does not print a fake success.

## Usage

### Language

The window, the API messages, the CLI and the desktop notifications are available in **Spanish
(default)** and **English**.

- **Window**: pick the language in the selector at the top right. The choice is remembered in the
  browser's `localStorage`; you can also force it with `?lang=en` in the URL.
- **CLI and daemon messages**: set `LAICRON_LANG=en` (or `es`). When it is unset, the usual
  `LC_ALL`, `LC_MESSAGES` and `LANG` variables are read, and Spanish is the fallback.
- **API**: the interface sends the `Accept-Language` header; validation errors and the rest of the
  messages come back in the language of the request.

### Opening the window

- From the applications menu: **LAICron**.
- From a terminal:

  ```sh
  laicron open
  ```

  If the command does not exist, use `~/.local/bin/laicron open` or add `~/.local/bin` to your
  `PATH`.

The window only opens if the daemon answers on the configured port; otherwise `open` exits with
`El daemon de LAICron no está activo. Arráncalo con: laicron start`.

The interface is a local web app served by the daemon itself at `http://127.0.0.1:7317/` by default.
The window loads it with the token in the URL fragment; if you open that address in a browser without
the token you will see `Falta el token de acceso. Abre LAICron desde el menú.`

### Creating a cron

1. Click **Create cron**.
2. Set a **name** (required, maximum 100 characters).
3. Choose the **runner**:
   - `opencode (AI)`: the **prompt** is required. **Model**, **variant** and **agent** are optional
     and are picked from the lists LAICron reads from `opencode`.
   - `shell (command)`: the **command** is required and runs with `sh -lc`; the **working
     directory** is also required (if you don't set it when creating through the API, your `$HOME`
     is used).
4. **Arguments** (optional, under *Run*): one per line. With `shell` they are passed as positional
   parameters (`$1`, `$2`…; `$0` is `laicron`). With `opencode` they are inserted before the prompt.
5. Choose the **repetition** and the **time zone** (a field with suggestions that includes `UTC`,
   the machine zone and the IANA zones; the current time and the offset are shown below it).
6. Adjust the run: catch-up policy, limit, overlap, maximum time (1–86400 seconds; 600 by default)
   and session mode.
7. Configure the **notification** if you want one.
8. **Save**. The cron appears in the list with its next run already calculated.

In each cron's detail view you can **Pause**/**Resume**, **Edit**, **Run now** and check the run
history and the conversation.

#### Model, variant and agent

With the `opencode (AI)` runner, the form asks the daemon for the catalog
(`GET /api/opencode/options`) and shows three selectors:

- **Model**: grouped by provider, with the readable name and the id. The empty option
  ("system default") lets `opencode` use its default model.
- **Variant**: the variants of the chosen model (for example, reasoning levels). It is only enabled
  if that model has any; "default" adds no suffix.
- **Agent**: **primary** agents only. Subagents and hidden agents are not listed because they cannot
  be run as the cron's main agent.

If you pick a variant, the cron stores the model as `provider/model#variant`, the same format
`opencode run --model` accepts; without a variant it stores `provider/model`.

The model and agent selectors include **Custom…** so you can type a value that is not in the list. If
`opencode` is not installed or the catalog fails, the form shows a warning and leaves text fields
instead of the lists: you can still create the cron by typing the model and the agent by hand, or
leave them empty. **Reload options** reads it again without restarting the daemon.

#### MCPs

With the `opencode (AI)` runner the form shows the **MCPs** section, with one row per server and four
columns: **MCP**, **Default**, **State** and **Effective**.

| Column | What it shows |
| --- | --- |
| **MCP** | Name of the MCP server |
| **Default** | Whether `opencode` has it on or off in the catalog |
| **State** | What this cron pins: **Inherited**, **On** or **Off** |
| **Effective** | The catalog value when inherited; if it is pinned, a 📌 |

- **Inherited** (default): the cron uses whatever `opencode` has at that moment. If you change your
  configuration, the cron changes with it.
- **On** / **Off**: pins the value for this cron and **does not change** even if you modify the
  `opencode` configuration. The 📌 in the **Effective** column marks the pinned MCPs.
- You can also turn on an MCP that is off by default: it is enabled only for that cron.

The catalog is requested with the cron's **working directory** (`opencode mcp list`), so it includes
the MCPs defined in the project (`.opencode/opencode.jsonc`). If you leave the directory empty, the
daemon's directory is used for listing and the cron runs in your `$HOME`. When you change it, the
list reloads by itself; **Reload options** reads it again without restarting the daemon. If the read
fails, the form shows a warning and keeps the states already saved.

On save, the cron only stores the **pinned** MCPs; inherited ones are not saved. On every run,
LAICron passes those values to `opencode` through the `OPENCODE_CONFIG_CONTENT`
(`{"mcp":{"servers":{"<name>":{"disabled":true|false}}}}`), without touching
`~/.config/opencode/opencode.jsonc` or the project configuration. MCPs that no longer exist are
ignored and the `shell` runner does not use this section.

To check the mechanism by hand:

```sh
OPENCODE_CONFIG_CONTENT='{"mcp":{"servers":{"xerj":{"disabled":true}}}}' \
  opencode run --standalone --format json "Say only: ok"
```

And to see the effective configuration `opencode` would apply:

```sh
OPENCODE_CONFIG_CONTENT='{"mcp":{"servers":{"xerj":{"disabled":true}}}}' \
  opencode debug config
```

If `opencode mcp list` fails at run time, the cron keeps the inherited configuration, is not marked as
failed and the journal leaves the warning
`[laicron] no se pudo leer la lista de MCPs; se usa la configuración heredada`.

#### Time zone and cron builder

The **time zone** is picked in a field with suggestions that includes `UTC`, the machine zone and all
IANA zones. Typing filters the list; below it you see the current time in that zone and its offset
from UTC (`Ahora son las 09:00 (GMT+2)`). The IANA name is stored (`Europe/Madrid`, `UTC`…).

With the **Cron** repetition, the expression is built from five fields: **Minute**, **Hour**, **Day
of the month**, **Month** and **Day of the week**. The **Template** fills all five at once (for
example, "Monday to Friday at 09:00") and the preview describes them in Spanish. Minute `0`, hour
`9`, day of the month `*`, month `*` and day of the week `1-5` produce `0 9 * * 1-5` ("Monday to
Friday at 09:00").

For expressions the fields do not cover, turn on **Advanced mode** and edit the whole expression.
When you turn it off, the form splits it back into the five fields; if it does not have exactly five,
it stays in advanced mode and shows the error.

### Repetition types

| Type | Expression | Example | Notes |
| --- | --- | --- | --- |
| `cron` | Five fields: minute, hour, day of the month, month and day of the week | `0 9 * * 1-5` | Interpreted in the cron's time zone and stored in UTC. Daylight saving changes neither duplicate nor skip runs |
| `interval` | `<n>m` or `<n>h` | `15m`, `2h` | The next run is calculated from the moment the previous one ran |
| `once` | ISO-8601 date with offset or `Z` | `2026-11-01T09:00:00+01:00` | The interface uses a local date and time picker and stores the instant in ISO format. A date in the past is rejected. After it runs, the cron has no next run |

### Catch-up (machine off or daemon stopped)

On startup, the daemon checks the active crons whose next run has already passed and applies each
one's policy. It also applies it on the first cycle after a suspend if two or more occurrences were
missed; if only one was missed, it runs it as scheduled:

| Policy | What it does |
| --- | --- |
| `none` | Runs nothing; records a `Skipped` run with the number of missed firings and moves on |
| `once` | Runs once, with the `Recovered` trigger, even if several firings were missed |
| `all` | Runs once per missed firing, up to the **recovery limit** (1–100; 10 by default). The rest are recorded as skipped |

Runs that were still `In progress` when the daemon stopped are marked as `Interrupted`.

### Overlap

If a firing arrives while the previous run of the same cron is still active:

| Policy | What it does |
| --- | --- |
| `skip` (default) | Does not start another one; records the firing as `Skipped` |
| `queue` | Waits for the previous run to finish and then runs the new one |
| `kill` | Terminates the previous run and starts the new one |

### Notification

With **Notify on finish** enabled, the daemon calls `notify-send -a "LAICron"` with the cron name,
the status, the duration and a summary of the answer or the error. You can choose to notify
**always**, **only on failure** or **only on success**. If there is no notification server the run
does not fail: it is recorded and the notice is marked as not delivered.

### History and conversation

The cron detail view shows the runs (status, trigger, start, duration, tokens, cost, exit code and
error) and, for AI crons, the user and assistant messages. History is kept for 90 days and a maximum
of 200 runs per cron; the oldest ones are deleted.

### Cron context

Every `opencode (AI)` run receives a fixed instruction telling it that this is a scheduled task, that
there will be no user reply, and that it must run and finish without greeting, asking for
confirmation or offering help. It cannot be edited from the window:

| What | Detail |
| --- | --- |
| File | `~/.local/share/laicron/prompts/cron-system.md` (or `$XDG_DATA_HOME/laicron/prompts/cron-system.md` if you set that variable) |
| Content | Fixed text from the code; rewritten on every run if it does not match |
| How it gets there | `OPENCODE_CONFIG_CONTENT` with `{"instructions":["<file path>"]}` |
| In the chat | It does not appear: history only stores your prompt and the answer |

If you edit the file by hand, the next run overwrites it. If LAICron cannot write it, the cron runs
anyway, without the instruction, and the journal shows
`[laicron] no se pudo preparar la instrucción de cron; se ejecuta sin ella`.

The runner adds `--standalone` to `opencode run` on **every** run. `OPENCODE_CONFIG_CONTENT` is only
applied with that flag: without it, `opencode` uses the shared service and the cron's inline
configuration (the instruction and the MCP overlay) is ignored. The price is that every run starts a
private `opencode` server: it takes a few seconds longer and uses a bit more RAM, with a maximum of 2
concurrent AI runs. In exchange, crons stay isolated from the `opencode` you use yourself. The
instruction and the MCP overlay are applied: pinned MCPs are sent with `disabled` set to `true` or
`false` (see *MCPs*).

### Usage

Every AI run stores the cost in USD and the input, output, reasoning and cache tokens. They are read
**after** the run with `opencode session export <session> --sanitize --standalone`; without
`--standalone` the export queries the shared service and answers `Session not found`. If the export
fails or hits the 10-second timeout per attempt (there is one retry), the run is still stored, without
data and without being marked as failed.

In the cron detail view:

- the **Usage** card shows the total cost, the total tokens, the input and output breakdown and how
  many runs have data (`3 de 5 ejecuciones con datos`);
- the **Run history** table has the **Tokens** and **Cost** columns per run.

Runs from before this version, `shell` runs and runs whose export could not be read show `—`, which
means "no data", not "zero". A free model does show `$0.00` with its tokens. The cost is formatted
with two decimals when zero, four for normal amounts and six below one cent.

In **Continuous** mode, each run only counts the assistant messages created since it started, but the
**input** tokens include the whole session history: the model re-reads the previous conversation on
every run and you pay for it. The card reminds you with a note.

Limitations:

- the export grows with the session, so very long continuous sessions take longer to read;
- if you continue that same session outside LAICron while the run is in progress, messages created
  after the start are also added to the run's usage.

Through the API:

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

`runs` counts all of the cron's runs and `runsWithUsage` only those with some data; the totals add up
only the runs with data.

## Data and security

| What | Where | Details |
| --- | --- | --- |
| Database | `~/.local/share/laicron/laicron.db` | SQLite in WAL mode; `laicron.db-wal` and `laicron.db-shm` also appear |
| API token | `~/.config/laicron/token` | 32 random bytes in hexadecimal, permissions `0600`; the directory is created `0700` |
| Service `PATH` | `~/.config/laicron/env` | Written by the installer with permissions `0600` |
| systemd unit | `~/.config/systemd/user/laicron.service` | `Restart=always`, `RestartSec=3` |
| Menu entry | `~/.local/share/applications/laicron.desktop` | Runs `packages/daemon/bin/laicron.js open` |
| CLI | `~/.local/bin/laicron` | Symlink to `packages/daemon/bin/laicron.js` |

- The API listens only on `127.0.0.1:7317` by default and requires `Authorization: Bearer <token>` on
  every `/api/*` route, except `GET /api/health`, which is public. The interface's static files are
  served without a token, but they contain no data.
- Crons run **with your user and your permissions**, without a sandbox or extra privileges. A shell
  cron can do anything you can do in a terminal; an AI cron runs `opencode` with your configuration
  and your `opencode` permissions.
- AI crons are launched with `opencode run --standalone --format json` without auto-approval flags;
  `opencode` applies its own permission configuration. `--standalone` starts a private server per run
  and avoids depending on the shared service, which would ignore the cron's inline configuration.
- The daemon passes its environment and the `PATH` captured at install time to the crons. There are no
  per-cron environment variables: they all inherit the service environment. LAICron adds
  `OPENCODE_CONFIG_CONTENT` to every AI run with the cron instruction and the MCP overlay. If
  `opencode` was not on `PATH` at install time, AI crons will fail with
  `opencode no está instalado o no está en el PATH`.
- Do not expose `LAICRON_HOST` as `0.0.0.0` on a network you do not control: the API would still ask
  for a token, but it would no longer be local.

## CLI commands

The installation creates the `~/.local/bin/laicron` symlink, which points to
`packages/daemon/bin/laicron.js` inside the repo. If `~/.local/bin` is not on your `PATH`, the
installer warns you: add it to your profile or use `~/.local/bin/laicron` (or the full path to the
script).

| Command | What it does |
| --- | --- |
| `laicron start` | Starts the daemon in the foreground. This is the default command. Do not use it if the systemd service is already active: the port will be busy |
| `laicron open` | Opens the window (requires the daemon to be active) |
| `laicron status` | Checks the daemon and shows the version and the last heartbeat |
| `laicron token` | Shows the **path** of the token file, never its contents |
| `laicron --help` | Shows the help |
| `laicron --version` | Shows the installed version |

## Environment variables

| Variable | Default | What for |
| --- | --- | --- |
| `LAICRON_PORT` | `7317` | API and interface port |
| `LAICRON_HOST` | `127.0.0.1` | API listening interface |
| `LAICRON_DB_PATH` | `$XDG_DATA_HOME/laicron/laicron.db` (or `~/.local/share/laicron/laicron.db`) | Database path |
| `LAICRON_CONFIG_DIR` | `$XDG_CONFIG_HOME/laicron` (or `~/.config/laicron`) | Directory for the token and the `env` file |
| `LAICRON_UI_ROOT` | `packages/ui/dist` inside the repo | Directory of the interface's static files |
| `LAICRON_LANG` | From `LC_ALL`/`LC_MESSAGES`/`LANG`, else `es` | Language of the CLI, the daemon messages and the notifications (`es` or `en`) |

The daemon started by systemd reads `~/.config/laicron/env`. To change, say, the port: add
`LAICRON_PORT=7400` to that file, run `systemctl --user restart laicron` and export the same variable
in your terminal so that `open` and `status` query the right port. Keep in mind that
`scripts/install.sh` rewrites `~/.config/laicron/env` on every installation.

Do not use `LAICRON_PORT=0`: the server picks a random port, but `open` and `status` would still query
port 0 and would not find the daemon.

## Development

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

`pnpm test` builds every package before running Vitest. To format:

```sh
pnpm format        # prettier --write .
pnpm format:check  # prettier --check .
```

## Troubleshooting

### The daemon is down

```sh
systemctl --user status laicron
journalctl --user -u laicron -n 50 --no-pager
```

If the unit does not exist, run `bash scripts/install.sh` again. If it exists but fails, the journal
shows the startup error; systemd retries every 3 seconds (`Restart=always`). If you have just
installed, `scripts/install.sh` already checks the startup and shows the journal if it does not become
active.

### The window says "The scheduler is not responding"

The warning appears when the interface cannot confirm that the daemon is alive: the process is down
or the last heartbeat is older than 60 seconds. Check:

```sh
systemctl --user status laicron
laicron status
journalctl --user -u laicron -n 50 --no-pager
```

If the service is not active, check the journal and start it again with `systemctl --user start
laicron`.

### The window does not open

- Check the daemon first (`systemctl --user status laicron`).
- If `open` says `Could not open the window (is python3 installed?)` (or the Spanish variant), `python3`
  is missing from `PATH`.
- If `python3` exists but the window does not appear, GTK3 or WebKit2 (4.1, with 4.0 as an
  alternative) is missing. `open` launches the launcher with its output silenced, so the error is not
  visible; check it by hand:

  ```sh
  python3 packages/platform/linux/src/window.py http://127.0.0.1:7317/
  ```

  If the libraries are missing, the launcher prints `Error: no se encontró GTK3 o WebKit2 4.1...` and
  the example packages (`gir1.2-gtk-3.0`, `gir1.2-webkit2-4.1`). The window will show the token
  notice if the libraries are fine: that confirms the problem was something else.

### `laicron: command not found`

The symlink exists, but `~/.local/bin` is not on your `PATH`. Add it to your shell profile or run
`~/.local/bin/laicron` with the full path. The installer warns when it detects this case.

### `opencode` not found

The run error is `opencode no está instalado o no está en el PATH`. Check with `command -v opencode`.
The service does not use your terminal's `PATH`, but the one in `~/.config/laicron/env`; add the
directory containing `opencode` there, run `systemctl --user restart laicron` or reinstall with
`opencode` already visible on your `PATH`.

### The form shows no models or agents

When creating an AI cron, a warning appears instead of the model and agent lists. It means LAICron
could not read the `opencode` catalog; the warning gives the reason:

- `opencode no está instalado o no está en el PATH`: install it or add its directory to the service
  `PATH` (see *`opencode` not found*).
- `opencode models agotó el tiempo de espera` or `opencode models falló (código N)`: the command took
  more than five seconds or exited with an error. Check that `opencode models` works in your terminal.

While the catalog is unavailable you can still create the cron: type the model and the agent in the
text fields. **Reload options** retries the read without restarting the daemon. If only the agent read
fails, the models still appear and the agent list is empty; use **Custom…** to type the agent by
hand.

### The MCPs section is empty or shows a warning

The warning appears when LAICron could not read `opencode mcp list` in the cron's working directory or
when the command returns no server. Check that it works in that directory:

```sh
cd /path/to/cron && opencode mcp list
```

The form keeps the states already saved and **Reload options** retries the read. If the listing fails
when the cron runs, the run continues with `opencode`'s inherited configuration, is not marked as
failed and the journal shows `[laicron] no se pudo leer la lista de MCPs; se usa la configuración
heredada`.

### Usage shows `—`

It means that run has no usage data, not that it spent zero. It happens in:

- runs stored before usage tracking existed;
- `shell` crons, which do not go through `opencode`;
- runs whose `opencode session export <session> --sanitize --standalone` failed or hit the 10-second
  timeout.

Check the export by hand with a recent session (the identifier is in `session_id`, in the
`GET /api/jobs/<ID>/runs` response):

```sh
opencode session export "<session>" --sanitize --standalone | head -c 400
```

If it always fails, check the `opencode` version and that the session still exists.

### Notifications do not arrive

Try the same binary the daemon uses:

```sh
notify-send -a LAICron "Test" "LAICron notification"
```

If nothing appears, there is no notification server or `notify-send` is missing. The run is stored
anyway, but with `notification_delivered = 0`. The journal also warns if the notifier could not be
loaded: `Aviso: no se pudo cargar el notificador de escritorio...`.

### The port is busy

The journal shows `No se pudo arrancar LAICron: listen EADDRINUSE...` and systemd retries every 3
seconds. Free the port or change `LAICRON_PORT` (see *Environment variables*). Remember to export the
same variable when using `open` and `status`.

### The menu or the service point to an old path

The unit, the `.desktop` entry and the `~/.local/bin/laicron` symlink store absolute paths to the
repository. If you moved the folder, run `bash scripts/install.sh` again.

### SQLite experimental warning

Node 22 may print `ExperimentalWarning: SQLite is an experimental feature`. It is Node's own warning
when loading `node:sqlite`; it does not affect operation.

## Uninstallation

```sh
bash scripts/uninstall.sh
```

The script asks whether you want to delete the database and the history too. If you answer no (or
press Enter), it stops and disables `laicron.service`, deletes the unit, the menu entry and the
`~/.local/bin/laicron` symlink, and **keeps** the data in `~/.local/share/laicron`. To delete it
without asking:

```sh
LAICRON_PURGE_DATA=1 bash scripts/uninstall.sh
```

Uninstallation does not delete `~/.config/laicron` (token and `env` file); you can remove it by hand
if you also want to delete the token. To install again, run `scripts/install.sh` once more.

## License

MIT. See [LICENSE](LICENSE).
