import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("discovery and phase copy", () => {
  it("uses user-facing Japanese terms without changing internal API actions", () => {
    const list = readFileSync(new URL("./discovery-client.tsx", import.meta.url), "utf8");
    const detail = readFileSync(new URL("./discovery-detail-client.tsx", import.meta.url), "utf8");
    const actions = readFileSync(
      new URL("./discovery-candidate-actions.ts", import.meta.url),
      "utf8",
    );

    expect(list).toContain("詳細分析");
    expect(list).toContain("監視対象に追加");
    expect(actions).toContain("/${kind}");
    expect(list).not.toContain(">Enrich<");
    expect(detail).toContain("詳細分析を再実行");
    expect(detail).toContain("詳細分析履歴");
    expect(detail).not.toContain("手動Enrichment");
  });

  it("documents the six processing steps and detailed analysis purpose", () => {
    const list = readFileSync(new URL("./discovery-client.tsx", import.meta.url), "utf8");

    for (const label of [
      "1. 候補を発見",
      "2. 詳細分析",
      "3. 適格性を判定",
      "4. 監視対象に追加",
      "5. 履歴を同期",
      "6. Performanceを計算",
    ]) {
      expect(list).toContain(label);
    }
    expect(list).toContain("履歴完全性・データ品質・監視適格性を判定します");
  });

  it("marks Phase 4 complete while leaving later features unavailable", () => {
    const dashboard = readFileSync(new URL("./dashboard.tsx", import.meta.url), "utf8");

    expect(dashboard).toContain("Phase 4 · Performance analytics");
    expect(dashboard).toContain("Phase 4 complete");
    expect(dashboard).toContain("現在は利用できません");
    expect(dashboard).toContain("ランキング・分析");
  });
});
