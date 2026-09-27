import { parseArgs } from "node:util";
import { loadRootEnvironment } from "@chaincopy/config";
import { disconnectDatabase, prisma } from "@chaincopy/database";
import { PrismaBehaviorAggregationService } from "../../../api/src/behavior-aggregation-service.js";

// Deliberately no Queue/Redis/client/scheduler imports: an explicit bounded projection only.
loadRootEnvironment();
try {
  const { values } = parseArgs({
    options: {
      coin: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      bucket: { type: "string" },
      execute: { type: "boolean", default: false },
      "expected-scope": { type: "string" },
    },
  });
  if (!values.coin || (values.bucket ? values.from || values.to : !values.from || !values.to))
    throw new Error(
      "Supply --coin and either --bucket or --from/--to; --execute explicitly persists.",
    );
  const service = new PrismaBehaviorAggregationService(prisma);
  const starts = values.bucket
    ? [values.bucket]
    : await service.plan(values.coin, values.from!, values.to!);
  for (const start of starts) {
    const result = await service.processBucket(
      values.coin,
      start,
      values.execute,
      values["expected-scope"],
    );
    console.log(
      JSON.stringify({
        coin: values.coin,
        start,
        status: result.status,
        ...("revisionId" in result
          ? {
              revisionId: result.revisionId,
              fingerprint: result.inputFingerprint,
              scopeFingerprint: result.scopeFingerprint,
              totals: result.totals,
              issues: result.snapshot.issues,
            }
          : {}),
      }),
    );
    if (result.status === "BLOCKED" || result.status === "NO_SELECTED_WALLETS")
      throw new Error("Aggregation stopped fail-closed; completed buckets remain reproducible.");
  }
  console.log(JSON.stringify({ completed: starts.length, executed: values.execute }));
} finally {
  await disconnectDatabase();
}
