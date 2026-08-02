import {
  type CandidateFilterStatus,
  type DiscoveryCandidate,
  type DiscoverySettings,
  type DiscoveryStats,
  type EnrichmentStatus,
} from "../lib/discovery-api";

export interface DiscoverySummaryItem {
  readonly label: string;
  readonly value: string;
}

export function discoveryStateLabel(
  settings: DiscoverySettings | null,
  stats: DiscoveryStats | null,
): string {
  if (settings?.enabled === false) return "自動探索は停止中です";
  if (settings === null || stats === null) return "探索状況を確認中";
  if (stats.websocketStatus !== "CONNECTED") {
    return "新しい候補を探せません";
  }
  if (stats.queueDepth >= 100 || stats.enrichmentWaiting >= 100) {
    return "調査結果の更新に時間がかかっています";
  }
  return "自動探索中";
}

export function discoverySummaryItems(
  stats: DiscoveryStats | null,
): ReadonlyArray<DiscoverySummaryItem> {
  const items: Array<DiscoverySummaryItem> = [
    { label: "見つかった候補", value: stats?.newCandidates ?? "-" },
    { label: "調査済み", value: stats?.enrichmentSucceeded ?? "-" },
    { label: "監視候補", value: String(stats?.filterPassed ?? "-") },
  ];
  if (stats && (stats.queueDepth >= 100 || stats.enrichmentWaiting >= 100)) {
    items.push({ label: "調査待ち", value: String(stats.enrichmentWaiting) });
  }
  return items;
}

export function enrichmentStatusLabel(status: EnrichmentStatus): string {
  const labels: Readonly<Record<EnrichmentStatus, string>> = {
    FAILED: "確認できませんでした",
    PENDING: "確認待ち",
    QUEUED: "確認待ち",
    RATE_LIMITED: "再確認待ち",
    RUNNING: "確認中",
    SUCCEEDED: "調査済み",
  };
  return labels[status];
}

export function candidateFilterStatusLabel(status: CandidateFilterStatus): string {
  const labels: Readonly<Record<CandidateFilterStatus, string>> = {
    ELIGIBLE: "監視候補",
    EXCLUDED: "対象外",
    INSUFFICIENT_HISTORY: "一部の履歴が不足",
    LIGHT_ELIGIBLE: "確認待ち",
    PENDING: "確認待ち",
    PROMOTED: "監視中",
  };
  return labels[status];
}

export function candidateDataCertainty(
  candidate: Pick<DiscoveryCandidate, "historyCompleteness">,
): string {
  const completeness = candidate.historyCompleteness.toUpperCase();
  if (completeness === "COMPLETE") return "高い";
  if (completeness === "PARTIAL" || completeness === "TRUNCATED") {
    return "一部確認が必要";
  }
  if (completeness.includes("INSUFFICIENT")) return "低い";
  return "確認中";
}

export function candidatePerformanceStatus(
  candidate: Pick<DiscoveryCandidate, "enrichmentStatus">,
): string {
  if (candidate.enrichmentStatus === "FAILED") return "取引履歴を確認できませんでした";
  if (candidate.enrichmentStatus !== "SUCCEEDED") return "取引履歴を確認中";
  return "成績確認前";
}

export function candidateReasonLabels(reasons: ReadonlyArray<string>): ReadonlyArray<string> {
  const labels = reasons.map((reason) => {
    if (reason === "INSUFFICIENT_HISTORY") return "取引履歴が不足しています";
    if (reason === "MANUALLY_EXCLUDED") return "手動で対象外にしています";
    if (reason === "LOW_DATA_QUALITY") return "データの確かさを確認できません";
    return "一部のデータを確認できません";
  });
  return [...new Set(labels)];
}
