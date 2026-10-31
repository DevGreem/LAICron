import { describe, expect, it } from "vitest";

import {
  composeCron,
  CRON_PRESETS,
  describeCron,
  parseCron,
  type CronFields,
} from "../src/cron.js";

function fieldsOf(expr: string): CronFields {
  const fields = parseCron(expr);
  if (fields === null) {
    throw new Error(`Expected a valid cron expression: ${expr}`);
  }
  return fields;
}

describe("parseCron", () => {
  it("splits a five-field expression", () => {
    expect(parseCron("0 9 * * 1-5")).toEqual({
      minute: "0",
      hour: "9",
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "1-5",
    });
  });

  it("rejects expressions without exactly five non-empty fields", () => {
    expect(parseCron("0 9 * *")).toBeNull();
    expect(parseCron("0 9 * * * extra")).toBeNull();
    expect(parseCron("")).toBeNull();
    expect(parseCron("   ")).toBeNull();
  });

  it("tolerates surrounding and repeated whitespace", () => {
    expect(parseCron("  0  9 * * * ")).toEqual({
      minute: "0",
      hour: "9",
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "*",
    });
  });
});

describe("composeCron", () => {
  it("reconstructs an expression with a single space between fields", () => {
    expect(composeCron(fieldsOf("0 9 * * 1-5"))).toBe("0 9 * * 1-5");
  });

  it("trims every field before joining", () => {
    expect(
      composeCron({
        minute: " 0 ",
        hour: "9",
        dayOfMonth: "*",
        month: "*",
        dayOfWeek: " 1-5 ",
      }),
    ).toBe("0 9 * * 1-5");
  });
});

describe("CRON_PRESETS", () => {
  it("keeps the agreed presets", () => {
    expect(CRON_PRESETS).toEqual([
      { id: "daily-9", label: "Cada día a las 09:00", expr: "0 9 * * *" },
      { id: "weekdays-9", label: "De lunes a viernes a las 09:00", expr: "0 9 * * 1-5" },
      { id: "monday-8", label: "Cada lunes a las 08:00", expr: "0 8 * * 1" },
      { id: "hourly", label: "Cada hora en punto", expr: "0 * * * *" },
      { id: "every-15", label: "Cada 15 minutos", expr: "*/15 * * * *" },
      { id: "monthly-1", label: "El primer día del mes a las 00:00", expr: "0 0 1 * *" },
    ]);
  });

  it("parses and round-trips every preset expression", () => {
    for (const preset of CRON_PRESETS) {
      const fields = parseCron(preset.expr);
      expect(fields, preset.id).not.toBeNull();
      if (fields !== null) {
        expect(composeCron(fields)).toBe(preset.expr);
      }
    }
  });
});

describe("describeCron", () => {
  it("describes every minute", () => {
    expect(describeCron(fieldsOf("* * * * *"))).toBe("cada minuto");
  });

  it("describes minute steps", () => {
    expect(describeCron(fieldsOf("*/15 * * * *"))).toBe("cada 15 minutos");
  });

  it("describes fixed daily times", () => {
    expect(describeCron(fieldsOf("0 9 * * *"))).toBe("todos los días a las 09:00");
    expect(describeCron(fieldsOf("30 18 * * *"))).toBe("todos los días a las 18:30");
  });

  it("describes weekday ranges", () => {
    expect(describeCron(fieldsOf("0 9 * * 1-5"))).toBe("de lunes a viernes a las 09:00");
  });

  it("describes single weekdays", () => {
    expect(describeCron(fieldsOf("0 9 * * 1"))).toBe("todos los lunes a las 09:00");
    expect(describeCron(fieldsOf("0 9 * * 0"))).toBe("todos los domingos a las 09:00");
  });

  it("falls back to the raw expression for anything else", () => {
    expect(describeCron(fieldsOf("0 9 1 * *"))).toBe("expresión cron 0 9 1 * *");
    expect(describeCron(fieldsOf("0 * * * *"))).toBe("expresión cron 0 * * * *");
  });

  it("never throws on malformed fields", () => {
    expect(() => describeCron({} as CronFields)).not.toThrow();
    expect(describeCron({} as CronFields)).toBe("expresión cron");
    expect(describeCron(null as unknown as CronFields)).toBe("expresión cron no válida");
  });
});
