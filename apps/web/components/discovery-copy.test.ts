import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  candidateDataCertainty,
  candidateFilterStatusLabel,
  candidatePerformanceStatus,
  candidateReasonLabels,
  discoveryStateLabel,
  discoverySummaryItems,
  enrichmentStatusLabel,
} from "./discovery-display.js";
import { type DiscoverySettings, type DiscoveryStats } from "../lib/discovery-api.js";

describe("discovery and phase copy", () => {
  it("uses user-facing Japanese terms without changing internal API actions", () => {
    const list = readFileSync(new URL("./discovery-client.tsx", import.meta.url), "utf8");
    const detail = readFileSync(new URL("./discovery-detail-client.tsx", import.meta.url), "utf8");
    const actions = readFileSync(
      new URL("./discovery-candidate-actions.ts", import.meta.url),
      "utf8",
    );

    expect(list).toContain("履歴を確認");
    expect(list).toContain("監視対象に追加");
    expect(actions).toContain("/${kind}");
    expect(list).not.toContain(">Enrich<");
    expect(detail).toContain("取引履歴を再確認");
    expect(detail).toContain("過去の売買成績と、データの確かさを確認します");
    expect(detail).not.toContain("詳細分析履歴");
    expect(detail).not.toContain("手動Enrichment");
  });

  it("技術監視の文言と工程説明を隠し、候補調査の目的を主表示にする", () => {
    const list = readFileSync(new URL("./discovery-client.tsx", import.meta.url), "utf8");
    const display = readFileSync(new URL("./discovery-display.ts", import.meta.url), "utf8");

    expect(list).toContain("優良アドレスを探す");
    expect(list).toContain("公開されている売買情報から、成績を確認する候補を自動で探しています");
    expect(display).toContain("見つかった候補");
    expect(list).toContain("候補一覧");
    for (const hidden of [
      "Official public market stream",
      "trades WebSocket",
      "受信イベント",
      "重複除外",
      "API weight / min",
      "Queue滞留",
      "最終イベント",
      "探索からPerformanceまで",
      "6. Performanceを計算",
    ]) {
      expect(list).not.toContain(hidden);
    }
  });

  it("内部状態を日本語化し、サマリーの重複と不要な統計再取得を避ける", () => {
    const list = readFileSync(new URL("./discovery-client.tsx", import.meta.url), "utf8");
    const settings = { enabled: true } as DiscoverySettings;
    const stats = {
      enrichmentSucceeded: "8",
      enrichmentWaiting: 2,
      filterPassed: 3,
      newCandidates: "15",
      queueDepth: 2,
      websocketStatus: "CONNECTED",
    } as DiscoveryStats;

    expect(discoveryStateLabel(settings, stats)).toBe("自動探索中");
    expect(discoveryStateLabel({ ...settings, enabled: false }, stats)).toBe(
      "自動探索は停止中です",
    );
    expect(discoveryStateLabel(settings, { ...stats, websocketStatus: "DISCONNECTED" })).toBe(
      "新しい候補を探せません",
    );
    expect(enrichmentStatusLabel("PENDING")).toBe("確認待ち");
    expect(candidateFilterStatusLabel("ELIGIBLE")).toBe("監視候補");
    expect(candidateFilterStatusLabel("EXCLUDED")).toBe("対象外");
    expect(candidateDataCertainty({ historyCompleteness: "COMPLETE" })).toBe("高い");
    expect(candidatePerformanceStatus({ enrichmentStatus: "SUCCEEDED" })).toBe("成績確認前");
    expect(candidateReasonLabels(["INSUFFICIENT_HISTORY", "UNKNOWN_CODE"])).toEqual([
      "取引履歴が不足しています",
      "一部のデータを確認できません",
    ]);
    expect(discoverySummaryItems(stats).map((item) => item.label)).toEqual([
      "見つかった候補",
      "調査済み",
      "監視候補",
    ]);
    expect(list.match(/\/api\/discovery\/stats/gu) ?? []).toHaveLength(1);
  });

  it("探索設定と統計を取得できるまで探索中と断定しない", () => {
    const enabledSettings = { enabled: true } as DiscoverySettings;
    const disabledSettings = { enabled: false } as DiscoverySettings;
    const stats = {
      enrichmentWaiting: 2,
      queueDepth: 2,
      websocketStatus: "CONNECTED",
    } as DiscoveryStats;

    expect(discoveryStateLabel(null, null)).toBe("探索状況を確認中");
    expect(discoveryStateLabel(null, stats)).toBe("探索状況を確認中");
    expect(discoveryStateLabel(enabledSettings, null)).toBe("探索状況を確認中");
    expect(discoveryStateLabel(disabledSettings, null)).toBe("自動探索は停止中です");
    expect(discoveryStateLabel(enabledSettings, stats)).toBe("自動探索中");
    expect(
      discoveryStateLabel(enabledSettings, { ...stats, websocketStatus: "DISCONNECTED" }),
    ).toBe("新しい候補を探せません");
    expect(discoveryStateLabel(enabledSettings, { ...stats, queueDepth: 100 })).toBe(
      "調査結果の更新に時間がかかっています",
    );
    expect(discoveryStateLabel(enabledSettings, { ...stats, enrichmentWaiting: 100 })).toBe(
      "調査結果の更新に時間がかかっています",
    );
  });

  it("hides development phase labels while leaving later features unavailable", () => {
    const dashboard = readFileSync(new URL("./dashboard.tsx", import.meta.url), "utf8");

    expect(dashboard).not.toContain("Phase 4 · Performance analytics");
    expect(dashboard).not.toContain("Phase 4 complete");
    expect(dashboard).toContain("現在は利用できません");
    expect(dashboard).toContain("ランキング・分析");
  });
});
