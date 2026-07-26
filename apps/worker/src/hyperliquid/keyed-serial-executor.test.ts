import { describe, expect, it, vi } from "vitest";

import { KeyedSerialExecutor } from "./keyed-serial-executor.js";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}

describe("KeyedSerialExecutor", () => {
  it("serializes jobs for the same wallet", async () => {
    const executor = new KeyedSerialExecutor();
    const firstCanFinish = deferred();
    const firstStarted = vi.fn();
    const secondStarted = vi.fn();

    const first = executor.run("wallet-1", async () => {
      firstStarted();
      await firstCanFinish.promise;
      return "first";
    });
    const second = executor.run("wallet-1", async () => {
      secondStarted();
      return "second";
    });

    await vi.waitFor(() => expect(firstStarted).toHaveBeenCalledOnce());
    expect(secondStarted).not.toHaveBeenCalled();
    firstCanFinish.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(secondStarted).toHaveBeenCalledOnce();
  });

  it("allows different wallets to run concurrently", async () => {
    const executor = new KeyedSerialExecutor();
    const canFinish = deferred();
    const started = vi.fn();

    const first = executor.run("wallet-1", async () => {
      started("wallet-1");
      await canFinish.promise;
    });
    const second = executor.run("wallet-2", async () => {
      started("wallet-2");
      await canFinish.promise;
    });

    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(2));
    canFinish.resolve();
    await Promise.all([first, second]);
  });

  it("continues the wallet queue after an operation fails", async () => {
    const executor = new KeyedSerialExecutor();

    const failed = executor.run("wallet-1", async () => {
      throw new Error("expected failure");
    });
    const recovered = executor.run("wallet-1", async () => "recovered");

    await expect(failed).rejects.toThrow("expected failure");
    await expect(recovered).resolves.toBe("recovered");
  });
});
