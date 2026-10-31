import { ApiError, messageFromError } from "../api.js";
import { CRON_PRESETS, composeCron, describeCron, parseCron } from "../cron.js";
import type { CronFields } from "../cron.js";
import type { AppContext, View } from "../context.js";
import {
  button,
  checkboxField,
  clearFieldErrors,
  errorSlot,
  field,
  formField,
  h,
  selectControl,
  setFieldError,
} from "../dom.js";
import { composeModelValue, splitModelValue } from "../model-value.js";
import { listTimezones, timezoneInfo } from "../timezones.js";
import type {
  CatchUpPolicy,
  Job,
  JobInput,
  NotifyOn,
  OpencodeAgentOption,
  OpencodeModelOption,
  OpencodeOptions,
  OverlapPolicy,
  RunnerKind,
  ScheduleKind,
  SessionMode,
} from "../types.js";
import { errorPanel, loadingView, pageHeader } from "./common.js";

interface IntervalParts {
  value: string;
  unit: "m" | "h";
}

function parseInterval(expr: string): IntervalParts {
  const match = /^(\d+)([mh])$/.exec(expr.trim());
  if (match === null) {
    return { value: "15", unit: "m" };
  }
  return {
    value: match[1] ?? "15",
    unit: match[2] === "h" ? "h" : "m",
  };
}

function toDateTimeLocal(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join("T");
}

function defaultOnceValue(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return toDateTimeLocal(date);
}

function onceValueFromJob(job: Job | null): string {
  if (job === null || job.scheduleKind !== "once") {
    return defaultOnceValue();
  }
  const date = new Date(job.scheduleExpr);
  return Number.isNaN(date.getTime()) ? defaultOnceValue() : toDateTimeLocal(date);
}

type BuildOutcome = { ok: true; input: JobInput } | { ok: false; field?: string; message: string };

