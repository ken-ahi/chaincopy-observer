import type { PrismaClient } from "@chaincopy/database";
import { XYZ_CL_QUOTE_CONTRACT } from "@chaincopy/blockchain-adapters";
import { describe, expect, it, vi } from "vitest";

import { BEHAVIOR_QUOTE_EVIDENCE_TYPE, type BehaviorQuoteEvidence } from "./market-provenance.js";
import { BehaviorRepository } from "./repository.js";

describe("Behavior quote evidence persistence", () => {
  const evidence: BehaviorQuoteEvidence = {
    contract: XYZ_CL_QUOTE_CONTRACT,
    fingerprint: "proof-1",
    responses: [],
  };

  it("uses append-only unique Run evidence and preserves the first receipt on retry", async () => {
    const rows = new Map<
      string,
      {
        externalEventId: string;
        fingerprint: string;
        walletAddressId: string;
        eventType: string;
        rawPayload: string;
      }
    >();
    const createMany = vi.fn(async ({ data, skipDuplicates }) => {
      expect(skipDuplicates).toBe(true);
      for (const row of data)
        if (!rows.has(row.externalEventId)) rows.set(row.externalEventId, row);
    });
    const database = {
      rawEvent: {
        createMany,
        findUniqueOrThrow: vi.fn(async ({ where }) =>
          rows.get(where.sourceId_externalEventId.externalEventId),
        ),
      },
    } as unknown as PrismaClient;
    const repository = new BehaviorRepository(database, "source-1");
    await repository.recordQuoteEvidence("run-1", "wallet-1", evidence);
    const original = JSON.stringify([...rows]);
    await repository.recordQuoteEvidence("run-1", "wallet-1", evidence);
    expect(JSON.stringify([...rows])).toBe(original);
    expect(rows.size).toBe(1);
    expect(JSON.parse(rows.get(`${BEHAVIOR_QUOTE_EVIDENCE_TYPE}:run-1`)!.rawPayload)).toEqual({
      normalizationRunId: "run-1",
      ...evidence,
    });
    await expect(
      repository.recordQuoteEvidence("run-1", "wallet-1", { ...evidence, fingerprint: "conflict" }),
    ).rejects.toThrow("conflicts");
    await expect(
      repository.recordQuoteEvidence("run-1", "another-wallet", evidence),
    ).rejects.toThrow("conflicts");
    expect(JSON.stringify([...rows])).toBe(original);
  });
});
