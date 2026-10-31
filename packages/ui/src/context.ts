import type { ApiClient } from "./api.js";

/** A rendered screen. `refresh` re-fetches without losing local view state. */
export interface View {
  readonly element: HTMLElement;
  refresh?: () => Promise<void>;
  dispose?: () => void;
}

/** Services and navigation helpers available to every view. */
export interface AppContext {
  readonly api: ApiClient;
  navigate(path: string): void;
  notify(message: string, kind?: "info" | "error" | "success"): void;
}
