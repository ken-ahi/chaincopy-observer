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
