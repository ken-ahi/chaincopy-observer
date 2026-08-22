import { createHash } from "node:crypto";

import {
  BEHAVIOR_VERSION,
  normalizeTimestampGroup,
  type BehaviorFillInput,
  type BehaviorGroupResult,
} from "@chaincopy/analytics";
import type { BehaviorJobData, BehaviorWalletCoinJobData } from "@chaincopy/domain";
import { type Queue } from "bullmq";

import { enqueueBehaviorJob } from "./queue.js";
import type { BehaviorFillRow, BehaviorRepository } from "./repository.js";

export interface BehaviorProcessResult {
  readonly outcome: "completed" | "continued" | "no-op" | "blocked";
  readonly processedEvents: number;
}

export class BehaviorNormalizationService {
  public constructor(
    private readonly repository: BehaviorRepository,
    private readonly queue: Queue<BehaviorJobData>,
  ) {}

  public async processControl(requestedAt: string): Promise<BehaviorProcessResult> {
    const wallets = await this.repository.listEffectiveSelectedWallets();
    if (wallets.length === 0) return { outcome: "no-op", processedEvents: 0 };
    for (const wallet of wallets) {
      for (const coin of await this.repository.listCoins(wallet.walletAddressId)) {
        await enqueueBehaviorJob(this.queue, {
          coin,
          kind: "wallet-coin",
          requestedAt,
          walletAddressId: wallet.walletAddressId,
        });
      }
    }
    return { outcome: "continued", processedEvents: 0 };
  }

  public async processWalletCoin(data: BehaviorWalletCoinJobData): Promise<BehaviorProcessResult> {
    const wallet = (await this.repository.listEffectiveSelectedWallets()).find(
      (candidate) => candidate.walletAddressId === data.walletAddressId,
    );
    if (!wallet) return { outcome: "no-op", processedEvents: 0 };
    if (data.rebuildFrom)
      await this.repository.rewindForLateFill(
        data.walletAddressId,
        data.coin,
        BEHAVIOR_VERSION,
        new Date(data.rebuildFrom),
      );
    const cursor = await this.repository.loadCursor(
      data.walletAddressId,
      data.coin,
      BEHAVIOR_VERSION,
    );
    const page = await this.repository.loadFillPage(
      data.walletAddressId,
      data.coin,
      cursor?.lastCompletedTimestamp ?? null,
    );
    if (page.fills.length === 0 && page.incompleteTimestampGroupAt === null)
      return { outcome: "completed", processedEvents: 0 };
    const calculationFrom =
      page.fills[0]?.occurredAt ?? page.incompleteTimestampGroupAt ?? new Date(data.requestedAt);
    const calculationTo =
      page.fills.at(-1)?.occurredAt ?? page.incompleteTimestampGroupAt ?? calculationFrom;
    const run = await this.repository.createRun({
      behaviorVersion: BEHAVIOR_VERSION,
      calculationFrom,
      calculationTo,
      coin: data.coin,
      inputFingerprint: createHash("sha256")
        .update(page.fills.map((fill) => fill.id).join("\u0000"))
        .digest("hex"),
      walletAddressId: data.walletAddressId,
    });
    await this.repository.addSelectionScope(run.id, wallet);
    if (await this.repository.hasHistoryGap(data.walletAddressId)) {
      await this.repository.recordIssue({
        coin: data.coin,
        detail: "An upstream synchronization cursor reports an unresolved history gap.",
        reason: "HISTORY_GAP",
        runId: run.id,
        sourceGroupAt: calculationFrom,
        walletAddressId: data.walletAddressId,
      });
      return { outcome: "blocked", processedEvents: 0 };
    }
    if (page.incompleteTimestampGroupAt) {
      await this.repository.recordIssue({
        coin: data.coin,
        detail: "Timestamp group exceeds the bounded maximum and was not split.",
        reason: "INCOMPLETE_TIMESTAMP_GROUP",
        runId: run.id,
        sourceGroupAt: page.incompleteTimestampGroupAt,
        walletAddressId: data.walletAddressId,
      });
      return { outcome: "blocked", processedEvents: 0 };
    }
    let boundary = cursor?.boundaryAfterPosition?.toString() ?? null;
    let processedEvents = 0;
    for (const group of timestampGroups(page.fills)) {
      const result = boundary === null ? resolveInitialBoundary(group) : normalize(group, boundary);
      if (!result.ok) {
        await this.repository.recordIssue({
          coin: data.coin,
          detail: result.detail,
          reason: result.reason,
          runId: run.id,
          sourceGroupAt: group[0]?.occurredAt ?? null,
          walletAddressId: data.walletAddressId,
        });
        return { outcome: "blocked", processedEvents };
      }
      await this.repository.saveSuccessfulGroup({
        afterPosition: result.afterPosition,
        behaviorVersion: BEHAVIOR_VERSION,
        coin: data.coin,
        completedAt: group[0]!.occurredAt,
        events: result.events,
        runId: run.id,
        walletAddressId: data.walletAddressId,
      });
      boundary = result.afterPosition;
      processedEvents += result.events.length;
    }
    await this.repository.completeRun(run.id);
    if (page.hasMore) {
      await enqueueBehaviorJob(this.queue, {
        coin: data.coin,
        continuationAfter: calculationTo.toISOString(),
        kind: "wallet-coin",
        requestedAt: new Date().toISOString(),
        walletAddressId: data.walletAddressId,
      });
      return { outcome: "continued", processedEvents };
    }
    return { outcome: "completed", processedEvents };
  }
}

function normalize(
  group: readonly BehaviorFillRow[],
  boundaryPosition: string,
): BehaviorGroupResult {
  return normalizeTimestampGroup({
    boundaryPosition,
    fills: group.map(toInput),
    market: marketForCoin(group[0]!.coin),
  });
}

function resolveInitialBoundary(group: readonly BehaviorFillRow[]): BehaviorGroupResult {
  const candidates = [...new Set(group.map((fill) => fill.startPosition))];
  const successes = candidates
    .map((boundary) => normalize(group, boundary))
    .filter((result): result is Extract<BehaviorGroupResult, { ok: true }> => result.ok);
  if (successes.length === 1) return successes[0]!;
  return successes.length > 1
    ? {
        ok: false,
        reason: "ORDERING_AMBIGUOUS",
        detail: "The initial timestamp group has multiple valid boundary chains.",
      }
    : {
        ok: false,
        reason: "MISSING_BOUNDARY",
        detail: "No trusted initial boundary produces a complete chain.",
      };
}

function marketForCoin(coin: string) {
  return coin.includes(":")
    ? { quoteAsset: "UNKNOWN", usdEquivalent: false }
    : { quoteAsset: "USDC", usdEquivalent: true };
}

function toInput(fill: BehaviorFillRow): BehaviorFillInput {
  return {
    coin: fill.coin,
    occurredAt: fill.occurredAt,
    price: fill.price,
    quantity: fill.size,
    side: fill.side,
    sourceEventId: fill.id,
    sourceTradeId: fill.sourceTradeId,
    startPosition: fill.startPosition,
  };
}

function timestampGroups(
  fills: readonly BehaviorFillRow[],
): readonly (readonly BehaviorFillRow[])[] {
  const groups: BehaviorFillRow[][] = [];
  for (const fill of fills) {
    const current = groups.at(-1);
    if (!current || current[0]!.occurredAt.getTime() !== fill.occurredAt.getTime())
      groups.push([fill]);
    else current.push(fill);
  }
  return groups;
}
