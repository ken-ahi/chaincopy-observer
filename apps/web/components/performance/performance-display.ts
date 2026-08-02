import { formatMetricValue } from "./performance-formatters";
import { type AddressPerformanceDto, type PerformanceMetricDto } from "../../lib/performance-api";

export type PerformanceLane = "return" | "trade" | "exposure";

export interface DisplayMetric {
  readonly description?: string;
  readonly interpretation?: string;
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

export const primaryMetricDefinitions: ReadonlyArray<PrimaryMetricDefinition> = [
  {
    key: "cumulativeReturn",
    label: "資産がどれくらい増えたか",
    lane: "return",
    description: "最初と比べて、資産が何％増減したかを表します。入出金の影響は成績に含めません。",
  },
  {
    key: "maxDrawdown",
    label: "一番大きく資産が減った割合",
    lane: "return",
    description:
      "最も調子が悪かった時に、資産が何％減ったかを表します。投資では「最大ドローダウン」と呼ばれます。",
  },
  {
    key: "profitFactor",
    label: "利益と損失のバランス",
    lane: "trade",
    description:
      "損失に対して、どれくらい利益を出せたかを表します。1を超えると利益の合計が損失の合計を上回ります。",
  },
  {
    key: "winRate",
    label: "利益になった取引の割合",
    lane: "trade",
    description: "利益で終わった取引が、全体の何％だったかを表します。",
  },
  {
    key: "trustedClosedCycleCount",
    label: "成績を調べた取引数",
    lane: "trade",
    description: "今回の成績計算に使えた、完了済みの取引数です。",
  },
  {
    key: "topTradeContribution",
    label: "一度の大勝ちへの依存",
    lane: "trade",
    description:
      "利益の多くが、少数の大きな勝ちだけで出ていないかを表します。数字が高いほど利益が一部の取引に偏っています。",
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
        ...(data.calculationDetails.trustedClosedCycleCount < 10
          ? { interpretation: "取引数が少ないため、この数字だけでは成績を判断できません。" }
          : {}),
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
    return toDisplayMetric(
      definition,
      metric,
      definition.description,
      primaryMetricInterpretation(definition.key, metric, data),
    );
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

  const count = canDisplayTrustedClosedCycleCount(data)
    ? data.calculationDetails.trustedClosedCycleCount
    : null;
  const countPhrase = count === null ? null : `信頼できる${String(count)}件の完了取引`;

  if (run.historyCompleteness === "PARTIAL") {
    return {
      consumedMeaningKeys: ["INCOMPLETE_TRADE_HISTORY"],
      level: "一部確認が必要",
      text: countPhrase
        ? `一部の履歴を評価対象から除外し、${countPhrase}を評価しています。`
        : "一部の履歴を除外し、利用できる範囲を評価しています。",
    };
  }
  if (run.historyCompleteness === "GAP_DETECTED") {
    return {
      consumedMeaningKeys: ["NAV_HISTORY_GAP"],
      level: "低い",
      text: countPhrase
        ? `履歴の欠損を跨がず、利用できる期間と、${countPhrase}を評価しています。`
        : "履歴の欠損を跨がず、利用できる期間だけを評価しています。",
    };
  }
  if (run.historyCompleteness === "TRUNCATED") {
    return {
      consumedMeaningKeys: ["NAV_HISTORY_SHORT"],
      level: "一部確認が必要",
      text: countPhrase
        ? `取得できた期間と、${countPhrase}を評価しています。`
        : "取得できた期間だけを評価しています。",
    };
  }
  if (run.historyCompleteness === "INSUFFICIENT_HISTORY") {
    return {
      consumedMeaningKeys: ["NAV_HISTORY_SHORT"],
      level: "低い",
      text: "正式な指標を計算する履歴が不足しているため、利用できる結果だけを表示しています。",
    };
  }

  if (countPhrase) {
    return {
      consumedMeaningKeys: [],
      level: "高い",
      text: `対象期間の履歴と、${countPhrase}を評価しています。`,
    };
  }
  if (
    data.availability.return.status !== "UNAVAILABLE" &&
    data.availability.trade.status === "UNAVAILABLE"
  ) {
    return {
      consumedMeaningKeys: [],
      level: "一部確認が必要",
      text: "入出金の影響を調整した運用成績を表示しています。",
    };
  }
  return {
    consumedMeaningKeys: [],
    level:
      data.availability.return.status === "AVAILABLE" &&
      data.availability.trade.status === "AVAILABLE"
        ? "高い"
        : "一部確認が必要",
    text: "対象期間のうち、利用できる履歴を使って評価しています。",
  };
}

export function unavailableReasonForLane(
  data: AddressPerformanceDto,
  lane: PerformanceLane,
): string {
  const reasons = data.availability[lane].reasons;
  if (
    reasons.some((reason) =>
      ["MISSING_CASH_FLOW_BOUNDARY_NAV", "UNKNOWN_CASH_FLOW"].includes(reason),
    )
  ) {
    return "入出金前後の資産データが足りないため計算できません。";
  }
  if (lane === "trade") {
    return "完了した取引の履歴が足りないため計算できません。";
  }
  if (lane === "exposure") {
    return "保有状況の履歴が足りないため計算できません。";
  }
  return "資産の履歴が足りないため計算できません。";
}

function toDisplayMetric(
  definition: MetricDefinition,
  metric: PerformanceMetricDto,
  description?: string,
  interpretation?: string,
): DisplayMetric {
  return {
    ...(description ? { description } : {}),
    ...(interpretation ? { interpretation } : {}),
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

function primaryMetricInterpretation(
  key: string,
  metric: PerformanceMetricDto,
  data: AddressPerformanceDto,
): string | undefined {
  if (key === "winRate") {
    const count = data.calculationDetails.trustedClosedCycleCount;
    return count < 10
      ? `確認できた${String(count)}回の取引のうち、表示の割合が利益になっています。取引数が少ないため、この数字だけでは判断できません。`
      : `確認できた${String(count)}回の取引のうち、表示の割合が利益になっています。`;
  }
  if (key === "topTradeContribution") {
    return formatMetricValue(key, metric.metricValue) === "100%"
      ? "利益のほとんどが、一部の取引に集中しています。"
      : "数字が高いほど、少数の大きな勝ちに利益が偏っています。";
  }
  return undefined;
}