function failure(fieldName: string, message: string): BuildOutcome {
  return { ok: false, field: fieldName, message };
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const DEFAULT_CRON_FIELDS: CronFields = {
  minute: "0",
  hour: "9",
  dayOfMonth: "*",
  month: "*",
  dayOfWeek: "*",
};

function presetIdFor(expr: string): string {
  return CRON_PRESETS.find((preset) => preset.expr === expr)?.id ?? "__custom__";
}

interface InitialCronState {
  fields: CronFields;
  preset: string;
  advanced: boolean;
  raw: string;
}

function initialCronState(job: Job | null): InitialCronState {
  if (job === null || job.scheduleKind !== "cron") {
    return { fields: { ...DEFAULT_CRON_FIELDS }, preset: "daily-9", advanced: false, raw: "" };
  }

  const parsed = parseCron(job.scheduleExpr);
  if (parsed === null) {
    return {
      fields: { ...DEFAULT_CRON_FIELDS },
      preset: "__custom__",
      advanced: true,
      raw: job.scheduleExpr,
    };
  }

  return {
    fields: parsed,
    preset: presetIdFor(composeCron(parsed)),
    advanced: false,
    raw: "",
  };
}

function cronFieldInput(id: string, listId: string): HTMLInputElement {
  return h("input", {
    attrs: {
      id,
      name: "scheduleExpr",
      type: "text",
      list: listId,
      autocomplete: "off",
    },
  });
}

function cronSuggestions(id: string, values: string[]): HTMLDataListElement {
  return h(
    "datalist",
    { attrs: { id } },
    ...values.map((value) => h("option", { attrs: { value } })),
  );
}

/** Shows the catalog name and id when they differ, or just the id otherwise. */
function optionLabel(id: string, name: string): string {
  return name.length > 0 && name !== id ? `${name} — ${id}` : id;
}

/** Create/edit form for every user-editable job field. */
export function createFormView(ctx: AppContext, jobId: string | null): View {
  const element = h("section", { class: "view" });
  const content = h("div", { class: "view-content" });
  element.append(content);
  let disposed = false;

  function renderLoadError(error: unknown): void {
    content.replaceChildren(
      pageHeader("Editar cron", null),
      errorPanel(messageFromError(error), () => {
        void load();
      }),
      h("a", { class: "btn", text: "Volver a la lista", attrs: { href: "#/" } }),
    );
  }

  async function load(): Promise<void> {
    if (jobId === null) {
      renderForm(null);
      return;
    }

    content.replaceChildren(pageHeader("Editar cron", null), loadingView());
    try {
      const job = await ctx.api.getJob(jobId);
      if (disposed) {
        return;
      }
      renderForm(job);
    } catch (error) {
      if (disposed) {
        return;
      }
      renderLoadError(error);
    }
  }

  function renderForm(job: Job | null): void {
    const isEdit = job !== null;
    const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const initialInterval = parseInterval(
      job !== null && job.scheduleKind === "interval" ? job.scheduleExpr : "15m",
    );
    const initialCron = initialCronState(job);

    const nameInput = h("input", {
      attrs: {
        id: "job-name",
        name: "name",
        type: "text",
        maxlength: "100",
        autocomplete: "off",
        required: true,
      },
    });
    nameInput.value = job?.name ?? "";

    const enabledInput = h("input", {
      attrs: { id: "job-enabled", name: "enabled", type: "checkbox" },
    });
    enabledInput.checked = job?.enabled ?? true;

    const runnerSelect = selectControl(
      "job-runner",
      "runner",
      [
        { value: "opencode", label: "opencode (IA)" },
        { value: "shell", label: "shell (comando)" },
      ],
      job?.runner ?? "opencode",
    );

    const promptInput = h("textarea", {
      attrs: { id: "job-prompt", name: "prompt", rows: "6", required: true },
    });
    promptInput.value = job?.prompt ?? "";

    const modelSelect = selectControl(
      "job-model",
      "model",
      [{ value: "", label: "Cargando…" }],
      "",
    );
    modelSelect.disabled = true;

    const modelCustomInput = h("input", {
      attrs: {
        id: "job-model-custom",
        name: "model",
        type: "text",
        placeholder: "proveedor/modelo#variante",
        autocomplete: "off",
      },
    });
    modelCustomInput.value = job?.model ?? "";

    const modelVariantSelect = selectControl(
      "job-model-variant",
      "modelVariant",
      [{ value: "", label: "Cargando…" }],
      "",
    );
    modelVariantSelect.disabled = true;

    const agentSelect = selectControl(
      "job-agent",
      "agent",
      [{ value: "", label: "Cargando…" }],
      "",
    );
    agentSelect.disabled = true;

    const agentCustomInput = h("input", {
      attrs: {
        id: "job-agent-custom",
        name: "agent",
        type: "text",
        autocomplete: "off",
      },
    });
    agentCustomInput.value = job?.agent ?? "";

    const optionsNotice = h("p", {
      class: "options-notice field-full",
      attrs: { id: "job-options-notice", hidden: true, role: "status" },
    });

    const optionsRefreshButton = button("Recargar opciones", () => {
      void loadOptions(true);
    });
    optionsRefreshButton.id = "job-options-refresh";

    const commandInput = h("input", {
      attrs: {
        id: "job-command",
        name: "command",
        type: "text",
        placeholder: "echo hola",
        autocomplete: "off",
      },
    });
    commandInput.value = job?.command ?? "";

    const cwdInput = h("input", {
      attrs: {
        id: "job-cwd",
        name: "cwd",
        type: "text",
        placeholder: "/home/usuario",
        autocomplete: "off",
      },
    });
    cwdInput.value = job?.cwd ?? "";

    const argsInput = h("textarea", {
      attrs: { id: "job-args", name: "args", rows: "3" },
    });
    argsInput.value = (job?.args ?? []).join("\n");

    const scheduleKindSelect = selectControl(
      "job-schedule-kind",
      "scheduleKind",
      [
        { value: "cron", label: "Cron" },
        { value: "interval", label: "Intervalo" },
        { value: "once", label: "Una vez" },
      ],
      job?.scheduleKind ?? "cron",
    );

    const cronPresetSelect = selectControl(
      "job-cron-preset",
      "cronPreset",
      [
        { value: "__custom__", label: "Personalizado…" },
        ...CRON_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
      ],
      initialCron.preset,
    );

    const cronMinuteInput = cronFieldInput("job-cron-minute", "job-cron-minute-list");
    const cronHourInput = cronFieldInput("job-cron-hour", "job-cron-hour-list");
    const cronDayOfMonthInput = cronFieldInput("job-cron-dom", "job-cron-dom-list");
    const cronMonthInput = cronFieldInput("job-cron-month", "job-cron-month-list");
    const cronDayOfWeekInput = cronFieldInput("job-cron-dow", "job-cron-dow-list");
    const cronFieldInputs = [
      cronMinuteInput,
      cronHourInput,
      cronDayOfMonthInput,
      cronMonthInput,
      cronDayOfWeekInput,
    ];

    cronMinuteInput.value = initialCron.fields.minute;
    cronHourInput.value = initialCron.fields.hour;
    cronDayOfMonthInput.value = initialCron.fields.dayOfMonth;
    cronMonthInput.value = initialCron.fields.month;
    cronDayOfWeekInput.value = initialCron.fields.dayOfWeek;

    const cronMinuteList = cronSuggestions("job-cron-minute-list", [
      "*",
      "0",
      "*/5",
      "*/10",
      "*/15",
      "*/30",
    ]);
    const cronHourList = cronSuggestions("job-cron-hour-list", ["*", "0", "6", "9", "12", "18"]);
    const cronDayOfMonthList = cronSuggestions("job-cron-dom-list", ["*", "1", "15"]);
    const cronMonthList = cronSuggestions("job-cron-month-list", [
      "*",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);
    const cronDayOfWeekList = cronSuggestions("job-cron-dow-list", [
      "*",
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "1-5",
      "0,6",
    ]);

    const cronPreview = h("p", {
      class: "cron-preview field-full",
      attrs: { id: "job-cron-preview" },
    });

    const cronAdvancedInput = h("input", {
      attrs: { id: "job-cron-advanced", type: "checkbox" },
    });
    cronAdvancedInput.checked = initialCron.advanced;

    const cronAdvancedField = checkboxField("Modo avanzado", cronAdvancedInput, {
      hint: "Escribe la expresión completa a mano.",
    });
    cronAdvancedField.classList.add("field-full");

    const cronRawInput = h("input", {
      attrs: {
        id: "job-cron-raw",
        name: "scheduleExpr",
        type: "text",
        placeholder: "0 9 * * 1-5",
        autocomplete: "off",
      },
    });
    cronRawInput.value = initialCron.raw;

    const cronRawField = field("Expresión cron", cronRawInput, {
      full: true,
      hint: "Cinco campos: minuto, hora, día, mes y día de la semana.",
    });

    const intervalValueInput = h("input", {
      attrs: {
        id: "job-interval-value",
        name: "scheduleExpr",
        type: "number",
        min: "1",
        step: "1",
      },
    });
    intervalValueInput.value = initialInterval.value;

    const intervalUnitSelect = selectControl(
      "job-interval-unit",
      "intervalUnit",
      [
        { value: "m", label: "minutos" },
        { value: "h", label: "horas" },
      ],
      initialInterval.unit,
    );

    const onceInput = h("input", {
      attrs: { id: "job-once-at", name: "scheduleExpr", type: "datetime-local" },
    });
    onceInput.value = onceValueFromJob(job);

    const timezoneInput = h("input", {
      attrs: {
        id: "job-timezone",
        name: "timezone",
        type: "text",
        list: "job-timezone-list",
        autocomplete: "off",
      },
    });
    timezoneInput.value = job?.timezone ?? defaultTimezone;

    const timezoneDatalist = cronSuggestions("job-timezone-list", listTimezones());
    const timezoneInfoElement = h("p", {
      class: "timezone-info",
      attrs: { id: "job-timezone-info" },
    });

    const timezoneField = formField("Zona horaria", timezoneInput, {
      field: "timezone",
      hint: "Nombre IANA, por ejemplo Europe/Madrid.",
    });
    timezoneField.appendChild(timezoneInfoElement);

    const catchUpSelect = selectControl(
      "job-catchup",
      "catchUp",
      [
        { value: "none", label: "Ninguna" },
        { value: "once", label: "Una vez" },
        { value: "all", label: "Todas" },
      ],
      job?.catchUp ?? "once",
    );

    const catchUpLimitInput = h("input", {
      attrs: {
        id: "job-catchup-limit",
        name: "catchUpLimit",
        type: "number",
        min: "1",
        max: "100",
        step: "1",
      },
    });
    catchUpLimitInput.value = String(job?.catchUpLimit ?? 10);

    const overlapSelect = selectControl(
      "job-overlap",
      "overlap",
      [
        { value: "skip", label: "Omitir la nueva" },
        { value: "queue", label: "Encolar la nueva" },
        { value: "kill", label: "Terminar la anterior" },
      ],
      job?.overlap ?? "skip",
    );

    const timeoutInput = h("input", {
      attrs: {
        id: "job-timeout",
        name: "timeoutSec",
        type: "number",
        min: "1",
        max: "86400",
        step: "1",
      },
    });
    timeoutInput.value = String(job?.timeoutSec ?? 600);

    const sessionModeSelect = selectControl(
      "job-session-mode",
      "sessionMode",
      [
        { value: "independent", label: "Independiente" },
        { value: "continuous", label: "Continua" },
      ],
      job?.sessionMode ?? "independent",
    );

    const sessionIdInput = h("input", {
      attrs: {
        id: "job-session-id",
        name: "sessionId",
        type: "text",
        placeholder: "Automático",
        autocomplete: "off",
      },
    });
    sessionIdInput.value = job?.sessionId ?? "";

    const notifyInput = h("input", {
      attrs: { id: "job-notify", name: "notify", type: "checkbox" },
    });
    notifyInput.checked = job?.notify ?? true;

    const notifyOnSelect = selectControl(
      "job-notify-on",
      "notifyOn",
      [
        { value: "always", label: "Siempre" },
        { value: "failure", label: "Solo si falla" },
        { value: "success", label: "Solo si va bien" },
      ],
      job?.notifyOn ?? "always",
    );

    const modelError = errorSlot("model");
    modelError.classList.add("field-full");
    const agentError = errorSlot("agent");
    agentError.classList.add("field-full");

    const modelField = field("Modelo", modelSelect, {
      hint: "Modelo del catálogo de opencode.",
    });
    const modelCustomField = field("Modelo personalizado", modelCustomInput, {
      hint: "Formato proveedor/modelo#variante. Se usa si el catálogo no está disponible.",
    });
    const variantField = field("Variante", modelVariantSelect, {
      hint: "Variante del modelo elegido.",
    });
    const agentField = field("Agente", agentSelect, {
      hint: "Agente primario del catálogo de opencode.",
    });
    const agentCustomField = field("Agente personalizado", agentCustomInput, {
      hint: "Se usa si el catálogo no está disponible.",
    });

    const opencodeFields = h(
      "div",
      { class: "form-grid" },
      formField("Prompt", promptInput, {
        field: "prompt",
        full: true,
        hint: "Texto que se envía a opencode en cada ejecución.",
      }),
      modelField,
      modelCustomField,
      variantField,
      agentField,
      agentCustomField,
      modelError,
      agentError,
      optionsNotice,
      h("div", { class: "options-actions field-full" }, optionsRefreshButton),
    );

    const shellFields = h(
      "div",
      { class: "form-grid" },
      formField("Comando", commandInput, {
        field: "command",
        full: true,
        hint: "Se ejecuta con sh -lc.",
      }),
      formField("Directorio de trabajo", cwdInput, {
        field: "cwd",
        hint: "Ruta absoluta donde se ejecuta el comando.",
      }),
    );

    const cronGroup = h(
      "div",
      { class: "form-grid" },
      field("Plantilla", cronPresetSelect, {
        full: true,
        hint: "Rellena los cinco campos con una programación habitual.",
      }),
      h(
        "div",
        { class: "cron-grid field-full" },
        field("Minuto", cronMinuteInput),
        field("Hora", cronHourInput),
        field("Día del mes", cronDayOfMonthInput),
        field("Mes", cronMonthInput),
        field("Día de la semana", cronDayOfWeekInput),
      ),
      cronPreview,
      cronAdvancedField,
      cronRawField,
      cronMinuteList,
      cronHourList,
      cronDayOfMonthList,
      cronMonthList,
      cronDayOfWeekList,
    );

    const intervalGroup = h(
      "div",
      { class: "form-grid" },
      field("Cada", intervalValueInput, {}),
      field("Unidad", intervalUnitSelect, {}),
    );
    const onceGroup = h(
      "div",
      { class: "form-grid" },
      field("Fecha y hora", onceInput, {
        full: true,
        hint: "Se interpreta en la zona horaria local y se guarda en UTC.",
      }),
    );

    const formError = h("div", {
      class: "form-error",
      attrs: { hidden: true, role: "alert" },
    });

    const submitButton = button("Guardar", undefined, { variant: "primary", type: "submit" });
    const cancelHref = isEdit && job !== null ? `#/jobs/${encodeURIComponent(job.id)}` : "#/";
    const cancelLink = h("a", {
      class: "btn btn-ghost",
      text: "Cancelar",
      attrs: { href: cancelHref },
    });

    const form = h(
      "form",
      { class: "form", attrs: { novalidate: true } },
      formError,
      h(
        "section",
        { class: "form-section" },
        h("h2", { class: "form-section-title", text: "Básico" }),
        h(
          "div",
          { class: "form-grid" },
          formField("Nombre", nameInput, { field: "name", full: true }),
          checkboxField("Activo", enabledInput, { field: "enabled" }),
          formField("Ejecutor", runnerSelect, { field: "runner" }),
        ),
      ),
      h(
        "section",
        { class: "form-section" },
        h("h2", { class: "form-section-title", text: "Configuración del ejecutor" }),
        opencodeFields,
        shellFields,
      ),
      h(
        "section",
        { class: "form-section" },
        h("h2", { class: "form-section-title", text: "Programación" }),
        h(
          "div",
          { class: "form-grid" },
          formField("Repetición", scheduleKindSelect, { field: "scheduleKind" }),
          timezoneField,
        ),
        timezoneDatalist,
        h("div", { class: "schedule-groups" }, cronGroup, intervalGroup, onceGroup),
        errorSlot("scheduleExpr"),
      ),
      h(
        "section",
        { class: "form-section" },
        h("h2", { class: "form-section-title", text: "Ejecución" }),
        h(
          "div",
          { class: "form-grid" },
          formField("Si el equipo estuvo apagado", catchUpSelect, { field: "catchUp" }),
          formField("Límite de recuperación", catchUpLimitInput, {
            field: "catchUpLimit",
            hint: "Entre 1 y 100 ejecuciones.",
          }),
          formField("Si ya hay una ejecución en curso", overlapSelect, { field: "overlap" }),
          formField("Tiempo máximo (segundos)", timeoutInput, {
            field: "timeoutSec",
            hint: "Entre 1 y 86400.",
          }),
          formField("Sesión", sessionModeSelect, { field: "sessionMode" }),
          formField("ID de sesión", sessionIdInput, {
            field: "sessionId",
            hint: "Se rellena solo; déjalo vacío para empezar de cero.",
          }),
          formField("Argumentos", argsInput, {
            field: "args",
            full: true,
            hint: "Opcional. Uno por línea; se guardan con el cron.",
          }),
        ),
      ),
      h(
        "section",
        { class: "form-section" },
        h("h2", { class: "form-section-title", text: "Notificación" }),
        h(
          "div",
          { class: "form-grid" },
          checkboxField("Avisar al terminar", notifyInput, { field: "notify" }),
          formField("Cuándo avisar", notifyOnSelect, { field: "notifyOn" }),
        ),
      ),
      h("div", { class: "form-actions" }, cancelLink, submitButton),
    );

    const controls: Record<string, HTMLElement> = {
      name: nameInput,
      enabled: enabledInput,
      runner: runnerSelect,
      prompt: promptInput,
      model: modelCustomInput,
      agent: agentCustomInput,
      command: commandInput,
      cwd: cwdInput,
      args: argsInput,
      scheduleKind: scheduleKindSelect,
      timezone: timezoneInput,
      catchUp: catchUpSelect,
      catchUpLimit: catchUpLimitInput,
      overlap: overlapSelect,
      timeoutSec: timeoutInput,
      sessionMode: sessionModeSelect,
      sessionId: sessionIdInput,
      notify: notifyInput,
      notifyOn: notifyOnSelect,
    };

    let catalog: OpencodeOptions | null = null;
    let catalogLoading = false;

    function catalogAvailable(): boolean {
      return catalog !== null && catalog.available;
    }

    function findModel(id: string): OpencodeModelOption | undefined {
      return catalog?.models.find((model) => model.id === id);
    }

    function findAgent(id: string): OpencodeAgentOption | undefined {
      return catalog?.agents.find((agent) => agent.id === id);
    }

    function populateModelSelect(options: OpencodeOptions): void {
      modelSelect.replaceChildren(
        h("option", { text: "Predeterminado del sistema", attrs: { value: "" } }),
      );

      const groups = new Map<string, OpencodeModelOption[]>();
      for (const model of options.models) {
        const group = groups.get(model.provider);
        if (group === undefined) {
          groups.set(model.provider, [model]);
        } else {
          group.push(model);
        }
      }

      for (const [provider, models] of groups) {
        modelSelect.append(
          h(
            "optgroup",
            { attrs: { label: provider } },
            ...models.map((model) =>
              h("option", {
                text: optionLabel(model.id, model.name),
                attrs: { value: model.id },
              }),
            ),
          ),
        );
      }

      modelSelect.append(h("option", { text: "Personalizado…", attrs: { value: "__custom__" } }));
    }

    function populateAgentSelect(options: OpencodeOptions): void {
      agentSelect.replaceChildren(
        h("option", { text: "Predeterminado", attrs: { value: "" } }),
        ...options.agents.map((agent) =>
          h("option", {
            text: optionLabel(agent.id, agent.name),
            attrs: { value: agent.id },
          }),
        ),
        h("option", { text: "Personalizado…", attrs: { value: "__custom__" } }),
      );
    }

    function populateVariants(model: OpencodeModelOption | undefined): void {
      modelVariantSelect.replaceChildren(
        h("option", { text: "Predeterminada", attrs: { value: "" } }),
        ...(model?.variants ?? []).map((variant) =>
          h("option", { text: variant, attrs: { value: variant } }),
        ),
      );
      modelVariantSelect.value = "";
    }

    /**
     * Selects the saved variant, adding it when the catalog no longer lists it.
     * The extra option only lives for the current model: changing model rebuilds
     * the list from `populateVariants` and drops it.
     */
    function selectSavedVariant(model: OpencodeModelOption, variant: string | null): void {
      populateVariants(model);
      if (variant !== null && !model.variants.includes(variant)) {
        modelVariantSelect.append(h("option", { text: variant, attrs: { value: variant } }));
      }
      modelVariantSelect.value = variant ?? "";
    }

    function currentModelValue(): string | null {
      if (!catalogAvailable() || modelSelect.value === "__custom__") {
        return trimOrNull(modelCustomInput.value);
      }
      if (modelSelect.value.length === 0) {
        return null;
      }
      return composeModelValue(modelSelect.value, modelVariantSelect.value);
    }

    function currentAgentValue(): string | null {
      if (!catalogAvailable() || agentSelect.value === "__custom__") {
        return trimOrNull(agentCustomInput.value);
      }
      return trimOrNull(agentSelect.value);
    }

    function applyModelValue(value: string | null): void {
      const { base, variant } = splitModelValue(value);
      const model = base.length > 0 ? findModel(base) : undefined;

      if (model !== undefined) {
        modelSelect.value = model.id;
        selectSavedVariant(model, variant);
        modelCustomInput.value = value ?? "";
        return;
      }

      if (base.length === 0) {
        modelSelect.value = "";
        populateVariants(undefined);
        modelCustomInput.value = "";
        return;
      }

      modelSelect.value = "__custom__";
      populateVariants(undefined);
      modelCustomInput.value = value ?? "";
    }

    function applyAgentValue(value: string | null): void {
      if (value === null || value.length === 0) {
        agentSelect.value = "";
        agentCustomInput.value = "";
        return;
      }

      if (findAgent(value) !== undefined) {
        agentSelect.value = value;
        agentCustomInput.value = value;
        return;
      }

      agentSelect.value = "__custom__";
      agentCustomInput.value = value;
    }

    function updateCatalogVisibility(): void {
      const available = catalogAvailable();
      const resolved = catalog !== null;

      modelField.hidden = resolved && !available;
      agentField.hidden = resolved && !available;
      variantField.hidden = resolved && !available;
      modelCustomField.hidden = available && modelSelect.value !== "__custom__";
      agentCustomField.hidden = available && agentSelect.value !== "__custom__";

      if (!available) {
        modelCustomField.hidden = false;
        agentCustomField.hidden = false;
      }
    }

    function syncCatalogControls(): void {
      const available = catalogAvailable();
      modelSelect.disabled = catalogLoading || !available;
      agentSelect.disabled = catalogLoading || !available;
      optionsRefreshButton.disabled = catalogLoading;

      const model = findModel(modelSelect.value);
      modelVariantSelect.disabled =
        catalogLoading ||
        !available ||
        model === undefined ||
        modelVariantSelect.options.length <= 1;
    }

    function applyCatalog(options: OpencodeOptions): void {
      const modelValue = currentModelValue();
      const agentValue = currentAgentValue();
      catalog = options;

      if (options.available) {
        populateModelSelect(options);
        populateAgentSelect(options);
        applyModelValue(modelValue);
        applyAgentValue(agentValue);
        optionsNotice.textContent = "";
        optionsNotice.hidden = true;
      } else {
        modelCustomInput.value = modelValue ?? "";
        agentCustomInput.value = agentValue ?? "";
        optionsNotice.textContent = options.reason ?? "No se pudo leer el catálogo de opencode.";
        optionsNotice.hidden = false;
      }

      updateCatalogVisibility();
      syncCatalogControls();
    }

    async function loadOptions(refresh: boolean): Promise<void> {
      if (catalogLoading) {
        return;
      }

      catalogLoading = true;
      syncCatalogControls();
      try {
        const options = await ctx.api.opencodeOptions(refresh);
        if (disposed) {
          return;
        }
        applyCatalog(options);
      } catch (error) {
        if (disposed) {
          return;
        }
        applyCatalog({
          available: false,
          reason: messageFromError(error),
          models: [],
          agents: [],
        });
      } finally {
        catalogLoading = false;
        if (!disposed) {
          syncCatalogControls();
          updateCatalogVisibility();
        }
      }
    }

    function updateRunnerFields(): void {
      const runner: RunnerKind = runnerSelect.value === "shell" ? "shell" : "opencode";
      opencodeFields.hidden = runner !== "opencode";
      shellFields.hidden = runner !== "shell";
      promptInput.required = runner === "opencode";
      commandInput.required = runner === "shell";
      cwdInput.required = runner === "shell";
    }

    function updateScheduleFields(): void {
      const kind = scheduleKindSelect.value;
      cronGroup.hidden = kind !== "cron";
      intervalGroup.hidden = kind !== "interval";
      onceGroup.hidden = kind !== "once";
    }

    function updateCatchUpLimit(): void {
      catchUpLimitInput.disabled = catchUpSelect.value === "none";
    }

    function updateNotifyOn(): void {
      notifyOnSelect.disabled = !notifyInput.checked;
    }

    function readCronFields(): CronFields {
      return {
        minute: cronMinuteInput.value,
        hour: cronHourInput.value,
        dayOfMonth: cronDayOfMonthInput.value,
        month: cronMonthInput.value,
        dayOfWeek: cronDayOfWeekInput.value,
      };
    }

    function writeCronFields(fields: CronFields): void {
      cronMinuteInput.value = fields.minute;
      cronHourInput.value = fields.hour;
      cronDayOfMonthInput.value = fields.dayOfMonth;
      cronMonthInput.value = fields.month;
      cronDayOfWeekInput.value = fields.dayOfWeek;
    }

    function updateCronPreview(): void {
      if (cronAdvancedInput.checked) {
        const parsed = parseCron(cronRawInput.value);
        cronPreview.textContent =
          parsed === null
            ? "La expresión actual no se pudo dividir en cinco campos; revísala."
            : `Se ejecutará: ${describeCron(parsed)}`;
        return;
      }
      cronPreview.textContent = `Se ejecutará: ${describeCron(readCronFields())}`;
    }

    function syncCronPreset(): void {
      cronPresetSelect.value = presetIdFor(composeCron(readCronFields()));
    }

    function updateCronRawVisibility(): void {
      cronRawField.hidden = !cronAdvancedInput.checked;
    }

    function handleCronPresetChange(): void {
      const preset = CRON_PRESETS.find((item) => item.id === cronPresetSelect.value);
      if (preset === undefined) {
        return;
      }
      const fields = parseCron(preset.expr);
      if (fields === null) {
        return;
      }
      writeCronFields(fields);
      if (cronAdvancedInput.checked) {
        cronRawInput.value = composeCron(fields);
      }
      setFieldError(form, "scheduleExpr", null);
      updateCronPreview();
    }

    function handleCronAdvancedChange(): void {
      if (cronAdvancedInput.checked) {
        cronRawInput.value = composeCron(readCronFields());
        updateCronRawVisibility();
        setFieldError(form, "scheduleExpr", null);
        updateCronPreview();
        return;
      }

      const parsed = parseCron(cronRawInput.value);
      if (parsed === null) {
        cronAdvancedInput.checked = true;
        updateCronRawVisibility();
        setFieldError(form, "scheduleExpr", "La expresión cron debe tener cinco campos.");
        updateCronPreview();
        cronRawInput.focus();
        return;
      }

      writeCronFields(parsed);
      syncCronPreset();
      updateCronRawVisibility();
      setFieldError(form, "scheduleExpr", null);
      updateCronPreview();
    }

    function handleModelChange(): void {
      if (modelSelect.value === "__custom__") {
        populateVariants(undefined);
      } else {
        populateVariants(findModel(modelSelect.value));
      }
      updateCatalogVisibility();
      syncCatalogControls();
    }

    function handleAgentChange(): void {
      updateCatalogVisibility();
      syncCatalogControls();
    }

    function updateTimezoneInfo(): void {
      const zone = timezoneInput.value.trim();
      const info = timezoneInfo(zone);
      // Show the zone id too, so the offset is unambiguous (UTC vs GMT+0).
      const label = zone.length > 0 ? ` en ${zone}` : "";
      timezoneInfoElement.textContent = `Ahora son las ${info.time}${label} (${info.offset})`;
    }

    function readModelValue(): string | null {
      if (!catalogAvailable() || modelSelect.value === "__custom__") {
        return trimOrNull(modelCustomInput.value);
      }
      return composeModelValue(modelSelect.value, modelVariantSelect.value);
    }

    function readAgentValue(): string | null {
      if (!catalogAvailable() || agentSelect.value === "__custom__") {
        return trimOrNull(agentCustomInput.value);
      }
      return trimOrNull(agentSelect.value);
    }

    function controlFor(fieldName: string): HTMLElement | null {
      if (fieldName === "model") {
        const manual = !catalogAvailable() || modelSelect.value === "__custom__";
        return manual ? modelCustomInput : modelSelect;
      }
      if (fieldName === "agent") {
        const manual = !catalogAvailable() || agentSelect.value === "__custom__";
        return manual ? agentCustomInput : agentSelect;
      }
      if (fieldName === "scheduleExpr") {
        if (scheduleKindSelect.value === "interval") {
          return intervalValueInput;
        }
        if (scheduleKindSelect.value === "once") {
          return onceInput;
        }
        if (cronAdvancedInput.checked) {
          return cronRawInput;
        }
        const invalid = cronFieldInputs.find((input) => {
          const value = input.value.trim();
          return value.length === 0 || /\s/.test(value);
        });
        return invalid ?? cronMinuteInput;
      }
      return controls[fieldName] ?? null;
    }

    function showGeneralError(message: string): void {
      formError.textContent = message;
      formError.hidden = false;
    }

    function hideGeneralError(): void {
      formError.textContent = "";
      formError.hidden = true;
    }

    let submitting = false;

    function buildInput(): BuildOutcome {
      const name = nameInput.value.trim();
      if (name.length === 0) {
        return failure("name", "El nombre es obligatorio.");
      }
      if (name.length > 100) {
        return failure("name", "El nombre no puede superar los 100 caracteres.");
      }

      const runner: RunnerKind = runnerSelect.value === "shell" ? "shell" : "opencode";
      const prompt = promptInput.value.trim();
      const command = commandInput.value.trim();
      const cwd = cwdInput.value.trim();
      if (runner === "opencode" && prompt.length === 0) {
        return failure("prompt", "El prompt es obligatorio para el ejecutor opencode.");
      }
      if (runner === "shell" && command.length === 0) {
        return failure("command", "El comando es obligatorio para el ejecutor shell.");
      }
      if (runner === "shell" && cwd.length === 0) {
        return failure("cwd", "El directorio de trabajo es obligatorio.");
      }

      const args = argsInput.value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const model = readModelValue();
      const agent = readAgentValue();
      const sessionId = sessionIdInput.value.trim();

      const scheduleKind: ScheduleKind =
        scheduleKindSelect.value === "interval"
          ? "interval"
          : scheduleKindSelect.value === "once"
            ? "once"
            : "cron";

      let scheduleExpr: string;
      if (scheduleKind === "cron") {
        scheduleExpr = cronAdvancedInput.checked
          ? cronRawInput.value.trim()
          : composeCron(readCronFields()).trim();
        if (parseCron(scheduleExpr) === null) {
          return failure("scheduleExpr", "La expresión cron debe tener cinco campos.");
        }
      } else if (scheduleKind === "interval") {
        const raw = intervalValueInput.value.trim();
        if (!/^\d+$/.test(raw)) {
          return failure("scheduleExpr", "El intervalo debe ser un número entero.");
        }
        const amount = Number(raw);
        if (!Number.isSafeInteger(amount) || amount < 1) {
          return failure("scheduleExpr", "El intervalo debe ser mayor o igual que 1.");
        }
        scheduleExpr = `${amount}${intervalUnitSelect.value === "h" ? "h" : "m"}`;
      } else {
        const raw = onceInput.value.trim();
        if (raw.length === 0) {
          return failure("scheduleExpr", "La fecha única es obligatoria.");
        }
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) {
          return failure("scheduleExpr", "La fecha única no es válida.");
        }
        scheduleExpr = date.toISOString();
      }

      const timezone = timezoneInput.value.trim();
      if (timezone.length === 0) {
        return failure("timezone", "La zona horaria es obligatoria.");
      }

      const catchUpLimit = Number(catchUpLimitInput.value);
      if (!Number.isInteger(catchUpLimit) || catchUpLimit < 1 || catchUpLimit > 100) {
        return failure("catchUpLimit", "El límite de recuperación debe estar entre 1 y 100.");
      }

      const timeoutSec = Number(timeoutInput.value);
      if (!Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > 86400) {
        return failure("timeoutSec", "El tiempo máximo debe estar entre 1 y 86400 segundos.");
      }

      const catchUp: CatchUpPolicy =
        catchUpSelect.value === "none" ? "none" : catchUpSelect.value === "all" ? "all" : "once";
      const overlap: OverlapPolicy =
        overlapSelect.value === "queue"
          ? "queue"
          : overlapSelect.value === "kill"
            ? "kill"
            : "skip";
      const sessionMode: SessionMode =
        sessionModeSelect.value === "continuous" ? "continuous" : "independent";
      const notifyOn: NotifyOn =
        notifyOnSelect.value === "failure"
          ? "failure"
          : notifyOnSelect.value === "success"
            ? "success"
            : "always";

      const input: JobInput = {
        name,
        enabled: enabledInput.checked,
        runner,
        prompt: runner === "opencode" ? prompt : null,
        command: runner === "shell" ? command : null,
        args,
        model,
        agent,
        sessionMode,
        sessionId: sessionId.length > 0 ? sessionId : null,
        scheduleKind,
        scheduleExpr,
        timezone,
        catchUp,
        catchUpLimit,
        overlap,
        timeoutSec,
        notify: notifyInput.checked,
        notifyOn,
      };
      if (cwd.length > 0) {
        input.cwd = cwd;
      }
      return { ok: true, input };
    }

    async function submit(): Promise<void> {
      if (submitting) {
        return;
      }
      hideGeneralError();
      clearFieldErrors(form);

      const outcome = buildInput();
      if (!outcome.ok) {
        if (outcome.field !== undefined) {
          setFieldError(form, outcome.field, outcome.message);
          controlFor(outcome.field)?.focus();
        } else {
          showGeneralError(outcome.message);
        }
        return;
      }

      submitting = true;
      submitButton.disabled = true;
      submitButton.textContent = "Guardando…";
      try {
        if (job === null) {
          await ctx.api.createJob(outcome.input);
        } else {
          await ctx.api.updateJob(job.id, outcome.input);
        }
        if (disposed) {
          return;
        }
        ctx.notify(job === null ? "Cron creado." : "Cron actualizado.", "success");
        ctx.navigate("#/");
      } catch (error) {
        if (error instanceof ApiError && error.field !== undefined) {
          setFieldError(form, error.field, error.message);
          controlFor(error.field)?.focus();
        } else {
          showGeneralError(messageFromError(error));
        }
      } finally {
        submitting = false;
        submitButton.disabled = false;
        submitButton.textContent = "Guardar";
      }
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submit();
    });

    form.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const fieldName = target.getAttribute("name");
      if (fieldName !== null) {
        setFieldError(form, fieldName, null);
      }
      if (target === timezoneInput) {
        updateTimezoneInfo();
      } else if (target === cronRawInput) {
        updateCronPreview();
      } else if (target instanceof HTMLInputElement && cronFieldInputs.includes(target)) {
        syncCronPreset();
        updateCronPreview();
      }
      hideGeneralError();
    });

    form.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target === runnerSelect) {
        updateRunnerFields();
        clearFieldErrors(form);
      } else if (target === scheduleKindSelect) {
        updateScheduleFields();
        setFieldError(form, "scheduleExpr", null);
      } else if (target === catchUpSelect) {
        updateCatchUpLimit();
      } else if (target === notifyInput) {
        updateNotifyOn();
      } else if (target === modelSelect) {
        handleModelChange();
        setFieldError(form, "model", null);
      } else if (target === agentSelect) {
        handleAgentChange();
        setFieldError(form, "agent", null);
      } else if (target === cronPresetSelect) {
        handleCronPresetChange();
      } else if (target === cronAdvancedInput) {
        handleCronAdvancedChange();
      } else if (target === timezoneInput) {
        updateTimezoneInfo();
        setFieldError(form, "timezone", null);
      } else {
        const fieldName = target.getAttribute("name");
        if (fieldName !== null) {
          setFieldError(form, fieldName, null);
        }
      }
      hideGeneralError();
    });

    updateRunnerFields();
    updateScheduleFields();
    updateCatchUpLimit();
    updateNotifyOn();
    updateTimezoneInfo();
    updateCronRawVisibility();
    updateCronPreview();

    content.replaceChildren(
      pageHeader(
        isEdit ? "Editar cron" : "Nuevo cron",
        isEdit ? "Cambia la configuración y guarda" : "Programa una tarea nueva",
      ),
      form,
    );

    void loadOptions(false);
  }

  void load();

  return {
    element,
    dispose: () => {
      disposed = true;
    },
  };
}
