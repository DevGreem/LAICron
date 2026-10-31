import { button, h } from "../dom.js";
import { RUN_STATUS_LABELS } from "../format.js";
import type { RunStatus } from "../types.js";

/** Page title, optional subtitle and right-aligned actions. */
export function pageHeader(
  title: string,
  subtitle: string | null,
  actions?: HTMLElement | HTMLElement[],
): HTMLElement {
  const actionElements = actions === undefined ? [] : Array.isArray(actions) ? actions : [actions];
  return h(
    "header",
    { class: "page-header" },
    h(
      "div",
      { class: "page-heading" },
      h("h1", { class: "page-title", text: title }),
      subtitle === null ? null : h("p", { class: "page-subtitle", text: subtitle }),
    ),
    actionElements.length === 0 ? null : h("div", { class: "page-actions" }, ...actionElements),
  );
}

export function loadingView(message = "Cargando…"): HTMLElement {
  return h("p", { class: "muted loading", text: message, attrs: { role: "status" } });
}

/** Error card with an optional retry action. */
export function errorPanel(message: string, onRetry?: () => void): HTMLElement {
  const panel = h(
    "div",
    { class: "panel error-panel", attrs: { role: "alert" } },
    h("p", { class: "error-panel-message", text: message }),
  );
  if (onRetry !== undefined) {
    panel.appendChild(button("Reintentar", () => onRetry(), { variant: "ghost" }));
  }
  return panel;
}

export function emptyPanel(message: string): HTMLElement {
  return h("div", { class: "panel empty", text: message });
}

/** Colored run-status badge with the Spanish label. */
export function statusBadge(status: RunStatus | null): HTMLElement {
  const label = status === null ? "Sin ejecuciones" : RUN_STATUS_LABELS[status];
  const className = status === null ? "badge status-none" : `badge status-${status}`;
  return h("span", { class: className, text: label });
}

/** Active / paused badge for a job. */
export function enabledBadge(enabled: boolean): HTMLElement {
  return h("span", {
    class: enabled ? "badge status-success" : "badge status-none",
    text: enabled ? "Activo" : "En pausa",
  });
}
