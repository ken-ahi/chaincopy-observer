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
  ) {}

  public async check(): Promise<ServiceHealth> {
    const [database, redis] = await Promise.all([
      checkComponent(async () => {
        await this.database.$queryRaw`SELECT 1`;
      }),
      checkComponent(async () => {
        const response = await this.redis.ping();
        if (response !== "PONG") {
          throw new Error("Redis ping did not return PONG");
        }
      }),
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

async function checkComponent(check: ComponentCheck): Promise<HealthComponent> {
  const startedAt = performance.now();

  try {
    await check();
    return {
      latencyMs: Math.round(performance.now() - startedAt),
      status: "up",
    };
  } catch {
    return {
      latencyMs: Math.round(performance.now() - startedAt),
      status: "down",
    };
  }
}
