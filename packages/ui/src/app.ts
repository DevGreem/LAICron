import { ApiClient } from "./api.js";
import type { AppContext, View } from "./context.js";
import { h } from "./dom.js";
import { connectEvents } from "./events.js";
import { startHealthMonitor } from "./health.js";
import { parseRoute, type Route } from "./router.js";
import { captureToken } from "./token.js";
import { createDetailView } from "./views/detail.js";
import { createFormView } from "./views/form.js";
import { createListView } from "./views/list.js";
import { pageHeader } from "./views/common.js";

export const appName = "LAICron";

const REFRESH_DEBOUNCE_MS = 150;
const TOAST_INFO_MS = 5000;
const TOAST_ERROR_MS = 8000;

/** Engine events that can change what the current view shows. */
const REFRESH_EVENTS = new Set([
  "job.created",
  "job.updated",
  "job.deleted",
  "run.queued",
  "run.started",
  "run.finished",
]);

function eventTypeOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const type = (data as Record<string, unknown>)["type"];
  return typeof type === "string" ? type : null;
}

function eventJobId(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;

  const job = record["job"];
  if (typeof job === "object" && job !== null) {
    const id = (job as Record<string, unknown>)["id"];
    if (typeof id === "string") {
      return id;
    }
  }

  const run = record["run"];
  if (typeof run === "object" && run !== null) {
    const jobId = (run as Record<string, unknown>)["jobId"];
    if (typeof jobId === "string") {
      return jobId;
    }
  }

  const jobId = record["jobId"];
  return typeof jobId === "string" ? jobId : null;
}

class App implements AppContext {
  readonly api: ApiClient;
  private readonly viewContainer: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly toasts: HTMLElement;
  private currentView: View | null = null;
  private currentRoute: Route | null = null;
  private refreshTimer: number | null = null;
  private healthy: boolean | null = null;
  private eventsConnected: boolean | null = null;

  constructor(root: HTMLElement, api: ApiClient) {
    this.api = api;
    this.banner = h("div", {
      class: "banner",
      text: "El planificador no responde",
      attrs: { hidden: true, role: "status" },
    });
    this.viewContainer = h("main", { class: "main" });
    this.toasts = h("div", { class: "toasts", attrs: { "aria-live": "polite" } });

    const header = h(
      "header",
      { class: "topbar" },
      h("a", { class: "brand", text: appName, attrs: { href: "#/" } }),
      h("span", { class: "tagline", text: "Planificador local de tareas" }),
    );

    root.replaceChildren(this.banner, header, this.viewContainer, this.toasts);
  }

  start(): void {
    window.addEventListener("hashchange", () => {
      this.renderRoute();
    });

    this.renderRoute();
    startHealthMonitor((healthy) => {
      this.setHealthy(healthy);
    });
    connectEvents(
      this.api.token,
      (type, data) => {
        this.handleEvent(type, data);
      },
      {
        onConnectionChange: (connected) => {
          const wasConnected = this.eventsConnected;
          this.eventsConnected = connected;
          if (connected && wasConnected === false) {
            this.scheduleRefresh();
          }
        },
      },
    );
  }

  navigate(path: string): void {
    const target = path.startsWith("#") ? path : `#${path}`;
    if (window.location.hash === target) {
      this.renderRoute();
      return;
    }
    window.location.hash = target;
  }

  notify(message: string, kind: "info" | "error" | "success" = "info"): void {
    const toast = h("div", {
      class: `toast toast-${kind}`,
      text: message,
      attrs: { role: kind === "error" ? "alert" : "status" },
    });
    this.toasts.append(toast);
    window.setTimeout(
      () => {
        toast.remove();
      },
      kind === "error" ? TOAST_ERROR_MS : TOAST_INFO_MS,
    );
  }

  private setHealthy(healthy: boolean): void {
    if (this.healthy === healthy) {
      return;
    }
    const wasHealthy = this.healthy;
    this.healthy = healthy;
    this.banner.hidden = healthy;
    if (healthy && wasHealthy === false) {
      this.scheduleRefresh();
    }
  }

  private handleEvent(type: string, data: unknown): void {
    const eventType = eventTypeOf(data) ?? type;

    if (eventType === "job.deleted") {
      const jobId = eventJobId(data);
      const route = this.currentRoute;
      if (
        jobId !== null &&
        route !== null &&
        (route.name === "detail" || route.name === "edit") &&
        route.id === jobId
      ) {
        this.navigate("#/");
        return;
      }
    }

    // Never rebuild a form while it is being edited: it would lose the input.
    if (this.currentRoute?.name === "new" || this.currentRoute?.name === "edit") {
      return;
    }
    if (!REFRESH_EVENTS.has(eventType)) {
      return;
    }
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.currentView?.refresh === undefined || this.refreshTimer !== null) {
      return;
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.currentView?.refresh?.();
    }, REFRESH_DEBOUNCE_MS);
  }

  private renderRoute(): void {
    const route = parseRoute(window.location.hash);
    this.currentRoute = route;

    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.currentView?.dispose?.();

    let view: View;
    switch (route.name) {
      case "list":
        view = createListView(this);
        break;
      case "new":
        view = createFormView(this, null);
        break;
      case "detail":
        view = createDetailView(this, route.id);
        break;
      case "edit":
        view = createFormView(this, route.id);
        break;
      default:
        view = { element: this.notFoundView() };
        break;
    }

    this.currentView = view;
    this.viewContainer.replaceChildren(view.element);
  }

  private notFoundView(): HTMLElement {
    const element = h("section", { class: "view" });
    element.append(
      pageHeader("Página no encontrada", null),
      h("p", { class: "muted", text: "La dirección no corresponde a ninguna vista de LAICron." }),
      h("a", { class: "btn", text: "Volver a la lista", attrs: { href: "#/" } }),
    );
    return element;
  }
}

function renderTokenError(root: HTMLElement): void {
  root.replaceChildren(
    h(
      "div",
      { class: "error-screen" },
      h("h1", { text: appName }),
      h("p", {
        class: "error-screen-message",
        text: "Falta el token de acceso. Abre LAICron desde el menú.",
      }),
    ),
  );
}

function bootstrap(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (root === null) {
    return;
  }

  const token = captureToken();
  if (token === null) {
    renderTokenError(root);
    return;
  }

  const app = new App(root, new ApiClient(token));
  app.start();
}

if (typeof document !== "undefined") {
  bootstrap();
}
