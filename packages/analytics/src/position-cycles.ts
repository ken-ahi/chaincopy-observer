import type { Decimal } from "decimal.js";

import {
  AnalysisDecimal,
  CalculationException,
  canonical,
  compareText,
  coverageFromTimes,
  decimal,
  execute,
  parseTime,
  warning,
} from "./core.js";
import type {
  AggregatePnl,
  CalculationCoverage,
  CalculationResult,
  CalculationWarning,
  CycleFill,
  CycleFunding,
  CyclePnl,
  FillInput,
  FundingInput,
  PositionCycle,
  TrustedTradeHistory,
} from "./types.js";

interface InternalCycle {
  readonly coin: string;
  readonly id: string;
  readonly openedAt: string;
  readonly side: "LONG" | "SHORT";
  averageEntryPrice: Decimal;
  closedAt: string | null;
  readonly fills: CycleFill[];
  readonly fundingEvents: CycleFunding[];
}

interface CoinState {
  averageEntryPrice: Decimal | null;
  cycle: InternalCycle | null;
  position: Decimal;
  sequence: number;
}

interface ParsedFill {
  readonly closedPnl: Decimal;
  readonly fee: Decimal;
  readonly input: FillInput;
  readonly price: Decimal;
  readonly size: Decimal;
  readonly startPosition: Decimal;
  readonly time: number;
}

export function buildPositionCycles(
  fills: readonly FillInput[],
  funding: readonly FundingInput[],
  coverage: CalculationCoverage,
): CalculationResult<readonly PositionCycle[]> {
  return execute(coverage, "DERIVED", () => {
    if (fills.length === 0) {
      throw new CalculationException("INSUFFICIENT_HISTORY", "At least one fill is required.");
    }

    const parsedFills = stableFills(fills);
    const states = new Map<string, CoinState>();
    const cycles: InternalCycle[] = [];
    const warnings: CalculationWarning[] = [];
    const trustedFills = selectTrustedFills(parsedFills, warnings);
    const discontinuedCoins = new Set<string>();

    for (const fill of trustedFills) {
      if (discontinuedCoins.has(fill.input.coin)) {
        continue;
      }
      const state = states.get(fill.input.coin) ?? {
        averageEntryPrice: null,
        cycle: null,
        position: new AnalysisDecimal(0),
        sequence: 0,
      };
      if (!fill.startPosition.eq(state.position)) {
        if (state.cycle !== null) {
          const untrustedCycleIndex = cycles.indexOf(state.cycle);
          if (untrustedCycleIndex !== -1) {
            cycles.splice(untrustedCycleIndex, 1);
          }
        }
        warnings.push(
          warning(
            "POSITION_DISCONTINUITY",
            `Fill ${fill.input.externalId} startPosition does not match the reconstructed position; later fills for ${fill.input.coin} were excluded.`,
            {
              actualStartPosition: canonical(fill.startPosition),
              coin: fill.input.coin,
              expectedStartPosition: canonical(state.position),
              externalId: fill.input.externalId,
            },
          ),
        );
        discontinuedCoins.add(fill.input.coin);
        continue;
      }

      const delta = fill.input.side === "BUY" ? fill.size : fill.size.neg();
      if (state.position.isZero()) {
        const cycle = createCycle(fill, state.sequence + 1);
        cycles.push(cycle);
        state.cycle = cycle;
        state.sequence += 1;
        state.averageEntryPrice = fill.price;
        state.position = delta;
        if (!fill.closedPnl.isZero()) {
          warnings.push(
            warning(
              "UNEXPECTED_OPENING_CLOSED_PNL",
              `Opening fill ${fill.input.externalId} has non-zero closedPnl.`,
            ),
          );
        }
        states.set(fill.input.coin, state);
        continue;
      }

      if (state.cycle === null || state.averageEntryPrice === null) {
        throw new CalculationException(
          "POSITION_DISCONTINUITY",
          `Coin ${fill.input.coin} has a position without an active cycle.`,
        );
      }

      if (state.position.isPositive() === delta.isPositive()) {
        const previousSize = state.position.abs();
        const nextSize = previousSize.plus(fill.size);
        state.averageEntryPrice = previousSize
          .mul(state.averageEntryPrice)
          .plus(fill.size.mul(fill.price))
          .div(nextSize);
        state.cycle.averageEntryPrice = state.averageEntryPrice;
        state.cycle.fills.push(openPortion(fill, fill.size, fill.fee));
        state.position = state.position.plus(delta);
        states.set(fill.input.coin, state);
        continue;
      }

      const closeSize = DecimalMin(state.position.abs(), fill.size);
      const openingSize = fill.size.minus(closeSize);
      const closeFee = fill.fee.mul(closeSize).div(fill.size);
      state.cycle.fills.push(closePortion(fill, closeSize, closeFee, state.averageEntryPrice));
      const nextPosition = state.position.plus(delta);

      if (openingSize.isZero()) {
        state.position = nextPosition;
        if (nextPosition.isZero()) {
          state.cycle.closedAt = fill.input.occurredAt;
          state.cycle = null;
          state.averageEntryPrice = null;
        }
        states.set(fill.input.coin, state);
        continue;
      }

      state.cycle.closedAt = fill.input.occurredAt;
      const openingFee = fill.fee.minus(closeFee);
      const nextCycle = createCycle(fill, state.sequence + 1, openingSize, openingFee);
      cycles.push(nextCycle);
      state.sequence += 1;
      state.cycle = nextCycle;
      state.position = nextPosition;
      state.averageEntryPrice = fill.price;
      states.set(fill.input.coin, state);
    }

    allocateFunding(cycles, funding, warnings);

    const result = cycles
      .map((cycle) => finalizeCycle(cycle, coverage.completeness))
      .sort(compareCycles);
    for (const cycle of result) {
      warnings.push(...cycle.warnings);
    }
    return { value: result, warnings };
  });
}

