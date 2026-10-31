/** Hash router: `#/`, `#/new`, `#/jobs/:id` and `#/jobs/:id/edit`. */

export type Route =
  | { name: "list" }
  | { name: "new" }
  | { name: "detail"; id: string }
  | { name: "edit"; id: string }
  | { name: "missing" };

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Parses a location hash (with or without the leading `#`). */
export function parseRoute(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  // A launcher fragment that could not be cleared still means "show the list".
  if (raw.startsWith("token=")) {
    return { name: "list" };
  }
  const path = raw.split("?")[0] ?? "";
  const segments = path.split("/").filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return { name: "list" };
  }
  if (segments.length === 1 && segments[0] === "new") {
    return { name: "new" };
  }
  if (segments[0] === "jobs" && segments.length >= 2) {
    const id = decodeSegment(segments[1] ?? "");
    if (id === null || id.length === 0) {
      return { name: "missing" };
    }
    if (segments.length === 2) {
      return { name: "detail", id };
    }
    if (segments.length === 3 && segments[2] === "edit") {
      return { name: "edit", id };
    }
  }
  return { name: "missing" };
}

/** Stable key used to decide whether a route changed. */
export function routeKey(route: Route): string {
  switch (route.name) {
    case "detail":
    case "edit":
      return `${route.name}:${route.id}`;
    default:
      return route.name;
  }
}
