import { formatMetricValue } from "./performance-formatters";
import { type AddressPerformanceDto, type PerformanceMetricDto } from "../../lib/performance-api";

export type PerformanceLane = "return" | "trade" | "exposure";

export interface DisplayMetric {
  readonly description?: string;
  readonly key: string;
  readonly label: string;
  readonly referenceOnly: boolean;
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
  readonly text: string;
}

export const primaryMetricDefinitions: ReadonlyArray<PrimaryMetricDefinition> = [
  {
    key: "cumulativeReturn",
    label: "累積収益率",
    lane: "return",
    description:
      "入出金の影響を調整したうえで、評価期間中の運用成績がどの程度増減したかを示します。",
  },
  {
    key: "maxDrawdown",
    label: "最大下落率",
    lane: "return",
    description:
      "入出金の影響を調整した資産推移において、ピークから最大でどの程度下落したかを示します。",
  },
  {
    key: "profitFactor",
    label: "利益と損失の効率",
    lane: "trade",
    description:
      "評価対象となった完了取引の利益総額が、損失総額の何倍かを示します。1を超えると利益総額が損失総額を上回ります。",
  },
  {
    key: "winRate",
    label: "勝率",
    lane: "trade",
    description: "評価対象となった完了取引のうち、利益になった取引の割合です。",
  },
  {
    key: "trustedClosedCycleCount",
    label: "評価対象取引数",
    lane: "trade",
    description:
      "ポジションがない状態から取引を開始し、再びポジションがない状態へ戻るまでを1取引として、履歴から信頼して評価できた完了取引数です。",
  },
  {
    key: "topTradeContribution",
    label: "利益の一発依存度",
    lane: "trade",
    description:
      "評価対象となった完了取引の総利益のうち、最も利益が大きい1取引が占める割合です。高いほど少数の成功に利益が偏っています。",
  },
];

const detailMetricGroupDefinitions: ReadonlyArray<{
  readonly key: string;
  readonly lane: PerformanceLane;
  readonly metrics: ReadonlyArray<MetricDefinition>;
  readonly title: string;
}> = [
  {
    key: "return-detail",
    lane: "return",
    title: "収益詳細",
    metrics: [
      { key: "twr", label: "入出金の影響を除いた収益率（TWR）", lane: "return" },
      { key: "annualizedReturn", label: "年率換算収益率", lane: "return" },
    ],
  },
  {
    key: "trade-detail",
    lane: "trade",
    title: "取引詳細",
    metrics: [
      { key: "averageWin", label: "平均利益", lane: "trade" },
      { key: "averageLoss", label: "平均損失", lane: "trade" },
      { key: "maxLosingStreak", label: "最大連敗", lane: "trade" },
    ],
  },
  {
    key: "risk-adjusted",
    lane: "return",
    title: "リスク調整指標",
    metrics: [
      { key: "volatility", label: "値動きの大きさ（ボラティリティ）", lane: "return" },
      {
        key: "sharpeRatio",
        label: "リスクに対する収益（Sharpe Ratio）",
        lane: "return",
      },
      {
        key: "sortinoRatio",
        label: "下落リスクに対する収益（Sortino Ratio）",
        lane: "return",
      },
      {
        key: "calmarRatio",
        label: "最大下落に対する収益（Calmar Ratio）",
        lane: "return",
      },
    ],
  },
  {
    key: "leverage",
    lane: "exposure",
    title: "レバレッジ",
    metrics: [
      { key: "medianLeverage", label: "通常時のレバレッジ（中央値）", lane: "exposure" },
      {
        key: "percentile95Leverage",
        label: "高い局面のレバレッジ（95%点）",
        lane: "exposure",
      },
      { key: "maxLeverage", label: "最大レバレッジ", lane: "exposure" },
      { key: "averageLeverage", label: "平均レバレッジ", lane: "exposure" },
    ],
  },
  {
    key: "concentration",
    lane: "exposure",
    title: "銘柄集中度",
    metrics: [
      { key: "largestCoinShare", label: "最大銘柄比率", lane: "exposure" },
      { key: "concentrationIndex", label: "銘柄集中度（HHI）", lane: "exposure" },
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
  if (data.latestSuccessfulRun === null) {
    return [];
  }

  return primaryMetricDefinitions.flatMap((definition) => {
    if (definition.key === "trustedClosedCycleCount") {
      if (!canDisplayTrustedClosedCycleCount(data)) {
        return [];
      }
      return [
        {
          description: definition.description,
          key: definition.key,
          label: definition.label,
          referenceOnly: false,
          value: `${String(data.calculationDetails.trustedClosedCycleCount)}件`,
        },
      ];
    }

    if (data.availability[definition.lane].status === "UNAVAILABLE") {
      return [];
    }
    const metric = data.metrics[definition.key];
    return metric ? [toDisplayMetric(definition, metric, definition.description)] : [];
  });
}

export function canDisplayTrustedClosedCycleCount(data: AddressPerformanceDto): boolean {
  return (
    data.latestSuccessfulRun !== null &&
    data.availability.trade.status !== "UNAVAILABLE" &&
    data.calculationDetails.trustedClosedCycleCount >= 1 &&
    tradeMetricKeys.some((key) => data.metrics[key] !== undefined)
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

  const count = canDisplayTrustedClosedCycleCount(data)
    ? data.calculationDetails.trustedClosedCycleCount
    : null;
  const countPhrase = count === null ? null : `信頼できる${String(count)}件の完了取引`;

  if (run.historyCompleteness === "PARTIAL") {
    return {
      consumedMeaningKeys: ["INCOMPLETE_TRADE_HISTORY"],
      text: countPhrase
        ? `一部の履歴を評価対象から除外し、${countPhrase}を評価しています。`
        : "一部の履歴を除外し、利用できる範囲を評価しています。",
    };
  }
  if (run.historyCompleteness === "GAP_DETECTED") {
    return {
      consumedMeaningKeys: ["NAV_HISTORY_GAP"],
      text: countPhrase
        ? `履歴の欠損を跨がず、利用できる期間と、${countPhrase}を評価しています。`
        : "履歴の欠損を跨がず、利用できる期間だけを評価しています。",
    };
  }
  if (run.historyCompleteness === "TRUNCATED") {
    return {
      consumedMeaningKeys: ["NAV_HISTORY_SHORT"],
      text: countPhrase
        ? `取得できた期間と、${countPhrase}を評価しています。`
        : "取得できた期間だけを評価しています。",
    };
  }
  if (run.historyCompleteness === "INSUFFICIENT_HISTORY") {
    return {
      consumedMeaningKeys: ["NAV_HISTORY_SHORT"],
      text: "正式な指標を計算する履歴が不足しているため、利用できる結果だけを表示しています。",
    };
  }

  if (countPhrase) {
    return {
      consumedMeaningKeys: [],
      text: `対象期間の履歴と、${countPhrase}を評価しています。`,
    };
  }
  if (
    data.availability.return.status !== "UNAVAILABLE" &&
    data.availability.trade.status === "UNAVAILABLE"
  ) {
    return {
      consumedMeaningKeys: [],
      text: "入出金の影響を調整した運用成績を表示しています。",
    };
  }
  return {
    consumedMeaningKeys: [],
    text: "対象期間のうち、利用できる履歴を使って評価しています。",
  };
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
    value: formatMetricValue(definition.key, metric.metricValue),
  };
}
