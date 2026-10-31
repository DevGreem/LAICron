export const FALLBACK_TIMEZONES: string[] = [
  "UTC",
  "Europe/Madrid",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Lisbon",
  "Europe/Moscow",
  "Atlantic/Canary",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/Santo_Domingo",
  "America/Panama",
  "America/Caracas",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Africa/Cairo",
  "Africa/Johannesburg",
];

/** Returns the time zone reported by the runtime, or an empty string if unknown. */
function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/** Reads the runtime IANA catalogue, falling back when the engine lacks it. */
function supportedTimezones(): string[] | null {
  if (typeof Intl.supportedValuesOf !== "function") {
    return null;
  }
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.length > 0 ? zones : null;
  } catch {
    return null;
  }
}

/** Returns UTC and the system zone first, then every known IANA zone without duplicates. */
export function listTimezones(): string[] {
  const zones: string[] = [];
  const seen = new Set<string>();
  const candidates = ["UTC", systemTimezone(), ...(supportedTimezones() ?? FALLBACK_TIMEZONES)];

  for (const zone of candidates) {
    if (zone.length > 0 && !seen.has(zone)) {
      seen.add(zone);
      zones.push(zone);
    }
  }

  return zones;
}

/** Returns the current HH:MM time and the UTC offset for a time zone. */
export function timezoneInfo(
  zone: string,
  now: Date = new Date(),
): { time: string; offset: string } {
  try {
    const timeParts = new Intl.DateTimeFormat("es-ES", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);

    const hour = timeParts.find((part) => part.type === "hour")?.value;
    const minute = timeParts.find((part) => part.type === "minute")?.value;
    const time =
      hour !== undefined && minute !== undefined
        ? `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`
        : "--:--";

    const offsetParts = new Intl.DateTimeFormat("es-ES", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    const offset = offsetParts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";

    return { time, offset };
  } catch {
    return { time: "--:--", offset: "zona no válida" };
  }
}
