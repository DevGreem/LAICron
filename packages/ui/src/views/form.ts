import { ApiError, messageFromError } from "../api.js";
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
import type {
  CatchUpPolicy,
  Job,
  JobInput,
  NotifyOn,
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

    const modelInput = h("input", {
      attrs: { id: "job-model", name: "model", type: "text", autocomplete: "off" },
    });
    modelInput.value = job?.model ?? "";

    const agentInput = h("input", {
      attrs: { id: "job-agent", name: "agent", type: "text", autocomplete: "off" },
    });
    agentInput.value = job?.agent ?? "";

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

    const cronInput = h("input", {
      attrs: {
        id: "job-cron-expr",
        name: "scheduleExpr",
        type: "text",
        placeholder: "0 9 * * 1-5",
        autocomplete: "off",
      },
    });
    cronInput.value = job !== null && job.scheduleKind === "cron" ? job.scheduleExpr : "";

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
      attrs: { id: "job-timezone", name: "timezone", type: "text", autocomplete: "off" },
    });
    timezoneInput.value = job?.timezone ?? defaultTimezone;

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

    const opencodeFields = h(
      "div",
      { class: "form-grid" },
      formField("Prompt", promptInput, {
        field: "prompt",
        full: true,
        hint: "Texto que se envía a opencode en cada ejecución.",
      }),
      formField("Modelo", modelInput, {
        field: "model",
        hint: "Opcional. Se pasa a opencode con --model.",
      }),
      formField("Agente", agentInput, {
        field: "agent",
        hint: "Opcional. Se pasa a opencode con --agent.",
      }),
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
      field("Expresión cron", cronInput, {
        full: true,
        hint: "Cinco campos: minuto, hora, día, mes y día de la semana.",
      }),
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
          formField("Zona horaria", timezoneInput, {
            field: "timezone",
            hint: "Nombre IANA, por ejemplo Europe/Madrid.",
          }),
        ),
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
      model: modelInput,
      agent: agentInput,
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

    function controlFor(fieldName: string): HTMLElement | null {
      if (fieldName === "scheduleExpr") {
        if (scheduleKindSelect.value === "interval") {
          return intervalValueInput;
        }
        if (scheduleKindSelect.value === "once") {
          return onceInput;
        }
        return cronInput;
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
      const model = modelInput.value.trim();
      const agent = agentInput.value.trim();
      const sessionId = sessionIdInput.value.trim();

      const scheduleKind: ScheduleKind =
        scheduleKindSelect.value === "interval"
          ? "interval"
          : scheduleKindSelect.value === "once"
            ? "once"
            : "cron";

      let scheduleExpr: string;
      if (scheduleKind === "cron") {
        scheduleExpr = cronInput.value.trim();
        if (scheduleExpr.length === 0) {
          return failure("scheduleExpr", "La expresión cron es obligatoria.");
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
        model: model.length > 0 ? model : null,
        agent: agent.length > 0 ? agent : null,
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
      hideGeneralError();
    });

    form.addEventListener("change", (event) => {
      const target = event.target;
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
      } else if (target instanceof HTMLElement) {
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

    content.replaceChildren(
      pageHeader(
        isEdit ? "Editar cron" : "Nuevo cron",
        isEdit ? "Cambia la configuración y guarda" : "Programa una tarea nueva",
      ),
      form,
    );
  }

  void load();

  return {
    element,
    dispose: () => {
      disposed = true;
    },
  };
}
