import { z } from "zod";

const hyperliquidAddressPattern = /^0x[0-9a-fA-F]{40}$/;

export const hyperliquidAddressSchema = z
  .string()
  .trim()
  .regex(hyperliquidAddressPattern, "42文字のEVM形式アドレスを入力してください。")
  .transform((address) => address.toLowerCase());

export function normalizeHyperliquidAddress(address: string): string {
  return hyperliquidAddressSchema.parse(address);
}

export function isHyperliquidAddress(address: string): boolean {
  return hyperliquidAddressSchema.safeParse(address).success;
}
