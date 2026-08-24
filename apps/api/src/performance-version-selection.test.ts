import { type PrismaClient } from "@chaincopy/database";
import { type PerformanceJobData } from "@chaincopy/domain";
import { type Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import { PerformanceRunNotFoundError, PrismaPerformanceService } from "./performance-service.js";
import { PerformanceRunTrustInconsistentError } from "./performance-run-trust.js";

interface TestRun {
  readonly calculationVersion: string;
  readonly id: string;
  readonly requestedAt: string;
  readonly status: string;
  readonly walletAddressId: string;
  readonly trustRevision: number;
  readonly trustState: "TRUSTED" | "QUARANTINED";
  readonly trustTransitions: readonly {
    readonly revision: number;
    readonly toState: "TRUSTED" | "QUARANTINED";
  }[];
}

interface RunQuery {
  readonly where: {
    readonly calculationVersion?: string;
    readonly id?: string;
    readonly status?: string;
    readonly walletAddressId?: string;
    readonly trustState?: string;
  };
}

function run(
  id: string,
  calculationVersion: string,
  requestedAt: string,
  walletAddressId = "wallet-1",
): TestRun {
  return {
    calculationVersion,
    id,
    requestedAt,
    status: "SUCCEEDED",
    walletAddressId,
    trustRevision: 0,
    trustState: "TRUSTED",
    trustTransitions: [],
  };
}

function createFindFirst(runs: readonly TestRun[]) {
  return vi.fn<(query: RunQuery) => Promise<TestRun | null>>(async (query) => {
    const matches = runs
      .filter(
        (candidate) =>
          (query.where.calculationVersion === undefined ||
            candidate.calculationVersion === query.where.calculationVersion) &&
          (query.where.id === undefined || candidate.id === query.where.id) &&
          (query.where.status === undefined || candidate.status === query.where.status) &&
          (query.where.trustState === undefined ||
            candidate.trustState === query.where.trustState) &&
          (query.where.walletAddressId === undefined ||
            candidate.walletAddressId === query.where.walletAddressId),
      )
      .sort(
        (left, right) =>
          right.requestedAt.localeCompare(left.requestedAt) || right.id.localeCompare(left.id),
      );
    return matches[0] ?? null;
  });
}

function serviceWithFindFirst(findFirst: unknown): PrismaPerformanceService {
  const database = {
    metricCalculationRun: { findFirst },
  } as unknown as PrismaClient;
  return new PrismaPerformanceService(database, {} as Queue<PerformanceJobData>);
}

async function findLatestSuccessful(service: PrismaPerformanceService): Promise<unknown> {
  const method: unknown = Reflect.get(service, "findLatestRun");
  if (typeof method !== "function") throw new TypeError("findLatestRun is unavailable.");
  return Reflect.apply(method, service, ["wallet-1", "SUCCEEDED"]);
}

async function resolveRun(service: PrismaPerformanceService, runId?: string): Promise<unknown> {
  const method: unknown = Reflect.get(service, "resolveRun");
  if (typeof method !== "function") throw new TypeError("resolveRun is unavailable.");
  return Reflect.apply(method, service, ["wallet-1", runId]);
}

const oldV2 = run("run-v2", "performance-v2", "2026-07-01T00:00:00.000Z");
const currentV3 = run("run-v3", "performance-v3", "2026-07-02T00:00:00.000Z");
const newV1 = run("run-v1", "performance-v1", "2026-07-03T00:00:00.000Z");
const futureV4 = run("run-v4", "performance-v4", "2026-07-04T00:00:00.000Z");

describe("performance calculation-version selection", () => {
  describe("findLatestRun", () => {
    it("selects v3 when a v3 run exists", async () => {
      const findFirst = createFindFirst([currentV3]);

      const result = await findLatestSuccessful(serviceWithFindFirst(findFirst));

      expect(result).toBe(currentV3);
      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
        where: {
          calculationVersion: "performance-v3",
          status: "SUCCEEDED",
          walletAddressId: "wallet-1",
        },
      });
    });

    it("selects v2 when v3 is absent", async () => {
      const findFirst = createFindFirst([oldV2]);

      const result = await findLatestSuccessful(serviceWithFindFirst(findFirst));

      expect(result).toBe(oldV2);
      expect(findFirst).toHaveBeenCalledTimes(2);
      expect(findFirst.mock.calls[1]?.[0]).toMatchObject({
        where: {
          calculationVersion: "performance-v2",
          status: "SUCCEEDED",
          walletAddressId: "wallet-1",
        },
      });
    });

    it("selects v3 when v3 and v2 coexist", async () => {
      const findFirst = createFindFirst([oldV2, currentV3]);

      const result = await findLatestSuccessful(serviceWithFindFirst(findFirst));

      expect(result).toBe(currentV3);
      expect(findFirst).toHaveBeenCalledTimes(1);
    });

    it("excludes a quarantined latest run and falls back to an older trusted run", async () => {
      const quarantined = {
        ...run("run-quarantined", "performance-v3", "2026-07-03T00:00:00.000Z"),
        trustRevision: 1,
        trustState: "QUARANTINED" as const,
        trustTransitions: [{ revision: 1, toState: "QUARANTINED" as const }],
      };
      const findFirst = createFindFirst([quarantined, currentV3]);

      const result = await findLatestSuccessful(serviceWithFindFirst(findFirst));

      expect(result).toBe(currentV3);
      expect(findFirst.mock.calls[0]?.[0].where).toMatchObject({ trustState: "TRUSTED" });
    });

    it("automatically selects a newer trusted successor", async () => {
      const successor = run("run-successor", "performance-v3", "2026-07-04T00:00:00.000Z");
      const result = await findLatestSuccessful(
        serviceWithFindFirst(createFindFirst([currentV3, successor])),
      );
      expect(result).toBe(successor);
    });

    it("fails closed when the selected trusted run has inconsistent provenance", async () => {
      const inconsistent = {
        ...currentV3,
        trustRevision: 1,
        trustTransitions: [],
      };
      await expect(
        findLatestSuccessful(serviceWithFindFirst(createFindFirst([inconsistent]))),
      ).rejects.toBeInstanceOf(PerformanceRunTrustInconsistentError);
    });

    it("selects v2 even when a v1 run is newer", async () => {
      const findFirst = createFindFirst([newV1, oldV2]);

      const result = await findLatestSuccessful(serviceWithFindFirst(findFirst));

      expect(result).toBe(oldV2);
    });

    it("returns no run when only v1 exists", async () => {
      const findFirst = createFindFirst([newV1]);

      const result = await findLatestSuccessful(serviceWithFindFirst(findFirst));

      expect(result).toBeNull();
      expect(findFirst).toHaveBeenCalledTimes(2);
    });

    it("returns no run when only an unknown version exists", async () => {
      const unknown = run("run-unknown", "custom-version", "2026-07-05T00:00:00.000Z");
      const findFirst = createFindFirst([unknown]);

      const result = await findLatestSuccessful(serviceWithFindFirst(findFirst));

      expect(result).toBeNull();
    });

    it("selects v2 instead of a future v4 run", async () => {
      const findFirst = createFindFirst([futureV4, oldV2]);

      const result = await findLatestSuccessful(serviceWithFindFirst(findFirst));

      expect(result).toBe(oldV2);
    });

    it("returns no run when only a future v4 run exists", async () => {
      const findFirst = createFindFirst([futureV4]);

      const result = await findLatestSuccessful(serviceWithFindFirst(findFirst));

      expect(result).toBeNull();
      expect(findFirst).toHaveBeenCalledTimes(2);
    });

    it("selects v3 when v3, v2, and v1 coexist", async () => {
      const findFirst = createFindFirst([newV1, oldV2, currentV3]);

      const result = await findLatestSuccessful(serviceWithFindFirst(findFirst));

      expect(result).toBe(currentV3);
      expect(findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveRun", () => {
    it("selects v3 when runId is omitted", async () => {
      const findFirst = createFindFirst([oldV2, currentV3]);

      const result = await resolveRun(serviceWithFindFirst(findFirst));

      expect(result).toBe(currentV3);
      expect(findFirst).toHaveBeenCalledTimes(1);
    });

    it("selects v2 when runId is omitted and v3 is absent", async () => {
      const findFirst = createFindFirst([oldV2]);

      const result = await resolveRun(serviceWithFindFirst(findFirst));

      expect(result).toBe(oldV2);
      expect(findFirst.mock.calls[1]?.[0]).toMatchObject({
        where: {
          calculationVersion: "performance-v2",
          status: "SUCCEEDED",
          walletAddressId: "wallet-1",
        },
      });
    });

    it("returns no run when runId is omitted and only v1 exists", async () => {
      const findFirst = createFindFirst([newV1]);

      const result = await resolveRun(serviceWithFindFirst(findFirst));

      expect(result).toBeNull();
      expect(findFirst).toHaveBeenCalledTimes(2);
    });

    it("gets the specified run when runId is explicit", async () => {
      const findFirst = createFindFirst([newV1]);

      const result = await resolveRun(serviceWithFindFirst(findFirst), newV1.id);

      expect(result).toBe(newV1);
      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(findFirst.mock.calls[0]?.[0]).toMatchObject({
        where: { id: newV1.id, walletAddressId: "wallet-1" },
      });
    });

    it("does not replace an explicit v2 run with v3", async () => {
      const findFirst = createFindFirst([currentV3, oldV2]);

      const result = await resolveRun(serviceWithFindFirst(findFirst), oldV2.id);

      expect(result).toBe(oldV2);
      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(findFirst.mock.calls[0]?.[0].where).not.toHaveProperty("calculationVersion");
    });

    it("does not get an explicit run belonging to another wallet", async () => {
      const otherWalletRun = run(
        "run-other-wallet",
        "performance-v3",
        "2026-07-06T00:00:00.000Z",
        "wallet-2",
      );
      const findFirst = createFindFirst([otherWalletRun]);

      await expect(
        resolveRun(serviceWithFindFirst(findFirst), otherWalletRun.id),
      ).rejects.toBeInstanceOf(PerformanceRunNotFoundError);
      expect(findFirst).toHaveBeenCalledTimes(1);
    });
  });
});
