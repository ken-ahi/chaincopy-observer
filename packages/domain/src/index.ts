export const systemJobNames = {
  sampleHealthCheck: "sample.health-check",
} as const;

export type SystemJobName = (typeof systemJobNames)[keyof typeof systemJobNames];

export type ComponentStatus = "up" | "down";

export interface HealthComponent {
  readonly latencyMs: number;
  readonly status: ComponentStatus;
}

export interface ServiceHealth {
  readonly checkedAt: string;
  readonly components: Readonly<Record<string, HealthComponent>>;
  readonly service: string;
  readonly status: "healthy" | "unhealthy";
}
