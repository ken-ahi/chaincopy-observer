const hyperliquidQueueName = "hyperliquid-sync";
const hyperliquidDiscoveryQueueName = "hyperliquid-discovery";
const hyperliquidCandidateQueueName = "hyperliquid-candidate-enrichment";

export const cleanupQueueNames = [
  hyperliquidQueueName,
  hyperliquidDiscoveryQueueName,
  hyperliquidCandidateQueueName,
] as const;
export type CleanupQueueName = (typeof cleanupQueueNames)[number];

export interface QueueCleanupOptions {
  readonly batchSize: number;
  readonly before: Date;
  readonly dryRun: boolean;
  readonly help: boolean;
  readonly queue: CleanupQueueName;
}

export const queueCleanupHelp = `Usage: pnpm queue:cleanup [options]

Safely inspects or removes old BullMQ jobs. Run the worker and scheduler stopped.

Options:
  --dry-run             Inspect and report without deleting jobs
  --queue <name>        Queue name (required; hyperliquid-sync,
                        hyperliquid-discovery, or hyperliquid-candidate-enrichment)
  --before <date-time>  Delete jobs with requestedAt <= this ISO-8601 instant (required)
  --batch-size <count>  Jobs fetched per BullMQ API batch (default: 1000, max: 10000)
  --help                Show this help without connecting to Redis`;

export function parseQueueCleanupOptions(arguments_: readonly string[]): QueueCleanupOptions {
  const knownFlags = new Set(["--batch-size", "--before", "--dry-run", "--help", "--queue"]);
  const valueFlags = new Set(["--batch-size", "--before", "--queue"]);
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (!knownFlags.has(argument))
      throw new RangeError(`Unknown queue cleanup option: ${argument}`);
    if (!valueFlags.has(argument)) continue;
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) throw new RangeError(`${argument} requires a value.`);
    if (values.has(argument)) throw new RangeError(`${argument} may only be specified once.`);
    values.set(argument, value);
    index += 1;
  }

  const help = arguments_.includes("--help");
  const batchSize = Number(values.get("--batch-size") ?? "1000");
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new RangeError("--batch-size must be an integer from 1 to 10000.");
  }
  const queue = values.get("--queue");
  if (!help && !cleanupQueueNames.some((name) => name === queue)) {
    throw new RangeError(`--queue must be one of: ${cleanupQueueNames.join(", ")}.`);
  }
  const beforeValue = values.get("--before");
  const before = new Date(beforeValue ?? "");
  if (!help && (!beforeValue || !Number.isFinite(before.getTime()))) {
    throw new RangeError("--before must be a valid ISO-8601 date-time.");
  }
  return {
    batchSize,
    before,
    dryRun: arguments_.includes("--dry-run"),
    help,
    queue: cleanupQueueNames.find((name) => name === queue) ?? hyperliquidQueueName,
  };
}
