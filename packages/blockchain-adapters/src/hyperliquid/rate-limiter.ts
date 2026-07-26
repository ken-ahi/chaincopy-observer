export interface RateLimiterClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

const systemClock: RateLimiterClock = {
  now: () => Date.now(),
  sleep: async (milliseconds) => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  },
};

export class WeightedRateLimiter {
  private readonly entries: Array<{ readonly at: number; readonly weight: number }> = [];

  public constructor(
    private readonly maximumWeight = 1_200,
    private readonly windowMs = 60_000,
    private readonly clock: RateLimiterClock = systemClock,
  ) {
    if (maximumWeight <= 0 || windowMs <= 0) {
      throw new RangeError("Rate limiter limits must be positive.");
    }
  }

  public async acquire(weight: number): Promise<void> {
    if (!Number.isSafeInteger(weight) || weight <= 0 || weight > this.maximumWeight) {
      throw new RangeError("Request weight must be a positive safe integer within the limit.");
    }

    while (true) {
      const now = this.clock.now();
      this.removeExpired(now);
      const usedWeight = this.entries.reduce((total, entry) => total + entry.weight, 0);
      if (usedWeight + weight <= this.maximumWeight) {
        this.entries.push({ at: now, weight });
        return;
      }

      const oldest = this.entries[0];
      if (!oldest) {
        continue;
      }
      await this.clock.sleep(Math.max(1, oldest.at + this.windowMs - now));
    }
  }

  private removeExpired(now: number): void {
    while (this.entries[0] && this.entries[0].at + this.windowMs <= now) {
      this.entries.shift();
    }
  }
}
