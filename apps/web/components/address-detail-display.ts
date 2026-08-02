import { type Order } from "../lib/address-api";

export const RECENT_ACTIVITY_LIMIT = 10;
export const OPEN_ORDER_LOOKUP_LIMIT = 10;

export interface AddressDetailPaths {
  readonly detail: string;
  readonly fills: string;
  readonly orders: string;
  readonly positions: string;
}

export function buildAddressDetailPaths(address: string): AddressDetailPaths {
  const base = `/api/addresses/${encodeURIComponent(address)}`;
  return {
    detail: base,
    fills: `${base}/fills?limit=${String(RECENT_ACTIVITY_LIMIT)}`,
    orders: `${base}/orders?limit=${String(OPEN_ORDER_LOOKUP_LIMIT)}&status=open`,
    positions: `${base}/positions`,
  };
}

export function isOpenOrder(order: Order): boolean {
  return order.status.trim().toLowerCase() === "open";
}

export function positionSideLabel(side: string): string {
  const normalized = side.trim().toUpperCase();
  if (normalized === "LONG" || normalized === "BUY") return "買い";
  if (normalized === "SHORT" || normalized === "SELL") return "売り";
  return "方向を確認できません";
}

export function orderSideLabel(side: string): string {
  return side.trim().toUpperCase() === "BUY" ? "買い" : "売り";
}

export function fillActionLabel(side: string): string {
  return side.trim().toUpperCase() === "BUY" ? "買いました" : "売りました";
}
