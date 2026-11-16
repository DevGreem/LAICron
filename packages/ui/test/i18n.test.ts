import { afterEach, describe, expect, it } from "vitest";

import { formatTokens } from "../src/format.js";
import { getLocale, LOCALES, setLocale, t } from "../src/i18n.js";

afterEach(() => {
  setLocale("es");
});

describe("i18n", () => {
  it("defaults to Spanish", () => {
    expect(getLocale()).toBe("es");
    expect(t("list.create")).toBe("Crear cron");
  });

  it("serves English after switching locale", () => {
    setLocale("en");

    expect(getLocale()).toBe("en");
    expect(t("list.create")).toBe("Create cron");
    expect(t("common.retry")).toBe("Retry");
  });

  it("interpolates placeholders", () => {
    setLocale("es");
    expect(t("list.confirmDelete", { name: "Demo" })).toContain("Demo");

    setLocale("en");
    expect(t("detail.pageInfo", { from: 1, to: 20, total: 40 })).toBe("Showing 1–20 of 40");
  });

  it("formats numbers with the locale separators", () => {
    setLocale("es");
    expect(formatTokens(12345)).toBe("12.345");

    setLocale("en");
    expect(formatTokens(12345)).toBe("12,345");
  });

  it("exposes the supported locales", () => {
    expect(LOCALES).toEqual(["es", "en"]);
  });
});
