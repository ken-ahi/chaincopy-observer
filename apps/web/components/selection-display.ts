import { type WalletSelectionItem, type WalletSelectionStatus } from "../lib/wallet-selection-api";

export const selectionStatusLabels: Readonly<Record<WalletSelectionStatus, string>> = {
  EXCLUDED: "対象外",
  QUALIFIED: "候補",
  REVIEW: "要確認",
  SELECTED: "参考対象",
};

const statusOrder: Readonly<Record<WalletSelectionStatus, number>> = {
  SELECTED: 0,
  QUALIFIED: 1,
  REVIEW: 2,
  EXCLUDED: 3,
};

const reasonLabels: Readonly<Record<string, string>> = {
  DATA_STALE: "最新データを確認できていません",
  DRAWDOWN_TOO_HIGH: "大きな損失が多すぎます",
  EVALUATION_PERIOD_TOO_SHORT: "評価できる期間が短すぎます",
  HISTORY_INCOMPLETE: "取引履歴の一部が不足しています",
  NO_PERFORMANCE_V3: "成績をまだ確認できません",
  PROFIT_TOO_CONCENTRATED: "一部の大勝ちに利益が偏りすぎています",
  REQUIRED_METRIC_MISSING: "判断に必要な成績を確認できません",
  RETURN_BELOW_MINIMUM: "収益率が条件を下回っています",
  TOO_FEW_COMPLETED_TRADES: "確認できた取引が少なすぎます",
};

const reasonShortLabels: Readonly<Record<string, string>> = {
  DATA_STALE: "更新待ち",
  DRAWDOWN_TOO_HIGH: "下落が大きい",
  EVALUATION_PERIOD_TOO_SHORT: "期間不足",
  HISTORY_INCOMPLETE: "履歴不足",
  NO_PERFORMANCE_V3: "成績未確認",
  PROFIT_TOO_CONCENTRATED: "利益が偏る",
  REQUIRED_METRIC_MISSING: "成績不足",
  RETURN_BELOW_MINIMUM: "収益条件未達",
  TOO_FEW_COMPLETED_TRADES: "取引数不足",
};

export function selectionReasonLabel(code: string): string {
  return reasonLabels[code] ?? "詳しい状況を確認してください";
}

export function selectionReasonSummary(item: WalletSelectionItem): string | null {
  const first = item.reasonCodes[0];
  return first ? (reasonShortLabels[first] ?? "確認が必要") : null;
}

export function selectionStatusAnnotations(item: WalletSelectionItem): {
  readonly manualLabel: string | null;
  readonly reasonSummary: string | null;
} {
  return {
    manualLabel: item.manualOverride === "AUTO" ? null : "手動設定",
    reasonSummary: selectionReasonSummary(item),
  };
}

export function selectionSummary(items: readonly WalletSelectionItem[]) {
  return (["SELECTED", "QUALIFIED", "REVIEW", "EXCLUDED"] as const).map((status) => ({
    label: selectionStatusLabels[status],
    status,
    value: items.filter((item) => item.effectiveStatus === status).length,
  }));
}

export function sortSelectionItems(
  items: readonly WalletSelectionItem[],
): readonly WalletSelectionItem[] {
  return [...items].sort((left, right) => {
    const statusComparison = statusOrder[left.effectiveStatus] - statusOrder[right.effectiveStatus];
    if (statusComparison !== 0) return statusComparison;
    if (left.rank !== null || right.rank !== null) {
      const rankComparison =
        (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER);
      if (rankComparison !== 0) return rankComparison;
    }
    const returnComparison = compareDecimalStrings(
      right.metrics.annualizedReturn,
      left.metrics.annualizedReturn,
    );
    if (returnComparison !== 0) return returnComparison;
    return left.address < right.address ? -1 : left.address > right.address ? 1 : 0;
  });
}

export function dataCertaintyLabel(item: WalletSelectionItem): string {
  if (item.historyCompleteness === null) return "未確認";
  if (item.automaticStatus === "REVIEW") return "確認が必要";
  if (item.historyCompleteness === "COMPLETE" && item.lastSyncAt) return "高い";
  return "確認が必要";
}

export function formatSelectionPercent(value: string | undefined, showPlus = false): string {
  if (value === undefined) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  const percentage = new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(numeric * 100);
  return `${showPlus && numeric > 0 ? "+" : ""}${percentage}%`;
}

function compareDecimalStrings(left: string | undefined, right: string | undefined): number {
  if (left === undefined) return right === undefined ? 0 : -1;
  if (right === undefined) return 1;
  const leftDecimal = normalizeDecimal(left);
  const rightDecimal = normalizeDecimal(right);
  if (!leftDecimal) return rightDecimal ? -1 : 0;
  if (!rightDecimal) return 1;
  if (leftDecimal.negative !== rightDecimal.negative) {
    return leftDecimal.negative ? -1 : 1;
  }
  const magnitude = compareMagnitude(leftDecimal, rightDecimal);
  return leftDecimal.negative ? -magnitude : magnitude;
}

function normalizeDecimal(value: string) {
  const match = /^(-)?(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const integer = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const zero = integer === "0" && fraction.length === 0;
  return { fraction, integer, negative: !zero && match[1] === "-" };
}

function compareMagnitude(
  left: { readonly integer: string; readonly fraction: string },
  right: { readonly integer: string; readonly fraction: string },
): number {
  if (left.integer.length !== right.integer.length) {
    return left.integer.length < right.integer.length ? -1 : 1;
  }
  if (left.integer !== right.integer) return left.integer < right.integer ? -1 : 1;
  const fractionLength = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = left.fraction.padEnd(fractionLength, "0");
  const rightFraction = right.fraction.padEnd(fractionLength, "0");
  return leftFraction < rightFraction ? -1 : leftFraction > rightFraction ? 1 : 0;
}
