import type {
  Health,
  Job,
  JobInput,
  JobListResponse,
  JobResponse,
  MessagePage,
  OpencodeOptions,
  Run,
  RunPage,
  RunResponse,
} from "./types.js";

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
    field?: string;
  };
}

/** An error returned by the local API (or a network failure with status 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;

  constructor(message: string, status: number, code: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** User-facing message for any thrown value. */
export function messageFromError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "El token de acceso no es válido. Abre LAICron desde el menú.";
    }
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Ha ocurrido un error inesperado.";
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: ErrorPayload | null = null;
  try {
    payload = (await response.json()) as ErrorPayload;
  } catch {
    payload = null;
  }

  const message = payload?.error?.message ?? `Error del servidor (${response.status}).`;
  const code = payload?.error?.code ?? "http_error";
  const field = payload?.error?.field;
  return new ApiError(message, response.status, code, field);
}

/** Authenticated client for `/api/jobs` and its sub-resources. */
export class ApiClient {
  readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.token}`);
    if (init.body !== undefined) {
      headers.set("content-type", "application/json");
    }

    let response: Response;
    try {
      response = await fetch(path, { ...init, headers, cache: "no-store" });
    } catch {
      throw new ApiError("No se pudo conectar con el planificador.", 0, "network_error");
    }

    if (!response.ok) {
      throw await toApiError(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(
        "La respuesta del servidor no es JSON válido.",
        response.status,
        "invalid_response",
      );
    }
  }

  async listJobs(): Promise<Job[]> {
    const data = await this.request<JobListResponse>("/api/jobs");
    return data.jobs;
  }

  async getJob(id: string): Promise<Job> {
    const data = await this.request<JobResponse>(`/api/jobs/${encodeURIComponent(id)}`);
    return data.job;
  }

  async createJob(input: JobInput): Promise<Job> {
    const data = await this.request<JobResponse>("/api/jobs", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return data.job;
  }

  async updateJob(id: string, input: Partial<JobInput>): Promise<Job> {
    const data = await this.request<JobResponse>(`/api/jobs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    return data.job;
  }

  async opencodeOptions(refresh = false, cwd?: string): Promise<OpencodeOptions> {
    const query: string[] = [];
    if (refresh) {
      query.push("refresh=1");
    }
    if (cwd !== undefined && cwd.length > 0) {
      query.push(`cwd=${encodeURIComponent(cwd)}`);
    }
    const suffix = query.length > 0 ? `?${query.join("&")}` : "";
    const data = await this.request<OpencodeOptions>(`/api/opencode/options${suffix}`);
    // Older daemons do not return `mcps`; the form expects an array.
    return { ...data, mcps: data.mcps ?? [] };
  }

  async deleteJob(id: string): Promise<void> {
    await this.request<void>(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async pauseJob(id: string): Promise<Job> {
    const data = await this.request<JobResponse>(`/api/jobs/${encodeURIComponent(id)}/pause`, {
      method: "POST",
    });
    return data.job;
  }

  async resumeJob(id: string): Promise<Job> {
    const data = await this.request<JobResponse>(`/api/jobs/${encodeURIComponent(id)}/resume`, {
      method: "POST",
    });
    return data.job;
  }

  async runJob(id: string): Promise<Run> {
    const data = await this.request<RunResponse>(`/api/jobs/${encodeURIComponent(id)}/run`, {
      method: "POST",
    });
    return data.run;
  }

  async listRuns(id: string, page: { limit: number; offset: number }): Promise<RunPage> {
    const query = new URLSearchParams({
      limit: String(page.limit),
      offset: String(page.offset),
    });
    return this.request<RunPage>(`/api/jobs/${encodeURIComponent(id)}/runs?${query.toString()}`);
  }

  async listMessages(id: string, page: { limit: number; offset: number }): Promise<MessagePage> {
    const query = new URLSearchParams({
      limit: String(page.limit),
      offset: String(page.offset),
    });
    return this.request<MessagePage>(
      `/api/jobs/${encodeURIComponent(id)}/messages?${query.toString()}`,
    );
  }
}

/** Public daemon health probe; deliberately sends no token. */
export async function fetchHealth(): Promise<Health> {
  const response = await fetch("/api/health", { cache: "no-store" });
  if (!response.ok) {
    throw new ApiError(
      `El planificador respondió ${response.status}.`,
      response.status,
      "http_error",
    );
  }
  return (await response.json()) as Health;
}
