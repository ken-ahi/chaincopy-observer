import type { Decimal } from "decimal.js";

import {
  AnalysisDecimal,
  CalculationException,
  canonical,
  compareText,
  coverageFromTimes,
  daysBetween,
  decimal,
  execute,
  parseTime,
  warning,
} from "./core.js";
import type {
  AnnualizedReturn,
  CalculationCoverage,
  CalculationResult,
  CalculationWarning,
  CashFlowCategory,
  CashFlowInput,
  DailyNavPoint,
  MetricValue,
  NavSnapshotInput,
  NormalizedCashFlow,
  ReturnNavPoint,
  ReturnPeriod,
  StoredCashFlowClassification,
  StoredCashFlowInput,
  WealthPoint,
} from "./types.js";

export function calculateDailyNav(
  snapshots: readonly NavSnapshotInput[],
  coverage: CalculationCoverage,
): CalculationResult<readonly DailyNavPoint[]> {
  return execute(coverage, "DERIVED", () => {
    if (snapshots.length === 0) {
      throw new CalculationException(
        "INSUFFICIENT_HISTORY",
        "At least one NAV snapshot is required.",
      );
    }
    const ids = new Set<string>();
    const parsed = snapshots
      .map((snapshot) => {
        if (ids.has(snapshot.externalId)) {
          throw new CalculationException(
            "DUPLICATE_EVENT",
            `Duplicate NAV externalId ${snapshot.externalId}.`,
          );
        }
        ids.add(snapshot.externalId);
        const time = parseTime(snapshot.occurredAt, `${snapshot.externalId}.occurredAt`);
        return {
          input: snapshot,
          nav: decimal(snapshot.nav, `${snapshot.externalId}.nav`),
          time,
        };
      })
      .sort(
        (left, right) =>
          left.time - right.time || compareText(left.input.externalId, right.input.externalId),
      );

    const scope = parsed[0]?.input.scope;
    if (parsed.some((item) => item.input.scope !== scope)) {
      throw new CalculationException("INVALID_INPUT", "NAV snapshots must use one account scope.");
    }

    const byDate = new Map<string, (typeof parsed)[number]>();
    const warnings: CalculationWarning[] = [];
    for (const item of parsed) {
      const date = new Date(item.time).toISOString().slice(0, 10);
      if (byDate.has(date)) {
        warnings.push(
          warning(
            "MULTIPLE_SNAPSHOTS_SAME_DAY",
            `Selected the latest normalized snapshot for UTC date ${date}.`,
          ),
        );
      }
      byDate.set(date, item);
    }

    const selected = [...byDate.entries()].sort(([left], [right]) => compareText(left, right));
    for (let index = 0; index < selected.length; index += 1) {
      const current = selected[index];
      if (!current) {
        continue;
      }
      if (current[1].nav.lte(0)) {
        throw new CalculationException(
          "NON_POSITIVE_NAV",
          `NAV for ${current[0]} must be positive.`,
        );
      }
      const previous = selected[index - 1];
      if (
        previous &&
        parseTime(`${current[0]}T00:00:00.000Z`, "date") -
          parseTime(`${previous[0]}T00:00:00.000Z`, "date") !==
          86_400_000
      ) {
        throw new CalculationException(
          "DATA_GAP",
          `Daily NAV has a gap between ${previous[0]} and ${current[0]}.`,
        );
      }
    }

    if (scope === "PERP") {
      warnings.push(
        warning(
          "PERP_ONLY_NAV",
          "Daily NAV represents the Perpetuals account and not total account equity.",
        ),
      );
    }

    return {
      value: selected.map(([date, item]) => ({
        date,
        nav: canonical(item.nav),
        navScope: scope === "TOTAL" ? "TOTAL_ACCOUNT_NAV" : "PERP_ACCOUNT_NAV",
        occurredAt: item.input.occurredAt,
        precision: "DERIVED" as const,
      })),
      warnings,
    };
  });
}

