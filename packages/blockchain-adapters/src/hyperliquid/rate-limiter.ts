export interface RateLimiterClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

export interface RateLimiterUsage {
  readonly maximumWeight: number;
  readonly usedWeight: number;
  readonly windowMs: number;
  readonly windowStartedAt: number | null;
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
  private readonly pending: Array<{
    readonly priority: number;
    readonly reject: (error: unknown) => void;
    readonly resolve: () => void;
    readonly sequence: number;
    readonly weight: number;
  }> = [];
  private processing = false;
  private sequence = 0;
  private usageObservation: Promise<void> = Promise.resolve();
  private wakePending: (() => void) | null = null;

  public constructor(
    private readonly maximumWeight = 1_200,
    private readonly windowMs = 60_000,
    private readonly clock: RateLimiterClock = systemClock,
    private readonly onUsage?: (usage: RateLimiterUsage) => Promise<void> | void,
  ) {
    if (maximumWeight <= 0 || windowMs <= 0) {
      throw new RangeError("Rate limiter limits must be positive.");
    }
  }

  public async acquire(weight: number, priority = 10): Promise<void> {
    if (!Number.isSafeInteger(weight) || weight <= 0 || weight > this.maximumWeight) {
      throw new RangeError("Request weight must be a positive safe integer within the limit.");
    }
    if (!Number.isSafeInteger(priority) || priority < 0) {
      throw new RangeError("Request priority must be a non-negative safe integer.");
    }

    await new Promise<void>((resolve, reject) => {
      this.pending.push({
        priority,
        reject,
        resolve,
        sequence: this.sequence,
        weight,
      });
      this.sequence += 1;
      this.pending.sort(
        (left, right) => left.priority - right.priority || left.sequence - right.sequence,
      );
      this.wakePending?.();
      void this.processPending();
    });
  }

  public usage(): RateLimiterUsage {
    const now = this.clock.now();
    this.removeExpired(now);
    return {
      maximumWeight: this.maximumWeight,
      usedWeight: this.entries.reduce((total, entry) => total + entry.weight, 0),
      windowMs: this.windowMs,
      windowStartedAt: this.entries[0]?.at ?? null,
    };
  }

  private async processPending(): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;
    try {
      while (this.pending.length > 0) {
        this.pending.sort(
          (left, right) => left.priority - right.priority || left.sequence - right.sequence,
        );
        const request = this.pending[0];
        if (!request) {
          return;
        }
        const now = this.clock.now();
        this.removeExpired(now);
        const usedWeight = this.entries.reduce((total, entry) => total + entry.weight, 0);
        if (usedWeight + request.weight <= this.maximumWeight) {
          this.pending.shift();
          this.entries.push({ at: now, weight: request.weight });
          request.resolve();
          if (this.onUsage) {
            const usage = this.usage();
            this.usageObservation = this.usageObservation
              .then(() => this.onUsage?.(usage))
              .catch((error: unknown) => {
                console.error(
                  JSON.stringify({
                    event: "hyperliquid_rate_limit_usage_observer_failed",
                    message: error instanceof Error ? error.message : String(error),
                  }),
                );
              });
          }
          continue;
        }

        const oldest = this.entries[0];
        if (!oldest) {
          continue;
        }
        await Promise.race([
          this.clock.sleep(Math.max(1, oldest.at + this.windowMs - now)),
          new Promise<void>((resolve) => {
            this.wakePending = resolve;
          }),
        ]);
        this.wakePending = null;
      }
    } finally {
      this.processing = false;
      if (this.pending.length > 0) {
        void this.processPending();
      }
    }
  }

  private removeExpired(now: number): void {
    while (this.entries[0] && this.entries[0].at + this.windowMs <= now) {
      this.entries.shift();
    }
  }
}
