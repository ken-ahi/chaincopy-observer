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
import {
  candidateDataCertainty,
  candidateFilterStatusLabel,
  candidatePerformanceStatus,
  candidateReasonLabels,
} from "./discovery-display";

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
          ← 候補一覧へ
        </Link>
        <p className="mt-6 text-sm text-rose-200">{error ?? "候補が見つかりません。"}</p>
      </div>
    );
  }

  const reasons = candidateReasonLabels([
    ...candidate.exclusionReasons,
    ...candidate.qualityIssues.map((issue) => issue.issueType),
    ...(candidate.truncationReason ? [candidate.truncationReason] : []),
  ]);

  return (
    <div className="mx-auto max-w-[96rem] px-4 py-7 sm:px-7">
      <Link
        className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-cyan-200"
        href="/dashboard/discovery"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        候補一覧
      </Link>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">候補の詳細</p>
          <h1 className="mt-2 break-all font-mono text-lg text-white">{candidate.address}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge value={candidateFilterStatusLabel(candidate.filterStatus)} />
            <StatusBadge value={`データの確かさ：${candidateDataCertainty(candidate)}`} />
            <StatusBadge value={candidatePerformanceStatus(candidate)} />
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
            取引履歴を再確認
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

      <p className="mt-5 text-sm text-slate-400">過去の売買成績と、データの確かさを確認します。</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="主に取引している通貨"
          value={
            candidate.coins
              .slice(0, 3)
              .map((coin) => coin.coin)
              .join(", ") || "-"
          }
        />
        <Metric label="取引回数" value={`${candidate.tradeCount}回`} />
        <Metric label="推定取引額" value={`$${decimalText(candidate.estimatedNotionalUsd)}`} />
        <Metric label="活動日数" value={`${candidate.activeDays}日`} />
        <Metric label="データの確かさ" value={candidateDataCertainty(candidate)} />
        <Metric label="候補の状態" value={candidateFilterStatusLabel(candidate.filterStatus)} />
        <Metric label="売買成績" value={candidatePerformanceStatus(candidate)} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>取引している通貨</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>通貨</th>
                    <th>取引回数</th>
                    <th>最初の確認</th>
                    <th>最後の確認</th>
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
            <CardTitle>確認が必要な理由</CardTitle>
          </CardHeader>
          <CardContent>
            {reasons.length > 0 ? (
              <ul className="grid gap-2 text-sm leading-relaxed text-amber-50">
                {reasons.map((reason) => (
                  <li key={reason}>・{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">追加で確認が必要な理由はありません。</p>
            )}
          </CardContent>
        </Card>
      </div>
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
  const positive = value === "監視候補" || value === "監視中" || value.includes("高い");
  const warning =
    value === "確認待ち" ||
    value === "確認中" ||
    value.includes("一部確認") ||
    value.includes("低い") ||
    value.includes("確認前");
  return <Badge variant={positive ? "success" : warning ? "warning" : "neutral"}>{value}</Badge>;
}

function decimalText(value: string): string {
  const [integer, fraction] = value.split(".");
  const grouped = (integer ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFraction = fraction?.replace(/0+$/, "");
  return trimmedFraction ? `${grouped}.${trimmedFraction.slice(0, 4)}` : grouped;
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
