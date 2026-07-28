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
  const [promotionPendingAddresses, setPromotionPendingAddresses] = useState<
    ReadonlySet<string>
  >(() => new Set());
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
        const [page, nextSettings, nextStats] = await Promise.all([
          apiRequest<CandidatePage>(`/api/discovery/candidates?${query.toString()}`),
          apiRequest<DiscoverySettings>("/api/discovery/settings"),
          apiRequest<DiscoveryStats>("/api/discovery/stats"),
        ]);
        if (requestId !== requestSequence.current) {
          return;
        }
        setCandidates((current) => (cursor ? [...current, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
        setSettings(nextSettings);
        setStats(nextStats);
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

  async function setDiscoveryEnabled(enabled: boolean) {
    await runAction(async () => {
      const next = await apiRequest<DiscoverySettings>(
        `/api/discovery/${enabled ? "start" : "stop"}`,
        { method: "POST" },
      );
      setSettings(next);
      return enabled ? "探索を開始しました。" : "探索を停止しました。";
    });
  }

  async function candidateAction(
    candidate: DiscoveryCandidate,
    action: CandidateActionKind,
  ) {
    if (
      candidateActionInFlight.current !== null ||
      (action === "promote" && promotionPendingAddressesRef.current.has(candidate.address))
    ) {
      return;
    }
    candidateActionInFlight.current = candidate.address;
    setPendingCandidateAddress(candidate.address);
    try {
      await runAction(
        async () => {
          const result = await requestCandidateAction(candidate, action);
          setCandidates((current) =>
            current.map((item) => applyCandidateActionState(item, result)),
          );
          if (result.kind === "promote") {
            const nextPendingAddresses = new Set(promotionPendingAddressesRef.current);
            nextPendingAddresses.add(result.address);
            promotionPendingAddressesRef.current = nextPendingAddresses;
            setPromotionPendingAddresses(nextPendingAddresses);
          }
          return result.message;
        },
        candidateActionErrorMessage,
      );
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
          <p className="text-xs uppercase tracking-[0.18em] text-cyan-300/70">
            Official public market stream
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Hyperliquid アドレス自動探索
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            公式trades WebSocketからbuyer / sellerを抽出し、有望な公開アドレスだけをInfo
            APIで詳細分析します。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={settings?.enabled === true}
            onClick={() => void setDiscoveryEnabled(true)}
            size="sm"
          >
            <Play aria-hidden="true" className="size-3.5" />
            探索開始
          </Button>
          <Button
            disabled={settings?.enabled !== true}
            onClick={() => void setDiscoveryEnabled(false)}
            size="sm"
            variant="outline"
          >
            <Square aria-hidden="true" className="size-3.5" />
            停止
          </Button>
        </div>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      <StatsGrid settings={settings} stats={stats} />
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>探索からPerformanceまで</CardTitle>
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
            ].map((step) => (
              <li className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3" key={step}>
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
            <CardTitle>発見候補</CardTitle>
            <Button
              aria-label="探索候補を再読み込み"
              disabled={loading}
              onClick={() => void load()}
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
              aria-label="詳細分析状態"
              className="input-field"
              onChange={(event) => setEnrichmentStatus(event.target.value as EnrichmentStatus | "")}
              value={enrichmentStatus}
            >
              <option value="">詳細分析: すべて</option>
              {["PENDING", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "RATE_LIMITED"].map(
                (value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ),
              )}
            </select>
            <select
              aria-label="フィルター状態"
              className="input-field"
              onChange={(event) =>
                setFilterStatus(event.target.value as CandidateFilterStatus | "")
              }
              value={filterStatus}
            >
              <option value="">フィルター: すべて</option>
              {[
                "PENDING",
                "LIGHT_ELIGIBLE",
                "INSUFFICIENT_HISTORY",
                "ELIGIBLE",
                "EXCLUDED",
                "PROMOTED",
              ].map((value) => (
                <option key={value} value={value}>
                  {value}
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
              <table className="data-table min-w-[1500px]">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>発見 / 最終活動</th>
                    <th>観測</th>
                    <th>推定取引額</th>
                    <th>銘柄</th>
                    <th>最大取引額</th>
                    <th>詳細分析</th>
                    <th>Filter</th>
                    <th>履歴完全性</th>
                    <th>品質</th>
                    <th>除外理由</th>
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
                      <td>
                        <p>{dateTime(candidate.firstSeenAt)}</p>
                        <p className="mt-1 text-slate-500">{dateTime(candidate.lastSeenAt)}</p>
                      </td>
                      <td>{candidate.tradeCount} trades</td>
                      <td className="font-mono">${decimalText(candidate.estimatedNotionalUsd)}</td>
                      <td>{candidate.coins.join(", ") || "—"}</td>
                      <td className="font-mono">${decimalText(candidate.largestTradeUsd)}</td>
                      <td>
                        <StatusBadge value={candidate.enrichmentStatus} />
                      </td>
                      <td>
                        <StatusBadge value={candidate.filterStatus} />
                      </td>
                      <td>
                        <StatusBadge value={candidate.historyCompleteness} />
                      </td>
                      <td>{candidate.dataQualityScore}/100</td>
                      <td className="max-w-72 text-slate-500">
                        {candidate.exclusionReasons.join(", ") || "—"}
                      </td>
                      <td>
                        <div className="flex gap-1.5">
                          <Button
                            aria-label={`${candidate.address} を詳細分析`}
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
                            詳細分析
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

function StatsGrid({
  settings,
  stats,
}: {
  readonly settings: DiscoverySettings | null;
  readonly stats: DiscoveryStats | null;
}) {
  const values = [
    ["WebSocket", stats?.websocketStatus ?? "—"],
    ["受信イベント", stats?.receivedTradeEvents ?? "0"],
    ["重複除外", stats?.duplicateTradeEvents ?? "0"],
    ["発見アドレス", stats?.discoveredAddresses ?? "0"],
    ["新規候補", stats?.newCandidates ?? "0"],
    ["詳細分析待ち", String(stats?.enrichmentWaiting ?? 0)],
    ["成功 / 失敗", `${stats?.enrichmentSucceeded ?? "0"} / ${stats?.enrichmentFailed ?? "0"}`],
    ["通過 / 除外", `${stats?.filterPassed ?? 0} / ${stats?.excluded ?? 0}`],
    ["API weight / min", String(stats?.apiWeightUsed ?? 0)],
    ["Queue滞留", String(stats?.queueDepth ?? 0)],
    ["最終イベント", stats?.lastEventAt ? dateTime(stats.lastEventAt) : "—"],
    ["購読", settings?.mode === "ALL" ? "全銘柄" : (stats?.subscribedCoins.join(", ") ?? "—")],
  ] as const;
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {values.map(([label, value]) => (
        <Card key={label}>
          <CardContent className="py-4">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">{label}</p>
            <p className="mt-2 truncate text-sm font-medium text-slate-200">{value}</p>
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
            購読範囲
            <select
              aria-label="購読範囲"
              className="input-field mt-1"
              onChange={(event) => setMode(event.target.value as "MAJOR" | "ALL")}
              value={mode}
            >
              <option value="MAJOR">主要銘柄のみ</option>
              <option value="ALL">全Perpetuals銘柄</option>
            </select>
          </label>
          <label className="text-xs text-slate-500">
            最低観測回数
            <input
              aria-label="最低観測回数"
              className="input-field mt-1"
              min="1"
              onChange={(event) => setMinimumTrades(event.target.value)}
              required
              type="number"
              value={minimumTrades}
            />
          </label>
          <label className="text-xs text-slate-500">
            最低観測取引額 (USD)
            <input
              aria-label="最低観測取引額"
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
        <p className="mt-3 text-xs text-slate-600">
          主要銘柄: {settings.priorityCoins.join(", ")}。全銘柄は公式metaのactive
          universeから取得します。
        </p>
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
  const positive = value === "CONNECTED" || value === "SUCCEEDED" || value === "ELIGIBLE";
  const warning =
    value === "RUNNING" ||
    value === "QUEUED" ||
    value === "LIGHT_ELIGIBLE" ||
    value === "INSUFFICIENT_HISTORY" ||
    value === "INSUFFICIENT";
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
