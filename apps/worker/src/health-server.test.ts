import { once } from "node:events";

import { createLogger } from "@chaincopy/config";
import { type PrismaClient } from "@chaincopy/database";
import { type Redis } from "ioredis";
import { afterEach, describe, expect, it } from "vitest";

import { startHealthServer } from "./health-server.js";

const servers: Array<Awaited<ReturnType<typeof startHealthServer>>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("worker health server", () => {
  it("returns 503 promptly when a shared dependency command does not settle", async () => {
    const never = new Promise<never>(() => undefined);
    const server = await startHealthServer({
      database: {
        $queryRaw: async () => [{ value: 1 }],
      } as unknown as PrismaClient,
      logger: createLogger("worker-health-test", "fatal"),
      port: 0,
      probeTimeoutMs: 5,
      redis: {
        ping: async () => never,
      } as unknown as Redis,
    });
    servers.push(server);
    if (!server.listening) {
      await once(server, "listening");
    }
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected the health server to use a TCP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      components: {
        database: { status: "up" },
        redis: { status: "down" },
      },
      status: "unhealthy",
    });
  });
});