export function analyzeTrustedTradeHistory(
  fills: readonly FillInput[],
): CalculationResult<TrustedTradeHistory> {
  const coverage = coverageFromTimes(fills.map((fill) => fill.occurredAt));
  return execute(coverage, "DERIVED", () => {
    if (fills.length === 0) {
      throw new CalculationException("INSUFFICIENT_HISTORY", "At least one fill is required.");
    }
    const warnings: CalculationWarning[] = [];
    const trusted = selectTrustedFills(stableFills(fills), warnings);
    return {
      value: {
        fills: trusted.map((fill) => fill.input),
        prefixes: warnings
          .filter((item) => item.code === "TRADE_HISTORY_PREFIX_SKIPPED" && item.details)
          .map((item) => ({
            coin: String(item.details?.coin ?? ""),
            skippedFillCount: Number(item.details?.skippedFillCount ?? 0),
            skippedFrom: String(item.details?.skippedFrom ?? ""),
            trustedFrom:
              typeof item.details?.trustedFrom === "string" ? item.details.trustedFrom : null,
          })),
      },
      warnings,
    };
  });
}

export function calculateCyclePnl(cycle: PositionCycle): CalculationResult<CyclePnl> {
  const coverage = coverageFromTimes(
    [cycle.openedAt, ...(cycle.closedAt ? [cycle.closedAt] : [])],
    cycle.completeness,
  );
  return execute(coverage, "DERIVED", () => computeCyclePnl(cycle.fills, cycle.fundingEvents));
}

export function calculateAggregatePnl(
  cycles: readonly PositionCycle[],
  coverage: CalculationCoverage,
): CalculationResult<AggregatePnl> {
  return execute(coverage, "DERIVED", () => {
    if (cycles.length === 0) {
      throw new CalculationException("INSUFFICIENT_HISTORY", "At least one cycle is required.");
    }
    let fee = new AnalysisDecimal(0);
    let funding = new AnalysisDecimal(0);
    let official = new AnalysisDecimal(0);
    let recomputed = new AnalysisDecimal(0);
    const warnings: CalculationWarning[] = [];

    for (const cycle of cycles) {
      const computed = computeCyclePnl(cycle.fills, cycle.fundingEvents);
      fee = fee.plus(computed.value.fee);
      funding = funding.plus(computed.value.funding);
      official = official.plus(computed.value.hyperliquidClosedPnl);
      recomputed = recomputed.plus(computed.value.fillRecomputedPnl);
      warnings.push(...(computed.warnings ?? []));
    }

    return {
      value: {
        fee: canonical(fee),
        fillRecomputedPnl: canonical(recomputed),
        funding: canonical(funding),
        grossRealizedPnl: canonical(official),
        hyperliquidClosedPnl: canonical(official),
        netRealizedPnl: canonical(official.minus(fee).plus(funding)),
      },
      warnings,
    };
  });
}

function stableFills(fills: readonly FillInput[]): readonly ParsedFill[] {
  const ids = new Set<string>();
  return fills
    .map((input) => {
      if (ids.has(input.externalId)) {
        throw new CalculationException(
          "DUPLICATE_EVENT",
          `Duplicate fill externalId ${input.externalId}.`,
        );
      }
      ids.add(input.externalId);
      const price = decimal(input.price, `${input.externalId}.price`);
      const size = decimal(input.size, `${input.externalId}.size`);
      if (price.lte(0) || size.lte(0)) {
        throw new CalculationException(
          "INVALID_INPUT",
          `Fill ${input.externalId} price and size must be positive.`,
        );
      }
      return {
        closedPnl: decimal(input.closedPnl, `${input.externalId}.closedPnl`),
        fee: decimal(input.fee, `${input.externalId}.fee`),
        input,
        price,
        size,
        startPosition: decimal(input.startPosition, `${input.externalId}.startPosition`),
        time: parseTime(input.occurredAt, `${input.externalId}.occurredAt`),
      };
    })
    .sort(
      (left, right) =>
        left.time - right.time || compareText(left.input.externalId, right.input.externalId),
    );
}

