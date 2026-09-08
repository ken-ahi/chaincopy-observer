import { createHash } from "node:crypto";

export const STAGE3A_MANIFEST_SHA256 =
  "effe5f8c8c294d3071b45422ddc463bc87fab4a3f67fa0c12613d2d63aff0329";

const EXPECTED_CLASS_HASHES = {
  clearinghouseCurrentState: "bdab83ff7a44fe43597387f65a70cb1f615ce949038db07abf7ecfb0b4e57357",
  portfolioEnvelope: "e0c44f691b35c99bd3224738394486611e016cc76c95b456aa7a1c0a76453555",
  portfolioHistory: "0c3b4345a866839de38fc9d01721847071df64323064ff7d65939cff74649ef0",
  rawSourceEvent: "34c14c130320915ef3824f8a74ee76c3a6967085f82b3679e198540975fc432c",
} as const;

type PortfolioClass = "clearinghouseCurrentState" | "portfolioEnvelope" | "portfolioHistory";

export interface ManifestPortfolioRow {
  readonly capturedAt: string;
  readonly className: PortfolioClass;
  readonly createdAt: string;
  readonly fingerprint: string;
  readonly id: string;
  readonly snapshotType: "clearinghouseState" | "portfolio" | "portfolio-history";
  readonly sourceId: string;
  readonly sourceJobId: string;
  readonly walletAddressId: string;
}

export interface ManifestRawRow {
  readonly canonicalAddressIncidentRow: boolean;
  readonly eventType: string;
  readonly fingerprint: string;
  readonly id: string;
  readonly receivedAt: string;
  readonly sourceId: string;
  readonly sourceJobId: string;
  readonly walletAddressId: string;
}

export interface ManifestSyncJob {
  readonly finishedAt: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly jobName: string;
  readonly startedAt: string;
  readonly walletAddressId: string;
}

export interface Stage3BManifest {
  readonly artifactSha256: string;
  readonly deleteRows: readonly ManifestPortfolioRow[];
  readonly jobs: readonly ManifestSyncJob[];
  readonly keepRows: readonly ManifestRawRow[];
}

export interface CurrentPortfolioRow {
  readonly capturedAt: string;
  readonly createdAt: string;
  readonly fingerprint: string;
  readonly id: string;
  readonly snapshotType: string;
  readonly sourceId: string;
  readonly walletAddressId: string;
}

export interface CurrentRawRow {
  readonly eventType: string;
  readonly fingerprint: string;
  readonly id: string;
  readonly receivedAt: string;
  readonly sourceId: string;
  readonly walletAddressId: string;
}

export interface CurrentSyncJob {
  readonly finishedAt: string | null;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly jobName: string;
  readonly startedAt: string | null;
  readonly walletAddressId: string | null;
}

export interface Stage3BMatchResult {
  readonly deleteExactMatches: number;
  readonly duplicateOrAmbiguousMatches: number;
  readonly identityMismatches: readonly string[];
  readonly keepExactMatches: number;
  readonly keepRowsSelectedForMutation: number;
  readonly manifestDeleteCount: number;
  readonly manifestKeepCount: number;
  readonly missingDeleteRows: readonly string[];
  readonly missingKeepRows: readonly string[];
  readonly missingOrMismatchedJobs: readonly string[];
  readonly outsideManifestRowsSelectedForMutation: number;
  readonly ready: boolean;
}

function fail(message: string): never {
  throw new Error(`Invalid Stage 3A manifest: ${message}`);
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${name} must be an array`);
  return value;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${name} must be a non-empty string`);
  return value;
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") fail(`${name} must be a boolean`);
  return value;
}

function assertColumns(actual: unknown, expected: readonly string[], name: string): void {
  const columns = asArray(actual, name).map((value, index) => asString(value, `${name}[${index}]`));
  if (
    columns.length !== expected.length ||
    columns.some((value, index) => value !== expected[index])
  ) {
    fail(`${name} does not match the authoritative positional schema`);
  }
}

function parseJob(value: unknown, index: number): ManifestSyncJob {
  const row = asArray(value, `jobs[${index}]`);
  if (row.length !== 6) fail(`jobs[${index}] must contain 6 values`);
  return {
    id: asString(row[0], `jobs[${index}].id`),
    idempotencyKey: asString(row[1], `jobs[${index}].idempotencyKey`),
    jobName: asString(row[2], `jobs[${index}].jobName`),
    walletAddressId: asString(row[3], `jobs[${index}].walletAddressId`),
    startedAt: asString(row[4], `jobs[${index}].startedAt`),
    finishedAt: asString(row[5], `jobs[${index}].finishedAt`),
  };
}

