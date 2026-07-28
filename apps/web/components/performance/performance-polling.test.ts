import { describe, expect, it } from "vitest";

import {
  PERFORMANCE_POLL_MAX_ATTEMPTS,
  isCurrentPerformanceAddress,
  isPerformanceActionDisabled,
  shouldPollPerformance,
} from "./performance-polling.js";

describe("performance polling", () => {
  it("polls locally queued, pending, and running calculations", () => {
    expect(shouldPollPerformance(null, true, 0)).toBe(true);
    expect(shouldPollPerformance("PENDING", false, 0)).toBe(true);
    expect(shouldPollPerformance("RUNNING", false, 0)).toBe(true);
  });

  it("stops polling at a terminal state or the attempt limit", () => {
    expect(shouldPollPerformance("SUCCEEDED", false, 0)).toBe(false);
    expect(shouldPollPerformance("INSUFFICIENT_DATA", false, 0)).toBe(false);
    expect(shouldPollPerformance("FAILED", false, 0)).toBe(false);
    expect(shouldPollPerformance("RUNNING", false, PERFORMANCE_POLL_MAX_ATTEMPTS)).toBe(false);
  });

  it("prevents multiple actions while submitting or calculating", () => {
    expect(isPerformanceActionDisabled(null, true, false)).toBe(true);
    expect(isPerformanceActionDisabled(null, false, true)).toBe(true);
    expect(isPerformanceActionDisabled("PENDING", false, false)).toBe(true);
    expect(isPerformanceActionDisabled("RUNNING", false, false)).toBe(true);
    expect(isPerformanceActionDisabled("FAILED", false, false)).toBe(false);
  });

  it("rejects stale responses after an address change", () => {
    expect(isCurrentPerformanceAddress("0x111", "0x111")).toBe(true);
    expect(isCurrentPerformanceAddress("0x111", "0x222")).toBe(false);
  });
});
