import { type PrismaClient } from "@chaincopy/database";
import { type Redis } from "ioredis";
import { describe, expect, it } from "vitest";

import { DatabaseRedisHealthService } from "./health.js";

describe("DatabaseRedisHealthService", () => {
  it("returns unhealthy when a dependency probe does not settle", async () => {
    const never = new Promise<never>(() => undefined);
    const service = new DatabaseRedisHealthService(
      {
        $queryRaw: async () => [{ value: 1 }],
      } as unknown as PrismaClient,
      {
        ping: async () => never,
      } as unknown as Redis,
      5,
    );

    const result = await service.check();

    expect(result).toMatchObject({
      components: {
        database: { status: "up" },
        redis: { status: "down" },
      },
      status: "unhealthy",
    });
  });
});
