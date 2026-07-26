export const adapterImplementationPhases = {
  hyperliquid: 2,
  suiCetus: 3,
} as const;

export interface ReadOnlyBlockchainAdapter {
  readonly source: "hyperliquid" | "sui" | "cetus";
  checkHealth(): Promise<"up" | "down">;
}
export * from "./hyperliquid/address.js";
export * from "./hyperliquid/client.js";
export * from "./hyperliquid/errors.js";
export * from "./hyperliquid/event-fingerprint.js";
export * from "./hyperliquid/http-client.js";
export * from "./hyperliquid/mapper.js";
export * from "./hyperliquid/rate-limiter.js";
export * from "./hyperliquid/schemas.js";
export * from "./hyperliquid/websocket-client.js";