export function normalizeCashFlows(
  cashFlows: readonly CashFlowInput[],
): CalculationResult<readonly NormalizedCashFlow[]> {
  const coverage = coverageFromTimes(cashFlows.map((item) => item.occurredAt));
  return execute(coverage, "DERIVED", () => {
    const ids = new Set<string>();
    const warnings: CalculationWarning[] = [];
    const normalized = cashFlows
      .map((cashFlow) => {
        if (ids.has(cashFlow.externalId)) {
          throw new CalculationException(
            "DUPLICATE_EVENT",
            `Duplicate cash flow externalId ${cashFlow.externalId}.`,
          );
        }
        ids.add(cashFlow.externalId);
        parseTime(cashFlow.occurredAt, `${cashFlow.externalId}.occurredAt`);
        const category = normalizeCategory(cashFlow.type);
        const amount =
          cashFlow.amount === null
            ? null
            : decimal(cashFlow.amount, `${cashFlow.externalId}.amount`);
        const classification = classifyCashFlowInput(cashFlow, category, amount);
        if (classification.category === "unknown") {
          warnings.push(
            warning(
              "UNKNOWN_CASH_FLOW",
              `Cash flow ${cashFlow.externalId} cannot be classified without assumptions.`,
            ),
          );
        }
        return {
          amount: amount === null ? null : canonical(amount),
          category: classification.category,
          externalId: cashFlow.externalId,
          isExternal: classification.isExternal,
          occurredAt: cashFlow.occurredAt,
        };
      })
      .sort(
        (left, right) =>
          parseTime(left.occurredAt, "occurredAt") - parseTime(right.occurredAt, "occurredAt") ||
          compareText(left.externalId, right.externalId),
      );
    return { value: normalized, warnings };
  });
}

export function splitReturnPeriodsAtCashFlows(
  navPoints: readonly ReturnNavPoint[],
  cashFlows: readonly NormalizedCashFlow[],
  coverage: CalculationCoverage,
): CalculationResult<readonly ReturnPeriod[]> {
  return execute(coverage, "DERIVED", () => {
    if (cashFlows.some((cashFlow) => cashFlow.category === "unknown")) {
      throw new CalculationException(
        "UNKNOWN_CASH_FLOW",
        "Formal return calculation cannot include an unknown cash flow.",
      );
    }
    const points = parseNavPoints(navPoints);
    const externalFlows = cashFlows
      .filter((cashFlow) => cashFlow.isExternal === true)
      .sort(
        (left, right) =>
          parseTime(left.occurredAt, "occurredAt") - parseTime(right.occurredAt, "occurredAt") ||
          compareText(left.externalId, right.externalId),
      );

    if (externalFlows.length === 0) {
      const regular = points.filter(
        (point) => point.input.boundary !== "FLOW_BEFORE" && point.input.boundary !== "FLOW_AFTER",
      );
      if (regular.length < 2) {
        throw new CalculationException(
          "INSUFFICIENT_HISTORY",
          "At least two regular NAV points are required.",
        );
      }
      return {
        value: regular.slice(1).map((ending, index) => {
          const beginning = regular[index];
          if (!beginning) {
            throw new CalculationException("INVALID_INPUT", "Return period has no beginning NAV.");
          }
          return createReturnPeriod(beginning, ending);
        }),
      };
    }

    const regular = points.filter(
      (point) =>
        (point.input.boundary ?? "REGULAR") === "REGULAR" && point.input.cashFlowId === undefined,
    );
    const firstFlowTime = parseTime(externalFlows[0]?.occurredAt ?? "", "cashFlow.occurredAt");
    const start = [...regular].reverse().find((point) => point.time < firstFlowTime);
    if (!start) {
      throw new CalculationException(
        "MISSING_CASH_FLOW_BOUNDARY_NAV",
        "A regular beginning NAV is required before the first cash flow.",
      );
    }

    let base = start;
    const periods: ReturnPeriod[] = [];
    const warnings: CalculationWarning[] = [];
    for (const cashFlow of externalFlows) {
      const before = points.find(
        (point) =>
          point.input.boundary === "FLOW_BEFORE" && point.input.cashFlowId === cashFlow.externalId,
      );
      const after = points.find(
        (point) =>
          point.input.boundary === "FLOW_AFTER" && point.input.cashFlowId === cashFlow.externalId,
      );
      if (!before || !after || cashFlow.amount === null) {
        throw new CalculationException(
          "MISSING_CASH_FLOW_BOUNDARY_NAV",
          `Cash flow ${cashFlow.externalId} requires before/after NAV and an amount.`,
        );
      }
      if (before.time < base.time || after.time < before.time) {
        throw new CalculationException(
          "DATA_ORDER_AMBIGUOUS",
          `Cash flow ${cashFlow.externalId} has inconsistent NAV boundary ordering.`,
        );
      }
      periods.push(createReturnPeriod(base, before));
      const flowAmount = decimal(cashFlow.amount, `${cashFlow.externalId}.amount`);
      if (!after.nav.minus(before.nav).eq(flowAmount)) {
        warnings.push(
          warning(
            "CASH_FLOW_NAV_MISMATCH",
            `NAV change at ${cashFlow.externalId} differs from its signed amount.`,
          ),
        );
      }
      base = after;
    }

    const end = regular.findLast((point) => point.time > base.time);
    if (!end) {
      throw new CalculationException(
        "MISSING_CASH_FLOW_BOUNDARY_NAV",
        "A regular ending NAV is required after the last cash flow.",
      );
    }
    periods.push(createReturnPeriod(base, end));
    return { value: periods, warnings };
  });
}

