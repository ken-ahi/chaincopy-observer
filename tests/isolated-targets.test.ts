import { describe, expect, it } from "vitest";
import { isolatedTargets } from "./isolated-targets.mjs";
const targets = {
  TEST_DATABASE_URL: "postgresql://chaincopy:chaincopy@127.0.0.1:55433/chaincopy?schema=public",
  TEST_REDIS_URL: "redis://127.0.0.1:56380/0",
};
describe("explicit test isolation", () => {
  it("accepts reserved endpoints", () =>
    expect(isolatedTargets(targets, "TEST").databaseUrl).toBe(targets.TEST_DATABASE_URL));
  it("does not inherit runtime URLs", () =>
    expect(() =>
      isolatedTargets(
        { DATABASE_URL: targets.TEST_DATABASE_URL, REDIS_URL: targets.TEST_REDIS_URL },
        "TEST",
      ),
    ).toThrow());
  it.each(["5432", "5433"])("rejects non-test PostgreSQL port %s", (port) =>
    expect(() =>
      isolatedTargets(
        { ...targets, TEST_DATABASE_URL: targets.TEST_DATABASE_URL.replace("55433", port) },
        "TEST",
      ),
    ).toThrow(),
  );
  it("rejects normal Redis and unknown hosts", () => {
    expect(() =>
      isolatedTargets({ ...targets, TEST_REDIS_URL: "redis://127.0.0.1:6379/0" }, "TEST"),
    ).toThrow();
    expect(() =>
      isolatedTargets(
        {
          ...targets,
          TEST_DATABASE_URL: targets.TEST_DATABASE_URL.replace("127.0.0.1", "postgres"),
        },
        "TEST",
      ),
    ).toThrow();
  });
  it("requires E2E schema and Redis database", () =>
    expect(() =>
      isolatedTargets(
        { E2E_DATABASE_URL: targets.TEST_DATABASE_URL, E2E_REDIS_URL: targets.TEST_REDIS_URL },
        "E2E",
      ),
    ).toThrow());
});
