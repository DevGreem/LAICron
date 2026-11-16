/**
 * Server-side translation layer. Every message lives in one table with the
 * Spanish and English variants side by side, so both languages stay in sync.
 *
 * Spanish is the default locale. The HTTP layer runs each request inside
 * {@link runWithLocale} so validation errors and API messages follow the
 * `Accept-Language` header, while background work (clock, runners, CLI) uses
 * the base locale resolved from the environment.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type Locale = "es" | "en";

const MESSAGES = {
  "db.notFound": ["Recurso no encontrado.", "Resource not found."],
  "db.jobNotFound": ["No se encontró el cron {id}.", "Cron {id} not found."],
  "db.runNotFound": ["No se encontró la ejecución {id}.", "Run {id} not found."],
  "db.jobCreateFailed": [
    "No se pudo leer el cron recién creado.",
    "Could not read the newly created cron.",
  ],
  "db.messageCreateFailed": [
    "No se pudo leer el mensaje recién creado.",
    "Could not read the newly created message.",
  ],

  "validation.mcpObject": [
    "Los MCPs deben ser un objeto de nombre a on u off.",
    "MCP overrides must be an object mapping names to on or off.",
  ],
  "validation.mcpState": [
    "El estado del MCP {name} debe ser on u off.",
    "The state of MCP {name} must be on or off.",
  ],
  "validation.mcpLimit": [
    "No se pueden fijar más de {limit} MCPs.",
    "No more than {limit} MCPs can be pinned.",
  ],
  "validation.scheduleExprRequired": [
    "La expresión de programación es obligatoria.",
    "The schedule expression is required.",
  ],
  "validation.cronFiveFields": [
    "La expresión cron debe tener exactamente cinco campos.",
    "The cron expression must have exactly five fields.",
  ],
  "validation.intervalShape": [
    "El intervalo debe tener la forma 15m o 2h.",
    "The interval must look like 15m or 2h.",
  ],
  "validation.onceIso": [
    "La fecha única debe ser una fecha ISO válida.",
    "The one-off date must be a valid ISO date.",
  ],
  "validation.scheduleKind": [
    "El tipo de programación debe ser cron, interval o once.",
    "The schedule kind must be cron, interval or once.",
  ],
  "validation.nameRequired": ["El nombre es obligatorio.", "The name is required."],
  "validation.nameTooLong": [
    "El nombre no puede superar los 100 caracteres.",
    "The name cannot exceed 100 characters.",
  ],
  "validation.runner": [
    "El ejecutor debe ser opencode o shell.",
    "The runner must be opencode or shell.",
  ],
  "validation.promptRequired": [
    "El prompt es obligatorio para el ejecutor opencode.",
    "The prompt is required for the opencode runner.",
  ],
  "validation.commandRequired": [
    "El comando es obligatorio para el ejecutor shell.",
    "The command is required for the shell runner.",
  ],
  "validation.promptType": ["El prompt debe ser texto o nulo.", "The prompt must be text or null."],
  "validation.commandType": [
    "El comando debe ser texto o nulo.",
    "The command must be text or null.",
  ],
  "validation.args": [
    "Los argumentos deben ser una lista de textos.",
    "Arguments must be a list of strings.",
  ],
  "validation.cwdRequired": [
    "El directorio de trabajo es obligatorio.",
    "The working directory is required.",
  ],
  "validation.modelType": ["El modelo debe ser texto o nulo.", "The model must be text or null."],
  "validation.agentType": ["El agente debe ser texto o nulo.", "The agent must be text or null."],
  "validation.sessionMode": [
    "El modo de sesión debe ser independent o continuous.",
    "The session mode must be independent or continuous.",
  ],
  "validation.sessionIdType": [
    "El identificador de sesión debe ser texto o nulo.",
    "The session ID must be text or null.",
  ],
  "validation.timezoneInvalid": [
    "La zona horaria no es una zona IANA válida.",
    "The time zone is not a valid IANA zone.",
  ],
  "validation.catchUp": [
    "La política de recuperación debe ser none, once o all.",
    "The catch-up policy must be none, once or all.",
  ],
  "validation.catchUpLimit": [
    "El límite de recuperación debe estar entre 1 y 100.",
    "The catch-up limit must be between 1 and 100.",
  ],
  "validation.overlap": [
    "La política de solapamiento debe ser skip, queue o kill.",
    "The overlap policy must be skip, queue or kill.",
  ],
  "validation.timeout": [
    "El tiempo máximo debe estar entre 1 y 86400 segundos.",
    "The maximum time must be between 1 and 86400 seconds.",
  ],
  "validation.notify": [
    "La notificación debe ser verdadera o falsa.",
    "The notification flag must be true or false.",
  ],
  "validation.notifyOn": [
    "El aviso debe ser always, failure o success.",
    "The notification trigger must be always, failure or success.",
  ],
  "validation.enabled": [
    "El estado debe ser verdadero o falso.",
    "The enabled flag must be true or false.",
  ],

  "schedule.kindInvalid": [
    'El tipo de repetición "{kind}" no es válido; debe ser cron, interval u once.',
    'The repetition kind "{kind}" is not valid; it must be cron, interval or once.',
  ],
  "schedule.cronFields": [
    "La expresión cron debe tener exactamente cinco campos (minuto hora día mes día-semana).",
    "The cron expression must have exactly five fields (minute hour day month day-of-week).",
  ],
  "schedule.cronInvalid": [
    'La expresión cron "{expression}" no es válida.',
    'The cron expression "{expression}" is not valid.',
  ],
  "schedule.intervalFormat": [
    "El intervalo debe tener el formato <n>m o <n>h, por ejemplo 15m o 2h.",
    "The interval must use the format <n>m or <n>h, for example 15m or 2h.",
  ],
  "schedule.intervalPositive": [
    "El intervalo debe ser un entero mayor o igual que 1.",
    "The interval must be an integer of at least 1.",
  ],
  "schedule.onceIso": [
    "La ejecución única necesita una fecha ISO-8601 con zona horaria explícita (Z u offset).",
    "A one-off run needs an ISO-8601 date with an explicit time zone (Z or offset).",
  ],
  "schedule.dateInvalid": [
    'La fecha "{expression}" no es válida.',
    'The date "{expression}" is not valid.',
  ],
  "schedule.nextRunInvalid": [
    'La expresión cron "{expression}" no tiene una próxima ejecución válida.',
    'The cron expression "{expression}" has no valid next run.',
  ],
  "schedule.timezoneRequired": ["La zona horaria es obligatoria.", "The time zone is required."],
  "schedule.timezoneOffset": [
    'La zona horaria "{timezone}" debe ser un nombre IANA, no un desplazamiento.',
    'The time zone "{timezone}" must be an IANA name, not an offset.',
  ],
  "schedule.timezoneInvalid": [
    'La zona horaria "{timezone}" no es válida.',
    'The time zone "{timezone}" is not valid.',
  ],
  "schedule.pastInstant": [
    "La fecha y hora indicadas ya pasaron.",
    "The given date and time are already in the past.",
  ],
  "schedule.instantMs": [
    '"{name}" debe ser un instante en milisegundos.',
    '"{name}" must be an instant in milliseconds.',
  ],

  "engine.cancelled": ["La ejecución se canceló.", "The run was cancelled."],
  "engine.clockError": ["Error del reloj de LAICron:", "LAICron clock error:"],

  "runner.shellNoCommand": ["el job no tiene comando definido", "the job has no command defined"],
  "runner.shellSpawn": [
    "no se pudo iniciar el shell: {detail}",
    "could not start the shell: {detail}",
  ],
  "runner.commandNotFound": ["comando no encontrado: {command}", "command not found: {command}"],
  "runner.opencodeMissing": [
    "opencode no está instalado o no está en el PATH",
    "opencode is not installed or not in PATH",
  ],
  "runner.opencodeStart": [
    "no se pudo iniciar opencode: {detail}",
    "could not start opencode: {detail}",
  ],
  "runner.mcpListFailed": [
    "[laicron] no se pudo leer la lista de MCPs; se usa la configuración heredada",
    "[laicron] could not read the MCP list; using the inherited configuration",
  ],
  "runner.cronInstructionFailed": [
    "[laicron] no se pudo preparar la instrucción de cron; se ejecuta sin ella",
    "[laicron] could not prepare the cron instruction; running without it",
  ],
  "runner.cronInstruction": [
    [
      "Estás ejecutando una tarea programada por LAICron. No es una conversación:",
      "no habrá respuesta del usuario.",
      "- Ejecuta exactamente lo que pide el mensaje y termina.",
      "- No saludes, no pidas confirmación, no preguntes nada y no ofrezcas ayuda.",
      "- Responde solo con el resultado necesario, de forma concisa.",
      "- Si falta un dato imprescindible, dilo en una línea y termina.",
    ].join("\n"),
    [
      "You are running a task scheduled by LAICron. This is not a conversation:",
      "there will be no user reply.",
      "- Do exactly what the message asks and finish.",
      "- Do not greet, ask for confirmation, ask anything or offer help.",
      "- Reply only with the necessary result, concisely.",
      "- If an essential piece of information is missing, say so in one line and finish.",
    ].join("\n"),
  ],

  "api.notFound": ["Recurso no encontrado.", "Resource not found."],
  "api.unauthorized": ["Token no válido.", "Invalid token."],
  "api.internalError": ["Error interno del servidor.", "Internal server error."],
  "api.serverRunning": [
    "El servidor HTTP ya está en marcha.",
    "The HTTP server is already running.",
  ],
  "api.serverNoPort": [
    "El servidor HTTP no expuso un puerto TCP.",
    "The HTTP server did not expose a TCP port.",
  ],
  "api.invalidJson": [
    "El cuerpo de la petición no es JSON válido.",
    "The request body is not valid JSON.",
  ],
  "api.payloadTooLarge": [
    "El cuerpo de la petición supera 1 MB.",
    "The request body exceeds 1 MB.",
  ],
  "api.bodyNotObject": [
    "El cuerpo de la petición debe ser un objeto JSON.",
    "The request body must be a JSON object.",
  ],
  "api.paramInteger": [
    'El parámetro "{field}" debe ser un entero.',
    'The "{field}" parameter must be an integer.',
  ],
  "api.paramRange": [
    'El parámetro "{field}" debe estar entre {min} y {max}.',
    'The "{field}" parameter must be between {min} and {max}.',
  ],
  "api.invalidJobId": ["El identificador del cron no es válido.", "The cron ID is not valid."],
  "api.catalogFailed": [
    "No se pudo leer el catálogo de opencode",
    "Could not read the opencode catalog",
  ],

  "opencode.timeout": ["opencode models agotó el tiempo de espera", "opencode models timed out"],
  "opencode.failed": [
    "opencode models falló (código {code})",
    "opencode models failed (code {code})",
  ],

  "notify.status.queued": ["queued", "queued"],
  "notify.status.running": ["running", "running"],
  "notify.status.success": ["Correcta", "Success"],
  "notify.status.failed": ["Fallida", "Failed"],
  "notify.status.timeout": ["Agotada", "Timed out"],
  "notify.status.interrupted": ["Interrumpida", "Interrupted"],
  "notify.status.skipped": ["Omitida", "Skipped"],

  "installer.unresolved": [
    "La plantilla contiene una variable sin resolver: {name}",
    "The template contains an unresolved variable: {name}",
  ],
  "installer.systemctlFailed": [
    'El comando "systemctl {args}" falló: {detail}',
    'The "systemctl {args}" command failed: {detail}',
  ],
  "installer.code": ["código {code}", "code {code}"],
  "installer.lingerUser": [
    "Aviso: no se pudo determinar el usuario para loginctl enable-linger.",
    "Warning: could not determine the user for loginctl enable-linger.",
  ],
  "installer.lingerFailed": [
    'Aviso: no se pudo habilitar la persistencia de sesión con "loginctl enable-linger {user}": {detail}',
    'Warning: could not enable session lingering with "loginctl enable-linger {user}": {detail}',
  ],
  "installer.pathWarning": [
    'Aviso: {dir} no está en el PATH. Añádelo para ejecutar "laicron" desde cualquier sitio.',
    'Warning: {dir} is not in PATH. Add it to run "laicron" from anywhere.',
  ],
  "installer.purged": [
    "Se han borrado la base de datos y el historial de LAICron.",
    "The LAICron database and history were deleted.",
  ],
  "installer.dataKept": [
    "Los datos de LAICron se conservan en {dir}",
    "LAICron data is kept in {dir}",
  ],
  "installer.installing": [
    "Instalando LAICron desde {root}...",
    "Installing LAICron from {root}...",
  ],
  "installer.installed": [
    "Servicio laicron.service instalado y activo.",
    "Service laicron.service installed and active.",
  ],
  "installer.uninstalled": [
    "Servicio laicron.service desinstalado.",
    "Service laicron.service uninstalled.",
  ],
  "installer.installedLine": ["Instalado: {value}", "Installed: {value}"],
  "installer.activeLine": ["Activo: {value}", "Active: {value}"],
  "installer.yes": ["sí", "yes"],
  "installer.no": ["no", "no"],
  "installer.usage": [
    "Uso: service-installer.js <install|uninstall [--purge-data]|status>",
    "Usage: service-installer.js <install|uninstall [--purge-data]|status>",
  ],

  "cli.help": [
    `LAICron — planificador local de tareas

Uso: laicron [comando]

Comandos:
  start        Arranca el daemon en primer plano (comando por defecto)
  open         Abre la ventana de LAICron
  status       Muestra si el daemon está activo y su último latido
  token        Muestra la ruta del fichero del token (nunca su contenido)

Opciones:
  -h, --help       Muestra esta ayuda
  -v, --version    Muestra la versión instalada`,
    `LAICron — local task scheduler

Usage: laicron [command]

Commands:
  start        Starts the daemon in the foreground (default command)
  open         Opens the LAICron window
  status       Shows whether the daemon is running and its last heartbeat
  token        Shows the token file path (never its contents)

Options:
  -h, --help       Shows this help
  -v, --version    Shows the installed version`,
  ],
  "cli.recoveryLine": ["Recuperación: {details}.", "Recovery: {details}."],
  "cli.recoveryInterrupted": [
    "{count} ejecución(es) interrumpida(s)",
    "{count} interrupted run(s)",
  ],
  "cli.recoveryExecuted": ["{count} recuperada(s)", "{count} recovered"],
  "cli.recoverySkipped": ["{count} omitida(s) en {jobs}", "{count} skipped across {jobs}"],
  "cli.jobsOne": ["1 cron", "1 cron"],
  "cli.jobsMany": ["{count} crons", "{count} crons"],
  "cli.clockStopError": [
    "Error al detener el reloj: {detail}",
    "Error stopping the clock: {detail}",
  ],
  "cli.cancelError": [
    "Error al cancelar las ejecuciones: {detail}",
    "Error cancelling the runs: {detail}",
  ],
  "cli.serverStopError": [
    "Error al detener el servidor HTTP: {detail}",
    "Error stopping the HTTP server: {detail}",
  ],
  "cli.dbCloseError": [
    "Error al cerrar la base de datos: {detail}",
    "Error closing the database: {detail}",
  ],
  "cli.startFailed": ["No se pudo arrancar LAICron: {detail}", "Could not start LAICron: {detail}"],
  "cli.listening": ["LAICron escuchando en {url}", "LAICron listening on {url}"],
  "cli.tokenUnreadable": [
    "No se pudo leer el token de LAICron.",
    "Could not read the LAICron token.",
  ],
  "cli.daemonInactive": [
    "El daemon de LAICron no está activo. Arráncalo con: laicron start",
    "The LAICron daemon is not running. Start it with: laicron start",
  ],
  "cli.windowLauncherMissing": [
    "No se encontró el lanzador de la ventana: {path}",
    "Window launcher not found: {path}",
  ],
  "cli.windowFailed": [
    "No se pudo abrir la ventana (¿está instalado python3?): {detail}",
    "Could not open the window (is python3 installed?): {detail}",
  ],
  "cli.inactive": ["LAICron está inactivo.", "LAICron is not running."],
  "cli.noHeartbeat": ["todavía sin latido", "no heartbeat yet"],
  "cli.active": [
    "LAICron está activo (versión {version}).",
    "LAICron is running (version {version}).",
  ],
  "cli.lastHeartbeat": ["Último latido: {value}", "Last heartbeat: {value}"],
  "cli.unknownCommand": ["Comando desconocido: {command}", "Unknown command: {command}"],
  "cli.error": ["Error: {detail}", "Error: {detail}"],
} as const satisfies Record<string, readonly [string, string]>;

export type MessageKey = keyof typeof MESSAGES;

const localeStorage = new AsyncLocalStorage<Locale>();
let baseLocale: Locale = "es";

function isLocale(value: string): value is Locale {
  return value === "es" || value === "en";
}

/**
 * Resolves the first supported language from a header-like value
 * (`en-US,en;q=0.9` → `en`). Returns null when none is supported.
 */