export function calculateTwr(
  periods: readonly ReturnPeriod[],
  coverage: CalculationCoverage,
): CalculationResult<MetricValue> {
  return multiplyReturns(periods, coverage);
}

export function calculateCumulativeReturn(
  periods: readonly ReturnPeriod[],
  coverage: CalculationCoverage,
): CalculationResult<MetricValue> {
  return multiplyReturns(periods, coverage);
}

export function buildTwrWealthIndex(
  periods: readonly ReturnPeriod[],
  coverage: CalculationCoverage,
): CalculationResult<readonly WealthPoint[]> {
  return execute(coverage, "DERIVED", () => {
    const first = periods[0];
    if (!first) {
      throw new CalculationException("INSUFFICIENT_HISTORY", "Return periods are required.");
    }

    let wealth = new AnalysisDecimal(1);
    let previousTo: number | null = null;
    const points: WealthPoint[] = [
      {
        externalId: "twr-wealth:0",
        nav: "1",
        occurredAt: first.from,
        sequence: 0,
      },
    ];

    for (const [index, period] of periods.entries()) {
      const fromTime = parseTime(period.from, `returnPeriods[${index}].from`);
      const toTime = parseTime(period.to, `returnPeriods[${index}].to`);
      if (toTime < fromTime || (previousTo !== null && fromTime < previousTo)) {
        throw new CalculationException(
          "DATA_ORDER_AMBIGUOUS",
          "Return periods must be provided in non-overlapping sequence order.",
        );
      }
      if (
        decimal(period.beginningNav, `returnPeriods[${index}].beginningNav`).lte(0) ||
        decimal(period.endingNav, `returnPeriods[${index}].endingNav`).lte(0)
      ) {
        throw new CalculationException(
          "NON_POSITIVE_NAV",
          "Return period NAV values must be positive.",
        );
      }
      const factor = decimal(period.return, `returnPeriods[${index}].return`).plus(1);
      if (factor.lte(0)) {
        throw new CalculationException(
          "NON_POSITIVE_NAV",
          "A return period must have a positive wealth factor.",
        );
      }
      wealth = wealth.mul(factor);
      points.push({
        externalId: `twr-wealth:${index + 1}`,
        nav: canonical(wealth),
        occurredAt: period.to,
        sequence: index + 1,
      });
      previousTo = toTime;
    }

    return { value: points };
  });
}

