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
import { t } from "../i18n.js";
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
    return t("detail.pageEmpty");
  }
  return t("detail.pageInfo", { from: offset + 1, to: offset + count, total });
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
      h("span", {
        class: "message-role",
        text: isUser ? t("detail.roleUser") : t("detail.roleAssistant"),
      }),
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
      pageHeader(t("detail.title"), null),
      errorPanel(
        notFound ? t("detail.notFound") : messageFromError(error),
        notFound
          ? undefined
          : () => {
              void refresh();
            },
      ),
      h("a", { class: "btn", text: t("detail.back"), attrs: { href: "#/" } }),
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

    add(t("detail.termStatus"), enabledBadge(job.enabled));
    add(t("detail.termRunner"), RUNNER_LABELS[job.runner]);
    add(t("detail.termSchedule"), scheduleSummary(job));
    add(t("detail.termTimezone"), job.timezone);
    add(t("detail.termNextRun"), formatDateTime(job.nextRunAt));
    add(t("detail.termLastRun"), formatDateTime(job.lastRunAt));
    add(t("detail.termLastStatus"), statusBadge(job.lastStatus));
    add(
      t("detail.termCatchUp"),
      t("detail.catchUpValue", { label: CATCH_UP_LABELS[job.catchUp], limit: job.catchUpLimit }),
    );
    add(t("detail.termOverlap"), OVERLAP_LABELS[job.overlap]);
    add(t("detail.termTimeout"), `${job.timeoutSec} s`);
    add(
      t("detail.termNotifications"),
      job.notify
        ? t("detail.notificationsYes", { when: NOTIFY_ON_LABELS[job.notifyOn].toLowerCase() })
        : t("detail.no"),
    );
    add(
      t("detail.termSession"),
      job.sessionId === null
        ? SESSION_MODE_LABELS[job.sessionMode]
        : `${SESSION_MODE_LABELS[job.sessionMode]} (${job.sessionId})`,
    );
    add(t("detail.termCreated"), formatDateTime(job.createdAt));
    add(t("detail.termUpdated"), formatDateTime(job.updatedAt));

    if (job.runner === "opencode") {
      add(t("detail.termPrompt"), h("pre", { class: "code-block", text: job.prompt ?? "" }));
      add(t("detail.termModel"), job.model ?? "—");
      add(t("detail.termAgent"), job.agent ?? "—");
    } else {
      add(t("detail.termCommand"), h("pre", { class: "code-block", text: job.command ?? "" }));
      add(t("detail.termCwd"), job.cwd);
    }
    if (job.args.length > 0) {
      add(t("detail.termArgs"), job.args.join(" "));
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
    const meta =
      page.total === 1 ? t("detail.runsOne") : t("detail.runsMany", { count: page.total });
    if (page.runs.length === 0) {
      return section(t("detail.runsTitle"), meta, emptyPanel(t("detail.runsEmpty")));
    }

    const table = h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h("caption", { class: "sr-only", text: t("detail.runsTitle") }),
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { text: t("detail.termStatus"), attrs: { scope: "col" } }),
            h("th", { text: t("detail.colTrigger"), attrs: { scope: "col" } }),
            h("th", { text: t("detail.colStart"), attrs: { scope: "col" } }),
            h("th", { text: t("detail.colDuration"), attrs: { scope: "col" } }),
            h("th", { text: t("detail.colTokens"), attrs: { scope: "col" } }),
            h("th", { text: t("detail.colCost"), attrs: { scope: "col" } }),
            h("th", { text: t("detail.colExitCode"), attrs: { scope: "col" } }),
            h("th", { text: t("detail.colError"), attrs: { scope: "col" } }),
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
      t("detail.runsTitle"),
      meta,
      table,
      paginationBar(
        pageInfo(page.offset, page.runs.length, page.total),
        previous,
        next,
        t("detail.newer"),
        t("detail.older"),
      ),
    );
  }

  function usageSection(job: Job, usage: JobUsage): HTMLElement {
    const card = h("div", { class: "usage-card", attrs: { id: "job-usage" } });

    if (usage.runsWithUsage === 0) {
      card.append(h("p", { class: "usage-empty", text: t("detail.usageEmpty") }));
    } else {
      card.append(
        h(
          "div",
          { class: "usage-grid" },
          h(
            "div",
            { class: "usage-metric" },
            h("span", { class: "usage-label", text: t("detail.usageTotalCost") }),
            h("span", { class: "usage-cost", text: formatCost(usage.costUsd) }),
          ),
          h(
            "div",
            { class: "usage-metric" },
            h("span", { class: "usage-label", text: t("detail.usageTokens") }),
            h("span", {
              class: "usage-tokens",
              text: formatTokens(usage.inputTokens + usage.outputTokens),
            }),
          ),
          h("span", {
            class: "usage-breakdown",
            text: t("detail.usageBreakdown", {
              input: formatTokens(usage.inputTokens),
              output: formatTokens(usage.outputTokens),
            }),
          }),
        ),
        h("p", {
          class: "usage-runs",
          text: t("detail.usageRuns", {
            withData: usage.runsWithUsage,
            runs: usage.runs,
          }),
        }),
      );
    }

    if (job.sessionMode === "continuous") {
      card.append(h("p", { class: "usage-note", text: t("detail.usageNote") }));
    }

    return section(t("detail.usageTitle"), null, card);
  }

  function chatSection(page: MessagePage): HTMLElement {
    const meta =
      page.total === 1 ? t("detail.messagesOne") : t("detail.messagesMany", { count: page.total });
    if (page.messages.length === 0) {
      return section(t("detail.chatTitle"), meta, emptyPanel(t("detail.chatEmpty")));
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
      t("detail.chatTitle"),
      meta,
      h("div", { class: "chat" }, ...page.messages.map((message) => messageBubble(message))),
      paginationBar(
        pageInfo(page.offset, page.messages.length, page.total),
        previous,
        next,
        t("detail.previous"),
        t("detail.next"),
      ),
    );
  }

  function render(job: Job, runsPage: RunPage, messagesPage: MessagePage, usage: JobUsage): void {
    hasData = true;
    const backLink = h("a", {
      class: "btn btn-ghost",
      text: t("detail.back"),
      attrs: { href: "#/" },
    });
    const editLink = h("a", {
      class: "btn",
      text: t("detail.edit"),
      attrs: { href: `#/jobs/${encodeURIComponent(job.id)}/edit` },
    });
    const toggleButton = button(
      job.enabled ? t("list.pause") : t("list.resume"),
      () => {
        void perform(toggleButton, async () => {
          if (job.enabled) {
            await ctx.api.pauseJob(job.id);
            ctx.notify(t("list.pausedToast", { name: job.name }), "success");
          } else {
            await ctx.api.resumeJob(job.id);
            ctx.notify(t("list.resumedToast", { name: job.name }), "success");
          }
          await refresh();
        });
      },
      { variant: "ghost" },
    );
    const runButton = button(
      t("list.runNow"),
      () => {
        void perform(runButton, async () => {
          await ctx.api.runJob(job.id);
          ctx.notify(t("list.startedToast", { name: job.name }), "success");
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
