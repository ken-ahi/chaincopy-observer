"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import { ArrowLeft, Eye, EyeOff, LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { formatDate, Notice } from "./addresses-client";
import {
  buildAddressDetailPaths,
  fillActionLabel,
  isOpenOrder,
  orderSideLabel,
  positionSideLabel,
  RECENT_ACTIVITY_LIMIT,
} from "./address-detail-display";
import { PerformanceSection } from "./performance/performance-section";
import {
  apiRequest,
  type AddressDetail,
  type Fill,
  type Order,
  type Page,
  type Position,
} from "@/lib/address-api";

interface DetailData {
  readonly detail: AddressDetail;
  readonly fills: Page<Fill>;
  readonly orders: Page<Order>;
  readonly positions: ReadonlyArray<Position>;
}

export function AddressDetailClient({ address }: { readonly address: string }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const paths = buildAddressDetailPaths(address);
    try {
      const [detail, fills, orders, positions] = await Promise.all([
        apiRequest<AddressDetail>(paths.detail),
        apiRequest<Page<Fill>>(paths.fills),
        apiRequest<Page<Order>>(paths.orders),
        apiRequest<ReadonlyArray<Position>>(paths.positions),
      ]);
      setData({ detail, fills, orders, positions });
    } catch {
      setError("最新データを取得できません。表示内容が古い可能性があります。");
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
      await apiRequest(`/api/addresses/${encodeURIComponent(address)}/watch`, {
        method: data.detail.address.isWatched ? "DELETE" : "POST",
      });
      setMessage(data.detail.address.isWatched ? "監視を解除しました。" : "監視を開始しました。");
      await load();
    } catch {
      setError("監視状態を更新できませんでした。時間をおいてもう一度お試しください。");
    }
  }

  async function syncNow() {
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/api/addresses/${encodeURIComponent(address)}/sync`, { method: "POST" });
      setMessage("最新データの取得を開始しました。");
      await load();
    } catch {
      setError("最新データを取得できません。表示内容が古い可能性があります。");
    }
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-slate-500">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        アドレスデータを読み込んでいます
      </div>
    );
  }

  const connectionProblem =
    data?.detail.address.syncStatus === "FAILED" ||
    data?.detail.address.syncStatus === "GAP_DETECTED" ||
    Boolean(data?.detail.address.lastError);
  const openOrders = data ? data.orders.items.filter(isOpenOrder) : [];

  return (
    <div className="mx-auto max-w-[96rem] px-4 py-7 sm:px-7">
      <Link
        className="mb-5 inline-flex items-center gap-2 text-xs text-slate-500 hover:text-slate-200"
        href="/dashboard/addresses"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        監視中のアドレス
      </Link>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {connectionProblem ? (
        <Notice tone="error">
          最新データを取得できていません。表示内容が古い可能性があります。
        </Notice>
      ) : null}
      {!data ? null : (
        <>
          <section className="mb-7 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0">
              <Badge variant={data.detail.address.isWatched ? "success" : "neutral"}>
                {data.detail.address.isWatched ? "監視中" : "監視していません"}
              </Badge>
              <h1 className="mt-3 text-xl font-semibold text-white">
                {data.detail.address.displayName ?? "名称未設定のアドレス"}
              </h1>
              <p className="mt-2 break-all font-mono text-xs text-cyan-200">
                {data.detail.address.address}
              </p>
              <p className="mt-2 text-sm text-slate-400">
                最終更新 {formatDate(lastUpdatedAt(data.detail))}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void toggleWatch()} variant="outline">
                {data.detail.address.isWatched ? (
                  <EyeOff aria-hidden="true" className="size-4" />
                ) : (
                  <Eye aria-hidden="true" className="size-4" />
                )}
                {data.detail.address.isWatched ? "監視を解除" : "監視を開始"}
              </Button>
              <Button onClick={() => void syncNow()}>
                <RefreshCw aria-hidden="true" className="size-4" />
                最新データを取得
              </Button>
            </div>
          </section>

          <div className="grid gap-6">
            <PerformanceSection
              address={data.detail.address.address}
              lastUpdatedAt={lastUpdatedAt(data.detail)}
            />

            <DataSection title="現在の先物ポジション">
              <Table
                columns={[
                  "通貨",
                  "買い／売り",
                  "ポジション金額",
                  "平均開始価格",
                  "現在の損益",
                  "レバレッジ",
                  "最終更新",
                ]}
                empty="現在の先物ポジションはありません。"
                rows={data.positions.map((item) => [
                  item.coin,
                  positionSideLabel(item.side),
                  `${item.positionValue} USD`,
                  item.entryPrice ? `${item.entryPrice} USD` : "-",
                  `${item.unrealizedPnl} USD`,
                  `${item.leverageValue}倍`,
                  formatDate(item.updatedExternalAt),
                ])}
              />
            </DataSection>

            {data.detail.spotBalances.length > 0 ? (
              <DataSection title="現在保有している通貨">
                <Table
                  columns={["通貨", "保有量", "取得時の金額", "最終更新"]}
                  empty=""
                  rows={data.detail.spotBalances.map((item) => [
                    item.coin,
                    item.total,
                    `${item.entryNotional} USD`,
                    formatDate(item.capturedAt),
                  ])}
                />
              </DataSection>
            ) : null}

            <DataSection title="最近の動き">
              <Table
                columns={["日時", "通貨", "行動", "数量"]}
                empty="最近の売買はありません。"
                rows={data.fills.items
                  .slice(0, RECENT_ACTIVITY_LIMIT)
                  .map((item) => [
                    formatDate(item.occurredAt),
                    item.coin,
                    fillActionLabel(item.side),
                    `${item.size} ${item.coin}`,
                  ])}
              />
            </DataSection>

            {openOrders.length > 0 ? (
              <DataSection title="現在出している注文">
                <Table
                  columns={["通貨", "買い／売り", "指値価格", "数量"]}
                  empty=""
                  rows={openOrders.map((item) => [
                    item.coin,
                    orderSideLabel(item.side),
                    `${item.limitPrice} USD`,
                    `${item.size} ${item.coin}`,
                  ])}
                />
              </DataSection>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function lastUpdatedAt(detail: AddressDetail): string {
  return detail.address.lastSyncAt ?? detail.address.lastSuccessfulAt ?? detail.updatedAt;
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
      <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-sm text-slate-400">
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
