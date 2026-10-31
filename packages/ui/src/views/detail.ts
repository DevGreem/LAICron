import { ApiError, messageFromError } from "../api.js";
import type { AppContext, View } from "../context.js";
import type { Child } from "../dom.js";
import { button, h } from "../dom.js";
import {
  CATCH_UP_LABELS,
  formatCost,
  formatDateTime,
  formatDuration,
  formatTokens,
  NOTIFY_ON_LABELS,
  OVERLAP_LABELS,
  RUNNER_LABELS,
  RUN_TRIGGER_LABELS,
  SESSION_MODE_LABELS,
  scheduleSummary,
} from "../format.js";
import type { Job, JobUsage, Message, MessagePage, Run, RunPage } from "../types.js";
import {
  emptyPanel,
  enabledBadge,
  errorPanel,
  loadingView,
  pageHeader,
  statusBadge,
} from "./common.js";

const RUNS_LIMIT = 20;
const MESSAGES_LIMIT = 100;

function pageInfo(offset: number, count: number, total: number): string {
  if (total === 0 || count === 0) {
    return "Sin resultados";
  }
  return `Mostrando ${offset + 1}–${offset + count} de ${total}`;
}

function paginationBar(
  info: string,
  previous: (() => void) | null,
  next: (() => void) | null,
  previousLabel: string,
  nextLabel: string,
): HTMLElement {
  return h(
    "div",
    { class: "pagination" },
    button(previousLabel, previous ?? undefined, {
      variant: "ghost",
      small: true,
      disabled: previous === null,
    }),
    h("span", { class: "pagination-info", text: info }),
    button(nextLabel, next ?? undefined, {
      variant: "ghost",
      small: true,
      disabled: next === null,
    }),
  );
}

function runRow(run: Run): HTMLElement {
  const errorCell = h("td", { class: "error-cell", text: run.error ?? "—" });
  if (run.error !== null) {
    errorCell.title = run.error;
  }

  const hasTokens = run.inputTokens !== null || run.outputTokens !== null;
  const tokensText = hasTokens
    ? formatTokens((run.inputTokens ?? 0) + (run.outputTokens ?? 0))
    : "—";
  const costText = run.costUsd === null ? "—" : formatCost(run.costUsd);

  return h(
    "tr",
    {},
    h("td", {}, statusBadge(run.status)),
    h("td", { text: RUN_TRIGGER_LABELS[run.trigger] }),
    h("td", { text: formatDateTime(run.startedAt) }),
    h("td", { text: formatDuration(run.durationMs) }),
    h("td", { class: "mono usage-cell", text: tokensText }),
    h("td", { class: "mono usage-cell", text: costText }),
    h("td", { class: "mono", text: run.exitCode === null ? "—" : String(run.exitCode) }),
    errorCell,
  );
}

function messageBubble(message: Message): HTMLElement {
  const isUser = message.role === "user";
  return h(
    "article",
    { class: `message ${message.role}` },
    h(
      "header",
      { class: "message-meta" },
      h("span", { class: "message-role", text: isUser ? "Usuario" : "Asistente" }),
      h("span", { class: "muted small", text: formatDateTime(message.createdAt) }),
    ),
    h("p", { class: "message-content", text: message.content }),
  );
}

