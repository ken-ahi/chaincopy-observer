"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import { ArrowLeft, Ban, LoaderCircle, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiRequestError, apiRequest } from "@/lib/address-api";
import { type DiscoveryCandidateDetail } from "@/lib/discovery-api";

import {
  applyCandidateActionState,
  candidateActionErrorMessage,
  type CandidateActionKind,
  exclusionAction,
  isCandidateExclusionDisabled,
  isCandidatePromotionDisabled,
  isManuallyExcluded,
  requestCandidateAction,
} from "./discovery-candidate-actions";

export function DiscoveryDetailClient({ address }: { readonly address: string }) {
  const [candidate, setCandidate] = useState<DiscoveryCandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [promotionPending, setPromotionPending] = useState(false);
  const actionInFlight = useRef(false);
  const promotionPendingRef = useRef(false);

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

  async function action(kind: CandidateActionKind) {
    if (
      actionInFlight.current ||
      !candidate ||
      (kind === "promote" && promotionPendingRef.current)
    ) {
      return;
    }
    actionInFlight.current = true;
    setActing(true);
    setError(null);
    setMessage(null);
    try {
      const result = await requestCandidateAction(candidate, kind);
      setCandidate((current) => (current ? applyCandidateActionState(current, result) : current));
      if (result.kind === "promote") {
        promotionPendingRef.current = true;
        setPromotionPending(true);
      }
      setMessage(result.message);
    } catch (cause) {
      setError(candidateActionErrorMessage(cause));
    } finally {
      actionInFlight.current = false;
      setActing(false);
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
              acting ||
              candidate.promotedAt !== null ||
              candidate.enrichmentStatus === "QUEUED" ||
              candidate.enrichmentStatus === "RUNNING" ||
              isManuallyExcluded(candidate)
            }
            onClick={() => void action("enrich")}
            size="sm"
            variant="outline"
          >
            <Sparkles aria-hidden="true" className="size-3.5" />
            詳細分析を再実行
          </Button>
          <Button
            aria-label={`${candidate.address} を${exclusionAction(candidate).label}`}
            disabled={isCandidateExclusionDisabled(candidate, acting)}
            onClick={() => void action("exclude")}
            size="sm"
            variant="ghost"
          >
            <Ban aria-hidden="true" className="size-3.5" />
            {exclusionAction(candidate).label}
          </Button>
          <Button
            disabled={isCandidatePromotionDisabled(candidate, acting, promotionPending)}
            onClick={() => void action("promote")}
            size="sm"
          >
            <ShieldCheck aria-hidden="true" className="size-3.5" />
            {promotionPending ? "追加待ち" : "監視対象に追加"}
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

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>処理ステップ</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-xs text-slate-400 sm:grid-cols-3 xl:grid-cols-6">
            {[
              "1. 候補を発見",
              "2. 詳細分析",
              "3. 適格性を判定",
              "4. 監視対象に追加",
              "5. 履歴を同期",
              "6. Performanceを計算",
            ].map((step, index) => (
              <li
                className={
                  index === currentStep(candidate)
                    ? "rounded-lg border border-cyan-300/30 bg-cyan-300/10 p-3 text-cyan-100"
                    : "rounded-lg border border-white/[0.07] bg-white/[0.025] p-3"
                }
                key={step}
              >
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            詳細分析では、候補アドレスの過去取引、Funding、注文、ポジションを取得し、履歴完全性・データ品質・監視適格性を判定します。
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            除外解除後、候補の適格性を再評価します。状態は一時的にPENDINGになることがあります。
          </p>
        </CardContent>
      </Card>

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
        <Metric label="監視対象への追加日時" value={nullableDate(candidate.promotedAt)} />
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
              <Data label="最終詳細分析" value={nullableDate(candidate.lastEnrichedAt)} />
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
          <CardTitle>詳細分析履歴</CardTitle>
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

function currentStep(candidate: DiscoveryCandidateDetail): number {
  if (candidate.promotedAt) return 4;
  if (candidate.filterStatus === "ELIGIBLE") return 3;
  if (candidate.enrichmentStatus === "SUCCEEDED") return 2;
  if (candidate.enrichmentStatus === "QUEUED" || candidate.enrichmentStatus === "RUNNING") {
    return 1;
  }
  return 0;
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
  return "処理に失敗しました。";
}