export function parseLocale(value: string | null | undefined): Locale | null {
  if (value === null || value === undefined) {
    return null;
  }
  for (const part of value.split(",")) {
    // Normalize POSIX values (`en_US.UTF-8`) and BCP-47 tags (`en-US`) alike.
    const raw = (part.split(";")[0] ?? "").trim().toLowerCase();
    const tag = (raw.split(".")[0] ?? "").replace(/_/g, "-");
    if (tag === "es" || tag.startsWith("es-")) {
      return "es";
    }
    if (tag === "en" || tag.startsWith("en-")) {
      return "en";
    }
  }
  return null;
}

/** Locale for processes without a request: `LAICRON_LANG`, then the POSIX vars. */
export function localeFromEnv(env: NodeJS.ProcessEnv = process.env): Locale {
  const explicit = parseLocale(env["LAICRON_LANG"]);
  if (explicit !== null) {
    return explicit;
  }
  if (env["LC_ALL"] !== undefined && env["LC_ALL"] !== "") {
    const all: Locale | null = parseLocale(env["LC_ALL"]);
    if (all !== null) {
      return all;
    }
  }
  if (env["LC_MESSAGES"] !== undefined && env["LC_MESSAGES"] !== "") {
    const messages: Locale | null = parseLocale(env["LC_MESSAGES"]);
    if (messages !== null) {
      return messages;
    }
  }
  return parseLocale(env["LANG"]) ?? "es";
}

export function setBaseLocale(locale: Locale): void {
  if (isLocale(locale)) {
    baseLocale = locale;
  }
}

export function getBaseLocale(): Locale {
  return baseLocale;
}

/** Locale of the current request, or the base locale outside one. */
export function getLocale(): Locale {
  return localeStorage.getStore() ?? baseLocale;
}

/** Runs `fn` with an explicit locale; nested async work inherits it. */
export function runWithLocale<T>(locale: Locale, fn: () => T): T {
  return localeStorage.run(locale, fn);
}

function formatMessage(template: string, params?: Record<string, string | number>): string {
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Translates a key, interpolating `{placeholders}` when given. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const pair = MESSAGES[key];
  return formatMessage(pair[getLocale() === "es" ? 0 : 1], params);
}