export function calculateAnnualizedReturn(
  cumulativeReturn: string,
  from: string,
  to: string,
  coverage: CalculationCoverage,
): CalculationResult<AnnualizedReturn> {
  return execute(coverage, "DERIVED", () => {
    const elapsedDays = daysBetween(from, to);
    if (elapsedDays.lt(30)) {
      throw new CalculationException(
        "INSUFFICIENT_HISTORY",
        "Annualized return requires at least 30 elapsed days.",
      );
    }
    const wealthFactor = decimal(cumulativeReturn, "cumulativeReturn").plus(1);
    if (wealthFactor.lte(0)) {
      throw new CalculationException(
        "ZERO_DENOMINATOR",
        "Annualized return requires a positive wealth factor.",
      );
    }
    const value = wealthFactor.pow(new AnalysisDecimal(365).div(elapsedDays)).minus(1);
    const referenceOnly = elapsedDays.lt(180);
    return {
      value: {
        evaluation: referenceOnly ? "REFERENCE_ONLY" : "STANDARD",
        value: canonical(value),
      },
      warnings: referenceOnly
        ? [
            warning(
              "REFERENCE_ONLY",
              "Annualized return from 30 to fewer than 180 days is a reference value.",
            ),
          ]
        : [],
    };
  });
}

function normalizeCategory(type: string): CashFlowCategory {
  const normalized = type
    .trim()
    .toLowerCase()
    .replaceAll(/[\s_-]/g, "");
  if (normalized === "deposit") return "deposit";
  if (normalized === "withdraw" || normalized === "withdrawal") return "withdrawal";
  if (normalized === "bridge") return "bridge";
  if (normalized === "transfer" || normalized === "send" || normalized === "accountclasstransfer") {
    return "transfer";
  }
  if (normalized === "reward" || normalized === "referralreward") return "reward";
  if (normalized === "liquidation") return "liquidation";
  return "unknown";
}

export function classifyCashFlowInput(
  input: CashFlowInput,
  category: CashFlowCategory = normalizeCategory(input.type),
  amount: Decimal | null = input.amount === null
    ? null
    : decimal(input.amount, `${input.externalId}.amount`),
): { readonly category: CashFlowCategory; readonly isExternal: boolean | null } {
  if (category === "deposit") {
    return amount?.gt(0)
      ? { category, isExternal: true }
      : { category: "unknown", isExternal: null };
  }
  if (category === "withdrawal") {
    return amount !== null && !amount.isZero()
      ? { category, isExternal: true }
      : { category: "unknown", isExternal: null };
  }
  if (category === "bridge" || category === "transfer") {
    if (input.boundary === "INTERNAL") {
      return { category, isExternal: false };
    }
    if (input.boundary === "EXTERNAL" && amount !== null && !amount.isZero()) {
      return { category, isExternal: true };
    }
    return { category: "unknown", isExternal: null };
  }
  if (category === "reward" || category === "liquidation") {
    return { category, isExternal: false };
  }
  return { category: "unknown", isExternal: null };
}

