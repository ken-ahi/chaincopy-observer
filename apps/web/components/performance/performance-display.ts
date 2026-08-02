import { formatMetricValue } from "./performance-formatters";
import { type AddressPerformanceDto, type PerformanceMetricDto } from "../../lib/performance-api";

export type PerformanceLane = "return" | "trade" | "exposure";

export interface DisplayMetric {
  readonly description?: string;
  readonly key: string;
  readonly label: string;
  readonly referenceOnly: boolean;
  readonly unavailable: boolean;
  readonly unavailableReason?: string;
  readonly value: string;
}

interface MetricDefinition {
  readonly key: string;
  readonly label: string;
  readonly lane: PerformanceLane;
}

interface PrimaryMetricDefinition extends MetricDefinition {
  readonly description: string;
}

export interface DetailMetricGroup {
  readonly key: string;
  readonly lane: PerformanceLane;
  readonly metrics: ReadonlyArray<DisplayMetric>;
  readonly title: string;
}

export interface ReliabilitySummary {
  readonly consumedMeaningKeys: ReadonlyArray<
    "INCOMPLETE_TRADE_HISTORY" | "NAV_HISTORY_GAP" | "NAV_HISTORY_SHORT"
  >;
  readonly level: "高い" | "一部確認が必要" | "低い";
  readonly text: string;
}

export interface PerformanceReason {
  readonly key: string;
  readonly message: string;
}

interface PerformanceReasonDefinition extends PerformanceReason {
  readonly codes: ReadonlyArray<string>;
  readonly priority: number;
}

export const primaryMetricDefinitions: ReadonlyArray<PrimaryMetricDefinition> = [
  {
    key: "cumulativeReturn",
    label: "資産の増減",
    lane: "return",
    description: "最初と比べて、資産が何％増えたかを表します。",
  },
  {
    key: "maxDrawdown",
    label: "最大の下落",
    lane: "return",
    description:
      "一番調子が悪かった時に、資産が何％減ったかを表します。投資では「最大ドローダウン」と呼ばれます。",
  },
  {
    key: "profitFactor",
    label: "損益バランス",
    lane: "trade",
    description: "損失に対して、どれくらい利益を出せたかを表します。",
  },
  {
    key: "winRate",
    label: "勝率",
    lane: "trade",
    description: "確認できた取引のうち、利益になった割合です。",
  },
  {
    key: "trustedClosedCycleCount",
    label: "確認できた取引",
    lane: "trade",
    description: "開始から終了まで確認でき、成績計算に使えた取引数です。",
  },
  {
    key: "topTradeContribution",
    label: "大勝ちへの依存",
    lane: "trade",
    description: "利益の多くが、一部の大きな勝ちだけで出ていないかを表します。",
  },
];

