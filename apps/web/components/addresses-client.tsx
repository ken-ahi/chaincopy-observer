"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import { Eye, EyeOff, LoaderCircle, Plus, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  ApiRequestError,
  apiRequest,
  type AddressSummary,
  type CreateAddressResult,
  type Page,
  type SyncStatus,
} from "@/lib/address-api";

const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export function AddressesClient() {
  const [addresses, setAddresses] = useState<ReadonlyArray<AddressSummary>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus | "">("");
  const [watchFilter, setWatchFilter] = useState<"" | "true" | "false">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadAddresses = useCallback(
    async (cursor?: string) => {
      const requestId = requestSequence.current + 1;
      requestSequence.current = requestId;
      setLoading(true);
      setError(null);
      const query = new URLSearchParams({ limit: "50" });
      if (search.trim()) query.set("search", search.trim());
      if (syncStatus) query.set("syncStatus", syncStatus);
      if (watchFilter) query.set("isWatched", watchFilter);
      if (cursor) query.set("cursor", cursor);
      try {
        const page = await apiRequest<Page<AddressSummary>>(`/api/addresses?${query.toString()}`);
        if (requestId !== requestSequence.current) {
          return;
        }
        setAddresses((current) => (cursor ? [...current, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
      } catch (cause) {
        if (requestId === requestSequence.current) {
          setError(errorMessage(cause));
        }
      } finally {
        if (requestId === requestSequence.current) {
          setLoading(false);
        }
      }
    },
    [search, syncStatus, watchFilter],
  );

  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses]);

  async function toggleWatch(item: AddressSummary) {
    setActionMessage(null);
    setError(null);
    try {
      await apiRequest<AddressSummary>(`/api/addresses/${item.address}/watch`, {
        method: item.isWatched ? "DELETE" : "POST",
      });
      setActionMessage(
        `${item.displayName ?? shortenAddress(item.address)} のウォッチを${
          item.isWatched ? "解除" : "開始"
        }しました。`,
      );
      await loadAddresses();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function syncAddress(item: AddressSummary) {
    setActionMessage(null);
    setError(null);
    try {
      const result = await apiRequest<{ readonly jobId: string; readonly status: string }>(
        `/api/addresses/${item.address}/sync`,
        { method: "POST" },
      );
      setActionMessage(`同期ジョブを登録しました: ${result.jobId}`);
      await loadAddresses();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <div className="mx-auto max-w-[96rem] px-4 py-7 sm:px-7">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-cyan-300/70">
          Hyperliquid public data
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">監視アドレス</h1>
        <p className="mt-2 text-sm text-slate-500">
          公開アドレスの履歴同期とリアルタイム購読を管理します。
        </p>
      </div>

      <AddressRegistration
        onCreated={async (result) => {
          setActionMessage(
            result.syncJob
              ? `登録しました。同期ジョブ: ${result.syncJob.jobId}`
              : "ウォッチOFFで登録しました。",
          );
          await loadAddresses();
        }}
      />

      <Card className="mt-5">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>登録済みアドレス</CardTitle>
            <Button
              aria-label="再読み込み"
              disabled={loading}
              onClick={() => void loadAddresses()}
              size="sm"
              variant="outline"
            >
              <RefreshCw
                aria-hidden="true"
                className={loading ? "size-3.5 animate-spin" : "size-3.5"}
              />
              再読み込み
            </Button>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_13rem_11rem]">
            <label className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600"
              />
              <input
                aria-label="アドレス検索"
                className="input-field pl-9"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="アドレスまたは表示名"
                value={search}
              />
            </label>
            <select
              aria-label="同期状態フィルター"
              className="input-field"
              onChange={(event) => setSyncStatus(event.target.value as SyncStatus | "")}
              value={syncStatus}
            >
              <option value="">すべての同期状態</option>
              <option value="IDLE">IDLE</option>
              <option value="RUNNING">RUNNING</option>
              <option value="SUCCEEDED">SUCCEEDED</option>
              <option value="FAILED">FAILED</option>
              <option value="GAP_DETECTED">GAP_DETECTED</option>
            </select>
            <select
              aria-label="ウォッチ状態フィルター"
              className="input-field"
              onChange={(event) => setWatchFilter(event.target.value as "" | "true" | "false")}
              value={watchFilter}
            >
              <option value="">ウォッチ: すべて</option>
              <option value="true">ON</option>
              <option value="false">OFF</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {actionMessage ? <Notice tone="success">{actionMessage}</Notice> : null}
          {loading && addresses.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              読み込み中
            </div>
          ) : null}
          {!loading && addresses.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/[0.08] text-sm text-slate-500">
              条件に一致するアドレスはありません。
            </div>
          ) : null}
          {addresses.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[1180px]">
                <thead>
                  <tr>
                    <th>アドレス / 表示名</th>
                    <th>Watch</th>
                    <th>同期状態</th>
                    <th>最終同期 / 成功</th>
                    <th>Fill</th>
                    <th>Funding</th>
                    <th>Ledger</th>
                    <th>Position</th>
                    <th>品質</th>
                    <th>最終エラー</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {addresses.map((item) => (
                    <tr key={item.address}>
                      <td>
                        <Link
                          className="font-mono text-xs text-cyan-200 hover:underline"
                          href={`/dashboard/addresses/${item.address}`}
                        >
                          {shortenAddress(item.address)}
                        </Link>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.displayName ?? "表示名なし"}
                        </p>
                      </td>
                      <td>
                        <Badge variant={item.isWatched ? "success" : "neutral"}>
                          {item.isWatched ? "ON" : "OFF"}
                        </Badge>
                      </td>
                      <td>
                        <StatusBadge status={item.syncStatus} />
                      </td>
                      <td className="text-xs text-slate-400">
                        <p>{formatDate(item.lastSyncAt)}</p>
                        <p className="mt-1 text-slate-600">
                          成功: {formatDate(item.lastSuccessfulAt)}
                        </p>
                      </td>
                      <td>{item.fillCount}</td>
                      <td>{item.fundingCount}</td>
                      <td>{item.ledgerCount}</td>
                      <td>{item.currentPositionCount}</td>
                      <td>{item.openDataQualityIssues}</td>
                      <td className="max-w-56 truncate text-xs text-rose-300/80">
                        {item.lastError ?? "—"}
                      </td>
                      <td>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => void toggleWatch(item)}
                            size="sm"
                            variant="outline"
                          >
                            {item.isWatched ? (
                              <EyeOff aria-hidden="true" className="size-3.5" />
                            ) : (
                              <Eye aria-hidden="true" className="size-3.5" />
                            )}
                            {item.isWatched ? "OFF" : "ON"}
                          </Button>
                          <Button
                            onClick={() => void syncAddress(item)}
                            size="sm"
                            variant="outline"
                          >
                            <RefreshCw aria-hidden="true" className="size-3.5" />
                            同期
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {nextCursor ? (
            <div className="mt-4 flex justify-center">
              <Button
                disabled={loading}
                onClick={() => void loadAddresses(nextCursor)}
                variant="outline"
              >
                さらに読み込む
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function AddressRegistration({
  onCreated,
}: {
  readonly onCreated: (result: CreateAddressResult) => Promise<void>;
}) {
  const [address, setAddress] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isWatched, setIsWatched] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!addressPattern.test(address.trim())) {
      setError("0x から始まる40桁の16進数アドレスを入力してください。");
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiRequest<CreateAddressResult>("/api/addresses", {
        body: JSON.stringify({
          address: address.trim(),
          displayName: displayName.trim() || null,
          isWatched,
        }),
        method: "POST",
      });
      setAddress("");
      setDisplayName("");
      await onCreated(result);
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError && cause.code === "duplicate_address"
          ? "このアドレスはすでに登録されています。"
          : errorMessage(cause),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>新規登録</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3 lg:grid-cols-[1fr_18rem_auto_auto]" onSubmit={submit}>
          <input
            aria-label="Hyperliquidアドレス"
            className="input-field font-mono"
            onChange={(event) => setAddress(event.target.value)}
            placeholder="0x..."
            value={address}
          />
          <input
            aria-label="表示名"
            className="input-field"
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="表示名（任意）"
            value={displayName}
          />
          <label className="flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.08] px-3 text-xs text-slate-400">
            <input
              checked={isWatched}
              onChange={(event) => setIsWatched(event.target.checked)}
              type="checkbox"
            />
            ウォッチON
          </label>
          <Button disabled={submitting} type="submit">
            {submitting ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Plus aria-hidden="true" className="size-4" />
            )}
            登録
          </Button>
        </form>
        {error ? (
          <div className="mt-3">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function Notice({
  children,
  tone,
}: {
  readonly children: string;
  readonly tone: "error" | "success";
}) {
  return (
    <div
      className={
        tone === "error"
          ? "mb-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2 text-xs text-rose-200"
          : "mb-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-2 text-xs text-emerald-200"
      }
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { readonly status: SyncStatus | null }) {
  const variant =
    status === "SUCCEEDED"
      ? "success"
      : status === "FAILED" || status === "GAP_DETECTED"
        ? "warning"
        : status === "RUNNING"
          ? "info"
          : "neutral";
  return <Badge variant={variant}>{status ?? "未同期"}</Badge>;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "処理に失敗しました。";
}
