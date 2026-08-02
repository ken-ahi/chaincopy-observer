"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import {
  Ban,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { ApiRequestError, apiRequest } from "@/lib/address-api";
import {
  type CandidateFilterStatus,
  type CandidatePage,
  type DiscoveryCandidate,
  type DiscoverySettings,
  type DiscoveryStats,
  type EnrichmentStatus,
} from "@/lib/discovery-api";

import {
  applyCandidateActionState,
  candidateActionErrorMessage,
  type CandidateActionKind,
  isCandidateExclusionDisabled,
  isCandidatePromotionDisabled,
  isManuallyExcluded,
  requestCandidateAction,
  exclusionAction,
} from "./discovery-candidate-actions";
import {
  candidateDataCertainty,
  candidateFilterStatusLabel,
  candidatePerformanceStatus,
  discoveryStateLabel,
  discoverySummaryItems,
  enrichmentStatusLabel,
} from "./discovery-display";

export function DiscoveryClient() {
  const [candidates, setCandidates] = useState<ReadonlyArray<DiscoveryCandidate>>([]);
  const [settings, setSettings] = useState<DiscoverySettings | null>(null);
  const [stats, setStats] = useState<DiscoveryStats | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [enrichmentStatus, setEnrichmentStatus] = useState<EnrichmentStatus | "">("");
  const [filterStatus, setFilterStatus] = useState<CandidateFilterStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingCandidateAddress, setPendingCandidateAddress] = useState<string | null>(null);
  const [promotionPendingAddresses, setPromotionPendingAddresses] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const candidateActionInFlight = useRef<string | null>(null);
  const promotionPendingAddressesRef = useRef<ReadonlySet<string>>(new Set());
  const requestSequence = useRef(0);

  const load = useCallback(
    async (cursor?: string) => {
      const requestId = requestSequence.current + 1;
      requestSequence.current = requestId;
      setLoading(true);
      setError(null);
      const query = new URLSearchParams({ limit: "50" });
      if (search.trim()) query.set("search", search.trim());
      if (enrichmentStatus) query.set("enrichmentStatus", enrichmentStatus);
      if (filterStatus) query.set("filterStatus", filterStatus);
      if (cursor) query.set("cursor", cursor);
      try {
        const page = await apiRequest<CandidatePage>(
          `/api/discovery/candidates?${query.toString()}`,
        );
        if (requestId !== requestSequence.current) {
          return;
        }
        setCandidates((current) => (cursor ? [...current, ...page.items] : page.items));
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
    [enrichmentStatus, filterStatus, search],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const loadSummary = useCallback(async () => {
    try {
      const [nextSettings, nextStats] = await Promise.all([
        apiRequest<DiscoverySettings>("/api/discovery/settings"),
        apiRequest<DiscoveryStats>("/api/discovery/stats"),
      ]);
      setSettings(nextSettings);
      setStats(nextStats);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  async function setDiscoveryEnabled(enabled: boolean) {
    await runAction(async () => {
      const next = await apiRequest<DiscoverySettings>(
        `/api/discovery/${enabled ? "start" : "stop"}`,
        { method: "POST" },
      );
      setSettings(next);
      return enabled ? "自動探索を開始しました。" : "自動探索を停止しました。";
    });
  }

  async function candidateAction(candidate: DiscoveryCandidate, action: CandidateActionKind) {
    if (
      candidateActionInFlight.current !== null ||
      (action === "promote" && promotionPendingAddressesRef.current.has(candidate.address))
    ) {
      return;
    }
    candidateActionInFlight.current = candidate.address;
    setPendingCandidateAddress(candidate.address);
    try {
      await runAction(async () => {
        const result = await requestCandidateAction(candidate, action);
        setCandidates((current) => current.map((item) => applyCandidateActionState(item, result)));
        if (result.kind === "promote") {
          const nextPendingAddresses = new Set(promotionPendingAddressesRef.current);
          nextPendingAddresses.add(result.address);
          promotionPendingAddressesRef.current = nextPendingAddresses;
          setPromotionPendingAddresses(nextPendingAddresses);
        }
        return result.message;
      }, candidateActionErrorMessage);
    } finally {
      candidateActionInFlight.current = null;
      setPendingCandidateAddress(null);
    }
  }

  async function runAction(
    action: () => Promise<string>,
    getErrorMessage: (cause: unknown) => string = errorMessage,
  ) {
    setError(null);
    setMessage(null);
    try {
      setMessage(await action());
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }

  return (
    <div className="mx-auto max-w-[96rem] px-4 py-7 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">優良アドレスを探す</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            公開されている売買情報から、成績を確認する候補を自動で探しています。
          </p>
        </div>
        {settings ? (
          <Button
            onClick={() => void setDiscoveryEnabled(!settings.enabled)}
            size="sm"
            variant="outline"
          >
            {settings.enabled ? (
              <Square aria-hidden="true" className="size-3.5" />
            ) : (
              <Play aria-hidden="true" className="size-3.5" />
            )}
            {settings.enabled ? "自動探索を停止" : "自動探索を開始"}
          </Button>
        ) : null}
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      <p
        className="mt-5 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-1.5 text-sm font-medium text-cyan-100"
        role="status"
      >
        {discoveryStateLabel(settings, stats)}
      </p>
      <SummaryGrid stats={stats} />
      {settings ? (
        <DiscoverySettingsCard
          onSaved={(next) => {
            setSettings(next);
            setMessage("探索設定を保存しました。");
          }}
          settings={settings}
        />
      ) : null}

      <Card className="mt-5">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>候補一覧</CardTitle>
            <Button
              aria-label="探索候補を再読み込み"
              disabled={loading}
              onClick={() => {
                void load();
                void loadSummary();
              }}
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
          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_13rem_13rem]">
            <label className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600"
              />
              <input
                aria-label="候補検索"
                className="input-field pl-9"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="0x アドレス"
                value={search}
              />
            </label>
            <select
              aria-label="調査状態"
              className="input-field"
              onChange={(event) => setEnrichmentStatus(event.target.value as EnrichmentStatus | "")}
              value={enrichmentStatus}
            >
              <option value="">調査状態: すべて</option>
              {["PENDING", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "RATE_LIMITED"].map(
                (value) => (
                  <option key={value} value={value}>
                    {enrichmentStatusLabel(value as EnrichmentStatus)}
                  </option>
                ),
              )}
            </select>
            <select
              aria-label="候補状態"
              className="input-field"
              onChange={(event) =>
                setFilterStatus(event.target.value as CandidateFilterStatus | "")
              }
              value={filterStatus}
            >
              <option value="">候補状態: すべて</option>
              {[
                "PENDING",
                "LIGHT_ELIGIBLE",
                "INSUFFICIENT_HISTORY",
                "ELIGIBLE",
                "EXCLUDED",
                "PROMOTED",
              ].map((value) => (
                <option key={value} value={value}>
                  {candidateFilterStatusLabel(value as CandidateFilterStatus)}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {loading && candidates.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              読み込み中
            </div>
          ) : null}
          {!loading && candidates.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/[0.08] text-sm text-slate-500">
              条件に一致する候補はありません。
            </div>
          ) : null}
          {candidates.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[1180px]">
                <thead>
                  <tr>
                    <th>アドレス</th>
                    <th>主に取引している通貨</th>
                    <th>取引回数</th>
                    <th>推定取引額</th>
                    <th>活動日数</th>
                    <th>データの確かさ</th>
                    <th>候補の状態</th>
                    <th>売買成績</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.id}>
                      <td>
                        <Link
                          className="font-mono text-xs text-cyan-200 hover:underline"
                          href={`/dashboard/discovery/${candidate.address}`}
                        >
                          {shortenAddress(candidate.address)}
                        </Link>
                      </td>
                      <td>{candidate.coins.slice(0, 3).join(", ") || "-"}</td>
                      <td>{candidate.tradeCount}回</td>
                      <td className="font-mono">${decimalText(candidate.estimatedNotionalUsd)}</td>
                      <td>{candidate.activeDays}日</td>
                      <td>
                        <StatusBadge value={candidateDataCertainty(candidate)} />
                      </td>
                      <td>
                        <StatusBadge value={candidateFilterStatusLabel(candidate.filterStatus)} />
                      </td>
                      <td>{candidatePerformanceStatus(candidate)}</td>
                      <td>
                        <div className="flex gap-1.5">
                          <Button
                            aria-label={`${candidate.address} の取引履歴を確認`}
                            disabled={
                              pendingCandidateAddress === candidate.address ||
                              candidate.promotedAt !== null ||
                              candidate.enrichmentStatus === "QUEUED" ||
                              candidate.enrichmentStatus === "RUNNING" ||
                              isManuallyExcluded(candidate)
                            }
                            onClick={() => void candidateAction(candidate, "enrich")}
                            size="sm"
                            variant="outline"
                          >
                            <Sparkles aria-hidden="true" className="size-3.5" />
                            履歴を確認
                          </Button>
                          <Button
                            aria-label={`${candidate.address} を${exclusionAction(candidate).label}`}
                            disabled={isCandidateExclusionDisabled(
                              candidate,
                              pendingCandidateAddress === candidate.address,
                            )}
                            onClick={() => void candidateAction(candidate, "exclude")}
                            size="sm"
                            variant="ghost"
                          >
                            <Ban aria-hidden="true" className="size-3.5" />
                            {exclusionAction(candidate).label}
                          </Button>
                          <Button
                            aria-label={`${candidate.address} を監視対象に追加`}
                            disabled={isCandidatePromotionDisabled(
                              candidate,
                              pendingCandidateAddress === candidate.address,
                              promotionPendingAddresses.has(candidate.address),
                            )}
                            onClick={() => void candidateAction(candidate, "promote")}
                            size="sm"
                          >
                            <ShieldCheck aria-hidden="true" className="size-3.5" />
                            {promotionPendingAddresses.has(candidate.address)
                              ? "追加待ち"
                              : "監視対象に追加"}
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
                onClick={() => void load(nextCursor)}
                size="sm"
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

function SummaryGrid({ stats }: { readonly stats: DiscoveryStats | null }) {
  const values = discoverySummaryItems(stats);
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:max-w-4xl">
      {values.map((item) => (
        <Card key={item.label}>
          <CardContent className="py-4">
            <p className="text-sm text-slate-400">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{item.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DiscoverySettingsCard({
  onSaved,
  settings,
}: {
  readonly onSaved: (settings: DiscoverySettings) => void;
  readonly settings: DiscoverySettings;
}) {
  const [mode, setMode] = useState(settings.mode);
  const [minimumTrades, setMinimumTrades] = useState(String(settings.minimumObservedTradeCount));
  const [minimumNotional, setMinimumNotional] = useState(settings.minimumObservedNotionalUsd);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const next = await apiRequest<DiscoverySettings>("/api/discovery/settings", {
        body: JSON.stringify({
          minimumObservedNotionalUsd: minimumNotional,
          minimumObservedTradeCount: Number.parseInt(minimumTrades, 10),
          mode,
        }),
        method: "PATCH",
      });
      onSaved(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle>探索設定</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3 md:grid-cols-4" onSubmit={submit}>
          <label className="text-xs text-slate-500">
            対象の通貨
            <select
              aria-label="対象の通貨"
              className="input-field mt-1"
              onChange={(event) => setMode(event.target.value as "MAJOR" | "ALL")}
              value={mode}
            >
              <option value="MAJOR">主要な通貨</option>
              <option value="ALL">すべての通貨</option>
            </select>
          </label>
          <label className="text-xs text-slate-500">
            候補にする最低取引回数
            <input
              aria-label="候補にする最低取引回数"
              className="input-field mt-1"
              min="1"
              onChange={(event) => setMinimumTrades(event.target.value)}
              required
              type="number"
              value={minimumTrades}
            />
          </label>
          <label className="text-xs text-slate-500">
            候補にする最低取引額 (USD)
            <input
              aria-label="候補にする最低取引額"
              className="input-field mt-1"
              inputMode="decimal"
              onChange={(event) => setMinimumNotional(event.target.value)}
              pattern="^(0|[1-9][0-9]*)(\.[0-9]+)?$"
              required
              value={minimumNotional}
            />
          </label>
          <div className="flex items-end">
            <Button className="w-full" disabled={saving} type="submit">
              {saving ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
              設定を保存
            </Button>
          </div>
        </form>
        {error ? <Notice tone="error">{error}</Notice> : null}
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
  const positive =
    value === "高い" || value === "調査済み" || value === "監視候補" || value === "監視中";
  const warning =
    value === "確認中" || value === "確認待ち" || value === "一部確認が必要" || value === "低い";
  return <Badge variant={positive ? "success" : warning ? "warning" : "neutral"}>{value}</Badge>;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function decimalText(value: string): string {
  const [integer, fraction] = value.split(".");
  const grouped = (integer ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFraction = fraction?.replace(/0+$/, "");
  return trimmedFraction ? `${grouped}.${trimmedFraction.slice(0, 4)}` : grouped;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiRequestError) {
    return cause.message;
  }
  return "処理に失敗しました。";
}
