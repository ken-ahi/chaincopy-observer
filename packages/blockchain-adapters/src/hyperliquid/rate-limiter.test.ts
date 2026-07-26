import { describe, expect, it, vi } from "vitest";

import { HyperliquidHttpClient } from "./http-client.js";
import { type RateLimiterClock, WeightedRateLimiter } from "./rate-limiter.js";

describe("WeightedRateLimiter", () => {
  it("respects the rolling weight window and priority ordering", async () => {
    let now = 0;
    let releaseSleep = (): void => {
      throw new Error("Sleep was not scheduled.");
    };
    const sleepGate = new Promise<void>((resolve) => {
      releaseSleep = () => {
        now = 10;
        resolve();
      };
    });
    const clock: RateLimiterClock = {
      now: () => now,
      sleep: async () => sleepGate,
    };
    const limiter = new WeightedRateLimiter(10, 10, clock);
    await limiter.acquire(8, 0);
    const order: string[] = [];
    const low = limiter.acquire(5, 20).then(() => order.push("low"));
    await Promise.resolve();
    const high = limiter.acquire(2, 1).then(() => order.push("high"));
    releaseSleep();
    await Promise.all([low, high]);

    expect(order).toEqual(["high", "low"]);
    expect(limiter.usage()).toMatchObject({ maximumWeight: 10, usedWeight: 7 });
  });
});

describe("Hyperliquid Retry-After", () => {
  it("reserves maximum item weight before a response-weighted request", async () => {
    const limiter = new WeightedRateLimiter(120);
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("[]", { status: 200 }));
    const client = new HyperliquidHttpClient("https://example.test/info", {
      fetchImplementation,
      rateLimiter: limiter,
    });

    await client.userFills("0x1111111111111111111111111111111111111111");

    expect(limiter.usage().usedWeight).toBe(120);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("waits for Retry-After before retrying HTTP 429", async () => {
    vi.useFakeTimers();
    try {
      const fetchImplementation = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("rate limited", {
            headers: { "retry-after": "2" },
            status: 429,
          }),
        )
        .mockResolvedValueOnce(new Response("[]", { status: 200 }));
      const client = new HyperliquidHttpClient("https://example.test/info", {
        fetchImplementation,
        maximumAttempts: 2,
      });
      const response = client.userFills("0x1111111111111111111111111111111111111111");
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchImplementation).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await expect(response).resolves.toMatchObject({ data: [] });
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