function selectTrustedFills(
  fills: readonly ParsedFill[],
  warnings: CalculationWarning[],
): readonly ParsedFill[] {
  const byCoin = new Map<string, ParsedFill[]>();
  for (const fill of fills) {
    const coinFills = byCoin.get(fill.input.coin) ?? [];
    coinFills.push(fill);
    byCoin.set(fill.input.coin, coinFills);
  }

  const trusted: ParsedFill[] = [];
  for (const [coin, coinFills] of [...byCoin.entries()].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const first = coinFills[0];
    if (!first) {
      continue;
    }
    if (first.startPosition.isZero()) {
      trusted.push(...coinFills);
      continue;
    }

    const trustedIndex = coinFills.findIndex(
      (fill, index) => index > 0 && fill.startPosition.isZero(),
    );
    const skippedFillCount = trustedIndex === -1 ? coinFills.length : trustedIndex;
    const trustedFrom =
      trustedIndex === -1 ? null : (coinFills[trustedIndex]?.input.occurredAt ?? null);
    warnings.push(
      warning(
        "TRADE_HISTORY_PREFIX_SKIPPED",
        `Coin ${coin} started with an unknown open position; ${skippedFillCount} prefix fills were excluded.`,
        {
          coin,
          skippedFillCount,
          skippedFrom: first.input.occurredAt,
          trustedFrom,
        },
      ),
    );
    if (trustedIndex !== -1) {
      trusted.push(...coinFills.slice(trustedIndex));
    }
  }

  return trusted.sort(
    (left, right) =>
      left.time - right.time || compareText(left.input.externalId, right.input.externalId),
  );
}

function createCycle(
  fill: ParsedFill,
  sequence: number,
  size = fill.size,
  fee = fill.fee,
): InternalCycle {
  const side = fill.input.side === "BUY" ? "LONG" : "SHORT";
  return {
    averageEntryPrice: fill.price,
    closedAt: null,
    coin: fill.input.coin,
    fills: [openPortion(fill, size, fee)],
    fundingEvents: [],
    id: `${fill.input.coin}:${sequence}:${fill.input.externalId}`,
    openedAt: fill.input.occurredAt,
    side,
  };
}

function openPortion(fill: ParsedFill, size: Decimal, fee: Decimal): CycleFill {
  return {
    closedPnl: "0",
    entryPriceForPnl: null,
    externalId: fill.input.externalId,
    fee: canonical(fee),
    occurredAt: fill.input.occurredAt,
    price: canonical(fill.price),
    role: "OPEN",
    side: fill.input.side,
    size: canonical(size),
  };
}

function closePortion(
  fill: ParsedFill,
  size: Decimal,
  fee: Decimal,
  entryPrice: Decimal,
): CycleFill {
  return {
    closedPnl: canonical(fill.closedPnl),
    entryPriceForPnl: canonical(entryPrice),
    externalId: fill.input.externalId,
    fee: canonical(fee),
    occurredAt: fill.input.occurredAt,
    price: canonical(fill.price),
    role: "CLOSE",
    side: fill.input.side,
    size: canonical(size),
  };
}

