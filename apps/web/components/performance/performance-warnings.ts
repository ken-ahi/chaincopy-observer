import { metricLane, performanceReasonForCode, type PerformanceLane } from "./performance-display";
import { type AddressPerformanceDto } from "../../lib/performance-api";

export type WarningMeaningKey =
  | "INCOMPLETE_TRADE_HISTORY"
  | "UNALLOCATED_FUNDING"
  | "NAV_HISTORY_GAP"
  | "NAV_HISTORY_SHORT"
  | "UNKNOWN_TRANSFER"
  | "MISSING_BOUNDARY_NAV"
  | "INVALID_NAV_INPUT"
  | "ADDITIONAL_CAUTION";

export type WarningRunSource = "latest" | "successful";
type WarningScope = PerformanceLane | "overall";

export interface UserWarning {
  readonly affectedLanes: ReadonlyArray<PerformanceLane>;
  readonly meaningKey: WarningMeaningKey;
  readonly message: string;
  readonly priority: number;
  readonly source: WarningRunSource;
}

export interface PerformanceWarningModel {
  readonly hidden: ReadonlyArray<UserWarning>;
  readonly laneWarnings: Readonly<Record<PerformanceLane, ReadonlyArray<UserWarning>>>;
  readonly visible: ReadonlyArray<UserWarning>;
}

interface WarningDefinition {
  readonly codes: ReadonlyArray<string>;
  readonly defaultScope: WarningScope;
  readonly key: WarningMeaningKey;
  readonly priority: number;
  readonly tieBreak: number;
}

interface WarningInput {
  readonly code: string;
  readonly scope: WarningScope;
}

const definitions: ReadonlyArray<WarningDefinition> = [
  {
    key: "INCOMPLETE_TRADE_HISTORY",
    codes: ["PARTIAL_HISTORY", "TRADE_HISTORY_PREFIX_SKIPPED", "POSITION_DISCONTINUITY"],
    defaultScope: "trade",
    priority: 2,
    tieBreak: 0,
  },
  {
    key: "UNALLOCATED_FUNDING",
    codes: ["UNALLOCATED_FUNDING"],
    defaultScope: "trade",
    priority: 2,
    tieBreak: 1,
  },
  {
    key: "NAV_HISTORY_GAP",
    codes: ["DATA_GAP", "RETURN_PERIOD_TRUNCATED_AT_GAP"],
    defaultScope: "return",
    priority: 1,
    tieBreak: 2,
  },
  {
    key: "NAV_HISTORY_SHORT",
    codes: [
      "HISTORY_TRUNCATED",
      "INSUFFICIENT_HISTORY",
      "MINIMUM_HISTORY_NOT_MET",
      "CALCULATION_WINDOW_ADJUSTED",
    ],
    defaultScope: "return",
    priority: 3,
    tieBreak: 3,
  },
  {
    key: "UNKNOWN_TRANSFER",
    codes: ["UNKNOWN_CASH_FLOW"],
    defaultScope: "return",
    priority: 0,
    tieBreak: 4,
  },
  {
    key: "MISSING_BOUNDARY_NAV",
    codes: ["MISSING_CASH_FLOW_BOUNDARY_NAV"],
    defaultScope: "return",
    priority: 0,
    tieBreak: 5,
  },
  {
    key: "INVALID_NAV_INPUT",
    codes: ["NON_POSITIVE_NAV", "INVALID_INPUT", "NO_POSITIVE_DATED_NAV"],
    defaultScope: "return",
    priority: 0,
    tieBreak: 6,
  },
];

const ignoredCodes = new Set(["DERIVED", "ESTIMATED", "REFERENCE_ONLY", "EXACT"]);
const lanes: ReadonlyArray<PerformanceLane> = ["return", "trade", "exposure"];

