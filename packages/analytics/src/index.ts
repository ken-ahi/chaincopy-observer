import { Decimal } from "decimal.js";

export const ANALYTICS_IMPLEMENTATION_PHASE = 4 as const;

const decimalStringPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function parseDecimalString(value: string): Decimal {
  if (!decimalStringPattern.test(value)) {
    throw new TypeError(`Invalid decimal string: ${value}`);
  }

  return new Decimal(value);
}
