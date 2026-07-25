import { createServer, type Server } from "node:http";
import { performance } from "node:perf_hooks";

import { type PrismaClient } from "@chaincopy/database";
import { type Redis } from "ioredis";
import { type Logger } from "pino";

interface HealthServerOptions {
  readonly database: PrismaClient;
  readonly logger: Logger;
  readonly port: number;
  readonly redis: Redis;
}

export async function startHealthServer(options: HealthServerOptions): Promise<Server> {
  const server = createServer(async (request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const [database, redis] = await Promise.all([
      probe(async () => {
        await options.database.$queryRaw`SELECT 1`;
      }),
      probe(async () => {
        const result = await options.redis.ping();
        if (result !== "PONG") {
          throw new Error("Redis ping did not return PONG");
        }
      }),
    ]);
    const healthy = database.status === "up" && redis.status === "up";
    response.writeHead(healthy ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        components: { database, redis },
        service: "worker",
        status: healthy ? "healthy" : "unhealthy",
      }),
    );
  });

  server.on("clientError", (error, socket) => {
    options.logger.warn(
      { error: { message: error.message, name: error.name } },
      "Health client error",
    );
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

async function probe(
  check: () => Promise<void>,
): Promise<{ latencyMs: number; status: "up" | "down" }> {
  const startedAt = performance.now();
  try {
    await check();
    return { latencyMs: Math.round(performance.now() - startedAt), status: "up" };
  } catch {
    return { latencyMs: Math.round(performance.now() - startedAt), status: "down" };
  }
}
