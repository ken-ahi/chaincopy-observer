import { resolve } from "node:path";

import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

const nodeEnvironmentSchema = z.enum(["development", "test", "production"]).default("development");
const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info");
const portSchema = z.coerce.number().int().min(1).max(65_535);
const positiveDecimalStringSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Expected a non-negative decimal string.");
const booleanEnvironmentSchema = z.enum(["true", "false"]).transform((value) => value === "true");
const commaSeparatedSchema = z.string().transform((value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);

const sharedSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema,
  LOG_LEVEL: logLevelSchema,
  TZ: z.literal("Asia/Tokyo").default("Asia/Tokyo"),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  REDIS_URL: z.string().url().startsWith("redis://"),
});

export const webEnvSchema = sharedSchema.extend({
  APP_BASE_URL: z.string().url(),
  NEXTAUTH_URL: z.string().url().optional(),
  API_BASE_URL: z.string().url().default("http://localhost:3001"),
  INTERNAL_API_SECRET: z.string().min(32),
  AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ALLOWED_ADMIN_EMAIL: z.string().trim().toLowerCase().email(),
});

export const apiEnvSchema = sharedSchema.extend({
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: portSchema.default(3001),
  INTERNAL_API_SECRET: z.string().min(32),
});

export const workerEnvSchema = sharedSchema.extend({
  WORKER_HEALTH_PORT: portSchema.default(3002),
  HYPERLIQUID_API_URL: z.string().url().default("https://api.hyperliquid.xyz/info"),
  HYPERLIQUID_WS_URL: z.string().url().startsWith("wss://").default("wss://api.hyperliquid.xyz/ws"),
  HYPERLIQUID_NETWORK: z.enum(["mainnet", "testnet"]).default("mainnet"),
  HYPERLIQUID_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  HYPERLIQUID_SYNC_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
  HYPERLIQUID_DISCOVERY_ENABLED: booleanEnvironmentSchema.default(false),
  HYPERLIQUID_DISCOVERY_MODE: z.enum(["MAJOR", "ALL"]).default("MAJOR"),
  HYPERLIQUID_DISCOVERY_PRIORITY_COINS: commaSeparatedSchema.default([
    "BTC",
    "ETH",
    "SOL",
    "HYPE",
    "SUI",
  ]),
  HYPERLIQUID_DISCOVERY_MIN_TRADES: z.coerce.number().int().min(1).default(10),
  HYPERLIQUID_DISCOVERY_MIN_NOTIONAL_USD: positiveDecimalStringSchema.default("10000"),
  HYPERLIQUID_DISCOVERY_RECENT_HOURS: z.coerce.number().int().min(1).default(24),
  HYPERLIQUID_DISCOVERY_ENRICHMENT_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  HYPERLIQUID_DISCOVERY_MIN_ENRICHMENT_INTERVAL_MIN: z.coerce.number().int().min(1).default(1_440),
  HYPERLIQUID_DISCOVERY_SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(5_000).default(10_000),
  HYPERLIQUID_DISCOVERY_MAX_RECONNECT_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(12),
  HYPERLIQUID_DISCOVERY_KNOWN_SYSTEM_ADDRESSES: commaSeparatedSchema.default([
    "0x0000000000000000000000000000000000000000",
  ]),
  HYPERLIQUID_API_WEIGHT_PER_MINUTE: z.coerce.number().int().min(100).max(1_200).default(1_200),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadRootEnvironment(currentDirectory = process.cwd()): void {
  const candidatePaths = [
    resolve(currentDirectory, ".env"),
    resolve(currentDirectory, "..", "..", ".env"),
  ];

  for (const path of candidatePaths) {
    loadDotEnv({ path, override: false, quiet: true });
  }
}

export function readWebEnv(environment: NodeJS.ProcessEnv = process.env): WebEnv {
  return webEnvSchema.parse(withBuildFallbacks(environment));
}

export function readApiEnv(environment: NodeJS.ProcessEnv = process.env): ApiEnv {
  return apiEnvSchema.parse(environment);
}

export function readWorkerEnv(environment: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return workerEnvSchema.parse(environment);
}

function withBuildFallbacks(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (environment.NEXT_PHASE !== "phase-production-build") {
    return environment;
  }

  return {
    DATABASE_URL: "postgresql://build:build@127.0.0.1:5432/build",
    REDIS_URL: "redis://127.0.0.1:6379",
    APP_BASE_URL: "http://localhost:3000",
    API_BASE_URL: "http://localhost:3001",
    INTERNAL_API_SECRET: "build-only-internal-secret-at-least-32-characters",
    AUTH_SECRET: "build-only-placeholder-secret-at-least-32-characters",
    GOOGLE_CLIENT_ID: "build-only-client-id",
    GOOGLE_CLIENT_SECRET: "build-only-client-secret",
    ALLOWED_ADMIN_EMAIL: "build@example.com",
    ...environment,
  };
}
