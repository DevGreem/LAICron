/**
 * Minimal UI translation layer. Every message lives in one table with the
 * Spanish and English variants side by side, so both languages stay in sync.
 * Spanish is the default locale; English is picked from `?lang=`, a previous
 * choice stored in localStorage, or the browser language.
 */

export type Locale = "es" | "en";

const STORAGE_KEY = "laicron.locale";
const SUPPORTED: readonly Locale[] = ["es", "en"];

const MESSAGES = {
  "app.tagline": ["Planificador local de tareas", "Local task scheduler"],
  "app.offline": ["El planificador no responde", "The scheduler is not responding"],
  "app.notFoundTitle": ["Página no encontrada", "Page not found"],
  "app.notFoundBody": [
    "La dirección no corresponde a ninguna vista de LAICron.",
    "That address does not match any LAICron view.",
  ],
  "app.backToList": ["Volver a la lista", "Back to the list"],
  "app.tokenMissing": [
    "Falta el token de acceso. Abre LAICron desde el menú.",
    "Missing access token. Open LAICron from the menu.",
  ],
  "app.language": ["Idioma", "Language"],

  "common.loading": ["Cargando…", "Loading…"],
  "common.retry": ["Reintentar", "Retry"],
  "common.noRuns": ["Sin ejecuciones", "No runs"],
  "common.active": ["Activo", "Active"],
  "common.paused": ["En pausa", "Paused"],

  "list.title": ["Crons", "Crons"],
  "list.subtitle": ["Tareas programadas de este equipo", "Scheduled tasks on this machine"],
  "list.create": ["Crear cron", "Create cron"],
  "list.pause": ["Pausar", "Pause"],
  "list.resume": ["Reanudar", "Resume"],
  "list.runNow": ["Ejecutar ahora", "Run now"],
  "list.delete": ["Borrar", "Delete"],
  "list.detail": ["Detalle", "Details"],
  "list.confirmDelete": [
    "¿Borrar el cron «{name}»? Esta acción no se puede deshacer.",
    "Delete the cron “{name}”? This cannot be undone.",
  ],
  "list.pausedToast": ["Cron «{name}» pausado.", "Cron “{name}” paused."],
  "list.resumedToast": ["Cron «{name}» reanudado.", "Cron “{name}” resumed."],
  "list.startedToast": ["Ejecución de «{name}» iniciada.", "Run of “{name}” started."],
  "list.deletedToast": ["Cron «{name}» borrado.", "Cron “{name}” deleted."],
  "list.empty": [
    "Todavía no hay crons. Crea el primero con «Crear cron».",
    "No crons yet. Create the first one with “Create cron”.",
  ],
  "list.colName": ["Nombre", "Name"],
  "list.colSchedule": ["Programación", "Schedule"],
  "list.colNextRun": ["Próxima ejecución", "Next run"],
  "list.colLastStatus": ["Último estado", "Last status"],
  "list.colActions": ["Acciones", "Actions"],

  "detail.title": ["Detalle del cron", "Cron details"],
  "detail.notFound": ["No se encontró el cron.", "Cron not found."],
  "detail.back": ["Volver a la lista", "Back to the list"],
  "detail.edit": ["Editar", "Edit"],
  "detail.termStatus": ["Estado", "Status"],
  "detail.termRunner": ["Ejecutor", "Runner"],
  "detail.termSchedule": ["Programación", "Schedule"],
  "detail.termTimezone": ["Zona horaria", "Time zone"],
  "detail.termNextRun": ["Próxima ejecución", "Next run"],
  "detail.termLastRun": ["Última ejecución", "Last run"],
  "detail.termLastStatus": ["Último estado", "Last status"],
  "detail.termCatchUp": ["Recuperación", "Catch-up"],
  "detail.catchUpValue": ["{label} (límite {limit})", "{label} (limit {limit})"],
  "detail.termOverlap": ["Solapamiento", "Overlap"],
  "detail.termTimeout": ["Tiempo máximo", "Maximum time"],
  "detail.termNotifications": ["Notificaciones", "Notifications"],
  "detail.notificationsYes": ["Sí ({when})", "Yes ({when})"],
  "detail.no": ["No", "No"],
  "detail.termSession": ["Sesión", "Session"],
  "detail.termCreated": ["Creado", "Created"],
  "detail.termUpdated": ["Actualizado", "Updated"],
  "detail.termPrompt": ["Prompt", "Prompt"],
  "detail.termModel": ["Modelo", "Model"],
  "detail.termAgent": ["Agente", "Agent"],
  "detail.termCommand": ["Comando", "Command"],
  "detail.termCwd": ["Directorio", "Directory"],
  "detail.termArgs": ["Argumentos", "Arguments"],
  "detail.colTrigger": ["Disparador", "Trigger"],
  "detail.colStart": ["Inicio", "Start"],
  "detail.colDuration": ["Duración", "Duration"],
  "detail.colTokens": ["Tokens", "Tokens"],
  "detail.colCost": ["Coste", "Cost"],
  "detail.colExitCode": ["Código de salida", "Exit code"],
  "detail.colError": ["Error", "Error"],
  "detail.newer": ["Más recientes", "Newer"],
  "detail.older": ["Más antiguas", "Older"],
  "detail.pageEmpty": ["Sin resultados", "No results"],
  "detail.pageInfo": ["Mostrando {from}–{to} de {total}", "Showing {from}–{to} of {total}"],
  "detail.runsTitle": ["Historial de ejecuciones", "Run history"],
  "detail.runsOne": ["1 ejecución", "1 run"],
  "detail.runsMany": ["{count} ejecuciones", "{count} runs"],
  "detail.runsEmpty": ["Todavía no hay ejecuciones.", "No runs yet."],
  "detail.usageTitle": ["Consumo", "Usage"],
  "detail.usageEmpty": ["Todavía no hay datos de consumo.", "No usage data yet."],
  "detail.usageTotalCost": ["Coste total", "Total cost"],
  "detail.usageTokens": ["Tokens", "Tokens"],
  "detail.usageBreakdown": ["Entrada {input} · Salida {output}", "Input {input} · Output {output}"],
  "detail.usageRuns": [
    "{withData} de {runs} ejecuciones con datos",
    "{withData} of {runs} runs with data",
  ],
  "detail.usageNote": [
    "En modo continuo, la entrada incluye el historial de la sesión.",
    "In continuous mode, input includes the session history.",
  ],
  "detail.chatTitle": ["Chat", "Chat"],
  "detail.messagesOne": ["1 mensaje", "1 message"],
  "detail.messagesMany": ["{count} mensajes", "{count} messages"],
  "detail.chatEmpty": [
    "Todavía no hay mensajes. Aparecerán aquí tras cada ejecución.",
    "No messages yet. They will appear here after each run.",
  ],
  "detail.previous": ["Anteriores", "Previous"],
  "detail.next": ["Siguientes", "Next"],
  "detail.roleUser": ["Usuario", "User"],
  "detail.roleAssistant": ["Asistente", "Assistant"],

  "format.status.queued": ["En cola", "Queued"],
  "format.status.running": ["En curso", "Running"],
  "format.status.success": ["Correcta", "Success"],
  "format.status.failed": ["Fallida", "Failed"],
  "format.status.timeout": ["Agotada", "Timed out"],
  "format.status.skipped": ["Omitida", "Skipped"],
  "format.status.interrupted": ["Interrumpida", "Interrupted"],
  "format.trigger.scheduled": ["Programada", "Scheduled"],
  "format.trigger.catch_up": ["Recuperada", "Recovered"],
  "format.trigger.manual": ["Manual", "Manual"],
  "format.kind.cron": ["Cron", "Cron"],
  "format.kind.interval": ["Intervalo", "Interval"],
  "format.kind.once": ["Una vez", "One-off"],
  "format.catchup.none": ["Ninguna", "None"],
  "format.catchup.once": ["Una vez", "Once"],
  "format.catchup.all": ["Todas", "All"],
  "format.overlap.skip": ["Omitir la nueva", "Skip the new one"],
  "format.overlap.queue": ["Encolar la nueva", "Queue the new one"],
  "format.overlap.kill": ["Terminar la anterior", "Kill the previous one"],
  "format.session.independent": ["Independiente", "Independent"],
  "format.session.continuous": ["Continua", "Continuous"],
  "format.notify.always": ["Siempre", "Always"],
  "format.notify.failure": ["Solo si falla", "Only on failure"],
  "format.notify.success": ["Solo si va bien", "Only on success"],
  "format.runner.opencode": ["opencode (IA)", "opencode (AI)"],
  "format.runner.shell": ["shell (comando)", "shell (command)"],
  "format.everyAmount": ["Cada {amount} {unit}", "Every {amount} {unit}"],
  "format.everyRaw": ["Cada {expr}", "Every {expr}"],
  "format.onceAt": ["Una vez: {date}", "Once: {date}"],
  "format.unit.minuteOne": ["minuto", "minute"],
  "format.unit.minuteMany": ["minutos", "minutes"],
  "format.unit.hourOne": ["hora", "hour"],
  "format.unit.hourMany": ["horas", "hours"],

  "cron.preset.daily9": ["Cada día a las 09:00", "Every day at 09:00"],
  "cron.preset.weekdays9": ["De lunes a viernes a las 09:00", "Monday to Friday at 09:00"],
  "cron.preset.monday8": ["Cada lunes a las 08:00", "Every Monday at 08:00"],
  "cron.preset.hourly": ["Cada hora en punto", "Every hour on the hour"],
  "cron.preset.every15": ["Cada 15 minutos", "Every 15 minutes"],
  "cron.preset.monthly1": [
    "El primer día del mes a las 00:00",
    "The first day of the month at 00:00",
  ],
  "cron.everyMinute": ["cada minuto", "every minute"],
  "cron.everyNMinutes": ["cada {amount} minutos", "every {amount} minutes"],
  "cron.everyDayAt": ["todos los días a las {time}", "every day at {time}"],
  "cron.fromToAt": ["de {from} a {to} a las {time}", "{from} to {to} at {time}"],
  "cron.everyDayOfWeekAt": ["todos los {day} a las {time}", "every {day} at {time}"],
  "cron.expression": ["expresión cron {expr}", "cron expression {expr}"],
  "cron.invalidExpression": ["expresión cron no válida", "invalid cron expression"],
  "cron.day.0": ["domingo", "Sunday"],
  "cron.day.1": ["lunes", "Monday"],
  "cron.day.2": ["martes", "Tuesday"],
  "cron.day.3": ["miércoles", "Wednesday"],
  "cron.day.4": ["jueves", "Thursday"],
  "cron.day.5": ["viernes", "Friday"],
  "cron.day.6": ["sábado", "Saturday"],
  "cron.days.0": ["domingos", "Sunday"],
  "cron.days.1": ["lunes", "Monday"],
  "cron.days.2": ["martes", "Tuesday"],
  "cron.days.3": ["miércoles", "Wednesday"],
  "cron.days.4": ["jueves", "Thursday"],
  "cron.days.5": ["viernes", "Friday"],
  "cron.days.6": ["sábados", "Saturday"],

  "form.titleEdit": ["Editar cron", "Edit cron"],
  "form.titleNew": ["Nuevo cron", "New cron"],
  "form.subtitleEdit": ["Cambia la configuración y guarda", "Change the settings and save"],
  "form.subtitleNew": ["Programa una tarea nueva", "Schedule a new task"],
  "form.sectionBasic": ["Básico", "Basics"],
  "form.sectionRunner": ["Configuración del ejecutor", "Runner settings"],
  "form.sectionSchedule": ["Programación", "Schedule"],
  "form.sectionRun": ["Ejecución", "Run"],
  "form.sectionNotify": ["Notificación", "Notification"],
  "form.name": ["Nombre", "Name"],
  "form.active": ["Activo", "Active"],
  "form.runner": ["Ejecutor", "Runner"],
  "form.cwd": ["Directorio de trabajo", "Working directory"],
  "form.cwdHintShell": [
    "Ruta absoluta donde se ejecuta el comando.",
    "Absolute path where the command runs.",
  ],
  "form.cwdHintOpencode": [
    "Dónde se ejecuta opencode y de dónde salen los MCPs de proyecto. Vacío = tu home.",
    "Where opencode runs and where project MCPs come from. Empty = your home.",
  ],
  "form.prompt": ["Prompt", "Prompt"],
  "form.promptHint": [
    "Texto que se envía a opencode en cada ejecución.",
    "Text sent to opencode on every run.",
  ],
  "form.model": ["Modelo", "Model"],
  "form.modelHint": ["Modelo del catálogo de opencode.", "Model from the opencode catalog."],
  "form.modelCustom": ["Modelo personalizado", "Custom model"],
  "form.modelCustomHint": [
    "Formato proveedor/modelo#variante. Se usa si el catálogo no está disponible.",
    "Format provider/model#variant. Used when the catalog is unavailable.",
  ],
  "form.variant": ["Variante", "Variant"],
  "form.variantHint": ["Variante del modelo elegido.", "Variant of the chosen model."],
  "form.agent": ["Agente", "Agent"],
  "form.agentHint": [
    "Agente primario del catálogo de opencode.",
    "Primary agent from the opencode catalog.",
  ],
  "form.agentCustom": ["Agente personalizado", "Custom agent"],
  "form.agentCustomHint": [
    "Se usa si el catálogo no está disponible.",
    "Used when the catalog is unavailable.",
  ],
  "form.loadingOptions": ["Cargando…", "Loading…"],
  "form.defaultSystem": ["Predeterminado del sistema", "System default"],
  "form.defaultVariant": ["Predeterminada", "Default"],
  "form.defaultAgent": ["Predeterminado", "Default"],
  "form.custom": ["Personalizado…", "Custom…"],
  "form.reloadOptions": ["Recargar opciones", "Reload options"],
  "form.optionsUnavailable": [
    "No se pudo leer el catálogo de opencode.",
    "Could not read the opencode catalog.",
  ],
  "form.mcpTitle": ["MCPs", "MCPs"],
  "form.mcpName": ["MCP", "MCP"],
  "form.mcpDefault": ["Por defecto", "Default"],
  "form.mcpState": ["Estado", "State"],
  "form.mcpEffective": ["Efectivo", "Effective"],
  "form.mcpLegend": [
    "Heredado sigue tu configuración de opencode; Encendido/Apagado fija ese valor para este cron y no cambia aunque modifiques la configuración.",
    "Inherited follows your opencode configuration; On/Off pins that value for this cron and does not change when you modify the configuration.",
  ],
  "form.mcpInherit": ["Heredado", "Inherited"],
  "form.mcpOn": ["Encendido", "On"],
  "form.mcpOff": ["Apagado", "Off"],
  "form.mcpPinned": ["Fijado para este cron", "Pinned for this cron"],
  "form.mcpStateOf": ["Estado de {name}", "State of {name}"],
  "form.mcpUnavailable": [
    "No se pudo leer la lista de MCPs de opencode.",
    "Could not read the opencode MCP list.",
  ],
  "form.command": ["Comando", "Command"],
  "form.commandHint": ["Se ejecuta con sh -lc.", "Runs with sh -lc."],
  "form.timezone": ["Zona horaria", "Time zone"],
  "form.timezoneHint": [
    "Nombre IANA, por ejemplo Europe/Madrid.",
    "IANA name, for example Europe/Madrid.",
  ],
  "form.timezoneNow": [
    "Ahora son las {time}{zone} ({offset})",
    "It is now {time}{zone} ({offset})",
  ],
  "form.timezoneNowZone": [" en {zone}", " in {zone}"],
  "form.scheduleKind": ["Repetición", "Repetition"],
  "form.preset": ["Plantilla", "Template"],
  "form.presetHint": [
    "Rellena los cinco campos con una programación habitual.",
    "Fills the five fields with a common schedule.",
  ],
  "form.minute": ["Minuto", "Minute"],
  "form.hour": ["Hora", "Hour"],
  "form.dayOfMonth": ["Día del mes", "Day of the month"],
  "form.month": ["Mes", "Month"],
  "form.dayOfWeek": ["Día de la semana", "Day of the week"],
  "form.advanced": ["Modo avanzado", "Advanced mode"],
  "form.advancedHint": [
    "Escribe la expresión completa a mano.",
    "Write the whole expression by hand.",
  ],
  "form.cronExpression": ["Expresión cron", "Cron expression"],
  "form.cronExpressionHint": [
    "Cinco campos: minuto, hora, día, mes y día de la semana.",
    "Five fields: minute, hour, day, month and day of the week.",
  ],
  "form.every": ["Cada", "Every"],
  "form.unit": ["Unidad", "Unit"],
  "form.minutes": ["minutos", "minutes"],
  "form.hours": ["horas", "hours"],
  "form.onceAt": ["Fecha y hora", "Date and time"],
  "form.onceHint": [
    "Se interpreta en la zona horaria local y se guarda en UTC.",
    "Interpreted in the local time zone and stored in UTC.",
  ],
  "form.catchUp": ["Si el equipo estuvo apagado", "If the machine was off"],
  "form.catchUpLimit": ["Límite de recuperación", "Recovery limit"],
  "form.catchUpLimitHint": ["Entre 1 y 100 ejecuciones.", "Between 1 and 100 runs."],
  "form.overlap": ["Si ya hay una ejecución en curso", "If a run is already in progress"],
  "form.timeout": ["Tiempo máximo (segundos)", "Maximum time (seconds)"],
  "form.timeoutHint": ["Entre 1 y 86400.", "Between 1 and 86400."],
  "form.session": ["Sesión", "Session"],
  "form.sessionId": ["ID de sesión", "Session ID"],
  "form.sessionIdHint": [
    "Se rellena solo; déjalo vacío para empezar de cero.",
    "Filled in automatically; leave it empty to start fresh.",
  ],
  "form.args": ["Argumentos", "Arguments"],
  "form.argsHint": [
    "Opcional. Uno por línea; se guardan con el cron.",
    "Optional. One per line; saved with the cron.",
  ],
  "form.notify": ["Avisar al terminar", "Notify on finish"],
  "form.notifyOn": ["Cuándo avisar", "When to notify"],
  "form.save": ["Guardar", "Save"],
  "form.saving": ["Guardando…", "Saving…"],
  "form.cancel": ["Cancelar", "Cancel"],
  "form.previewWillRun": ["Se ejecutará: {desc}", "Will run: {desc}"],
  "form.previewInvalid": [
    "La expresión actual no se pudo dividir en cinco campos; revísala.",
    "The current expression could not be split into five fields; check it.",
  ],
  "form.errNameRequired": ["El nombre es obligatorio.", "The name is required."],
  "form.errNameTooLong": [
    "El nombre no puede superar los 100 caracteres.",
    "The name cannot exceed 100 characters.",
  ],
  "form.errPromptRequired": [
    "El prompt es obligatorio para el ejecutor opencode.",
    "The prompt is required for the opencode runner.",
  ],
  "form.errCommandRequired": [
    "El comando es obligatorio para el ejecutor shell.",
    "The command is required for the shell runner.",
  ],
  "form.errCwdRequired": [
    "El directorio de trabajo es obligatorio.",
    "The working directory is required.",
  ],
  "form.errCronFiveFields": [
    "La expresión cron debe tener cinco campos.",
    "The cron expression must have five fields.",
  ],
  "form.errIntervalInteger": [
    "El intervalo debe ser un número entero.",
    "The interval must be an integer.",
  ],
  "form.errIntervalMin": [
    "El intervalo debe ser mayor o igual que 1.",
    "The interval must be 1 or greater.",
  ],
  "form.errOnceRequired": ["La fecha única es obligatoria.", "The one-off date is required."],
  "form.errOnceInvalid": ["La fecha única no es válida.", "The one-off date is not valid."],
  "form.errTimezoneRequired": ["La zona horaria es obligatoria.", "The time zone is required."],
  "form.errCatchUpLimit": [
    "El límite de recuperación debe estar entre 1 y 100.",
    "The recovery limit must be between 1 and 100.",
  ],
  "form.errTimeout": [
    "El tiempo máximo debe estar entre 1 y 86400 segundos.",
    "The maximum time must be between 1 and 86400 seconds.",
  ],
  "form.toastCreated": ["Cron creado.", "Cron created."],
  "form.toastUpdated": ["Cron actualizado.", "Cron updated."],

  "api.invalidToken": [
    "El token de acceso no es válido. Abre LAICron desde el menú.",
    "The access token is not valid. Open LAICron from the menu.",
  ],
  "api.unexpected": ["Ha ocurrido un error inesperado.", "An unexpected error occurred."],
  "api.serverError": ["Error del servidor ({status}).", "Server error ({status})."],
  "api.network": [
    "No se pudo conectar con el planificador.",
    "Could not connect to the scheduler.",
  ],
  "api.invalidResponse": [
    "La respuesta del servidor no es JSON válido.",
    "The server response is not valid JSON.",
  ],
  "api.healthStatus": ["El planificador respondió {status}.", "The scheduler responded {status}."],

  "events.openFailed": [
    "No se pudo abrir el canal de eventos ({status}).",
    "Could not open the event channel ({status}).",
  ],
  "timezones.invalidZone": ["zona no válida", "invalid time zone"],
} as const satisfies Record<string, readonly [string, string]>;