function allocateFunding(
  cycles: readonly InternalCycle[],
  funding: readonly FundingInput[],
  warnings: CalculationWarning[],
): void {
  const ids = new Set<string>();
  const sorted = funding
    .map((item) => {
      if (ids.has(item.externalId)) {
        throw new CalculationException(
          "DUPLICATE_EVENT",
          `Duplicate funding externalId ${item.externalId}.`,
        );
      }
      ids.add(item.externalId);
      return {
        amount: decimal(item.amount, `${item.externalId}.amount`),
        input: item,
        time: parseTime(item.occurredAt, `${item.externalId}.occurredAt`),
      };
    })
    .sort(
      (left, right) =>
        left.time - right.time || compareText(left.input.externalId, right.input.externalId),
    );

  for (const item of sorted) {
    const coinCycles = cycles.filter((cycle) => cycle.coin === item.input.coin);
    let boundaryAmbiguous = false;
    for (const cycle of coinCycles) {
      const openedAt = parseTime(cycle.openedAt, "cycle.openedAt");
      const closedAt = cycle.closedAt ? parseTime(cycle.closedAt, "cycle.closedAt") : null;
      if (item.time === openedAt || item.time === closedAt) {
        warnings.push(
          warning(
            "UNALLOCATED_FUNDING",
            `Funding ${item.input.externalId} is simultaneous with a cycle boundary and was excluded.`,
            { externalId: item.input.externalId, reason: "CYCLE_BOUNDARY_AMBIGUOUS" },
          ),
        );
        boundaryAmbiguous = true;
        break;
      }
    }
    if (boundaryAmbiguous) {
      continue;
    }
    const active = coinCycles.filter((cycle) => {
      const openedAt = parseTime(cycle.openedAt, "cycle.openedAt");
      const closedAt = cycle.closedAt ? parseTime(cycle.closedAt, "cycle.closedAt") : null;
      return item.time > openedAt && (closedAt === null || item.time < closedAt);
    });
    if (active.length !== 1) {
      warnings.push(
        warning(
          "UNALLOCATED_FUNDING",
          `Funding ${item.input.externalId} could not be allocated to one cycle.`,
          {
            externalId: item.input.externalId,
            reason: active.length === 0 ? "NO_TRUSTED_CYCLE" : "MULTIPLE_CYCLE_CANDIDATES",
          },
        ),
      );
      continue;
    }
    active[0]?.fundingEvents.push({
      amount: canonical(item.amount),
      externalId: item.input.externalId,
      occurredAt: item.input.occurredAt,
    });
  }
}

function finalizeCycle(
  cycle: InternalCycle,
  completeness: PositionCycle["completeness"],
): PositionCycle {
  const computed = computeCyclePnl(cycle.fills, cycle.fundingEvents);
  return {
    averageEntryPrice: canonical(cycle.averageEntryPrice),
    closedAt: cycle.closedAt,
    coin: cycle.coin,
    completeness,
    fills: cycle.fills.map((fill) => ({ ...fill })),
    fundingEvents: cycle.fundingEvents.map((item) => ({ ...item })),
    id: cycle.id,
    openedAt: cycle.openedAt,
    pnl: computed.value,
    side: cycle.side,
    status: cycle.closedAt ? "CLOSED" : "OPEN",
    warnings: computed.warnings ?? [],
  };
}

function computeCyclePnl(
  fills: readonly CycleFill[],
  fundingEvents: readonly CycleFunding[],
): { readonly value: CyclePnl; readonly warnings?: readonly CalculationWarning[] } {
  let fee = new AnalysisDecimal(0);
  let official = new AnalysisDecimal(0);
  let recomputed = new AnalysisDecimal(0);
  let funding = new AnalysisDecimal(0);

  for (const fill of fills) {
    fee = fee.plus(decimal(fill.fee, `${fill.externalId}.fee`));
    official = official.plus(decimal(fill.closedPnl, `${fill.externalId}.closedPnl`));
    if (fill.role === "CLOSE") {
      if (fill.entryPriceForPnl === null) {
        throw new CalculationException(
          "MISSING_INITIAL_STATE",
          `Close fill ${fill.externalId} has no entry price.`,
        );
      }
      const entry = decimal(fill.entryPriceForPnl, `${fill.externalId}.entryPriceForPnl`);
      const price = decimal(fill.price, `${fill.externalId}.price`);
      const size = decimal(fill.size, `${fill.externalId}.size`);
      const pnl =
        fill.side === "SELL" ? price.minus(entry).mul(size) : entry.minus(price).mul(size);
      recomputed = recomputed.plus(pnl);
    }
  }
  for (const item of fundingEvents) {
    funding = funding.plus(decimal(item.amount, `${item.externalId}.amount`));
  }

  const warnings = official.eq(recomputed)
    ? []
    : [
        warning(
          "CLOSED_PNL_MISMATCH",
          `Hyperliquid closedPnl ${canonical(official)} differs from fill reconstruction ${canonical(recomputed)}.`,
        ),
      ];
  return {
    value: {
      fee: canonical(fee),
      fillRecomputedPnl: canonical(recomputed),
      funding: canonical(funding),
      grossRealizedPnl: canonical(official),
      hyperliquidClosedPnl: canonical(official),
      netRealizedPnl: canonical(official.minus(fee).plus(funding)),
    },
    warnings,
  };
}

function compareCycles(left: PositionCycle, right: PositionCycle): number {
  return (
    parseTime(left.openedAt, "openedAt") - parseTime(right.openedAt, "openedAt") ||
    compareText(left.coin, right.coin) ||
    compareText(left.id, right.id)
  );
}

function DecimalMin(left: Decimal, right: Decimal): Decimal {
  return left.lte(right) ? left : right;
}
