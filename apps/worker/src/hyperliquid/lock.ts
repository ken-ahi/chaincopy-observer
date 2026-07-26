import { randomUUID } from "node:crypto";

import { type Redis } from "ioredis";

export class SyncLockUnavailableError extends Error {
  public constructor(lockKey: string) {
    super(`A sync job already holds lock ${lockKey}.`);
    this.name = "SyncLockUnavailableError";
  }
}

export class SyncLockLostError extends Error {
  public constructor(lockKey: string, options?: ErrorOptions) {
    super(`Sync lock ${lockKey} was lost before the operation completed.`, options);
    this.name = "SyncLockLostError";
  }
}

export interface RedisLockOptions {
  readonly acquisitionTimeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly ttlMs?: number;
}

const releaseLockScript =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const renewLockScript =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

export async function withRedisLock<T>(
  redis: Redis,
  lockKey: string,
  operation: () => Promise<T>,
  options: RedisLockOptions = {},
): Promise<T> {
  const acquisitionTimeoutMs = options.acquisitionTimeoutMs ?? 30_000;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  if (
    !Number.isSafeInteger(acquisitionTimeoutMs) ||
    acquisitionTimeoutMs < 0 ||
    !Number.isSafeInteger(retryDelayMs) ||
    retryDelayMs <= 0 ||
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 3_000
  ) {
    throw new RangeError("Redis lock timing options are invalid.");
  }

  const token = randomUUID();
  const deadline = Date.now() + acquisitionTimeoutMs;
  while ((await redis.set(lockKey, token, "PX", ttlMs, "NX")) !== "OK") {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new SyncLockUnavailableError(lockKey);
    }
    await delay(Math.min(retryDelayMs, remainingMs));
  }

  let renewalError: SyncLockLostError | null = null;
  let renewal: Promise<void> | null = null;
  const renewalTimer = setInterval(
    () => {
      if (renewal || renewalError) {
        return;
      }
      renewal = redis
        .eval(renewLockScript, 1, lockKey, token, String(ttlMs))
        .then((renewed) => {
          if (renewed !== 1) {
            renewalError = new SyncLockLostError(lockKey);
          }
        })
        .catch((error: unknown) => {
          renewalError = new SyncLockLostError(lockKey, { cause: error });
        })
        .finally(() => {
          renewal = null;
        });
    },
    Math.max(1_000, Math.floor(ttlMs / 3)),
  );
  renewalTimer.unref();

  let outcome:
    { readonly ok: true; readonly value: T } | { readonly error: unknown; readonly ok: false };
  try {
    outcome = { ok: true, value: await operation() };
  } catch (error) {
    outcome = { error, ok: false };
  } finally {
    clearInterval(renewalTimer);
  }

  if (renewal) {
    await renewal;
  }

  let releaseError: unknown;
  try {
    const released = await redis.eval(releaseLockScript, 1, lockKey, token);
    if (released !== 1) {
      releaseError = new SyncLockLostError(lockKey);
    }
  } catch (error) {
    releaseError = error;
  }

  if (!outcome.ok) {
    throw outcome.error;
  }
  if (renewalError) {
    throw renewalError;
  }
  if (releaseError) {
    throw new SyncLockLostError(lockKey, { cause: releaseError });
  }
  return outcome.value;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
