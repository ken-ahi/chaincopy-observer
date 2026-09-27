// Reserved local test endpoints. Never infer these from runtime connection variables.
export function isolatedTargets(environment, prefix) {
  const databaseUrl = environment[`${prefix}_DATABASE_URL`];
  const redisUrl = environment[`${prefix}_REDIS_URL`];
  if (!databaseUrl || !redisUrl)
    throw new Error(`Explicit ${prefix} isolated connection targets are required.`);
  const database = new URL(databaseUrl);
  const redis = new URL(redisUrl);
  const schema = prefix === "E2E" ? "chaincopy_e2e" : "public";
  if (
    !["postgresql:", "postgres:"].includes(database.protocol) ||
    database.hostname !== "127.0.0.1" ||
    database.port !== "55433" ||
    database.pathname !== "/chaincopy" ||
    database.searchParams.get("schema") !== schema ||
    redis.protocol !== "redis:" ||
    redis.hostname !== "127.0.0.1" ||
    redis.port !== "56380" ||
    redis.pathname !== (prefix === "E2E" ? "/15" : "/0")
  ) {
    throw new Error("Refusing tests outside the explicitly isolated PostgreSQL/Redis endpoints.");
  }
  return { databaseUrl, redisUrl };
}