function parsePortfolioRow(
  value: unknown,
  className: PortfolioClass,
  index: number,
): ManifestPortfolioRow {
  const row = asArray(value, `${className}.rows[${index}]`);
  if (row.length !== 7) fail(`${className}.rows[${index}] must contain 7 values`);
  const snapshotType =
    className === "portfolioHistory"
      ? "portfolio-history"
      : className === "portfolioEnvelope"
        ? "portfolio"
        : "clearinghouseState";
  return {
    id: asString(row[0], `${className}.rows[${index}].id`),
    walletAddressId: asString(row[1], `${className}.rows[${index}].walletAddressId`),
    sourceId: asString(row[2], `${className}.rows[${index}].sourceId`),
    fingerprint: asString(row[3], `${className}.rows[${index}].fingerprint`),
    capturedAt: asString(row[4], `${className}.rows[${index}].capturedAt`),
    createdAt: asString(row[5], `${className}.rows[${index}].createdAt`),
    sourceJobId: asString(row[6], `${className}.rows[${index}].sourceJobId`),
    className,
    snapshotType,
  };
}

function parseRawRow(value: unknown, index: number): ManifestRawRow {
  const row = asArray(value, `rawSourceEvent.rows[${index}]`);
  if (row.length !== 8) fail(`rawSourceEvent.rows[${index}] must contain 8 values`);
  return {
    id: asString(row[0], `rawSourceEvent.rows[${index}].id`),
    walletAddressId: asString(row[1], `rawSourceEvent.rows[${index}].walletAddressId`),
    sourceId: asString(row[2], `rawSourceEvent.rows[${index}].sourceId`),
    fingerprint: asString(row[3], `rawSourceEvent.rows[${index}].fingerprint`),
    eventType: asString(row[4], `rawSourceEvent.rows[${index}].eventType`),
    receivedAt: asString(row[5], `rawSourceEvent.rows[${index}].receivedAt`),
    sourceJobId: asString(row[6], `rawSourceEvent.rows[${index}].sourceJobId`),
    canonicalAddressIncidentRow: asBoolean(
      row[7],
      `rawSourceEvent.rows[${index}].canonicalAddressIncidentRow`,
    ),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function classHash(rows: readonly (ManifestPortfolioRow | ManifestRawRow)[]): string {
  const lines = rows
    .map((row) =>
      "eventType" in row
        ? [
            row.id,
            row.walletAddressId,
            row.sourceId,
            row.eventType,
            row.fingerprint,
            row.receivedAt,
          ].join("|")
        : [
            row.id,
            row.walletAddressId,
            row.sourceId,
            row.fingerprint,
            row.capturedAt,
            row.createdAt,
          ].join("|"),
    )
    .sort();
  return sha256(lines.join("\n"));
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label} contains duplicate values`);
}

export function parseAndValidateStage3AManifest(text: string): Stage3BManifest {
  const artifactSha256 = sha256(text);
  if (artifactSha256 !== STAGE3A_MANIFEST_SHA256) fail(`artifact SHA-256 is ${artifactSha256}`);
  const root = asObject(JSON.parse(text) as unknown, "root");
  assertColumns(
    root.jobColumns,
    ["id", "idempotencyKey", "jobName", "walletAddressId", "startedAt", "finishedAt"],
    "jobColumns",
  );
  assertColumns(
    root.portfolioColumns,
    ["id", "walletAddressId", "sourceId", "fingerprint", "capturedAt", "createdAt", "sourceJobId"],
    "portfolioColumns",
  );
  assertColumns(
    root.rawColumns,
    [
      "id",
      "walletAddressId",
      "sourceId",
      "fingerprint",
      "eventType",
      "receivedAt",
      "sourceJobId",
      "canonicalAddressIncidentRow",
    ],
    "rawColumns",
  );
  const classes = asObject(root.classes, "classes");
  const classNames = Object.keys(classes).sort();
  const expectedNames = Object.keys(EXPECTED_CLASS_HASHES).sort();
  if (classNames.join("|") !== expectedNames.join("|"))
    fail("class set differs from the authoritative manifest");

  const parseClass = (name: keyof typeof EXPECTED_CLASS_HASHES): readonly unknown[] => {
    const item = asObject(classes[name], `classes.${name}`);
    const expectedTable = name === "rawSourceEvent" ? "raw_events" : "portfolio_snapshots";
    const expectedAction = name === "rawSourceEvent" ? "KEEP" : "DELETE";
    if (item.table !== expectedTable || item.action !== expectedAction)
      fail(`${name} table/action changed`);
    return asArray(item.rows, `classes.${name}.rows`);
  };
  const history = parseClass("portfolioHistory").map((row, index) =>
    parsePortfolioRow(row, "portfolioHistory", index),
  );
  const envelope = parseClass("portfolioEnvelope").map((row, index) =>
    parsePortfolioRow(row, "portfolioEnvelope", index),
  );
  const clearing = parseClass("clearinghouseCurrentState").map((row, index) =>
    parsePortfolioRow(row, "clearinghouseCurrentState", index),
  );
  const keepRows = parseClass("rawSourceEvent").map(parseRawRow);
  const deleteRows = [...history, ...envelope, ...clearing];
  const jobs = asArray(root.jobs, "jobs").map(parseJob);

  if (history.length !== 143 || envelope.length !== 13 || clearing.length !== 5)
    fail("DELETE class counts are not 143/13/5");
  if (
    deleteRows.length !== 161 ||
    keepRows.length !== 42 ||
    deleteRows.length + keepRows.length !== 203
  )
    fail("row counts are not DELETE=161, KEEP=42, total=203");
  if (jobs.length !== 22) fail(`expected 22 source jobs, found ${jobs.length}`);
  assertUnique(
    deleteRows.map((row) => row.id),
    "portfolio snapshot primary keys",
  );
  assertUnique(
    keepRows.map((row) => row.id),
    "raw event primary keys",
  );
  assertUnique(
    jobs.map((job) => job.id),
    "sync job primary keys",
  );
  assertUnique(
    jobs.map((job) => job.idempotencyKey),
    "sync job idempotency keys",
  );
  assertUnique(
    deleteRows.map((row) => `portfolio_snapshots:${row.id}`),
    "DELETE physical identities",
  );
  assertUnique(
    keepRows.map((row) => `raw_events:${row.id}`),
    "KEEP physical identities",
  );
  const jobIds = new Set(jobs.map((job) => job.id));
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  for (const row of [...deleteRows, ...keepRows]) {
    if (!jobIds.has(row.sourceJobId)) fail(`row ${row.id} references an absent source job`);
    const job = jobsById.get(row.sourceJobId)!;
    if (job.walletAddressId !== row.walletAddressId)
      fail(`row ${row.id} and source job wallet differ`);
    const expectedJobName =
      "eventType" in row
        ? row.eventType === "portfolio"
          ? "hyperliquid-portfolio-snapshot"
          : row.eventType === "historicalOrders"
            ? "hyperliquid-historical-orders-sync"
            : "hyperliquid-current-state-snapshot"
        : row.snapshotType === "clearinghouseState"
          ? "hyperliquid-current-state-snapshot"
          : "hyperliquid-portfolio-snapshot";
    if (job.jobName !== expectedJobName) fail(`row ${row.id} and source job type differ`);
    const persistedAt = "eventType" in row ? row.receivedAt : row.createdAt;
    if (persistedAt < job.startedAt || persistedAt > job.finishedAt) {
      fail(`row ${row.id} persistence time is outside its source job interval`);
    }
  }
  const actualHashes = {
    clearinghouseCurrentState: classHash(clearing),
    portfolioEnvelope: classHash(envelope),
    portfolioHistory: classHash(history),
    rawSourceEvent: classHash(keepRows),
  };
  for (const name of Object.keys(EXPECTED_CLASS_HASHES) as (keyof typeof EXPECTED_CLASS_HASHES)[]) {
    if (actualHashes[name] !== EXPECTED_CLASS_HASHES[name])
      fail(`${name} checksum is ${actualHashes[name]}`);
  }
  return { artifactSha256, deleteRows, jobs, keepRows };
}

function samePortfolio(expected: ManifestPortfolioRow, actual: CurrentPortfolioRow): boolean {
  return (
    expected.id === actual.id &&
    expected.walletAddressId === actual.walletAddressId &&
    expected.sourceId === actual.sourceId &&
    expected.fingerprint === actual.fingerprint &&
    expected.snapshotType === actual.snapshotType &&
    expected.capturedAt === actual.capturedAt &&
    expected.createdAt === actual.createdAt
  );
}

function sameRaw(expected: ManifestRawRow, actual: CurrentRawRow): boolean {
  return (
    expected.id === actual.id &&
    expected.walletAddressId === actual.walletAddressId &&
    expected.sourceId === actual.sourceId &&
    expected.fingerprint === actual.fingerprint &&
    expected.eventType === actual.eventType &&
    expected.receivedAt === actual.receivedAt
  );
}

function sameJob(expected: ManifestSyncJob, actual: CurrentSyncJob): boolean {
  return (
    expected.id === actual.id &&
    expected.idempotencyKey === actual.idempotencyKey &&
    expected.jobName === actual.jobName &&
    expected.walletAddressId === actual.walletAddressId &&
    expected.startedAt === actual.startedAt &&
    expected.finishedAt === actual.finishedAt
  );
}

export function verifyCurrentRows(input: {
  readonly manifest: Stage3BManifest;
  readonly portfolioRows: readonly CurrentPortfolioRow[];
  readonly rawRows: readonly CurrentRawRow[];
  readonly syncJobs: readonly CurrentSyncJob[];
}): Stage3BMatchResult {
  const portfolioById = new Map<string, CurrentPortfolioRow[]>();
  for (const row of input.portfolioRows)
    portfolioById.set(row.id, [...(portfolioById.get(row.id) ?? []), row]);
  const rawById = new Map<string, CurrentRawRow[]>();
  for (const row of input.rawRows) rawById.set(row.id, [...(rawById.get(row.id) ?? []), row]);
  const jobsById = new Map(input.syncJobs.map((job) => [job.id, job]));
  const missingDeleteRows: string[] = [];
  const missingKeepRows: string[] = [];
  const identityMismatches: string[] = [];
  let duplicateOrAmbiguousMatches = 0;
  let deleteExactMatches = 0;
  let keepExactMatches = 0;
  for (const expected of input.manifest.deleteRows) {
    const matches = portfolioById.get(expected.id) ?? [];
    if (matches.length === 0) missingDeleteRows.push(expected.id);
    else if (matches.length > 1) duplicateOrAmbiguousMatches += 1;
    else if (!samePortfolio(expected, matches[0]!))
      identityMismatches.push(`portfolio_snapshots:${expected.id}`);
    else deleteExactMatches += 1;
  }
  for (const expected of input.manifest.keepRows) {
    const matches = rawById.get(expected.id) ?? [];
    if (matches.length === 0) missingKeepRows.push(expected.id);
    else if (matches.length > 1) duplicateOrAmbiguousMatches += 1;
    else if (!sameRaw(expected, matches[0]!)) identityMismatches.push(`raw_events:${expected.id}`);
    else keepExactMatches += 1;
  }
  const missingOrMismatchedJobs = input.manifest.jobs
    .filter((expected) => {
      const actual = jobsById.get(expected.id);
      return !actual || !sameJob(expected, actual);
    })
    .map((job) => job.id);
  const deleteIds = new Set(input.manifest.deleteRows.map((row) => row.id));
  const keepRowsSelectedForMutation = input.manifest.keepRows.filter((row) =>
    deleteIds.has(row.id),
  ).length;
  const outsideManifestRowsSelectedForMutation = input.portfolioRows.filter(
    (row) => !deleteIds.has(row.id),
  ).length;
  const ready =
    input.manifest.deleteRows.length === 161 &&
    deleteExactMatches === 161 &&
    missingDeleteRows.length === 0 &&
    identityMismatches.length === 0 &&
    duplicateOrAmbiguousMatches === 0 &&
    keepRowsSelectedForMutation === 0 &&
    outsideManifestRowsSelectedForMutation === 0 &&
    missingKeepRows.length === 0 &&
    keepExactMatches === 42 &&
    missingOrMismatchedJobs.length === 0;
  return {
    deleteExactMatches,
    duplicateOrAmbiguousMatches,
    identityMismatches,
    keepExactMatches,
    keepRowsSelectedForMutation,
    manifestDeleteCount: input.manifest.deleteRows.length,
    manifestKeepCount: input.manifest.keepRows.length,
    missingDeleteRows,
    missingKeepRows,
    missingOrMismatchedJobs,
    outsideManifestRowsSelectedForMutation,
    ready,
  };
}