export type MessageKey = keyof typeof MESSAGES;

let locale: Locale = "es";
let dateTimeCache: { locale: Locale; formatter: Intl.DateTimeFormat } | null = null;
let numberCache: { locale: Locale; formatter: Intl.NumberFormat } | null = null;

function isLocale(value: string | null | undefined): value is Locale {
  return value === "es" || value === "en";
}

/** Resolves the initial locale from the URL, storage and browser, in that order. */
export function initLocale(): Locale {
  let chosen: Locale | null = null;

  try {
    const fromQuery = new URLSearchParams(window.location.search).get("lang");
    if (isLocale(fromQuery)) {
      chosen = fromQuery;
      window.localStorage.setItem(STORAGE_KEY, fromQuery);
    }
  } catch {
    // Ignore storage or URL failures: the defaults below still apply.
  }

  if (chosen === null) {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isLocale(stored)) {
        chosen = stored;
      }
    } catch {
      // Storage may be unavailable.
    }
  }

  if (chosen === null) {
    const browser = typeof navigator === "undefined" ? "" : navigator.language;
    chosen = browser.toLowerCase().startsWith("en") ? "en" : "es";
  }

  setLocale(chosen);
  return locale;
}

export function getLocale(): Locale {
  return locale;
}

/** Changes the current locale and remembers it for the next visit. */
export function setLocale(next: Locale): void {
  locale = next;
  dateTimeCache = null;
  numberCache = null;
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode or disabled storage: the locale still applies to this page.
  }
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
  return formatMessage(pair[locale === "es" ? 0 : 1], params);
}

export function dateTimeFormatter(): Intl.DateTimeFormat {
  if (dateTimeCache === null || dateTimeCache.locale !== locale) {
    dateTimeCache = {
      locale,
      formatter: new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    };
  }
  return dateTimeCache.formatter;
}

export function numberFormatter(): Intl.NumberFormat {
  if (numberCache === null || numberCache.locale !== locale) {
    numberCache = {
      locale,
      formatter: new Intl.NumberFormat(locale === "es" ? "es-ES" : "en-US"),
    };
  }
  return numberCache.formatter;
}

/** Supported locales, for the language selector. */
export const LOCALES: readonly Locale[] = SUPPORTED;
