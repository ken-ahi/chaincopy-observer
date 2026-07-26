"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import { ArrowLeft, Ban, LoaderCircle, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiRequestError, apiRequest } from "@/lib/address-api";
import { type DiscoveryCandidateDetail } from "@/lib/discovery-api";

export function DiscoveryDetailClient({ address }: { readonly address: string }) {
  const [candidate, setCandidate] = useState<DiscoveryCandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCandidate(
        await apiRequest<DiscoveryCandidateDetail>(`/api/discovery/candidates/${address}`),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(kind: "enrich" | "exclude" | "promote") {
    setError(null);
    setMessage(null);
    try {
      const result = await apiRequest<{ readonly jobId?: string }>(
        `/api/discovery/candidates/${address}/${kind}`,
        { method: "POST" },
      );
      setMessage(
        kind === "exclude"
          ? "候補を除外しました。"
          : `${kind === "enrich" ? "Enrichment" : "昇格"}ジョブ: ${result.jobId ?? "queued"}`,
      );
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  if (loading && !candidate) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-slate-500">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        候補を読み込み中
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-7">
        <Link className="text-sm text-cyan-300" href="/dashboard/discovery">
          ← 探索一覧へ
        </Link>
        <p className="mt-6 text-sm text-rose-200">{error ?? "候補が見つかりません。"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[96rem] px-4 py-7 sm:px-7">
      <Link
        className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-cyan-200"
        href="/dashboard/discovery"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        探索一覧
      </Link>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-cyan-300/70">
            Discovery candidate
          </p>
          <h1 className="mt-2 break-all font-mono text-lg text-white">{candidate.address}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge value={candidate.enrichmentStatus} />
            <StatusBadge value={candidate.filterStatus} />
            <StatusBadge value={candidate.historyCompleteness} />
            {candidate.historyTruncated ? <Badge variant="warning">TRUNCATED</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              candidate.promotedAt !== null ||
              candidate.enrichmentStatus === "QUEUED" ||
              candidate.enrichmentStatus === "RUNNING" ||
              candidate.exclusionReasons.includes("MANUALLY_EXCLUDED")
            }
            onClick={() => void action("enrich")}
            size="sm"
            variant="outline"
          >
            <Sparkles aria-hidden="true" className="size-3.5" />
            手動Enrichment
          </Button>
          <Button
            disabled={
              candidate.promotedAt !== null ||
              candidate.exclusionReasons.includes("MANUALLY_EXCLUDED")
            }
            onClick={() => void action("exclude")}
            size="sm"
            variant="ghost"
          >
            <Ban aria-hidden="true" className="size-3.5" />
            除外
          </Button>
          <Button
            disabled={candidate.filterStatus !== "ELIGIBLE"}
            onClick={() => void action("promote")}
            size="sm"
          >
            <ShieldCheck aria-hidden="true" className="size-3.5" />
            監視対象へ昇格
          </Button>
          <Button
            aria-label="候補詳細を再読み込み"
            disabled={loading}
            onClick={() => void load()}
            size="sm"
            variant="outline"
          >
            <RefreshCw
              aria-hidden="true"
              className={loading ? "size-3.5 animate-spin" : "size-3.5"}
            />
          </Button>
        </div>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="発見日時" value={dateTime(candidate.firstSeenAt)} />
        <Metric label="最終活動" value={dateTime(candidate.lastSeenAt)} />
        <Metric label="観測取引" value={`${candidate.tradeCount} trades`} />
        <Metric label="推定取引額" value={`$${decimalText(candidate.estimatedNotionalUsd)}`} />
        <Metric label="最大取引額" value={`$${decimalText(candidate.largestTradeUsd)}`} />
        <Metric label="平均取引額" value={`$${decimalText(candidate.averageTradeUsd)}`} />
        <Metric
          label="Active day / hour"
          value={`${candidate.activeDays} / ${candidate.activeHours}`}
        />
        <Metric label="Data quality" value={`${candidate.dataQualityScore}/100`} />
        <Metric label="Retrieved fills" value={String(candidate.retrievedFillCount)} />
        <Metric label="Available from" value={nullableDate(candidate.availableFrom)} />
        <Metric label="Available to" value={nullableDate(candidate.availableTo)} />
        <Metric label="Promoted" value={nullableDate(candidate.promotedAt)} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>観測統計</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <Data
                label="Maker / Taker"
                value={`${candidate.makerCount} / ${candidate.takerCount}`}
              />
              <Data label="Buy / Sell" value={`${candidate.buyCount} / ${candidate.sellCount}`} />
              <Data
                label="Long / Short related"
                value={`${candidate.longRelatedCount} / ${candidate.shortRelatedCount}`}
              />
              <Data label="Distinct coins" value={String(candidate.distinctCoins)} />
              <Data label="発見元" value={candidate.discoverySource} />
              <Data label="最終Enrichment" value={nullableDate(candidate.lastEnrichedAt)} />
            </dl>
            <div className="mt-5 overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Coin</th>
                    <th>Trades</th>
                    <th>First</th>
                    <th>Last</th>
                  </tr>
                </thead>
                <tbody>
                  {candidate.coins.map((coin) => (
                    <tr key={coin.coin}>
                      <td>{coin.coin}</td>
                      <td>{coin.tradeCount}</td>
                      <td>{dateTime(coin.firstSeenAt)}</td>
                      <td>{dateTime(coin.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>履歴完全性・除外理由</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">
              {candidate.exclusionReasons.join(", ") || "除外理由なし"}
            </p>
            {candidate.truncationReason ? (
              <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                {candidate.truncationReason}
              </p>
            ) : null}
            <div className="mt-5 space-y-3">
              {candidate.qualityIssues.length === 0 ? (
                <p className="text-xs text-slate-600">Data Quality Issueはありません。</p>
              ) : (
                candidate.qualityIssues.map((issue) => (
                  <div
                    className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3"
                    key={`${issue.issueType}:${issue.lastDetectedAt}`}
                  >
                    <div className="flex justify-between gap-3">
                      <p className="text-xs text-slate-200">{issue.issueType}</p>
                      <Badge variant="warning">{issue.status}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{issue.message}</p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Enrichment履歴</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="data-table min-w-[900px]">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Requested range</th>
                  <th>Fills</th>
                  <th>Completeness</th>
                  <th>Result</th>
                  <th>Error / truncation</th>
                </tr>
              </thead>
              <tbody>
                {candidate.enrichmentAttempts.map((attempt) => (
                  <tr key={`${attempt.startedAt}:${attempt.requestedTo}`}>
                    <td>{dateTime(attempt.startedAt)}</td>
                    <td>
                      {dateTime(attempt.requestedFrom)} – {dateTime(attempt.requestedTo)}
                    </td>
                    <td>{attempt.retrievedFillCount}</td>
                    <td>{attempt.historyCompleteness}</td>
                    <td>{attempt.succeeded ? "SUCCEEDED" : "FAILED"}</td>
                    <td>{attempt.errorMessage ?? attempt.truncationReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">{label}</p>
        <p className="mt-2 truncate text-sm font-medium text-slate-200">{value}</p>
      </CardContent>
    </Card>
  );
}

function Data({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-slate-600">{label}</dt>
      <dd className="mt-1 break-all text-slate-300">{value}</dd>
    </div>
  );
}

function Notice({
  children,
  tone,
}: {
  readonly children: React.ReactNode;
  readonly tone: "error" | "success";
}) {
  return (
    <div
      className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
        tone === "error"
          ? "border-rose-400/20 bg-rose-400/10 text-rose-200"
          : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      }`}
      role="status"
    >
      {children}
    </div>
  );
}

function StatusBadge({ value }: { readonly value: string }) {
  const positive = value === "SUCCEEDED" || value === "ELIGIBLE" || value === "COMPLETE";
  const warning =
    value === "QUEUED" ||
    value === "RUNNING" ||
    value === "LIGHT_ELIGIBLE" ||
    value.includes("INSUFFICIENT");
  return <Badge variant={positive ? "success" : warning ? "warning" : "neutral"}>{value}</Badge>;
}

function decimalText(value: string): string {
  const [integer, fraction] = value.split(".");
  const grouped = (integer ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFraction = fraction?.replace(/0+$/, "");
  return trimmedFraction ? `${grouped}.${trimmedFraction.slice(0, 4)}` : grouped;
}

function nullableDate(value: string | null): string {
  return value ? dateTime(value) : "—";
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiRequestError) {
    return cause.message;
  }
  return cause instanceof Error ? cause.message : "処理に失敗しました。";
}