const performanceReasonDefinitions: ReadonlyArray<PerformanceReasonDefinition> = [
  {
    codes: ["MISSING_CASH_FLOW_BOUNDARY_NAV", "CASH_FLOW_NAV_MISMATCH"],
    key: "missing-cash-flow-boundary",
    message:
      "入金や出金の前後に、資産がいくらあったか確認できません。そのため、売買で増えたのか、入金で増えたのかを区別できません。",
    priority: 0,
  },
  {
    codes: ["UNKNOWN_CASH_FLOW"],
    key: "unknown-cash-flow",
    message: "入金や出金の種類を確認できません。そのため、売買による増減と区別できません。",
    priority: 1,
  },
  {
    codes: ["NON_POSITIVE_NAV", "NO_POSITIVE_DATED_NAV"],
    key: "invalid-asset-value",
    message: "資産額が0以下になっている記録があり、計算に使えません。",
    priority: 2,
  },
  {
    codes: ["INVALID_INPUT", "INVALID_DECIMAL"],
    key: "invalid-input",
    message: "計算に使えない記録があるため、一部の成績を確認できません。",
    priority: 2,
  },
  {
    codes: ["DATA_ORDER_AMBIGUOUS"],
    key: "ambiguous-data-order",
    message: "同じ時刻の記録が複数あり、正しい順番を一つに決められません。",
    priority: 3,
  },
  {
    codes: ["DATA_GAP", "RETURN_PERIOD_TRUNCATED_AT_GAP"],
    key: "asset-history-gap",
    message:
      "日ごとの資産額の記録が不足しています。そのため、資産全体の増減を正しく確認できません。",
    priority: 3,
  },
  {
    codes: ["PARTIAL_HISTORY"],
    key: "partial-trade-history",
    message: "取引履歴の途中が抜けています。そのため、すべての売買を正しく追えません。",
    priority: 4,
  },
  {
    codes: ["TRADE_HISTORY_PREFIX_SKIPPED", "HISTORY_TRUNCATED"],
    key: "old-trade-history-missing",
    message: "古い取引履歴の一部を取得できていません。",
    priority: 5,
  },
  {
    codes: ["MISSING_INITIAL_STATE"],
    key: "missing-initial-position",
    message: "取引開始時の保有状況を確認できないため、すべての売買を正しく追えません。",
    priority: 5,
  },
  {
    codes: [
      "POSITION_DISCONTINUITY",
      "CYCLE_BOUNDARY_AMBIGUOUS",
      "MULTIPLE_CYCLE_CANDIDATES",
      "UNEXPECTED_OPENING_CLOSED_PNL",
    ],
    key: "position-discontinuity",
    message: "ポジションの増減を途中までしか追えません。",
    priority: 6,
  },
  {
    codes: ["UNALLOCATED_FUNDING"],
    key: "unallocated-holding-fee",
    message: "一部の保有中に発生した手数料を、どの取引に含めるか判断できません。",
    priority: 7,
  },
  {
    codes: ["MULTIPLE_SNAPSHOTS_SAME_DAY"],
    key: "multiple-daily-assets",
    message: "同じ日の資産記録が複数あり、正しい値を一つに決められません。",
    priority: 8,
  },
  {
    codes: ["CLOSED_PNL_MISMATCH"],
    key: "closed-profit-mismatch",
    message: "取引ごとの損益と、口座全体の損益が一致していません。",
    priority: 9,
  },
  {
    codes: ["CALCULATION_WINDOW_ADJUSTED"],
    key: "calculation-window-adjusted",
    message: "データがそろっている期間だけを使って計算しています。",
    priority: 10,
  },
  {
    codes: ["PERP_ONLY_NAV"],
    key: "futures-assets-only",
    message: "現物資産を含められないため、先物取引の資産だけを使っています。",
    priority: 11,
  },
  {
    codes: ["DUPLICATE_EVENT"],
    key: "duplicate-trade-record",
    message: "同じ取引記録が複数あり、正しい記録を確認できません。",
    priority: 12,
  },
  {
    codes: ["MINIMUM_HISTORY_NOT_MET", "INSUFFICIENT_HISTORY", "NO_TRUSTED_CYCLE"],
    key: "insufficient-history",
    message: "履歴が不足しているため、一部の成績を確認できません。",
    priority: 13,
  },
  {
    codes: ["NO_LOSING_CYCLES", "ZERO_GROSS_LOSS"],
    key: "no-confirmed-loss",
    message: "損失になった取引を確認できないため、損益バランスを計算できません。",
    priority: 14,
  },
  {
    codes: ["NO_WINNING_CYCLES"],
    key: "no-confirmed-win",
    message: "利益になった取引を確認できないため、一部の成績を計算できません。",
    priority: 14,
  },
  {
    codes: ["ZERO_DOWNSIDE_DEVIATION"],
    key: "no-downside-movement",
    message: "下落した日の記録がないため、下落に対する成績を計算できません。",
    priority: 15,
  },
  {
    codes: ["ZERO_DRAWDOWN"],
    key: "no-drawdown",
    message: "確認できた期間に下落がないため、下落に対する成績を計算できません。",
    priority: 15,
  },
  {
    codes: ["ZERO_VARIANCE"],
    key: "no-price-variation",
    message: "資産額の変化がないため、値動きに対する成績を計算できません。",
    priority: 15,
  },
  {
    codes: ["ZERO_DENOMINATOR"],
    key: "zero-calculation-base",
    message: "計算の基準になる値が0のため、一部の成績を計算できません。",
    priority: 16,
  },
];

