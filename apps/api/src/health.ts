import { performance } from "node:perf_hooks";

import { type PrismaClient } from "@chaincopy/database";
import { type HealthComponent, type ServiceHealth } from "@chaincopy/domain";
import { type Redis } from "ioredis";

export interface HealthService {
  check(): Promise<ServiceHealth>;
}

type ComponentCheck = () => Promise<void>;

export class DatabaseRedisHealthService implements HealthService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly redis: Redis,
    private readonly timeoutMs = 2_000,
  ) {}

  public async check(): Promise<ServiceHealth> {
    const [database, redis] = await Promise.all([
      checkComponent(async () => {
        await this.database.$queryRaw`SELECT 1`;
      }, this.timeoutMs),
      checkComponent(async () => {
        const response = await this.redis.ping();
        if (response !== "PONG") {
          throw new Error("Redis ping did not return PONG");
        }
      }, this.timeoutMs),
    ]);

    return {
      checkedAt: new Date().toISOString(),
      components: {
        database,
        redis,
      },
      service: "api",
      status: database.status === "up" && redis.status === "up" ? "healthy" : "unhealthy",
    };
  }
}

async function checkComponent(check: ComponentCheck, timeoutMs: number): Promise<HealthComponent> {
  const startedAt = performance.now();
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      check(),
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Health probe timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
    return {
      latencyMs: Math.round(performance.now() - startedAt),
      status: "up",
    };
  } catch {
    return {
      latencyMs: Math.round(performance.now() - startedAt),
      status: "down",
    };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