export function classifyStoredCashFlowInput(
  input: StoredCashFlowInput,
): StoredCashFlowClassification {
  const normalized = input.type.toLowerCase().replaceAll(/[\s_-]/g, "");
  if (normalized === "deposit") {
    return { amount: input.amount, boundary: "EXTERNAL" };
  }
  if (normalized === "withdraw" || normalized === "withdrawal") {
    return {
      amount:
        input.amount === null || input.amount.startsWith("-") ? input.amount : `-${input.amount}`,
      boundary: "EXTERNAL",
    };
  }

  const delta = readLedgerDelta(input.rawPayload);
  if (normalized === "accountclasstransfer" && typeof delta?.toPerp === "boolean") {
    return { amount: input.amount, boundary: "INTERNAL" };
  }
  if (normalized === "send" || normalized === "transfer" || normalized === "bridge") {
    const user = typeof delta?.user === "string" ? delta.user.toLowerCase() : null;
    const destination =
      typeof delta?.destination === "string" ? delta.destination.toLowerCase() : null;
    const wallet = input.walletAddress.toLowerCase();
    if (user === wallet && destination && destination !== wallet) {
      return {
        amount:
          input.amount === null || input.amount.startsWith("-") ? input.amount : `-${input.amount}`,
        boundary: "EXTERNAL",
      };
    }
    if (destination === wallet && user && user !== wallet) {
      return { amount: input.amount, boundary: "EXTERNAL" };
    }
    if (user === wallet && destination === wallet) {
      return { amount: input.amount, boundary: "INTERNAL" };
    }
  }
  return { amount: input.amount, boundary: "UNKNOWN" };
}

function readLedgerDelta(rawPayload: string | null): Readonly<Record<string, unknown>> | null {
  if (rawPayload === null) return null;
  try {
    const parsed: unknown = JSON.parse(rawPayload);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "delta" in parsed &&
      typeof parsed.delta === "object" &&
      parsed.delta !== null
    ) {
      return parsed.delta as Readonly<Record<string, unknown>>;
    }
  } catch {
    return null;
  }
  return null;
}

interface ParsedNavPoint {
  readonly input: ReturnNavPoint;
  readonly nav: Decimal;
  readonly time: number;
}

function parseNavPoints(navPoints: readonly ReturnNavPoint[]): readonly ParsedNavPoint[] {
  if (navPoints.length === 0) {
    throw new CalculationException("INSUFFICIENT_HISTORY", "NAV points are required.");
  }
  const ids = new Set<string>();
  return navPoints
    .map((input) => {
      if (ids.has(input.externalId)) {
        throw new CalculationException(
          "DUPLICATE_EVENT",
          `Duplicate NAV externalId ${input.externalId}.`,
        );
      }
      ids.add(input.externalId);
      const nav = decimal(input.nav, `${input.externalId}.nav`);
      if (nav.lte(0)) {
        throw new CalculationException(
          "NON_POSITIVE_NAV",
          `NAV ${input.externalId} must be positive.`,
        );
      }
      return {
        input,
        nav,
        time: parseTime(input.occurredAt, `${input.externalId}.occurredAt`),
      };
    })
    .sort(
      (left, right) =>
        left.time - right.time || compareText(left.input.externalId, right.input.externalId),
    );
}

function createReturnPeriod(beginning: ParsedNavPoint, ending: ParsedNavPoint): ReturnPeriod {
  if (beginning.nav.lte(0)) {
    throw new CalculationException("NON_POSITIVE_NAV", "Beginning NAV must be positive.");
  }
  return {
    beginningNav: canonical(beginning.nav),
    endingNav: canonical(ending.nav),
    from: beginning.input.occurredAt,
    return: canonical(ending.nav.div(beginning.nav).minus(1)),
    to: ending.input.occurredAt,
  };
}

function multiplyReturns(
  periods: readonly ReturnPeriod[],
  coverage: CalculationCoverage,
): CalculationResult<MetricValue> {
  return execute(coverage, "DERIVED", () => {
    if (periods.length === 0) {
      throw new CalculationException("INSUFFICIENT_HISTORY", "Return periods are required.");
    }
    let factor = new AnalysisDecimal(1);
    for (const period of periods) {
      if (decimal(period.beginningNav, "beginningNav").lte(0)) {
        throw new CalculationException("NON_POSITIVE_NAV", "Beginning NAV must be positive.");
      }
      const periodFactor = decimal(period.return, "periodReturn").plus(1);
      if (periodFactor.lte(0)) {
        throw new CalculationException(
          "NON_POSITIVE_NAV",
          "A return period must end with positive NAV.",
        );
      }
      factor = factor.mul(periodFactor);
    }
    return { value: { value: canonical(factor.minus(1)) } };
  });
}
