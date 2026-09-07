import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseAndValidateStage3AManifest,
  verifyCurrentRows,
  type CurrentPortfolioRow,
  type CurrentRawRow,
  type CurrentSyncJob,
} from "./issue26-stage3b-preflight-policy.js";

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export async function runStage3BReadOnlyPreflight(
  manifestPath: string,
): Promise<Readonly<Record<string, unknown>>> {
  const manifest = parseAndValidateStage3AManifest(await readFile(manifestPath, "utf8"));
  const { PrismaClient } = await import("@chaincopy/database");
  const database = new PrismaClient();
  try {
    return await database.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const [
          portfolioRows,
          rawRows,
          syncJobs,
          quarantinedRuns,
          portfolioCount,
          rawCount,
          transitionCount,
        ] = await Promise.all([
          transaction.portfolioSnapshot.findMany({
            select: {
              capturedAt: true,
              createdAt: true,
              fingerprint: true,
              id: true,
              snapshotType: true,
              sourceId: true,
              walletAddressId: true,
            },
            where: { id: { in: manifest.deleteRows.map((row) => row.id) } },
          }),
          transaction.rawEvent.findMany({
            select: {
              eventType: true,
              fingerprint: true,
              id: true,
              receivedAt: true,
              sourceId: true,
              walletAddressId: true,
            },
            where: { id: { in: manifest.keepRows.map((row) => row.id) } },
          }),
          transaction.syncJob.findMany({
            select: {
              finishedAt: true,
              id: true,
              idempotencyKey: true,
              jobName: true,
              startedAt: true,
              walletAddressId: true,
            },
            where: { id: { in: manifest.jobs.map((job) => job.id) } },
          }),
          transaction.metricCalculationRun.findMany({
            select: { id: true, status: true, trustRevision: true, trustState: true },
            where: { trustState: "QUARANTINED" },
          }),
          transaction.portfolioSnapshot.count(),
          transaction.rawEvent.count(),
          transaction.performanceRunTrustTransition.count(),
        ]);
        const match = verifyCurrentRows({
          manifest,
          portfolioRows: portfolioRows.map((row): CurrentPortfolioRow => ({
            ...row,
            capturedAt: iso(row.capturedAt)!,
            createdAt: iso(row.createdAt)!,
          })),
          rawRows: rawRows.map((row): CurrentRawRow => ({
            ...row,
            receivedAt: iso(row.receivedAt)!,
          })),
          syncJobs: syncJobs.map((job): CurrentSyncJob => ({
            ...job,
            finishedAt: iso(job.finishedAt),
            startedAt: iso(job.startedAt),
          })),
        });
        const runIds = quarantinedRuns.map((run) => run.id);
        const [
          metricCount,
          cycleCount,
          dailyNavCount,
          selectionReferenceCount,
          behaviorReferenceCount,
        ] = await Promise.all([
          transaction.addressPerformanceMetric.count({
            where: { calculationRunId: { in: runIds } },
          }),
          transaction.positionCycle.count({ where: { calculationRunId: { in: runIds } } }),
          transaction.dailyNav.count({ where: { calculationRunId: { in: runIds } } }),
          transaction.walletSelectionResult.count({ where: { performanceRunId: { in: runIds } } }),
          transaction.behaviorSelectionScope.count({ where: { performanceRunId: { in: runIds } } }),
        ]);
        const quarantineReady =
          quarantinedRuns.length === 14 &&
          quarantinedRuns.every(
            (run) =>
              run.status === "SUCCEEDED" &&
              run.trustState === "QUARANTINED" &&
              run.trustRevision === 1,
          ) &&
          metricCount === 115 &&
          cycleCount === 171 &&
          dailyNavCount === 68 &&
          selectionReferenceCount === 0 &&
          behaviorReferenceCount === 0 &&
          transitionCount === 14;
        return {
          manifest: {
            artifactSha256: manifest.artifactSha256,
            deleteRows: manifest.deleteRows.length,
            incidentRows: manifest.deleteRows.length + manifest.keepRows.length,
            keepRows: manifest.keepRows.length,
            sourceJobs: manifest.jobs.length,
          },
          exactMatch: match,
          database: { portfolioCount, rawCount, transitionCount },
          quarantine: {
            behaviorReferenceCount,
            cycleCount,
            dailyNavCount,
            metricCount,
            quarantineReady,
            runCount: quarantinedRuns.length,
            runIds: runIds.sort(),
            selectionReferenceCount,
          },
          ready: match.ready && quarantineReady,
        };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  } finally {
    await database.$disconnect();
  }
}

async function main(): Promise<void> {
  const manifestPath = resolve(process.cwd(), "docs/issue26-stage3a-repair-manifest.json");
  const report = await runStage3BReadOnlyPreflight(manifestPath);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.ready !== true) process.exitCode = 1;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