export function buildPerformanceWarnings(
  data: AddressPerformanceDto,
  consumedMeaningKeys: ReadonlyArray<WarningMeaningKey> = [],
): PerformanceWarningModel {
  const consumed = new Set(consumedMeaningKeys);
  const latestIsDisplayedResult =
    data.latestRun !== null &&
    data.latestSuccessfulRun !== null &&
    data.latestRun.runId === data.latestSuccessfulRun.runId;
  const latest = normalizeWarningInputs(
    (data.latestRun?.warningCodes ?? []).map((code) => ({
      code,
      scope: latestIsDisplayedResult ? defaultScope(code) : "overall",
    })),
    "latest",
  );
  const successful = normalizeWarningInputs(successfulWarningInputs(data), "successful");
  const latestKeys = new Set(latest.map((warning) => warning.meaningKey));
  const successfulAfterRunDeduplication = successful.filter(
    (warning) => !latestKeys.has(warning.meaningKey),
  );
  const primaryCandidates = [...latest, ...successfulAfterRunDeduplication].filter(
    (warning) => !consumed.has(warning.meaningKey) && isPrimaryWarning(warning),
  );
  const laneCandidates = latestIsDisplayedResult
    ? [...latest, ...successfulAfterRunDeduplication]
    : successfulAfterRunDeduplication;
  const warningsForLane = (lane: PerformanceLane): ReadonlyArray<UserWarning> =>
    laneCandidates.filter(
      (warning) =>
        !consumed.has(warning.meaningKey) &&
        warning.affectedLanes.length === 1 &&
        warning.affectedLanes[0] === lane,
    );
  const laneWarnings: Readonly<Record<PerformanceLane, ReadonlyArray<UserWarning>>> = {
    exposure: warningsForLane("exposure"),
    return: warningsForLane("return"),
    trade: warningsForLane("trade"),
  };

  return {
    hidden: primaryCandidates.slice(3),
    laneWarnings,
    visible: primaryCandidates.slice(0, 3),
  };
}

export function normalizeWarningCodes(
  codes: ReadonlyArray<string>,
  source: WarningRunSource,
): ReadonlyArray<UserWarning> {
  return normalizeWarningInputs(
    codes.map((code) => ({ code, scope: source === "latest" ? "overall" : defaultScope(code) })),
    source,
  );
}

function successfulWarningInputs(data: AddressPerformanceDto): ReadonlyArray<WarningInput> {
  if (data.latestSuccessfulRun === null) {
    return [];
  }
  const inputs: Array<WarningInput> = data.latestSuccessfulRun.warningCodes.map((code) => ({
    code,
    scope: defaultScope(code),
  }));

  for (const metricKey of Object.keys(data.metrics).sort()) {
    const lane = metricLane(metricKey);
    for (const code of data.metrics[metricKey]?.warningCodes ?? []) {
      inputs.push({ code, scope: lane ?? defaultScope(code) });
    }
  }
  for (const lane of lanes) {
    for (const code of data.availability[lane].reasons) {
      inputs.push({ code, scope: lane });
    }
  }
  if (
    data.calculationDetails.excludedFillCount > 0 ||
    data.calculationDetails.tradePrefixes.length
  ) {
    inputs.push({ code: "TRADE_HISTORY_PREFIX_SKIPPED", scope: "trade" });
  }
  if (data.calculationDetails.excludedFundingCount > 0) {
    inputs.push({ code: "UNALLOCATED_FUNDING", scope: "trade" });
  }
  if (data.calculationDetails.navGapCount > 0) {
    inputs.push({ code: "DATA_GAP", scope: "return" });
  }
  if (data.calculationDetails.unknownCashFlowCount > 0) {
    inputs.push({ code: "UNKNOWN_CASH_FLOW", scope: "return" });
  }
  return inputs;
}

function normalizeWarningInputs(
  inputs: ReadonlyArray<WarningInput>,
  source: WarningRunSource,
): ReadonlyArray<UserWarning> {
  const grouped = new Map<
    WarningMeaningKey,
    { definition: WarningDefinition; message: string; scopes: Set<WarningScope> }
  >();
  for (const input of inputs) {
    if (ignoredCodes.has(input.code)) {
      continue;
    }
    const definition = definitionForCode(input.code);
    const existing = grouped.get(definition.key);
    if (existing) {
      existing.scopes.add(input.scope);
    } else {
      grouped.set(definition.key, {
        definition,
        message: performanceReasonForCode(input.code, input.scope).message,
        scopes: new Set([input.scope]),
      });
    }
  }

  return [...grouped.values()]
    .map(({ definition, message, scopes }) => ({
      affectedLanes: scopes.has("overall") ? [...lanes] : lanes.filter((lane) => scopes.has(lane)),
      meaningKey: definition.key,
      message,
      priority: definition.priority,
      source,
      tieBreak: definition.tieBreak,
    }))
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        left.tieBreak - right.tieBreak ||
        left.meaningKey.localeCompare(right.meaningKey),
    )
    .map(({ tieBreak: _tieBreak, ...warning }) => warning);
}

function definitionForCode(code: string): WarningDefinition {
  return (
    definitions.find((definition) => definition.codes.includes(code)) ?? {
      key: "ADDITIONAL_CAUTION",
      codes: [code],
      defaultScope: "overall",
      priority: 4,
      tieBreak: 99,
    }
  );
}

function defaultScope(code: string): WarningScope {
  return definitionForCode(code).defaultScope;
}

function isPrimaryWarning(warning: UserWarning): boolean {
  return warning.affectedLanes.length !== 1;
}