const ignoredReasonCodes = new Set(["DERIVED", "ESTIMATED", "EXACT", "REFERENCE_ONLY"]);

const detailMetricGroupDefinitions: ReadonlyArray<{
  readonly key: string;
  readonly lane: PerformanceLane;
  readonly metrics: ReadonlyArray<MetricDefinition>;
  readonly title: string;
}> = [
  {
    key: "return-detail",
    lane: "return",
    title: "資産の増減をくわしく見る",
    metrics: [
      { key: "twr", label: "入出金の影響を除いた収益率", lane: "return" },
      { key: "annualizedReturn", label: "1年あたりに換算した収益率", lane: "return" },
    ],
  },
  {
    key: "trade-detail",
    lane: "trade",
    title: "取引ごとの成績",
    metrics: [
      { key: "averageWin", label: "平均利益", lane: "trade" },
      { key: "averageLoss", label: "平均損失", lane: "trade" },
      { key: "maxLosingStreak", label: "最大連敗", lane: "trade" },
    ],
  },
  {
    key: "risk-adjusted",
    lane: "return",
    title: "値動きを考慮した成績",
    metrics: [
      { key: "volatility", label: "値動きの大きさ", lane: "return" },
      {
        key: "sharpeRatio",
        label: "値動きに対する収益",
        lane: "return",
      },
      {
        key: "sortinoRatio",
        label: "下落する値動きに対する収益",
        lane: "return",
      },
      {
        key: "calmarRatio",
        label: "最大の下落に対する収益",
        lane: "return",
      },
    ],
  },
  {
    key: "leverage",
    lane: "exposure",
    title: "借り入れを使った取引の大きさ",
    metrics: [
      { key: "medianLeverage", label: "通常時のレバレッジ", lane: "exposure" },
      {
        key: "percentile95Leverage",
        label: "大きな取引をした時のレバレッジ",
        lane: "exposure",
      },
      { key: "maxLeverage", label: "最大レバレッジ", lane: "exposure" },
      { key: "averageLeverage", label: "平均レバレッジ", lane: "exposure" },
    ],
  },
  {
    key: "concentration",
    lane: "exposure",
    title: "特定の通貨への偏り",
    metrics: [
      { key: "largestCoinShare", label: "最も多く取引した通貨の割合", lane: "exposure" },
      { key: "concentrationIndex", label: "取引する通貨の偏り", lane: "exposure" },
    ],
  },
];

const tradeMetricKeys = [
  "profitFactor",
  "winRate",
  "averageWin",
  "averageLoss",
  "maxLosingStreak",
  "topTradeContribution",
] as const;

const allMetricDefinitions: ReadonlyArray<MetricDefinition> = [
  ...primaryMetricDefinitions.filter((definition) => definition.key !== "trustedClosedCycleCount"),
  ...detailMetricGroupDefinitions.flatMap((group) => group.metrics),
];

export function selectPrimaryMetrics(data: AddressPerformanceDto): ReadonlyArray<DisplayMetric> {
  return primaryMetricDefinitions.map((definition) => {
    if (definition.key === "trustedClosedCycleCount") {
      if (!canDisplayTrustedClosedCycleCount(data)) {
        return unavailableDisplayMetric(definition, data);
      }
      return {
        description: definition.description,
        key: definition.key,
        label: definition.label,
        referenceOnly: false,
        unavailable: false,
        value: `${String(data.calculationDetails.trustedClosedCycleCount)}件`,
      };
    }

    const metric = data.metrics[definition.key];
    if (
      data.latestSuccessfulRun === null ||
      data.availability[definition.lane].status === "UNAVAILABLE" ||
      metric === undefined
    ) {
      return unavailableDisplayMetric(definition, data);
    }
    return toDisplayMetric(definition, metric, definition.description);
  });
}

