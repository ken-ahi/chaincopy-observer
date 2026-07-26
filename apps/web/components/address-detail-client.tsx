"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import { ArrowLeft, Eye, EyeOff, LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { formatDate, Notice, StatusBadge } from "./addresses-client";
import { PerformanceSection } from "./performance/performance-section";
import {
  apiRequest,
  type AddressDetail,
  type DataQualityIssue,
  type Fill,
  type Funding,
  type Ledger,
  type Order,
  type Page,
  type Position,
  type SyncStatusDetail,
} from "@/lib/address-api";

interface DetailData {
  readonly detail: AddressDetail;
  readonly fills: Page<Fill>;
  readonly funding: Page<Funding>;
  readonly ledger: Page<Ledger>;
  readonly orders: Page<Order>;
  readonly positions: ReadonlyArray<Position>;
  readonly quality: Page<DataQualityIssue>;
  readonly sync: SyncStatusDetail;
}

export function AddressDetailClient({ address }: { readonly address: string }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const base = `/api/addresses/${encodeURIComponent(address)}`;
    try {
      const [detail, fills, funding, ledger, orders, positions, quality, sync] = await Promise.all([
        apiRequest<AddressDetail>(base),
        apiRequest<Page<Fill>>(`${base}/fills?limit=100`),
        apiRequest<Page<Funding>>(`${base}/funding?limit=100`),
        apiRequest<Page<Ledger>>(`${base}/ledger?limit=100`),
        apiRequest<Page<Order>>(`${base}/orders?limit=100`),
        apiRequest<ReadonlyArray<Position>>(`${base}/positions`),
        apiRequest<Page<DataQualityIssue>>(`${base}/data-quality?limit=100`),
        apiRequest<SyncStatusDetail>(`${base}/sync-status`),
      ]);
      setData({ detail, fills, funding, ledger, orders, positions, quality, sync });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleWatch() {
    if (!data) return;
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/api/addresses/${address}/watch`, {
        method: data.detail.address.isWatched ? "DELETE" : "POST",
      });
      setMessage(
        data.detail.address.isWatched ? "ウォッチを解除しました。" : "ウォッチを開始しました。",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新に失敗しました。");
    }
  }

  async function syncNow() {
    setError(null);
    setMessage(null);
    try {
      const result = await apiRequest<{ readonly jobId: string }>(
        `/api/addresses/${address}/sync`,
        { method: "POST" },
      );
      setMessage(`同期ジョブを登録しました: ${result.jobId}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "同期登録に失敗しました。");
    }
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-slate-500">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        アドレスデータを読み込み中
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[96rem] px-4 py-7 sm:px-7">
      <Link
        className="mb-5 inline-flex items-center gap-2 text-xs text-slate-500 hover:text-slate-200"
        href="/dashboard/addresses"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        アドレス一覧
      </Link>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {!data ? null : (
        <>
          <section className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={data.detail.address.syncStatus} />
                <Badge variant={data.detail.address.isWatched ? "success" : "neutral"}>
                  Watch {data.detail.address.isWatched ? "ON" : "OFF"}
                </Badge>
              </div>
              <h1 className="mt-3 text-xl font-semibold text-white">
                {data.detail.address.displayName ?? "Hyperliquid address"}
              </h1>
              <p className="mt-2 break-all font-mono text-xs text-cyan-200">
                {data.detail.address.address}
              </p>
              <p className="mt-2 text-xs text-slate-600">
                最終更新 {formatDate(data.detail.updatedAt)} · 最終同期{" "}
                {formatDate(data.detail.address.lastSyncAt)}
              </p>
            </div>
            <div className="flex gap-2">
              <a
                className="inline-flex min-h-10 items-center rounded-lg border border-white/[0.1] px-3 text-xs font-medium text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-200"
                href="#performance"
              >
                Performance
              </a>
              <Button onClick={() => void toggleWatch()} variant="outline">
                {data.detail.address.isWatched ? (
                  <EyeOff aria-hidden="true" className="size-4" />
                ) : (
                  <Eye aria-hidden="true" className="size-4" />
                )}
                Watch {data.detail.address.isWatched ? "OFF" : "ON"}
              </Button>
              <Button onClick={() => void syncNow()}>
                <RefreshCw aria-hidden="true" className="size-4" />
                手動同期
              </Button>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="Fill" value={data.detail.address.fillCount} />
            <Metric label="Funding" value={data.detail.address.fundingCount} />
            <Metric label="Ledger" value={data.detail.address.ledgerCount} />
            <Metric label="Position" value={data.detail.address.currentPositionCount} />
            <Metric label="Spot balance" value={data.detail.spotBalances.length} />
            <Metric label="Open quality issue" value={data.detail.address.openDataQualityIssues} />
          </section>

          {data.detail.address.lastError ? (
            <div className="mt-4">
              <Notice tone="error">{data.detail.address.lastError}</Notice>
            </div>
          ) : null}

          <div className="mt-5 grid gap-5">
            <PerformanceSection address={data.detail.address.address} />

            <DataSection title="現在ポジション">
              <Table
                columns={["Coin", "Side", "Size", "Entry", "Value", "uPnL", "Leverage", "更新"]}
                empty="現在ポジションはありません。"
                rows={data.positions.map((item) => [
                  item.coin,
                  item.side,
                  item.size,
                  item.entryPrice ?? "—",
                  item.positionValue,
                  item.unrealizedPnl,
                  `${item.leverageValue}x ${item.leverageType}`,
                  formatDate(item.updatedExternalAt),
                ])}
              />
            </DataSection>

            <DataSection title="現物残高">
              <Table
                columns={["Coin", "Total", "Hold", "Entry notional", "取得日時"]}
                empty="現物残高はありません。"
                rows={data.detail.spotBalances.map((item) => [
                  item.coin,
                  item.total,
                  item.hold,
                  item.entryNotional,
                  formatDate(item.capturedAt),
                ])}
              />
            </DataSection>

            <DataSection title="約定履歴（最大100件）">
              <Table
                columns={["日時", "Coin", "Side", "Price", "Size", "Fee", "Closed PnL", "Tx"]}
                empty="約定履歴はありません。"
                rows={data.fills.items.map((item) => [
                  formatDate(item.occurredAt),
                  item.coin,
                  item.side,
                  item.price,
                  item.size,
                  item.fee,
                  item.closedPnl,
                  item.transactionHash.slice(0, 12),
                ])}
              />
            </DataSection>

            <div className="grid gap-5 xl:grid-cols-2">
              <DataSection title="Funding履歴（最大100件）">
                <Table
                  columns={["日時", "Coin", "Amount", "Position", "Rate"]}
                  empty="Funding履歴はありません。"
                  rows={data.funding.items.map((item) => [
                    formatDate(item.occurredAt),
                    item.coin,
                    item.amount,
                    item.positionSize,
                    item.fundingRate,
                  ])}
                />
              </DataSection>
              <DataSection title="Ledger履歴（最大100件）">
                <Table
                  columns={["日時", "Type", "Asset", "Amount", "USD", "Fee"]}
                  empty="Ledger履歴はありません。"
                  rows={data.ledger.items.map((item) => [
                    formatDate(item.occurredAt),
                    item.flowType,
                    item.asset ?? "—",
                    item.amount ?? "—",
                    item.usdValue ?? "—",
                    item.fee ?? "—",
                  ])}
                />
              </DataSection>
            </div>

            <DataSection title="注文履歴（最大100件）">
              <Table
                columns={["日時", "Coin", "Side", "Status", "Type", "Price", "Size"]}
                empty="注文履歴はありません。"
                rows={data.orders.items.map((item) => [
                  formatDate(item.statusTimestamp),
                  item.coin,
                  item.side,
                  item.status,
                  item.orderType,
                  item.limitPrice,
                  item.size,
                ])}
              />
            </DataSection>

            <DataSection title="ポートフォリオスナップショット（最大50件）">
              <Table
                columns={[
                  "取得日時",
                  "Type",
                  "Account value",
                  "Notional",
                  "Margin",
                  "Withdrawable",
                ]}
                empty="ポートフォリオスナップショットはありません。"
                rows={data.detail.portfolioSnapshots.map((item) => [
                  formatDate(item.capturedAt),
                  item.snapshotType,
                  item.accountValue ?? "—",
                  item.totalNotionalPosition ?? "—",
                  item.totalMarginUsed ?? "—",
                  item.withdrawable ?? "—",
                ])}
              />
            </DataSection>

            <div className="grid gap-5 xl:grid-cols-2">
              <DataSection title="Sync Cursor">
                <Table
                  columns={["Scope", "Status", "Cursor", "成功", "試行", "Error"]}
                  empty="Sync Cursorはありません。"
                  rows={data.sync.cursors.map((item) => [
                    item.scope,
                    item.status,
                    item.lastTimestamp
                      ? formatDate(item.lastTimestamp)
                      : (item.lastExternalId ?? "—"),
                    formatDate(item.lastSuccessfulAt),
                    formatDate(item.lastAttemptedAt),
                    item.errorMessage ?? "—",
                  ])}
                />
              </DataSection>
              <DataSection title="Sync Job（最大50件）">
                <Table
                  columns={["作成", "Job", "Status", "Attempt", "終了", "Error"]}
                  empty="Sync Jobはありません。"
                  rows={data.sync.jobs.map((item) => [
                    formatDate(item.createdAt),
                    item.jobName,
                    item.status,
                    String(item.attempt),
                    formatDate(item.finishedAt),
                    item.errorMessage ?? "—",
                  ])}
                />
              </DataSection>
            </div>

            <DataSection title="Data Quality Issue（最大100件）">
              <Table
                columns={["検出", "Type", "Severity", "Status", "Message", "解決"]}
                empty="データ品質上の問題はありません。"
                rows={data.quality.items.map((item) => [
                  formatDate(item.lastDetectedAt),
                  item.issueType,
                  item.severity,
                  item.status,
                  item.message,
                  formatDate(item.resolvedAt),
                ])}
              />
            </DataSection>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] text-slate-600">{label}</p>
        <p className="mt-2 text-xl font-semibold text-white">{value}</p>
      </CardContent>
    </Card>
  );
}

function DataSection({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Table({
  columns,
  empty,
  rows,
}: {
  readonly columns: ReadonlyArray<string>;
  readonly empty: string;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-xs text-slate-600">
        {empty}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0] ?? "row"}-${index}`}>
              {row.map((cell, cellIndex) => (
                <td className="max-w-80 break-words" key={`${columns[cellIndex]}-${cellIndex}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
