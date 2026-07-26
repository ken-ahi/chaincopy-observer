import { type Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";

import { SyncLockUnavailableError, withRedisLock } from "./lock.js";

class LockRedis {
  private token: string | null = null;

  public async set(
    _key: string,
    token: string,
    _px: "PX",
    _ttlMs: number,
    _nx: "NX",
  ): Promise<"OK" | null> {
    if (this.token) {
      return null;
    }
    this.token = token;
    return "OK";
  }

  public async eval(
    script: string,
    _keyCount: number,
    _key: string,
    token: string,
  ): Promise<number> {
    if (this.token !== token) {
      return 0;
    }
    if (script.includes("'del'")) {
      this.token = null;
    }
    return 1;
  }

  public occupy(): void {
    this.token = "another-worker";
  }
}

describe("withRedisLock", () => {
  it("runs the operation and releases the owned lock", async () => {
    const redis = new LockRedis();
    const operation = vi.fn(async () => "completed");

    await expect(
      withRedisLock(redis as unknown as Redis, "wallet-lock", operation, {
        acquisitionTimeoutMs: 0,
      }),
    ).resolves.toBe("completed");
    expect(operation).toHaveBeenCalledOnce();

    await expect(
      withRedisLock(redis as unknown as Redis, "wallet-lock", async () => "second", {
        acquisitionTimeoutMs: 0,
      }),
    ).resolves.toBe("second");
  });

  it("does not run when another worker owns the lock", async () => {
    const redis = new LockRedis();
    redis.occupy();
    const operation = vi.fn(async () => "unexpected");

    await expect(
      withRedisLock(redis as unknown as Redis, "wallet-lock", operation, {
        acquisitionTimeoutMs: 0,
      }),
    ).rejects.toBeInstanceOf(SyncLockUnavailableError);
    expect(operation).not.toHaveBeenCalled();
  });
});