export function canDisplayTrustedClosedCycleCount(data: AddressPerformanceDto): boolean {
  return (
    data.latestSuccessfulRun !== null &&
    data.availability.trade.status !== "UNAVAILABLE" &&
    data.calculationDetails.trustedClosedCycleCount >= 0 &&
    (data.calculationDetails.trustedClosedCycleCount === 0 ||
      tradeMetricKeys.some((key) => data.metrics[key] !== undefined))
  );
}

export function selectDetailMetricGroups(
  data: AddressPerformanceDto,
): ReadonlyArray<DetailMetricGroup> {
  if (data.latestSuccessfulRun === null) {
    return [];
  }

  return detailMetricGroupDefinitions.flatMap((group) => {
    if (data.availability[group.lane].status === "UNAVAILABLE") {
      return [];
    }
    const metrics = group.metrics.flatMap((definition) => {
      const metric = data.metrics[definition.key];
      return metric ? [toDisplayMetric(definition, metric)] : [];
    });
    return metrics.length > 0 ? [{ ...group, metrics }] : [];
  });
}

export function unavailableMetricLabels(
  data: AddressPerformanceDto,
  lane: PerformanceLane,
): ReadonlyArray<string> {
  return allMetricDefinitions
    .filter((definition) => definition.lane === lane)
    .filter(
      (definition) =>
        data.availability[lane].status === "UNAVAILABLE" ||
        data.metrics[definition.key] === undefined,
    )
    .map((definition) => definition.label);
}

export function metricLane(metricKey: string): PerformanceLane | null {
  return allMetricDefinitions.find((definition) => definition.key === metricKey)?.lane ?? null;
}

export function buildReliabilitySummary(data: AddressPerformanceDto): ReliabilitySummary | null {
  const run = data.latestSuccessfulRun;
  if (run === null) {
    return null;
  }

  if (run.historyCompleteness === "PARTIAL") {
    return {
      consumedMeaningKeys: ["INCOMPLETE_TRADE_HISTORY"],
      level: "一部確認が必要",
      text: "一部の履歴が不足しています",
    };
  }
  if (run.historyCompleteness === "GAP_DETECTED") {
    return {
      consumedMeaningKeys: ["NAV_HISTORY_GAP"],
      level: "低い",
      text: "履歴不足のため参考値です",
    };
  }
  if (run.historyCompleteness === "TRUNCATED") {
    return {
      consumedMeaningKeys: ["NAV_HISTORY_SHORT"],
      level: "一部確認が必要",
      text: "一部の履歴が不足しています",
    };
  }
  if (run.historyCompleteness === "INSUFFICIENT_HISTORY") {
    return {
      consumedMeaningKeys: ["NAV_HISTORY_SHORT"],
      level: "低い",
      text: "履歴不足のため参考値です",
    };
  }

  if (
    data.availability.return.status === "AVAILABLE" &&
    data.availability.trade.status === "AVAILABLE"
  ) {
    return {
      consumedMeaningKeys: [],
      level: "高い",
      text: "必要な履歴がそろっています",
    };
  }
  if (
    data.availability.return.status !== "UNAVAILABLE" &&
    data.availability.trade.status === "UNAVAILABLE"
  ) {
    return {
      consumedMeaningKeys: [],
      level: "一部確認が必要",
      text: "一部の履歴が不足しています",
    };
  }
  return {
    consumedMeaningKeys: [],
    level:
      data.availability.return.status === "AVAILABLE" &&
      data.availability.trade.status === "AVAILABLE"
        ? "高い"
        : "一部確認が必要",
    text: "一部の履歴が不足しています",
  };
}

