import { afterEach, describe, expect, it } from "vitest";

import {
  getBaseLocale,
  getLocale,
  localeFromEnv,
  parseLocale,
  runWithLocale,
  setBaseLocale,
  t,
} from "../src/i18n.js";

afterEach(() => {
  setBaseLocale("es");
});

describe("parseLocale", () => {
  it("accepts BCP-47 and POSIX tags", () => {
    expect(parseLocale("en-US")).toBe("en");
    expect(parseLocale("es-419")).toBe("es");
    expect(parseLocale("en_US.UTF-8")).toBe("en");
    expect(parseLocale("es_ES.UTF-8")).toBe("es");
  });

  it("reads the first supported language of a header", () => {
    expect(parseLocale("fr-FR,en;q=0.9,es;q=0.8")).toBe("en");
    expect(parseLocale("fr-FR")).toBeNull();
    expect(parseLocale(null)).toBeNull();
  });
});

describe("localeFromEnv", () => {
  it("prefers LAICRON_LANG", () => {
    expect(localeFromEnv({ LAICRON_LANG: "en", LANG: "es_ES.UTF-8" })).toBe("en");
  });

  it("falls back to the POSIX variables", () => {
    expect(localeFromEnv({ LC_ALL: "en_US.UTF-8" })).toBe("en");
    expect(localeFromEnv({ LANG: "es_ES.UTF-8" })).toBe("es");
  });

  it("defaults to Spanish", () => {
    expect(localeFromEnv({})).toBe("es");
    expect(localeFromEnv({ LANG: "C" })).toBe("es");
  });
});

describe("t", () => {
  it("uses the base locale outside a request", () => {
    setBaseLocale("en");
    expect(getLocale()).toBe("en");
    expect(t("api.notFound")).toBe("Resource not found.");
  });

  it("uses the locale of the current request", async () => {
    setBaseLocale("es");
    const english = await runWithLocale("en", async () => t("api.notFound"));
    const spanish = t("api.notFound");

    expect(english).toBe("Resource not found.");
    expect(spanish).toBe("Recurso no encontrado.");
    expect(getBaseLocale()).toBe("es");
  });

  it("interpolates placeholders", () => {
    setBaseLocale("en");
    expect(t("api.paramRange", { field: "limit", min: 1, max: 100 })).toBe(
      'The "limit" parameter must be between 1 and 100.',
    );
  });
});
