import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildAddressDetailPaths,
  fillActionLabel,
  isOpenOrder,
  orderSideLabel,
  positionSideLabel,
} from "./address-detail-display.js";
import { type Order } from "../lib/address-api.js";

describe("Address detail investor display", () => {
  it("初期表示は必要な4 APIだけを少数件で取得する", () => {
    expect(buildAddressDetailPaths("0xAB CD")).toEqual({
      detail: "/api/addresses/0xAB%20CD",
      fills: "/api/addresses/0xAB%20CD/fills?limit=10",
      orders: "/api/addresses/0xAB%20CD/orders?limit=10&status=open",
      positions: "/api/addresses/0xAB%20CD/positions",
    });
  });

  it("買い・売りを日本語で表示し、約定から過度な行動推測をしない", () => {
    expect(positionSideLabel("LONG")).toBe("買い");
    expect(positionSideLabel("SHORT")).toBe("売り");
    expect(positionSideLabel("unknown")).toBe("方向を確認できません");
    expect(orderSideLabel("BUY")).toBe("買い");
    expect(orderSideLabel("SELL")).toBe("売り");
    expect(fillActionLabel("BUY")).toBe("買いました");
    expect(fillActionLabel("SELL")).toBe("売りました");
  });

  it("現在出している注文には未成立注文だけを残す", () => {
    expect(isOpenOrder(order("open"))).toBe(true);
    expect(isOpenOrder(order("filled"))).toBe(false);
    expect(isOpenOrder(order("canceled"))).toBe(false);
  });

  it("通常画面から生履歴・同期・品質・内部計算情報を除く", () => {
    const detailSource = readFileSync(
      new URL("./address-detail-client.tsx", import.meta.url),
      "utf8",
    );
    const performanceSource = readFileSync(
      new URL("./performance/performance-section.tsx", import.meta.url),
      "utf8",
    );

    for (const hiddenText of [
      "約定履歴（最大100件）",
      "Funding履歴",
      "Ledger履歴",
      "注文履歴（最大100件）",
      "Sync Cursor",
      "Sync Job",
      "Data Quality Issue",
      "Run ID",
      "Input Fingerprint",
      "Warning Codes",
    ]) {
      expect(`${detailSource}\n${performanceSource}`).not.toContain(hiddenText);
    }
  });
});

function order(status: string): Order {
  return {
    coin: "BTC",
    id: `order-${status}`,
    limitPrice: "50000",
    orderType: "Limit",
    side: "BUY",
    size: "0.1",
    status,
    statusTimestamp: "2026-08-02T00:00:00.000Z",
  };
}
