import { messageFromError } from "../api.js";
import type { AppContext, View } from "../context.js";
import { button, h } from "../dom.js";
import { formatDateTime, scheduleSummary } from "../format.js";
import { t } from "../i18n.js";
import type { Job } from "../types.js";
import { emptyPanel, errorPanel, loadingView, pageHeader, statusBadge } from "./common.js";

/** Cron list with schedule, next run, last status and row actions. */
export function createListView(ctx: AppContext): View {
  const element = h("section", { class: "view" });
  const content = h("div", { class: "view-content" });
  element.append(content);
  let generation = 0;
  let hasData = false;

  function header(): HTMLElement {
    return pageHeader(
      t("list.title"),
      t("list.subtitle"),
      h("a", { class: "btn btn-primary", text: t("list.create"), attrs: { href: "#/new" } }),
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

  function createRow(job: Job): HTMLElement {
    const detailHref = `#/jobs/${encodeURIComponent(job.id)}`;

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
      { variant: "ghost", small: true },
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
      { variant: "ghost", small: true },
    );

    const deleteButton = button(
      t("list.delete"),
      () => {
        const confirmed = window.confirm(t("list.confirmDelete", { name: job.name }));
        if (!confirmed) {
          return;
        }
        void perform(deleteButton, async () => {
          await ctx.api.deleteJob(job.id);
          ctx.notify(t("list.deletedToast", { name: job.name }), "success");
          await refresh();
        });
      },
      { variant: "danger", small: true },
    );

    return h(
      "tr",
      {},
      h(
        "td",
        {},
        h(
          "div",
          { class: "job-cell" },
          h("a", { class: "job-name", text: job.name, attrs: { href: detailHref } }),
          h(
            "div",
            { class: "job-meta" },
            h("span", { class: "tag", text: job.runner }),
            job.enabled ? null : h("span", { class: "tag tag-paused", text: t("common.paused") }),
          ),
        ),
      ),
      h("td", { class: "muted", text: scheduleSummary(job) }),
      h("td", { text: formatDateTime(job.nextRunAt) }),
      h("td", {}, statusBadge(job.lastStatus)),
      h(
        "td",
        { class: "col-actions" },
        h(
          "div",
          { class: "row-actions" },
          h("a", {
            class: "btn btn-ghost btn-sm",
            text: t("list.detail"),
            attrs: { href: detailHref },
          }),
          runButton,
          toggleButton,
          deleteButton,
        ),
      ),
    );
  }

  function render(jobs: Job[]): void {
    hasData = true;
    if (jobs.length === 0) {
      content.replaceChildren(header(), emptyPanel(t("list.empty")));
      return;
    }

    const table = h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { text: t("list.colName"), attrs: { scope: "col" } }),
            h("th", { text: t("list.colSchedule"), attrs: { scope: "col" } }),
            h("th", { text: t("list.colNextRun"), attrs: { scope: "col" } }),
            h("th", { text: t("list.colLastStatus"), attrs: { scope: "col" } }),
            h("th", { class: "col-actions", text: t("list.colActions"), attrs: { scope: "col" } }),
          ),
        ),
        h("tbody", {}, ...jobs.map((job) => createRow(job))),
      ),
    );

    content.replaceChildren(header(), table);
  }

  async function refresh(): Promise<void> {
    const current = ++generation;
    try {
      const jobs = await ctx.api.listJobs();
      if (current !== generation) {
        return;
      }
      render(jobs);
    } catch (error) {
      if (current !== generation) {
        return;
      }
      if (hasData) {
        // Keep the last good list visible; the banner already warns about the daemon.
        ctx.notify(messageFromError(error), "error");
        return;
      }
      content.replaceChildren(
        header(),
        errorPanel(messageFromError(error), () => {
          void refresh();
        }),
      );
    }
  }

  content.append(loadingView());
  void refresh();

  return { element, refresh };
}
