import { describe, expect, it } from "vitest";

import { createDiscoveryRuntimePolicy } from "./runtime-policy.js";

describe("discovery runtime policy", () => {
  it("disables every producer and consumer when discovery is disabled", () => {
    expect(createDiscoveryRuntimePolicy(false)).toEqual({
      candidateConsumer: false,
      discoveryConsumer: false,
      marketWebSocket: false,
      scheduler: false,
    });
  });

  it("enables the complete discovery pipeline together", () => {
    expect(Object.values(createDiscoveryRuntimePolicy(true)).every(Boolean)).toBe(true);
  });
});
