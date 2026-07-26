import { Decimal } from "decimal.js";

import type {
  CalculationCoverage,
  CalculationErrorCode,
  CalculationPrecision,
  CalculationResult,
  CalculationWarning,
  DataCompleteness,
} from "./types.js";

export const AnalysisDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_EVEN,
});

const decimalStringPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const millisecondsPerDay = 86_400_000;

export class CalculationException extends Error {
  public constructor(
    public readonly code: CalculationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function parseDecimalString(value: string): Decimal {
  if (!decimalStringPattern.test(value)) {
    throw new TypeError(`Invalid decimal string: ${value}`);
  }
  return new AnalysisDecimal(value);
}

export function decimal(value: string, field: string): Decimal {
  try {
    return parseDecimalString(value);
  } catch {
    throw new CalculationException("INVALID_DECIMAL", `${field} must be a plain decimal string.`);
  }
}

export function canonical(value: Decimal): string {
  return value.isZero() ? "0" : value.toFixed();
}

export function parseTime(value: string, field: string): number {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    throw new CalculationException("INVALID_INPUT", `${field} must be a valid date-time.`);
  }
  return time;
}

export function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function daysBetween(from: string, to: string): Decimal {
  const difference = parseTime(to, "to") - parseTime(from, "from");
  return new AnalysisDecimal(String(difference)).div(millisecondsPerDay);
}

export function coverageFromTimes(
  times: readonly string[],
  completeness: DataCompleteness = "COMPLETE",
): CalculationCoverage {
  if (times.length === 0) {
    return {
      calculationFrom: "",
      calculationTo: "",
      completeness,
      initialStateKnown: true,
    };
  }
  const sorted = [...times].sort(
    (left, right) => parseTime(left, "time") - parseTime(right, "time"),
  );
  return {
    calculationFrom: sorted[0] ?? "",
    calculationTo: sorted.at(-1) ?? "",
    completeness,
    initialStateKnown: true,
  };
}

interface Computed<T> {
  readonly value: T;
  readonly warnings?: readonly CalculationWarning[];
}

export function execute<T>(
  coverage: CalculationCoverage,
  precision: Exclude<CalculationPrecision, "ESTIMATED" | "UNAVAILABLE">,
  computation: () => Computed<T>,
): CalculationResult<T> {
  const coverageFailure = validateCoverage(coverage);
  if (coverageFailure) {
    return {
      calculationFrom: coverage.calculationFrom,
      calculationTo: coverage.calculationTo,
      completeness: coverage.completeness,
      error: coverageFailure,
      ok: false,
      warnings: [],
    };
  }

  try {
    const computed = computation();
    const warnings = [...(computed.warnings ?? [])];
    if (coverage.completeness === "PARTIAL") {
      warnings.push({
        code: "PARTIAL_HISTORY",
        message: "The result covers only the explicitly bounded available interval.",
      });
    }
    return {
      calculationFrom: coverage.calculationFrom,
      calculationTo: coverage.calculationTo,
      completeness: coverage.completeness,
      ok: true,
      precision,
      value: computed.value,
      warnings,
    };
  } catch (error) {
    const calculationError =
      error instanceof CalculationException
        ? { code: error.code, message: error.message }
        : {
            code: "INVALID_INPUT" as const,
            message: error instanceof Error ? error.message : "Calculation failed.",
          };
    return {
      calculationFrom: coverage.calculationFrom,
      calculationTo: coverage.calculationTo,
      completeness: coverage.completeness,
      error: calculationError,
      ok: false,
      warnings: [],
    };
  }
}

function validateCoverage(
  coverage: CalculationCoverage,
): { readonly code: CalculationErrorCode; readonly message: string } | null {
  if (coverage.completeness === "GAP_DETECTED") {
    return { code: "DATA_GAP", message: "The requested calculation range contains a data gap." };
  }
  if (coverage.completeness === "TRUNCATED") {
    return {
      code: "HISTORY_TRUNCATED",
      message: "The requested calculation range extends beyond available history.",
    };
  }
  if (coverage.completeness === "INSUFFICIENT_HISTORY") {
    return {
      code: "INSUFFICIENT_HISTORY",
      message: "The requested metric does not have enough history.",
    };
  }
  if (coverage.completeness === "PARTIAL" && coverage.initialStateKnown !== true) {
    return {
      code: "MISSING_INITIAL_STATE",
      message: "Partial history requires an explicit initial state.",
    };
  }
  return null;
}

export function warning(code: string, message: string): CalculationWarning {
  return { code, message };
}
