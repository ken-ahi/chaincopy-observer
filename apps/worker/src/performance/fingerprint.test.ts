import { describe, expect, it } from "vitest";

import { createPerformanceInputFingerprint } from "./fingerprint.js";
import type { PerformanceCalculationInput } from "./types.js";

const baseInput: PerformanceCalculationInput = {
  accountSnapshots: [],
  cashFlows: [
    {
      amount: "10",
      externalId: "cash-2",
      occurredAt: "2024-01-02T00:00:00.000Z",
      type: "deposit",
    },
  ],
  fills: [
    {
      closedPnl: "0",
      coin: "BTC",
      externalId: "fill-2",
      fee: "0",
      occurredAt: "2024-01-02T00:00:00.000Z",
      price: "100",
      side: "BUY",
      size: "1",
      startPosition: "0",
    },
    {
      closedPnl: "0",
      coin: "ETH",
      externalId: "fill-1",
      fee: "0",
      occurredAt: "2024-01-01T00:00:00.000Z",
      price: "10",
      side: "BUY",
      size: "1",
      startPosition: "0",
    },
  ],
  funding: [],
  navSnapshots: [],
  openIssueTypes: [],
  positionSnapshots: [],
  syncCursorStatuses: [],
  walletAddress: "0x1111111111111111111111111111111111111111",
  walletAddressId: "wallet-1",
};

const base = {
  calculationFrom: "2024-01-01T00:00:00.000Z",
  calculationTo: "2024-02-01T00:00:00.000Z",
  calculationVersion: "performance-v1",
  historyCompleteness: "COMPLETE" as const,
};

describe("performance input fingerprint", () => {
  it("is independent of input array order", () => {
    const first = createPerformanceInputFingerprint({ ...base, input: baseInput });
    const second = createPerformanceInputFingerprint({
      ...base,
      input: {
        ...baseInput,
        fills: [...baseInput.fills].reverse(),
      },
    });
    expect(second).toBe(first);
  });

  it("changes when a fill is added", () => {
    const original = createPerformanceInputFingerprint({ ...base, input: baseInput });
    const changed = createPerformanceInputFingerprint({
      ...base,
      input: {
        ...baseInput,
        fills: [...baseInput.fills, { ...baseInput.fills[0]!, externalId: "fill-3" }],
      },
    });
    expect(changed).not.toBe(original);
  });

  it("changes when funding is added", () => {
    const original = createPerformanceInputFingerprint({ ...base, input: baseInput });
    const changed = createPerformanceInputFingerprint({
      ...base,
      input: {
        ...baseInput,
        funding: [
          {
            amount: "1",
            coin: "BTC",
            externalId: "funding-1",
            occurredAt: "2024-01-03T00:00:00.000Z",
          },
        ],
      },
    });
    expect(changed).not.toBe(original);
  });

  it("changes when the calculation range changes", () => {
    const original = createPerformanceInputFingerprint({ ...base, input: baseInput });
    const changed = createPerformanceInputFingerprint({
      ...base,
      calculationTo: "2024-03-01T00:00:00.000Z",
      input: baseInput,
    });
    expect(changed).not.toBe(original);
  });

  it("changes when the calculation version changes", () => {
    const original = createPerformanceInputFingerprint({ ...base, input: baseInput });
    const changed = createPerformanceInputFingerprint({
      ...base,
      calculationVersion: "performance-v2",
      input: baseInput,
    });
    expect(changed).not.toBe(original);
  });
});
