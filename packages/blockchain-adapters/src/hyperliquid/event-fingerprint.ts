import { createHash } from "node:crypto";

import { isLosslessNumber, stringify as stringifyLossless } from "lossless-json";

export function createEventFingerprint(
  eventType: string,
  walletAddress: string,
  payload: unknown,
): string {
  const canonical = canonicalize({
    eventType,
    payload,
    walletAddress: walletAddress.toLowerCase(),
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function stringifyHyperliquidPayload(value: unknown): string {
  return stringifyLossless(value) ?? "{}";
}

function canonicalize(value: unknown): unknown {
  if (isLosslessNumber(value)) {
    return { $number: value.toString() };
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}
