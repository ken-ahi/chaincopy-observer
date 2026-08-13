export const rejectOrderStatuses = [
  "badAloPxRejected",
  "iocCancelRejected",
  "perpMarginRejected",
  "reduceOnlyRejected",
  "selfTradeCanceled",
] as const;

export type CleanupTable = "order_history" | "raw_events" | "sync_jobs";

export interface CleanupRule {
  readonly cutoff: Date;
  readonly status?: string;
  readonly table: CleanupTable;
}

export function createCleanupRules(
  now: Date,
  table?: CleanupTable,
  status?: string,
): CleanupRule[] {
  const daysAgo = (days: number): Date => new Date(now.getTime() - days * 86_400_000);
  const rules: CleanupRule[] = [
    { cutoff: daysAgo(7), status: "SUCCEEDED", table: "sync_jobs" },
    { cutoff: daysAgo(30), status: "FAILED", table: "sync_jobs" },
    { cutoff: daysAgo(30), table: "raw_events" },
    ...rejectOrderStatuses.map((rejectStatus) => ({
      cutoff: daysAgo(7),
      status: rejectStatus,
      table: "order_history" as const,
    })),
  ];
  return rules.filter(
    (rule) => (!table || rule.table === table) && (!status || rule.status === status),
  );
}

export function isCleanupTable(value: string): value is CleanupTable {
  return value === "sync_jobs" || value === "raw_events" || value === "order_history";
}

export interface CleanupAdapter {
  count(rule: CleanupRule): Promise<bigint>;
  deleteBatch(rule: CleanupRule, batchSize: number): Promise<number>;
}

export async function executeCleanupRule(input: {
  readonly adapter: CleanupAdapter;
  readonly batchSize: number;
  readonly dryRun: boolean;
  readonly onBatch?: (deleted: number) => Promise<void>;
  readonly rule: CleanupRule;
}): Promise<{ readonly deleted: number; readonly planned: bigint }> {
  const planned = await input.adapter.count(input.rule);
  if (input.dryRun) return { deleted: 0, planned };
  let deleted = 0;
  while (true) {
    const batchDeleted = await input.adapter.deleteBatch(input.rule, input.batchSize);
    if (batchDeleted < 0 || batchDeleted > input.batchSize) {
      throw new RangeError("Cleanup adapter returned an invalid batch count.");
    }
    deleted += batchDeleted;
    await input.onBatch?.(batchDeleted);
    if (batchDeleted < input.batchSize) return { deleted, planned };
  }
}
