"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import { LoaderCircle, RefreshCw, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ApiRequestError, apiRequest } from "@/lib/address-api";
import {
  type WalletSelectionItem,
  type WalletSelectionOverride,
  type WalletSelectionResponse,
  type WalletSelectionSettings,
  type WalletSelectionStatus,
} from "@/lib/wallet-selection-api";

import {
  dataCertaintyLabel,
  formatSelectionPercent,
  selectionReasonLabel,
  selectionStatusAnnotations,
  selectionStatusLabels,
  selectionSummary,
  sortSelectionItems,
} from "./selection-display";

export function SelectionClient() {
  const [selection, setSelection] = useState<WalletSelectionResponse>({ items: [], run: null });
  const [settings, setSettings] = useState<WalletSelectionSettings | null>(null);
  const [filter, setFilter] = useState<WalletSelectionStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSelection, nextSettings] = await Promise.all([
        apiRequest<WalletSelectionResponse>("/api/wallet-selection"),
        apiRequest<WalletSelectionSettings>("/api/wallet-selection/settings"),
      ]);
      setSelection(nextSelection);
      setSettings(nextSettings);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleItems = useMemo(
    () =>
      sortSelectionItems(selection.items).filter(
        (item) => !filter || item.effectiveStatus === filter,
      ),
    [filter, selection.items],
  );

  async function evaluate() {
    setEvaluating(true);
    setError(null);
    setMessage(null);
    try {
      const next = await apiRequest<WalletSelectionResponse>("/api/wallet-selection/evaluate", {
        method: "POST",
      });
      setSelection(next);
      setMessage("監視中のアドレスを再評価しました。");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setEvaluating(false);
    }
  }

  async function setOverride(item: WalletSelectionItem, decision: WalletSelectionOverride) {
    setPendingAddress(item.address);
    setError(null);
    setMessage(null);
    try {
      const updated = await apiRequest<WalletSelectionItem>(
        `/api/wallet-selection/${encodeURIComponent(item.address)}/override`,
        { body: JSON.stringify({ decision }), method: "PATCH" },
      );
      setSelection((current) => ({
        ...current,
        items: current.items.map((currentItem) =>
          currentItem.walletAddressId === updated.walletAddressId ? updated : currentItem,
        ),
      }));
      setMessage(
        decision === "AUTO"
          ? "自動判定に戻しました。"
          : decision === "INCLUDE"
            ? "手動で参考対象にしました。"
            : "手動で対象外にしました。",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPendingAddress(null);
    }
  }

  return (
    <div className="mx-auto max-w-[96rem] px-4 py-7 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">参考にするアドレス</h1>
          <p className="mt-2 text-sm text-slate-400">
            売買の参考にするアドレスを、成績とデータの確かさから選びます。
          </p>
        </div>
        <Button disabled={evaluating} onClick={() => void evaluate()} size="sm">
          {evaluating ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" className="size-4" />
          )}
          再評価
        </Button>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {selectionSummary(selection.items).map((item) => (
          <Card key={item.status}>
            <CardContent className="py-4">
              <p className="text-sm text-slate-400">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {settings ? (
        <SelectionSettingsCard
          onSaved={(next) => {
            setSettings(next);
            setMessage("選定条件を保存しました。再評価してください。");
          }}
          settings={settings}
        />
      ) : null}

      <Card className="mt-5">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>アドレス一覧</CardTitle>
            <select
              aria-label="参考状態で絞り込む"
              className="input-field max-w-48"
              onChange={(event) => setFilter(event.target.value as WalletSelectionStatus | "")}
              value={filter}
            >
              <option value="">すべての状態</option>
              {(Object.keys(selectionStatusLabels) as WalletSelectionStatus[]).map((status) => (
                <option key={status} value={status}>
                  {selectionStatusLabels[status]}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              読み込み中
            </div>
          ) : null}
          {!loading && selection.run === null ? (
            <EmptyState>
              まだ選定結果がありません。「再評価」から最初の選定を行ってください。
            </EmptyState>
          ) : null}
          {!loading && selection.run !== null && visibleItems.length === 0 ? (
            <EmptyState>この状態に該当するアドレスはありません。</EmptyState>
          ) : null}
          {!loading && visibleItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[1180px]">
                <thead>
                  <tr>
                    <th>アドレス</th>
                    <th>状態</th>
                    <th>1年あたりの増減</th>
                    <th>資産の増減</th>
                    <th>最大の下落</th>
                    <th>確認できた取引</th>
                    <th>大勝ちへの依存</th>
                    <th>データの確かさ</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <SelectionRow
                      item={item}
                      key={item.walletAddressId}
                      onOverride={setOverride}
                      pending={pendingAddress === item.address}
                    />
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

function SelectionRow({
  item,
  onOverride,
  pending,
}: {
  readonly item: WalletSelectionItem;
  readonly onOverride: (item: WalletSelectionItem, decision: WalletSelectionOverride) => void;
  readonly pending: boolean;
}) {
  const { manualLabel, reasonSummary } = selectionStatusAnnotations(item);
  return (
    <tr>
      <td>
        <Link
          className="font-mono text-xs text-cyan-200 hover:underline"
          href={`/dashboard/addresses/${item.address}`}
        >
          {shortenAddress(item.address)}
        </Link>
      </td>
      <td>
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={item.effectiveStatus} />
          {manualLabel ? <span className="text-[11px] text-slate-500">{manualLabel}</span> : null}
          {reasonSummary ? (
            <span className="text-[11px] text-amber-200">{reasonSummary}</span>
          ) : null}
          {item.reasonCodes.length > 0 ? (
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer text-cyan-300">理由を見る</summary>
              <ul className="mt-2 space-y-1">
                {item.reasonCodes.map((code) => (
                  <li key={code}>・{selectionReasonLabel(code)}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </td>
      <td>{formatSelectionPercent(item.metrics.annualizedReturn, true)}</td>
      <td>{formatSelectionPercent(item.metrics.cumulativeReturn, true)}</td>
      <td>{formatSelectionPercent(item.metrics.maxDrawdown)}</td>
      <td>{item.performanceRunId ? `${item.trustedClosedCycleCount}件` : "-"}</td>
      <td>{formatSelectionPercent(item.metrics.topTradeContribution)}</td>
      <td>{dataCertaintyLabel(item)}</td>
      <td>
        <div className="flex min-w-72 flex-wrap gap-1.5">
          <Button
            disabled={pending || item.manualOverride === "INCLUDE"}
            onClick={() => onOverride(item, "INCLUDE")}
            size="sm"
            variant="outline"
          >
            参考対象にする
          </Button>
          <Button
            disabled={pending || item.manualOverride === "EXCLUDE"}
            onClick={() => onOverride(item, "EXCLUDE")}
            size="sm"
            variant="ghost"
          >
            対象外にする
          </Button>
          {item.manualOverride !== "AUTO" ? (
            <Button
              disabled={pending}
              onClick={() => onOverride(item, "AUTO")}
              size="sm"
              variant="ghost"
            >
              自動判定に戻す
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function SelectionSettingsCard({
  onSaved,
  settings,
}: {
  readonly onSaved: (settings: WalletSelectionSettings) => void;
  readonly settings: WalletSelectionSettings;
}) {
  const [values, setValues] = useState(() => settingsFormValues(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const next = await apiRequest<WalletSelectionSettings>("/api/wallet-selection/settings", {
        body: JSON.stringify({
          maxAutoSelected: Number.parseInt(values.maxAutoSelected, 10),
          maximumDataAgeHours: Number.parseInt(values.maximumDataAgeHours, 10),
          maximumDrawdown: values.maximumDrawdown,
          maximumTopTradeContribution: values.maximumTopTradeContribution,
          minimumAnnualizedReturn: values.minimumAnnualizedReturn,
          minimumEvaluationDays: Number.parseInt(values.minimumEvaluationDays, 10),
          minimumTrustedClosedCycles: Number.parseInt(values.minimumTrustedClosedCycles, 10),
        }),
        method: "PATCH",
      });
      setValues(settingsFormValues(next));
      onSaved(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="mt-5 rounded-xl border border-white/[0.08] bg-white/[0.025]">
      <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-sm font-medium text-slate-200">
        <SlidersHorizontal aria-hidden="true" className="size-4" />
        選定条件
      </summary>
      <form
        className="grid gap-3 border-t border-white/[0.06] p-5 md:grid-cols-3"
        onSubmit={submit}
      >
        <SettingsInput
          label="自動選定する最大件数"
          onChange={(value) => setValues((current) => ({ ...current, maxAutoSelected: value }))}
          value={values.maxAutoSelected}
        />
        <SettingsInput
          label="最低評価期間（日）"
          onChange={(value) =>
            setValues((current) => ({ ...current, minimumEvaluationDays: value }))
          }
          value={values.minimumEvaluationDays}
        />
        <SettingsInput
          label="最低取引数"
          onChange={(value) =>
            setValues((current) => ({ ...current, minimumTrustedClosedCycles: value }))
          }
          value={values.minimumTrustedClosedCycles}
        />
        <SettingsInput
          label="最低1年あたり収益率（0.1 = 10%）"
          onChange={(value) =>
            setValues((current) => ({ ...current, minimumAnnualizedReturn: value }))
          }
          text
          value={values.minimumAnnualizedReturn}
        />
        <SettingsInput
          label="最大下落の上限（0.5 = 50%）"
          onChange={(value) => setValues((current) => ({ ...current, maximumDrawdown: value }))}
          text
          value={values.maximumDrawdown}
        />
        <SettingsInput
          label="大勝ち依存の上限（0.75 = 75%）"
          onChange={(value) =>
            setValues((current) => ({ ...current, maximumTopTradeContribution: value }))
          }
          text
          value={values.maximumTopTradeContribution}
        />
        <SettingsInput
          label="データ更新の許容時間（時間）"
          min="1"
          onChange={(value) => setValues((current) => ({ ...current, maximumDataAgeHours: value }))}
          value={values.maximumDataAgeHours}
        />
        <div className="flex items-end">
          <Button className="w-full" disabled={saving} type="submit">
            {saving ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
            選定条件を保存
          </Button>
        </div>
        {error ? (
          <div className="md:col-span-3">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : null}
      </form>
    </details>
  );
}

function SettingsInput({
  label,
  min = "0",
  onChange,
  text = false,
  value,
}: {
  readonly label: string;
  readonly min?: string;
  readonly onChange: (value: string) => void;
  readonly text?: boolean;
  readonly value: string;
}) {
  return (
    <label className="text-xs text-slate-500">
      {label}
      <input
        aria-label={label}
        className="input-field mt-1"
        inputMode={text ? "decimal" : "numeric"}
        min={text ? undefined : min}
        onChange={(event) => onChange(event.target.value)}
        required
        type={text ? "text" : "number"}
        value={value}
      />
    </label>
  );
}

function settingsFormValues(settings: WalletSelectionSettings) {
  return {
    maxAutoSelected: String(settings.maxAutoSelected),
    maximumDataAgeHours: String(settings.maximumDataAgeHours),
    maximumDrawdown: settings.maximumDrawdown,
    maximumTopTradeContribution: settings.maximumTopTradeContribution,
    minimumAnnualizedReturn: settings.minimumAnnualizedReturn,
    minimumEvaluationDays: String(settings.minimumEvaluationDays),
    minimumTrustedClosedCycles: String(settings.minimumTrustedClosedCycles),
  };
}

function StatusBadge({ status }: { readonly status: WalletSelectionStatus }) {
  const variant = status === "SELECTED" ? "success" : status === "REVIEW" ? "warning" : "neutral";
  return <Badge variant={variant}>{selectionStatusLabels[status]}</Badge>;
}

function EmptyState({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-white/[0.08] px-4 text-center text-sm text-slate-500">
      {children}
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

function shortenAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiRequestError) {
    if (cause.status === 400) return "入力した条件を確認してください。";
    if (cause.status === 404) return "監視中のアドレスが見つかりません。";
  }
  return "処理に失敗しました。時間をおいて再度お試しください。";
}
