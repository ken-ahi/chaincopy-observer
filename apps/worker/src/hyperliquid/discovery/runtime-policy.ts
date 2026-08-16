export interface DiscoveryRuntimePolicy {
  readonly candidateConsumer: boolean;
  readonly discoveryConsumer: boolean;
  readonly marketWebSocket: boolean;
  readonly scheduler: boolean;
}

export function createDiscoveryRuntimePolicy(enabled: boolean): DiscoveryRuntimePolicy {
  return {
    candidateConsumer: enabled,
    discoveryConsumer: enabled,
    marketWebSocket: enabled,
    scheduler: enabled,
  };
}