export function performanceReasonForCode(
  code: string,
  lane: PerformanceLane | "overall" = "overall",
): PerformanceReason {
  if (["INSUFFICIENT_HISTORY", "MINIMUM_HISTORY_NOT_MET", "NO_TRUSTED_CYCLE"].includes(code)) {
    if (lane === "trade") {
      return {
        key: "insufficient-completed-trades",
        message:
          "開始から終了まで確認できる取引が足りません。そのため、勝率や損益を計算できません。",
      };
    }
    if (lane === "return") {
      return {
        key: "insufficient-asset-history",
        message:
          "日ごとの資産額の記録が不足しています。そのため、資産全体の増減を正しく確認できません。",
      };
    }
    if (lane === "exposure") {
      return {
        key: "insufficient-position-history",
        message: "保有状況の記録が不足しているため、ポジションの変化を確認できません。",
      };
    }
  }
  const definition = performanceReasonDefinitions.find((item) => item.codes.includes(code));
  return definition
    ? { key: definition.key, message: definition.message }
    : { key: "unconfirmed-data", message: "一部のデータを確認できません" };
}

export function selectPerformanceReasons(
  data: AddressPerformanceDto,
): ReadonlyArray<PerformanceReason> {
  const inputs: Array<{ readonly code: string; readonly lane: PerformanceLane | "overall" }> = [];
  for (const code of data.latestRun?.warningCodes ?? []) inputs.push({ code, lane: "overall" });
  for (const code of data.latestSuccessfulRun?.warningCodes ?? []) {
    inputs.push({ code, lane: "overall" });
  }
  for (const metric of Object.values(data.metrics)) {
    const lane = metricLane(metric.metricKey) ?? "overall";
    for (const code of metric.warningCodes) inputs.push({ code, lane });
  }
  for (const lane of ["return", "trade", "exposure"] as const) {
    for (const code of data.availability[lane].reasons) inputs.push({ code, lane });
  }
  if (
    data.calculationDetails.excludedFillCount > 0 ||
    data.calculationDetails.tradePrefixes.length > 0
  ) {
    inputs.push({ code: "TRADE_HISTORY_PREFIX_SKIPPED", lane: "trade" });
  }
  if (data.calculationDetails.excludedFundingCount > 0) {
    inputs.push({ code: "UNALLOCATED_FUNDING", lane: "trade" });
  }
  if (data.calculationDetails.navGapCount > 0) inputs.push({ code: "DATA_GAP", lane: "return" });
  if (data.calculationDetails.unknownCashFlowCount > 0) {
    inputs.push({ code: "UNKNOWN_CASH_FLOW", lane: "return" });
  }

  const seenMessages = new Set<string>();
  return inputs
    .filter(({ code }) => !ignoredReasonCodes.has(code))
    .map(({ code, lane }, index) => {
      const reason = performanceReasonForCode(code, lane);
      const priority =
        performanceReasonDefinitions.find((item) => item.codes.includes(code))?.priority ?? 99;
      return { index, priority, reason };
    })
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .flatMap(({ reason }) => {
      if (seenMessages.has(reason.message)) return [];
      seenMessages.add(reason.message);
      return [reason];
    });
}

export function unavailableReasonForLane(
  _data: AddressPerformanceDto,
  lane: PerformanceLane,
): string {
  if (lane === "trade") return "取引不足";
  if (lane === "exposure") return "保有履歴不足";
  return "履歴不足";
}

function toDisplayMetric(
  definition: MetricDefinition,
  metric: PerformanceMetricDto,
  description?: string,
): DisplayMetric {
  return {
    ...(description ? { description } : {}),
    key: definition.key,
    label: definition.label,
    referenceOnly: metric.status === "REFERENCE_ONLY",
    unavailable: false,
    value: formatMetricValue(definition.key, metric.metricValue),
  };
}

function unavailableDisplayMetric(
  definition: PrimaryMetricDefinition,
  data: AddressPerformanceDto,
): DisplayMetric {
  return {
    description: definition.description,
    key: definition.key,
    label: definition.label,
    referenceOnly: false,
    unavailable: true,
    unavailableReason: unavailableReasonForLane(data, definition.lane),
    value: "-",
  };
}
