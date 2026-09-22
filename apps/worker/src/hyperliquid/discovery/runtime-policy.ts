export interface DiscoveryRuntimePolicy {
  readonly candidateConsumer: boolean;
  readonly discoveryConsumer: boolean;
  readonly marketWebSocket: boolean;
  readonly scheduler: boolean;
}

export interface DiscoveryRuntimeOverrides {
  readonly candidateConsumer?: boolean;
  readonly discoveryConsumer?: boolean;
  readonly scheduler?: boolean;
}

export function createDiscoveryRuntimePolicy(
  enabled: boolean,
  overrides: DiscoveryRuntimeOverrides = {},
): DiscoveryRuntimePolicy {
  const scheduler = enabled && (overrides.scheduler ?? true);
  return {
    candidateConsumer: enabled && (overrides.candidateConsumer ?? true),
    discoveryConsumer: enabled && (overrides.discoveryConsumer ?? true),
    marketWebSocket: scheduler,
    scheduler,
  };
}