/** Detail screen: job data, paginated run history and chat. */
export function createDetailView(ctx: AppContext, jobId: string): View {
  const element = h("section", { class: "view" });
  const content = h("div", { class: "view-content" });
  element.append(content);
  let generation = 0;
  let disposed = false;
  let hasData = false;
  let runsOffset = 0;
  let messagesOffset: number | null = null;

  async function loadMessages(): Promise<MessagePage> {
    const first = await ctx.api.listMessages(jobId, {
      limit: MESSAGES_LIMIT,
      offset: messagesOffset ?? 0,
    });
    if (messagesOffset !== null || first.total <= MESSAGES_LIMIT) {
      return first;
    }
    // The API lists messages oldest-first; show the newest page by default.
    return ctx.api.listMessages(jobId, {
      limit: MESSAGES_LIMIT,
      offset: first.total - MESSAGES_LIMIT,
    });
  }

  function renderError(error: unknown): void {
    const notFound = error instanceof ApiError && error.status === 404;
    content.replaceChildren(
      pageHeader("Detalle del cron", null),
      errorPanel(
        notFound ? "No se encontró el cron." : messageFromError(error),
        notFound
          ? undefined
          : () => {
              void refresh();
            },
      ),
      h("a", { class: "btn", text: "Volver a la lista", attrs: { href: "#/" } }),
    );
  }

  async function perform(trigger: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
    trigger.disabled = true;
    try {
      await action();
    } catch (error) {
      ctx.notify(messageFromError(error), "error");
    } finally {
      trigger.disabled = false;
    }
  }

  function detailsList(job: Job): HTMLElement {
    const list = h("dl", { class: "details" });
    const add = (term: string, value: Child): void => {
      list.append(h("dt", { text: term }), h("dd", {}, value));
    };

    add("Estado", enabledBadge(job.enabled));
    add("Ejecutor", RUNNER_LABELS[job.runner]);
    add("Programación", scheduleSummary(job));
    add("Zona horaria", job.timezone);
    add("Próxima ejecución", formatDateTime(job.nextRunAt));
    add("Última ejecución", formatDateTime(job.lastRunAt));
    add("Último estado", statusBadge(job.lastStatus));
    add("Recuperación", `${CATCH_UP_LABELS[job.catchUp]} (límite ${job.catchUpLimit})`);
    add("Solapamiento", OVERLAP_LABELS[job.overlap]);
    add("Tiempo máximo", `${job.timeoutSec} s`);
    add(
      "Notificaciones",
      job.notify ? `Sí (${NOTIFY_ON_LABELS[job.notifyOn].toLowerCase()})` : "No",
    );
    add(
      "Sesión",
      job.sessionId === null
        ? SESSION_MODE_LABELS[job.sessionMode]
        : `${SESSION_MODE_LABELS[job.sessionMode]} (${job.sessionId})`,
    );
    add("Creado", formatDateTime(job.createdAt));
    add("Actualizado", formatDateTime(job.updatedAt));

    if (job.runner === "opencode") {
      add("Prompt", h("pre", { class: "code-block", text: job.prompt ?? "" }));
      add("Modelo", job.model ?? "—");
      add("Agente", job.agent ?? "—");
    } else {
      add("Comando", h("pre", { class: "code-block", text: job.command ?? "" }));
      add("Directorio", job.cwd);
    }
    if (job.args.length > 0) {
      add("Argumentos", job.args.join(" "));
    }

    return list;
  }

  function section(title: string, meta: string | null, ...children: Child[]): HTMLElement {
    return h(
      "section",
      { class: "section" },
      h(
        "div",
        { class: "section-header" },
        h("h2", { class: "section-title", text: title }),
        meta === null ? null : h("span", { class: "muted small", text: meta }),
      ),
      ...children,
    );
  }

  function runsSection(page: RunPage): HTMLElement {
    const meta = page.total === 1 ? "1 ejecución" : `${page.total} ejecuciones`;
    if (page.runs.length === 0) {
      return section("Historial de ejecuciones", meta, emptyPanel("Todavía no hay ejecuciones."));
    }

    const table = h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h("caption", { class: "sr-only", text: "Historial de ejecuciones" }),
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { text: "Estado", attrs: { scope: "col" } }),
            h("th", { text: "Disparador", attrs: { scope: "col" } }),
            h("th", { text: "Inicio", attrs: { scope: "col" } }),
            h("th", { text: "Duración", attrs: { scope: "col" } }),
            h("th", { text: "Tokens", attrs: { scope: "col" } }),
            h("th", { text: "Coste", attrs: { scope: "col" } }),
            h("th", { text: "Código de salida", attrs: { scope: "col" } }),
            h("th", { text: "Error", attrs: { scope: "col" } }),
          ),
        ),
        h("tbody", {}, ...page.runs.map((run) => runRow(run))),
      ),
    );

    const previous =
      runsOffset > 0
        ? (): void => {
            runsOffset = Math.max(0, runsOffset - RUNS_LIMIT);
            void refresh();
          }
        : null;
    const next =
      runsOffset + RUNS_LIMIT < page.total
        ? (): void => {
            runsOffset += RUNS_LIMIT;
            void refresh();
          }
        : null;

    return section(
      "Historial de ejecuciones",
      meta,
      table,
      paginationBar(
        pageInfo(page.offset, page.runs.length, page.total),
        previous,
        next,
        "Más recientes",
        "Más antiguas",
      ),
    );
  }

  function usageSection(job: Job, usage: JobUsage): HTMLElement {
    const card = h("div", { class: "usage-card", attrs: { id: "job-usage" } });

    if (usage.runsWithUsage === 0) {
      card.append(h("p", { class: "usage-empty", text: "Todavía no hay datos de consumo." }));
    } else {
      card.append(
        h(
          "div",
          { class: "usage-grid" },
          h(
            "div",
            { class: "usage-metric" },
            h("span", { class: "usage-label", text: "Coste total" }),
            h("span", { class: "usage-cost", text: formatCost(usage.costUsd) }),
          ),
          h(
            "div",
            { class: "usage-metric" },
            h("span", { class: "usage-label", text: "Tokens" }),
            h("span", {
              class: "usage-tokens",
              text: formatTokens(usage.inputTokens + usage.outputTokens),
            }),
          ),
          h("span", {
            class: "usage-breakdown",
            text: `Entrada ${formatTokens(usage.inputTokens)} · Salida ${formatTokens(usage.outputTokens)}`,
          }),
        ),
        h("p", {
          class: "usage-runs",
          text: `${usage.runsWithUsage} de ${usage.runs} ejecuciones con datos`,
        }),
      );
    }

    if (job.sessionMode === "continuous") {
      card.append(
        h("p", {
          class: "usage-note",
          text: "En modo continuo, la entrada incluye el historial de la sesión.",
        }),
      );
    }

    return section("Consumo", null, card);
  }

  function chatSection(page: MessagePage): HTMLElement {
    const meta = page.total === 1 ? "1 mensaje" : `${page.total} mensajes`;
    if (page.messages.length === 0) {
      return section(
        "Chat",
        meta,
        emptyPanel("Todavía no hay mensajes. Aparecerán aquí tras cada ejecución."),
      );
    }

    const previous =
      page.offset > 0
        ? (): void => {
            messagesOffset = Math.max(0, page.offset - MESSAGES_LIMIT);
            void refresh();
          }
        : null;
    const nextOffset = page.offset + MESSAGES_LIMIT;
    const next =
      nextOffset < page.total
        ? (): void => {
            messagesOffset = nextOffset + MESSAGES_LIMIT >= page.total ? null : nextOffset;
            void refresh();
          }
        : null;

    return section(
      "Chat",
      meta,
      h("div", { class: "chat" }, ...page.messages.map((message) => messageBubble(message))),
      paginationBar(
        pageInfo(page.offset, page.messages.length, page.total),
        previous,
        next,
        "Anteriores",
        "Siguientes",
      ),
    );
  }

  function render(job: Job, runsPage: RunPage, messagesPage: MessagePage, usage: JobUsage): void {
    hasData = true;
    const backLink = h("a", {
      class: "btn btn-ghost",
      text: "Volver a la lista",
      attrs: { href: "#/" },
    });
    const editLink = h("a", {
      class: "btn",
      text: "Editar",
      attrs: { href: `#/jobs/${encodeURIComponent(job.id)}/edit` },
    });
    const toggleButton = button(
      job.enabled ? "Pausar" : "Reanudar",
      () => {
        void perform(toggleButton, async () => {
          if (job.enabled) {
            await ctx.api.pauseJob(job.id);
            ctx.notify(`Cron «${job.name}» pausado.`, "success");
          } else {
            await ctx.api.resumeJob(job.id);
            ctx.notify(`Cron «${job.name}» reanudado.`, "success");
          }
          await refresh();
        });
      },
      { variant: "ghost" },
    );
    const runButton = button(
      "Ejecutar ahora",
      () => {
        void perform(runButton, async () => {
          await ctx.api.runJob(job.id);
          ctx.notify(`Ejecución de «${job.name}» iniciada.`, "success");
          await refresh();
        });
      },
      { variant: "primary" },
    );

    content.replaceChildren(
      pageHeader(job.name, `Cron ${job.id}`, [backLink, toggleButton, editLink, runButton]),
      h("div", { class: "panel" }, detailsList(job)),
      usageSection(job, usage),
      runsSection(runsPage),
      chatSection(messagesPage),
    );
  }

  async function refresh(): Promise<void> {
    const current = ++generation;
    try {
      const [job, runsPage, messagesPage, usage] = await Promise.all([
        ctx.api.getJob(jobId),
        ctx.api.listRuns(jobId, { limit: RUNS_LIMIT, offset: runsOffset }),
        loadMessages(),
        ctx.api.getJobUsage(jobId),
      ]);
      if (disposed || current !== generation) {
        return;
      }
      render(job, runsPage, messagesPage, usage);
    } catch (error) {
      if (disposed || current !== generation) {
        return;
      }
      const notFound = error instanceof ApiError && error.status === 404;
      if (hasData && !notFound) {
        // Keep the last good detail visible; the banner already warns about the daemon.
        ctx.notify(messageFromError(error), "error");
        return;
      }
      renderError(error);
    }
  }

  content.append(loadingView());
  void refresh();

  return {
    element,
    refresh,
    dispose: () => {
      disposed = true;
    },
  };
}
