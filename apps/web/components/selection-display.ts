import { type WalletRankingItem } from "../lib/wallet-selection-api";

export function sortWalletRankingItems(
  items: readonly WalletRankingItem[],
): readonly WalletRankingItem[] {
  return [...items].sort(
    (left, right) =>
      left.rank - right.rank ||
      (left.address < right.address ? -1 : left.address > right.address ? 1 : 0),
  );
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

export function formatSelectionDecimal(value: string | undefined): string {
  if (value === undefined) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(numeric);
}

export function formatSelectionDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
