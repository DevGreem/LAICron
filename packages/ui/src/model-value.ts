/** A model value split into its base id and optional variant. */
export interface ModelValue {
  base: string;
  variant: string | null;
}

/** Splits `provider/model#variant` at the last `#`, trimming both sides. */
export function splitModelValue(value: string | null | undefined): ModelValue {
  if (value === null || value === undefined) {
    return { base: "", variant: null };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { base: "", variant: null };
  }

  const separator = trimmed.lastIndexOf("#");
  if (separator === -1) {
    return { base: trimmed, variant: null };
  }

  const base = trimmed.slice(0, separator).trim();
  const variant = trimmed.slice(separator + 1).trim();
  return { base, variant: variant.length > 0 ? variant : null };
}

/** Joins a base id and an optional variant; returns null when the base is empty. */
export function composeModelValue(base: string, variant: string | null): string | null {
  const trimmedBase = base.trim();
  if (trimmedBase.length === 0) {
    return null;
  }

  const trimmedVariant = variant?.trim() ?? "";
  return trimmedVariant.length > 0 ? `${trimmedBase}#${trimmedVariant}` : trimmedBase;
}
