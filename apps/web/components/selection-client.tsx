"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import { LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiRequestError, apiRequest } from "@/lib/address-api";
import { type WalletRankingItem, type WalletRankingResponse } from "@/lib/wallet-selection-api";

import {
  formatSelectionDate,
  formatSelectionDecimal,
  formatSelectionPercent,
  sortWalletRankingItems,
} from "./selection-display";

export function SelectionClient() {
  const [ranking, setRanking] = useState<WalletRankingResponse>({ items: [], run: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRanking(await apiRequest<WalletRankingResponse>("/api/wallet-selection/ranking"));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => sortWalletRankingItems(ranking.items), [ranking.items]);

  return (
    <div className="mx-auto max-w-[96rem] px-4 py-7 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            参考ウォレットランキング
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            完全な履歴と信頼できる成績を確認できたウォレットだけを、自動で順位付けしています。
          </p>
        </div>
        <Button disabled={loading} onClick={() => void load()} size="sm" variant="outline">
          {loading ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" className="size-4" />
          )}
          表示を更新
        </Button>
      </div>

      {error ? <Notice>{error}</Notice> : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <SummaryCard label="自動選定中" value={ranking.run?.selectedCount ?? 0} />
        <SummaryCard label="条件通過・順位付き" value={ranking.run?.eligibleCount ?? 0} />
      </div>

      <Card className="mt-5">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>総合ランキング</CardTitle>
            {ranking.run ? (
              <span className="text-xs text-slate-500">
                評価日時 {formatSelectionDate(ranking.run.evaluatedAt)}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              読み込み中
            </div>
          ) : null}
          {!loading && ranking.run === null ? (
            <EmptyState>
              自動評価はまだ完了していません。候補の同期と成績計算が完了すると自動で更新されます。
            </EmptyState>
          ) : null}
          {!loading && ranking.run !== null && items.length === 0 ? (
            <EmptyState>
              現在、履歴・成績・リスクの全条件を通過したウォレットはありません。
            </EmptyState>
          ) : null}
          {!loading && items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[1180px]">
                <thead>
                  <tr>
                    <th>順位</th>
                    <th>ウォレット</th>
                    <th>選定</th>
                    <th>完了取引</th>
                    <th>勝率</th>
                    <th>年率収益率</th>
                    <th>累積収益率</th>
                    <th>Profit Factor</th>
                    <th>最大ドローダウン</th>
                    <th>最終活動</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <RankingRow item={item} key={item.walletAddressId} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function RankingRow({ item }: { readonly item: WalletRankingItem }) {
  return (
    <tr>
      <td className="text-lg font-semibold tabular-nums text-white">{item.rank}</td>
      <td>
        <Link
          className="font-mono text-xs text-cyan-200 hover:underline"
          href={`/dashboard/addresses/${item.address}`}
        >
          {shortenAddress(item.address)}
        </Link>
      </td>
      <td>
        <Badge variant={item.automaticStatus === "SELECTED" ? "success" : "neutral"}>
          {item.automaticStatus === "SELECTED" ? "参考対象" : "条件通過"}
        </Badge>
      </td>
      <td>{item.trustedClosedCycleCount}件</td>
      <td>{formatSelectionPercent(item.metrics.winRate)}</td>
      <td>{formatSelectionPercent(item.metrics.annualizedReturn, true)}</td>
      <td>{formatSelectionPercent(item.metrics.cumulativeReturn, true)}</td>
      <td>{formatSelectionDecimal(item.metrics.profitFactor)}</td>
      <td>{formatSelectionPercent(item.metrics.maxDrawdown)}</td>
      <td>{formatSelectionDate(item.latestActivityAt)}</td>
    </tr>
  );
}

function SummaryCard({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-sm text-slate-400">{label}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/[0.08] px-4 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

function Notice({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-200"
      role="status"
    >
      {children}
    </div>
  );
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiRequestError && cause.status === 401) {
    return "ログイン状態を確認してください。";
  }
  return "ランキングを読み込めませんでした。時間をおいて再度お試しください。";
}
