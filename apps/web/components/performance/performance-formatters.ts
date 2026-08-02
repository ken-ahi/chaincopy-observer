const percentageMetricKeys = new Set([
  "cumulativeReturn",
  "annualizedReturn",
  "twr",
  "maxDrawdown",
  "volatility",
  "winRate",
  "topTradeContribution",
  "largestCoinShare",
  "concentrationIndex",
]);

const leverageMetricKeys = new Set([
  "medianLeverage",
  "percentile95Leverage",
  "maxLeverage",
  "averageLeverage",
]);

const currencyMetricKeys = new Set(["averageWin", "averageLoss"]);

export function formatPerformanceDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

export function formatPerformanceMinute(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);
}

export function formatPerformanceDay(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

export function formatPerformanceAmount(
  value: string | null,
  options: { signed?: boolean } = {},
): string {
  if (value === null) {
    return "—";
  }
  const parts = parseDecimal(value);
  if (parts === null) {
    return "—";
  }
  const formatted = formatDecimal(value, 12);
  if (options.signed && parts.sign > 0 && !isZeroDecimal(parts)) {
    return `+${formatted}`;
  }
  return formatted;
}

export function formatPerformancePnl(value: string | null): string {
  const formatted = formatPerformanceAmount(value, { signed: true });
  if (value === null) {
    return formatted;
  }
  const comparison = comparePerformanceDecimals(value, "0");
  if (comparison === null) {
    return "—";
  }
  if (comparison > 0) {
    return `${formatted} · Profit`;
  }
  if (comparison < 0) {
    return `${formatted} · Loss`;
  }
  return `${formatted} · Break-even`;
}

export function comparePerformanceDecimals(left: string, right: string): number | null {
  const leftParts = parseDecimal(left);
  const rightParts = parseDecimal(right);
  if (leftParts === null || rightParts === null) {
    return null;
  }

  const leftSign = isZeroDecimal(leftParts) ? 0 : leftParts.sign;
  const rightSign = isZeroDecimal(rightParts) ? 0 : rightParts.sign;
  if (leftSign !== rightSign) {
    return leftSign < rightSign ? -1 : 1;
  }
  if (leftSign === 0) {
    return 0;
  }

  const magnitude = compareDecimalMagnitudes(leftParts, rightParts);
  return leftSign < 0 ? -magnitude : magnitude;
}

export function formatMetricValue(metricKey: string, value: string): string {
  if (percentageMetricKeys.has(metricKey)) {
    return `${formatDecimal(shiftDecimal(value, 2), 4)}%`;
  }
  if (leverageMetricKeys.has(metricKey)) {
    return `${formatDecimal(value, 4)}×`;
  }
  if (currencyMetricKeys.has(metricKey)) {
    return formatCurrency(value);
  }
  return formatDecimal(value, 6);
}

export function formatSafeErrorCode(value: string | null): string {
  return value && /^[A-Z0-9_]{1,80}$/u.test(value) ? value : "—";
}

export function formatSafeErrorMessage(value: string | null): string {
  const firstLine = value?.split(/\r?\n/u, 1)[0]?.trim();
  if (!firstLine) {
    return "—";
  }
  if (
    /(secret|password|token|database_url|redis_url|postgresql:\/\/|redis:\/\/|prisma|[a-z]:\\|\/[^\s]+\.tsx?)/iu.test(
      firstLine,
    )
  ) {
    return "詳細はサーバーログを確認してください。";
  }
  return firstLine.slice(0, 300);
}

function formatCurrency(value: string): string {
  const formatted = formatDecimal(value, 4);
  return formatted.startsWith("-") ? `-$${formatted.slice(1)}` : `$${formatted}`;
}

function formatDecimal(value: string, maxFractionDigits: number): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/u.exec(value.trim());
  if (!match) {
    return value.length > 64 ? `${value.slice(0, 61)}…` : value;
  }
  const sign = match[1] === "-" ? "-" : "";
  const integer = (match[2] ?? "0").replace(/^0+(?=\d)/u, "");
  const fractionSource = match[3] ?? "";
  const fraction = fractionSource.slice(0, maxFractionDigits).replace(/0+$/u, "");
  if (integer === "0" && !fraction && /[1-9]/u.test(fractionSource)) {
    const threshold = `0.${"0".repeat(Math.max(0, maxFractionDigits - 1))}1`;
    return sign ? `>-${threshold}` : `<${threshold}`;
  }
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

interface DecimalParts {
  sign: -1 | 1;
  integer: string;
  fraction: string;
}

function parseDecimal(value: string): DecimalParts | null {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/u.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    sign: match[1] === "-" ? -1 : 1,
    integer: (match[2] ?? "0").replace(/^0+(?=\d)/u, ""),
    fraction: match[3] ?? "",
  };
}

function isZeroDecimal(parts: DecimalParts): boolean {
  return /^0+$/u.test(parts.integer) && (!parts.fraction || /^0+$/u.test(parts.fraction));
}

function compareDecimalMagnitudes(left: DecimalParts, right: DecimalParts): number {
  if (left.integer.length !== right.integer.length) {
    return left.integer.length < right.integer.length ? -1 : 1;
  }
  if (left.integer !== right.integer) {
    return left.integer < right.integer ? -1 : 1;
  }

  const length = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = left.fraction.padEnd(length, "0");
  const rightFraction = right.fraction.padEnd(length, "0");
  if (leftFraction === rightFraction) {
    return 0;
  }
  return leftFraction < rightFraction ? -1 : 1;
}

function shiftDecimal(value: string, places: number): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/u.exec(value.trim());
  if (!match) {
    return value;
  }
  const sign = match[1] === "-" ? "-" : "";
  const integer = match[2] ?? "0";
  const fraction = match[3] ?? "";
  const digits = `${integer}${fraction}`.padEnd(integer.length + places, "0");
  const decimalIndex = integer.length + places;
  const shifted =
    decimalIndex >= digits.length
      ? digits.padEnd(decimalIndex, "0")
      : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  return `${sign}${shifted}`;
}
