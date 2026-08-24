import { type PerformanceRunTrustState, type PrismaClient } from "@chaincopy/database";
import { describe, expect, it, vi } from "vitest";

import {
  assertPerformanceRunTrustConsistency,
  PerformanceRunTrustInconsistentError,
  PerformanceRunTrustService,
} from "./performance-run-trust.js";

describe("performance run trust", () => {
  it("accepts legacy trusted runs and matching transition provenance", () => {
    expect(() =>
      assertPerformanceRunTrustConsistency("legacy", {
        trustRevision: 0,
        trustState: "TRUSTED",
        trustTransitions: [],
      }),
    ).not.toThrow();
    expect(() =>
      assertPerformanceRunTrustConsistency("restored", {
        trustRevision: 2,
        trustState: "TRUSTED",
        trustTransitions: [{ revision: 2, toState: "TRUSTED" }],
      }),
    ).not.toThrow();
  });

  it("fails closed for unknown or inconsistent trust provenance", () => {
    expect(() =>
      assertPerformanceRunTrustConsistency("bad", {
        trustRevision: 1,
        trustState: "TRUSTED",
        trustTransitions: [{ revision: 1, toState: "QUARANTINED" }],
      }),
    ).toThrow(PerformanceRunTrustInconsistentError);
  });

  it("quarantines once and treats a repeated operation key as idempotent", async () => {
    let state: PerformanceRunTrustState = "TRUSTED";
    let revision = 0;
    const operations = new Map<
      string,
      { performanceRunId: string; revision: number; toState: PerformanceRunTrustState }
    >();
    const transaction = {
      metricCalculationRun: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "run-1",
          trustRevision: revision,
          trustState: state,
          trustTransitions: revision === 0 ? [] : [{ revision, toState: state }],
        })),
        updateMany: vi.fn(
          async (input: {
            data: { trustRevision: number; trustState: PerformanceRunTrustState };
          }) => {
            revision = input.data.trustRevision;
            state = input.data.trustState;
            return { count: 1 };
          },
        ),
      },
      performanceRunTrustTransition: {
        create: vi.fn(
          async (input: {
            data: {
              operationKey: string;
              performanceRunId: string;
              revision: number;
              toState: PerformanceRunTrustState;
            };
          }) => {
            operations.set(input.data.operationKey, input.data);
            return input.data;
          },
        ),
        findUnique: vi.fn(
          async (input: { where: { operationKey: string } }) =>
            operations.get(input.where.operationKey) ?? null,
        ),
      },
    };
    const database = {
      $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as PrismaClient;
    const service = new PerformanceRunTrustService(database);
    const change = {
      actor: "owner",
      incidentRef: "#20",
      operationKey: "issue-20/run-1/quarantine",
      reasonCode: "CONTAMINATED_INPUT",
    };

    await expect(service.quarantine("run-1", change)).resolves.toMatchObject({
      changed: true,
      trustRevision: 1,
      trustState: "QUARANTINED",
    });
    await expect(service.quarantine("run-1", change)).resolves.toMatchObject({
      changed: false,
      trustRevision: 1,
      trustState: "QUARANTINED",
    });
    expect(transaction.performanceRunTrustTransition.create).toHaveBeenCalledTimes(1);

    const restore = {
      actor: "owner",
      operationKey: "issue-20/run-1/restore",
      reasonCode: "CLEAN_INPUT_VERIFIED",
    };
    await expect(service.restoreTrusted("run-1", restore)).resolves.toMatchObject({
      changed: true,
      trustRevision: 2,
      trustState: "TRUSTED",
    });
    await expect(service.restoreTrusted("run-1", restore)).resolves.toMatchObject({
      changed: false,
      trustRevision: 2,
      trustState: "TRUSTED",
    });
    expect(transaction.performanceRunTrustTransition.create).toHaveBeenCalledTimes(2);
  });
});
