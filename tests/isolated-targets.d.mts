export function isolatedTargets(
  environment: Readonly<Record<string, string | undefined>>,
  prefix: "TEST" | "E2E",
): { databaseUrl: string; redisUrl: string };
