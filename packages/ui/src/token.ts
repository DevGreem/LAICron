/** Session token handling for the local API. */

export const TOKEN_STORAGE_KEY = "laicron.token";

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Storage can be disabled by the webview; the hash token still works.
    return null;
  }
}

/**
 * Extracts `token=` from a `#token=<value>` fragment. The hash is parsed as
 * URL-encoded parameters so extra pairs or a leading `#` are tolerated.
 */
export function tokenFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.includes("token=")) {
    return null;
  }
  const params = new URLSearchParams(raw);
  const token = params.get("token");
  if (token === null) {
    return null;
  }
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Reads the token kept for this browsing session. */
export function readStoredToken(): string | null {
  const current = storage();
  if (current === null) {
    return null;
  }
  try {
    const token = current.getItem(TOKEN_STORAGE_KEY);
    return token !== null && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    storage()?.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Quota or privacy errors must not stop the UI.
  }
}

function clearFragment(): void {
  try {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch {
    // A sandboxed webview may refuse history changes; the token is still usable.
  }
}

/**
 * Resolves the token for this window: a fresh `#token=` wins and is persisted,
 * then the fragment is removed so it does not leak into history or screenshots.
 */
export function captureToken(): string | null {
  const hash = window.location.hash;
  const fromHash = tokenFromHash(hash);
  if (fromHash !== null) {
    storeToken(fromHash);
    clearFragment();
    return fromHash;
  }

  // Drop an empty or malformed launcher fragment so the router falls back to `#/`.
  if (hash.startsWith("#token=") || hash.startsWith("token=")) {
    clearFragment();
  }
  return readStoredToken();
}
