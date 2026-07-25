export const adapterImplementationPhases = {
  hyperliquid: 2,
  suiCetus: 3,
} as const;

export interface ReadOnlyBlockchainAdapter {
  readonly source: "hyperliquid" | "sui" | "cetus";
  checkHealth(): Promise<"up" | "down">;
}
