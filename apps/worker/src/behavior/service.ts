import { createHash } from "node:crypto";

import {
  BEHAVIOR_VERSION,
  canonicalDecimal,
  normalizeTimestampGroup,
  type BehaviorFillInput,
  type BehaviorGroupResult,
} from "@chaincopy/analytics";
import type { BehaviorJobData, BehaviorWalletCoinJobData } from "@chaincopy/domain";
import { type Queue } from "bullmq";

import { enqueueBehaviorJob } from "./queue.js";
import {
  unresolvedBehaviorMarket,
  type BehaviorMarketResolver,
  type BehaviorMarketResolution,
} from "./market-provenance.js";
import type { BehaviorFillRow, BehaviorRepository } from "./repository.js";
import type { BehaviorSelectionSource } from "./selection-source.js";

export interface BehaviorProcessResult {
  readonly outcome: "completed" | "continued" | "no-op" | "blocked";
  readonly processedEvents: number;
}

export class BehaviorNormalizationService {
  public constructor(
    private readonly repository: BehaviorRepository,
    private readonly selectionSource: BehaviorSelectionSource,
    private readonly queue: Queue<BehaviorJobData>,
    private readonly marketResolver?: BehaviorMarketResolver,
  ) {}

  public async processControl(requestedAt: string): Promise<BehaviorProcessResult> {
    const wallets = await this.selectionSource.listEffectiveSelectedWallets();
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
    const wallet = (await this.selectionSource.listEffectiveSelectedWallets()).find(
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
    const market = this.marketResolver
      ? await this.marketResolver.resolve(data.coin)
      : unresolvedBehaviorMarket(data.coin);
    const inputDigest = createHash("sha256").update(
      page.fills.map((fill) => fill.id).join("\u0000"),
    );
    if (market.evidence) inputDigest.update(`\u0000${market.evidence.fingerprint}`);
    const run = await this.repository.createRun({
      behaviorVersion: BEHAVIOR_VERSION,
      calculationFrom,
      calculationTo,
      coin: data.coin,
      inputFingerprint: inputDigest.digest("hex"),
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
    if (market.evidence) {
      if (page.fills.some((fill) => fill.feeToken !== market.evidence!.contract.collateralAsset)) {
        await this.repository.recordIssue({
          coin: data.coin,
          detail: "Fill fee asset conflicts with the proven collateral asset.",
          reason: "SOURCE_INCONSISTENT",
          runId: run.id,
          sourceGroupAt: calculationFrom,
          walletAddressId: data.walletAddressId,
        });
        return { outcome: "blocked", processedEvents: 0 };
      }
      // No custom event may commit until its exact official evidence is durable.
      await this.repository.recordQuoteEvidence(run.id, data.walletAddressId, market.evidence);
    }
    let boundary = cursor?.boundaryAfterPosition?.toString() ?? null;
    let processedEvents = 0;
    for (const group of timestampGroups(page.fills)) {
      const result =
        boundary === null
          ? resolveInitialBoundary(group, market)
          : normalize(group, boundary, market);
      if (!result.ok) {
        await this.repository.recordIssue({
          coin: data.coin,
          detail:
            result.reason === "UNSUPPORTED_QUOTE"
              ? (market.detail ?? result.detail)
              : result.detail,
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
  market: BehaviorMarketResolution,
): BehaviorGroupResult {
  return normalizeTimestampGroup({
    boundaryPosition,
    fills: group.map(toInput),
    market,
  });
}

function resolveInitialBoundary(
  group: readonly BehaviorFillRow[],
  market: BehaviorMarketResolution,
): BehaviorGroupResult {
  let positions: string[];
  try {
    positions = group.map((fill) => canonicalDecimal(fill.startPosition));
  } catch (error) {
    return {
      ok: false,
      reason: "INVALID_DECIMAL",
      detail: error instanceof Error ? error.message : "Invalid initial position Decimal.",
    };
  }
  if (!positions.includes("0"))
    return {
      ok: false,
      reason: "MISSING_BOUNDARY",
      detail: "The initial timestamp group has no source-proven FLAT boundary.",
    };
  // Do not infer a nonzero boundary, or mask quote/order/source errors as missing history.
  return normalize(group, "0", market);
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
