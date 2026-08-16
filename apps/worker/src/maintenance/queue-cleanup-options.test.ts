import { describe, expect, it } from "vitest";

import { parseQueueCleanupOptions } from "./queue-cleanup-options.js";

describe("queue cleanup options", () => {
  it("parses the documented dry-run command", () => {
    expect(
      parseQueueCleanupOptions([
        "--dry-run",
        "--queue",
        "hyperliquid-sync",
        "--before",
        "2026-08-01T00:00:00Z",
      ]),
    ).toMatchObject({
      batchSize: 1000,
      dryRun: true,
      queue: "hyperliquid-sync",
    });
  });

  it.each(["hyperliquid-discovery", "hyperliquid-candidate-enrichment"])(
    "accepts the maintenance queue %s",
    (queue) => {
      expect(
        parseQueueCleanupOptions([
          "--dry-run",
          "--queue",
          queue,
          "--before",
          "2026-08-01T00:00:00Z",
        ]),
      ).toMatchObject({ dryRun: true, queue });
    },
  );

  it.each([
    [[], "--queue"],
    [["--queue", "other", "--before", "2026-08-01T00:00:00Z"], "--queue"],
    [["--queue", "hyperliquid-sync"], "--before"],
    [["--queue", "hyperliquid-sync", "--before", "invalid"], "--before"],
    [
      ["--queue", "hyperliquid-sync", "--before", "2026-08-01T00:00:00Z", "--batch-size", "0"],
      "--batch-size",
    ],
  ])("rejects unsafe input %#", (arguments_, message) => {
    expect(() => parseQueueCleanupOptions(arguments_)).toThrow(message);
  });
});
