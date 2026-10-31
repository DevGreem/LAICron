import { afterEach, describe, expect, it } from "vitest";

import { createRepositories } from "../../src/db/index.js";
import { cleanupTempDatabases, openTempDatabase } from "./helpers.js";

afterEach(cleanupTempDatabases);

describe("MetaRepository", () => {
  it("returns null for missing keys and stores values", () => {
    const { db } = openTempDatabase();
    const { meta } = createRepositories(db);

    expect(meta.get("heartbeat")).toBeNull();

    meta.set("heartbeat", "123");
    expect(meta.get("heartbeat")).toBe("123");

    meta.set("heartbeat", "456");
    expect(meta.get("heartbeat")).toBe("456");

    meta.set("other", "value");
    expect(meta.get("other")).toBe("value");
    expect(meta.get("heartbeat")).toBe("456");
  });
});
