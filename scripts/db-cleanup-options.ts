import { isCleanupTable, type CleanupTable } from "./db-cleanup-policy.js";

export interface CleanupCliOptions {
  readonly batchSize: number;
  readonly delayMs: number;
  readonly dryRun: boolean;
  readonly explain: boolean;
  readonly help: boolean;
  readonly status?: string;
  readonly table?: CleanupTable;
}

export const cleanupHelp = `Usage: pnpm db:cleanup [options]

Options:
  --dry-run             Count eligible rows without deleting them
  --explain             Print the batch-selection EXPLAIN plan without deleting
  --table <table>       sync_jobs | raw_events | order_history
  --status <status>     Restrict a table rule to one supported status
  --batch-size <count>  Rows per transaction (default: 1000, max: 10000)
  --delay-ms <ms>       Delay between full batches (default: 100)
  --help                Show this help without connecting to the database`;

export function parseCleanupOptions(arguments_: readonly string[]): CleanupCliOptions {
  const knownFlags = new Set([
    "--batch-size",
    "--delay-ms",
    "--dry-run",
    "--explain",
    "--help",
    "--status",
    "--table",
  ]);
  const valueFlags = new Set(["--batch-size", "--delay-ms", "--status", "--table"]);
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (!knownFlags.has(argument)) throw new RangeError(`Unknown cleanup option: ${argument}`);
    if (!valueFlags.has(argument)) continue;
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) throw new RangeError(`${argument} requires a value.`);
    values.set(argument, value);
    index += 1;
  }
  const batchSize = Number(values.get("--batch-size") ?? "1000");
  const delayMs = Number(values.get("--delay-ms") ?? "100");
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new RangeError("--batch-size must be an integer from 1 to 10000.");
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
    throw new RangeError("--delay-ms must be an integer from 0 to 60000.");
  }
  if (arguments_.includes("--dry-run") && arguments_.includes("--explain")) {
    throw new RangeError("--dry-run and --explain cannot be used together.");
  }
  const tableValue = values.get("--table");
  if (tableValue && !isCleanupTable(tableValue)) {
    throw new RangeError(`Unsupported cleanup table: ${tableValue}`);
  }
  return {
    batchSize,
    delayMs,
    dryRun: arguments_.includes("--dry-run"),
    explain: arguments_.includes("--explain"),
    help: arguments_.includes("--help"),
    status: values.get("--status"),
    table: tableValue,
  };
}
