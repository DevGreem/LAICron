import type { McpState } from "./types.js";

/** What the form can choose for one MCP: follow opencode or pin a value. */
export type McpChoice = "inherit" | McpState;

/** One row of the MCP table, with the catalog default and the chosen state. */
export interface McpRow {
  name: string;
  enabled: boolean | null;
  state: McpChoice;
}

/**
 * Merges the catalog with the saved overrides. Catalog entries keep their
 * order; saved names that the catalog no longer lists are appended with an
 * unknown default so the user can still remove them.
 */
export function mergeMcpRows(
  catalog: Array<{ name: string; enabled: boolean }>,
  saved: Record<string, McpState>,
): McpRow[] {
  const rows: McpRow[] = [];
  const seen = new Set<string>();

  for (const entry of catalog) {
    if (seen.has(entry.name)) {
      continue;
    }
    seen.add(entry.name);
    rows.push({
      name: entry.name,
      enabled: entry.enabled,
      state: saved[entry.name] ?? "inherit",
    });
  }

  for (const [name, state] of Object.entries(saved)) {
    if (seen.has(name)) {
      continue;
    }
    rows.push({ name, enabled: null, state });
  }

  return rows;
}

/** Keeps only pinned states; `inherit` is represented by an absent key. */
export function buildOverrides(
  rows: Array<{ name: string; state: McpChoice }>,
): Record<string, McpState> {
  const overrides: Record<string, McpState> = {};
  for (const row of rows) {
    if (row.state === "on" || row.state === "off") {
      overrides[row.name] = row.state;
    }
  }
  return overrides;
}

/**
 * Resolves what opencode will do for a row: inherited choices follow the
 * catalog default, while pinned choices ignore it.
 */
export function effectiveState(state: McpChoice, enabled: boolean | null): McpChoice {
  if (state === "on" || state === "off") {
    return state;
  }
  if (enabled === true) {
    return "on";
  }
  if (enabled === false) {
    return "off";
  }
  return "inherit";
}
