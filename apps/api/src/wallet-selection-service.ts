import { createHash } from "node:crypto";

import { normalizeHyperliquidAddress } from "@chaincopy/blockchain-adapters";
import {
  DEFAULT_WALLET_SELECTION_POLICY,
  effectiveWalletSelectionStatus,
  evaluateWalletSelection,
  validateWalletSelectionPolicy,
  WALLET_SELECTION_POLICY_VERSION,
  type WalletSelectionAutomaticStatus,
  type WalletSelectionOverrideDecision,
  type WalletSelectionPolicy,
  type WalletSelectionReasonCode,
} from "@chaincopy/analytics";
import { Prisma, type PrismaClient } from "@chaincopy/database";

const PERFORMANCE_VERSION = "performance-v3";
const METRIC_KEYS = [
  "annualizedReturn",
  "cumulativeReturn",
  "maxDrawdown",
  "profitFactor",
  "topTradeContribution",
  "winRate",
] as const;

export interface WalletSelectionSettingsDto extends WalletSelectionPolicy {
  readonly updatedAt: string;
}

export interface WalletSelectionSettingsUpdate {
  readonly maxAutoSelected?: number;
  readonly minimumEvaluationDays?: number;
  readonly minimumTrustedClosedCycles?: number;
  readonly minimumAnnualizedReturn?: string;
  readonly maximumDrawdown?: string;
  readonly maximumTopTradeContribution?: string;
  readonly maximumDataAgeHours?: number;
}

export interface WalletSelectionItemDto {
  readonly walletAddressId: string;
  readonly address: string;
  readonly automaticStatus: WalletSelectionAutomaticStatus;
  readonly effectiveStatus: WalletSelectionAutomaticStatus;
  readonly manualOverride: WalletSelectionOverrideDecision;
  readonly overrideNote: string | null;
  readonly rank: number | null;
  readonly reasonCodes: readonly WalletSelectionReasonCode[];
  readonly performanceRunId: string | null;
  readonly lastSyncAt: string | null;
  readonly historyCompleteness: string | null;
  readonly trustedClosedCycleCount: number;
  readonly metrics: Readonly<Record<string, string>>;
}

export interface WalletSelectionRunDto {
  readonly run: {
    readonly id: string;
    readonly policyVersion: string;
    readonly inputFingerprint: string;
    readonly evaluatedAt: string;
    readonly universeCount: number;
    readonly selectedCount: number;
    readonly qualifiedCount: number;
    readonly reviewCount: number;
    readonly excludedCount: number;
  } | null;
  readonly items: readonly WalletSelectionItemDto[];
}

export interface WalletSelectionEvaluationDto extends WalletSelectionRunDto {
  readonly reused: boolean;
}

export interface EffectiveSelectedWalletDto {
  readonly walletAddressId: string;
  readonly address: string;
  readonly automaticStatus: WalletSelectionAutomaticStatus;
  readonly manualOverride: WalletSelectionOverrideDecision;
  readonly selectionRunId: string;
  readonly performanceRunId: string | null;
}

export interface WalletSelectionService {
  getCurrentSelection(): Promise<WalletSelectionRunDto>;
  getSettings(): Promise<WalletSelectionSettingsDto>;
  updateSettings(input: WalletSelectionSettingsUpdate): Promise<WalletSelectionSettingsDto>;
  evaluate(): Promise<WalletSelectionEvaluationDto>;
  setOverride(
    address: string,
    decision: WalletSelectionOverrideDecision,
    note?: string | null,
  ): Promise<WalletSelectionItemDto | null>;
  listEffectiveSelectedWallets(): Promise<readonly EffectiveSelectedWalletDto[]>;
}

export class WalletSelectionWalletNotFoundError extends Error {
  public constructor(address: string) {
    super(`Hyperliquid wallet ${address} was not found.`);
    this.name = "WalletSelectionWalletNotFoundError";
  }
}

const selectionResultInclude = {
  performanceRun: {
    select: {
      _count: { select: { positionCycles: { where: { status: "CLOSED" as const } } } },
      historyCompleteness: true,
      performanceMetrics: {
        orderBy: { metricKey: "asc" as const },
        select: {
          calculationFrom: true,
          calculationTo: true,
          metricKey: true,
          metricValue: true,
        },
        where: {
          metricKey: { in: [...METRIC_KEYS] },
          metricVersion: PERFORMANCE_VERSION,
        },
      },
    },
  },
  walletAddress: {
    select: {
      address: true,
      lastSyncAt: true,
      walletSelectionOverride: { select: { decision: true, note: true } },
    },
  },
} satisfies Prisma.WalletSelectionResultInclude;

const selectionRunInclude = {
  results: {
    include: selectionResultInclude,
    orderBy: { walletAddress: { address: "asc" as const } },
  },
} satisfies Prisma.WalletSelectionRunInclude;

type SelectionRunRow = Prisma.WalletSelectionRunGetPayload<{
  include: typeof selectionRunInclude;
}>;
type SelectionResultRow = SelectionRunRow["results"][number];

export class PrismaWalletSelectionService implements WalletSelectionService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async getCurrentSelection(): Promise<WalletSelectionRunDto> {
    const source = await this.ensureSource();
    const settings = await this.ensureSettings(source.id);
    const run = settings.currentSelectionRunId
      ? await this.findRunById(source.id, settings.currentSelectionRunId)
      : null;
    return run ? toRunDto(run) : { items: [], run: null };
  }

  public async getSettings(): Promise<WalletSelectionSettingsDto> {
    const settings = await this.ensureSettings();
    return toSettingsDto(settings);
  }

  public async updateSettings(
    input: WalletSelectionSettingsUpdate,
  ): Promise<WalletSelectionSettingsDto> {
    const current = await this.ensureSettings();
    const next = validateWalletSelectionPolicy({
      policyVersion: WALLET_SELECTION_POLICY_VERSION,
      maxAutoSelected: input.maxAutoSelected ?? current.maxAutoSelected,
      maximumDataAgeHours: input.maximumDataAgeHours ?? current.maximumDataAgeHours,
      maximumDrawdown: input.maximumDrawdown ?? current.maximumDrawdown.toString(),
      maximumTopTradeContribution:
        input.maximumTopTradeContribution ?? current.maximumTopTradeContribution.toString(),
      minimumAnnualizedReturn:
        input.minimumAnnualizedReturn ?? current.minimumAnnualizedReturn.toString(),
      minimumEvaluationDays: input.minimumEvaluationDays ?? current.minimumEvaluationDays,
      minimumTrustedClosedCycles:
        input.minimumTrustedClosedCycles ?? current.minimumTrustedClosedCycles,
    });
    const updated = await this.database.walletSelectionSettings.update({
      data: {
        maxAutoSelected: next.maxAutoSelected,
        maximumDataAgeHours: next.maximumDataAgeHours,
        maximumDrawdown: next.maximumDrawdown,
        maximumTopTradeContribution: next.maximumTopTradeContribution,
        minimumAnnualizedReturn: next.minimumAnnualizedReturn,
        minimumEvaluationDays: next.minimumEvaluationDays,
        minimumTrustedClosedCycles: next.minimumTrustedClosedCycles,
      },
      where: { id: current.id },
    });
    return toSettingsDto(updated);
  }

  public async evaluate(): Promise<WalletSelectionEvaluationDto> {
    const source = await this.ensureSource();
    const settings = await this.ensureSettings(source.id);
    const policy = toPolicy(settings);
    const evaluatedAt = this.now();
    const wallets = await this.loadUniverse(source.id);
    const fingerprint = selectionFingerprint(source.id, policy, wallets, evaluatedAt);
    const existing = await this.findRunByFingerprint(source.id, fingerprint);
    if (existing) {
      await this.activateRun(settings.id, existing.id);
      return { ...toRunDto(existing), reused: true };
    }

    const inputs = wallets.map((wallet) => {
      const performance = wallet.metricCalculationRuns[0] ?? null;
      const metrics = metricMap(performance?.performanceMetrics ?? []);
      const annualizedReturnMetric = performance?.performanceMetrics.find(
        (metric) => metric.metricKey === "annualizedReturn",
      );
      return {
        address: wallet.address,
        lastSyncAt: wallet.lastSyncAt?.toISOString() ?? null,
        performance: performance
          ? {
              annualizedReturn: metrics.annualizedReturn ?? null,
              annualizedReturnCalculationFrom:
                annualizedReturnMetric?.calculationFrom.toISOString() ?? null,
              annualizedReturnCalculationTo:
                annualizedReturnMetric?.calculationTo.toISOString() ?? null,
              calculationVersion: performance.calculationVersion,
              cumulativeReturn: metrics.cumulativeReturn ?? null,
              historyCompleteness: performance.historyCompleteness,
              maxDrawdown: metrics.maxDrawdown ?? null,
              profitFactor: metrics.profitFactor ?? null,
              runId: performance.id,
              topTradeContribution: metrics.topTradeContribution ?? null,
              trustedClosedCycleCount: performance._count.positionCycles,
              winRate: metrics.winRate ?? null,
            }
          : null,
        walletAddressId: wallet.id,
      };
    });
    const results = evaluateWalletSelection(inputs, policy, evaluatedAt.toISOString());
    const counts = countStatuses(results);

    try {
      await this.database.$transaction(async (transaction) => {
        const run = await transaction.walletSelectionRun.create({
          data: {
            evaluatedAt,
            excludedCount: counts.EXCLUDED,
            inputFingerprint: fingerprint,
            policySnapshot: policy as unknown as Prisma.InputJsonValue,
            policyVersion: policy.policyVersion,
            qualifiedCount: counts.QUALIFIED,
            reviewCount: counts.REVIEW,
            selectedCount: counts.SELECTED,
            sourceId: source.id,
            universeCount: results.length,
          },
          select: { id: true },
        });
        await transaction.walletSelectionResult.createMany({
          data: results.map((result) => ({
            automaticStatus: result.automaticStatus,
            performanceRunId: result.performanceRunId,
            rank: result.rank,
            reasonCodes: [...result.reasonCodes],
            selectionRunId: run.id,
            walletAddressId: result.walletAddressId,
          })),
        });
        await transaction.walletSelectionSettings.update({
          data: { currentSelectionRunId: run.id },
          where: { id: settings.id },
        });
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const reused = await this.findRunByFingerprint(source.id, fingerprint);
      if (!reused) {
        throw new Error("Wallet selection run was not available after a uniqueness conflict.");
      }
      await this.activateRun(settings.id, reused.id);
      return { ...toRunDto(reused), reused: true };
    }

    const saved = await this.findRunByFingerprint(source.id, fingerprint);
    if (!saved) {
      throw new Error("Wallet selection run was not available after persistence.");
    }
    return { ...toRunDto(saved), reused: false };
  }

  public async setOverride(
    addressInput: string,
    decision: WalletSelectionOverrideDecision,
    note?: string | null,
  ): Promise<WalletSelectionItemDto | null> {
    const address = normalizeHyperliquidAddress(addressInput);
    const wallet = await this.database.walletAddress.findFirst({
      select: { id: true },
      where: { address, isWatched: true, source: { kind: "HYPERLIQUID" } },
    });
    if (!wallet) throw new WalletSelectionWalletNotFoundError(address);

    await this.database.walletSelectionOverride.upsert({
      create: { decision, note: note ?? null, walletAddressId: wallet.id },
      update: { decision, ...(note !== undefined ? { note } : {}) },
      where: { walletAddressId: wallet.id },
    });

    const source = await this.ensureSource();
    const settings = await this.ensureSettings(source.id);
    const current = settings.currentSelectionRunId
      ? await this.findRunById(source.id, settings.currentSelectionRunId)
      : null;
    const row = current?.results.find((result) => result.walletAddressId === wallet.id);
    return row ? toItemDto(row) : null;
  }

  public async listEffectiveSelectedWallets(): Promise<readonly EffectiveSelectedWalletDto[]> {
    const source = await this.ensureSource();
    const settings = await this.ensureSettings(source.id);
    const current = settings.currentSelectionRunId
      ? await this.findRunById(source.id, settings.currentSelectionRunId)
      : null;
    if (!current) return [];
    return current.results
      .filter((result) => {
        const decision = result.walletAddress.walletSelectionOverride?.decision ?? "AUTO";
        return effectiveWalletSelectionStatus(result.automaticStatus, decision) === "SELECTED";
      })
      .map((result) => ({
        address: result.walletAddress.address,
        automaticStatus: result.automaticStatus,
        manualOverride: result.walletAddress.walletSelectionOverride?.decision ?? "AUTO",
        performanceRunId: result.performanceRunId,
        selectionRunId: current.id,
        walletAddressId: result.walletAddressId,
      }));
  }

  private async ensureSource() {
    return this.database.dataSource.upsert({
      create: {
        enabled: true,
        key: "hyperliquid-mainnet",
        kind: "HYPERLIQUID",
        name: "Hyperliquid Mainnet",
      },
      update: {},
      where: { key: "hyperliquid-mainnet" },
    });
  }

  private async ensureSettings(sourceId?: string) {
    const resolvedSourceId = sourceId ?? (await this.ensureSource()).id;
    try {
      return await this.database.walletSelectionSettings.upsert({
        create: {
          maxAutoSelected: DEFAULT_WALLET_SELECTION_POLICY.maxAutoSelected,
          maximumDataAgeHours: DEFAULT_WALLET_SELECTION_POLICY.maximumDataAgeHours,
          maximumDrawdown: DEFAULT_WALLET_SELECTION_POLICY.maximumDrawdown,
          maximumTopTradeContribution: DEFAULT_WALLET_SELECTION_POLICY.maximumTopTradeContribution,
          minimumAnnualizedReturn: DEFAULT_WALLET_SELECTION_POLICY.minimumAnnualizedReturn,
          minimumEvaluationDays: DEFAULT_WALLET_SELECTION_POLICY.minimumEvaluationDays,
          minimumTrustedClosedCycles: DEFAULT_WALLET_SELECTION_POLICY.minimumTrustedClosedCycles,
          sourceId: resolvedSourceId,
        },
        update: {},
        where: { sourceId: resolvedSourceId },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      return this.database.walletSelectionSettings.findUniqueOrThrow({
        where: { sourceId: resolvedSourceId },
      });
    }
  }

  private loadUniverse(sourceId: string) {
    return this.database.walletAddress.findMany({
      orderBy: { address: "asc" },
      select: {
        address: true,
        id: true,
        lastSyncAt: true,
        metricCalculationRuns: {
          orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
          select: {
            _count: {
              select: { positionCycles: { where: { status: "CLOSED" } } },
            },
            calculationVersion: true,
            historyCompleteness: true,
            id: true,
            performanceMetrics: {
              orderBy: { metricKey: "asc" },
              select: {
                calculationFrom: true,
                calculationTo: true,
                metricKey: true,
                metricValue: true,
              },
              where: {
                metricKey: { in: [...METRIC_KEYS] },
                metricVersion: PERFORMANCE_VERSION,
              },
            },
          },
          take: 1,
          where: { calculationVersion: PERFORMANCE_VERSION, status: "SUCCEEDED" },
        },
      },
      where: { isWatched: true, sourceId },
    });
  }

  private findRunById(sourceId: string, id: string): Promise<SelectionRunRow | null> {
    return this.database.walletSelectionRun.findFirst({
      include: selectionRunInclude,
      where: { id, sourceId },
    });
  }

  private async activateRun(settingsId: string, runId: string): Promise<void> {
    await this.database.walletSelectionSettings.update({
      data: { currentSelectionRunId: runId },
      where: { id: settingsId },
    });
  }

  private findRunByFingerprint(
    sourceId: string,
    inputFingerprint: string,
  ): Promise<SelectionRunRow | null> {
    return this.database.walletSelectionRun.findUnique({
      include: selectionRunInclude,
      where: {
        sourceId_policyVersion_inputFingerprint: {
          inputFingerprint,
          policyVersion: WALLET_SELECTION_POLICY_VERSION,
          sourceId,
        },
      },
    });
  }
}

function toPolicy(settings: {
  readonly maxAutoSelected: number;
  readonly maximumDataAgeHours: number;
  readonly maximumDrawdown: Prisma.Decimal;
  readonly maximumTopTradeContribution: Prisma.Decimal;
  readonly minimumAnnualizedReturn: Prisma.Decimal;
  readonly minimumEvaluationDays: number;
  readonly minimumTrustedClosedCycles: number;
}): WalletSelectionPolicy {
  return {
    maxAutoSelected: settings.maxAutoSelected,
    maximumDataAgeHours: settings.maximumDataAgeHours,
    maximumDrawdown: settings.maximumDrawdown.toString(),
    maximumTopTradeContribution: settings.maximumTopTradeContribution.toString(),
    minimumAnnualizedReturn: settings.minimumAnnualizedReturn.toString(),
    minimumEvaluationDays: settings.minimumEvaluationDays,
    minimumTrustedClosedCycles: settings.minimumTrustedClosedCycles,
    policyVersion: WALLET_SELECTION_POLICY_VERSION,
  };
}

function toSettingsDto(
  settings: Parameters<typeof toPolicy>[0] & { readonly updatedAt: Date },
): WalletSelectionSettingsDto {
  return { ...toPolicy(settings), updatedAt: settings.updatedAt.toISOString() };
}

function toRunDto(row: SelectionRunRow): WalletSelectionRunDto {
  return {
    items: row.results.map(toItemDto),
    run: {
      evaluatedAt: row.evaluatedAt.toISOString(),
      excludedCount: row.excludedCount,
      id: row.id,
      inputFingerprint: row.inputFingerprint,
      policyVersion: row.policyVersion,
      qualifiedCount: row.qualifiedCount,
      reviewCount: row.reviewCount,
      selectedCount: row.selectedCount,
      universeCount: row.universeCount,
    },
  };
}

function toItemDto(row: SelectionResultRow): WalletSelectionItemDto {
  const decision = row.walletAddress.walletSelectionOverride?.decision ?? "AUTO";
  return {
    address: row.walletAddress.address,
    automaticStatus: row.automaticStatus,
    effectiveStatus: effectiveWalletSelectionStatus(row.automaticStatus, decision),
    historyCompleteness: row.performanceRun?.historyCompleteness ?? null,
    lastSyncAt: row.walletAddress.lastSyncAt?.toISOString() ?? null,
    manualOverride: decision,
    metrics: metricMap(row.performanceRun?.performanceMetrics ?? []),
    overrideNote: row.walletAddress.walletSelectionOverride?.note ?? null,
    performanceRunId: row.performanceRunId,
    rank: row.rank,
    reasonCodes: row.reasonCodes as WalletSelectionReasonCode[],
    trustedClosedCycleCount: row.performanceRun?._count.positionCycles ?? 0,
    walletAddressId: row.walletAddressId,
  };
}

function metricMap(
  metrics: readonly { readonly metricKey: string; readonly metricValue: Prisma.Decimal }[],
): Record<string, string> {
  return Object.fromEntries(
    metrics.map((metric) => [metric.metricKey, metric.metricValue.toString()]),
  );
}

function countStatuses(
  results: readonly { readonly automaticStatus: WalletSelectionAutomaticStatus }[],
): Record<WalletSelectionAutomaticStatus, number> {
  const counts: Record<WalletSelectionAutomaticStatus, number> = {
    EXCLUDED: 0,
    QUALIFIED: 0,
    REVIEW: 0,
    SELECTED: 0,
  };
  for (const result of results) counts[result.automaticStatus] += 1;
  return counts;
}

function selectionFingerprint(
  sourceId: string,
  policy: WalletSelectionPolicy,
  wallets: Awaited<ReturnType<PrismaWalletSelectionService["loadUniverse"]>>,
  evaluatedAt: Date,
): string {
  const maximumAgeMs = policy.maximumDataAgeHours * 3_600_000;
  const payload = {
    policy,
    policyVersion: WALLET_SELECTION_POLICY_VERSION,
    sourceId,
    wallets: wallets.map((wallet) => ({
      dataStale:
        wallet.lastSyncAt === null ||
        evaluatedAt.getTime() - wallet.lastSyncAt.getTime() > maximumAgeMs,
      lastSyncAt: wallet.lastSyncAt?.toISOString() ?? null,
      performanceRunId: wallet.metricCalculationRuns[0]?.id ?? null,
      walletAddressId: wallet.id,
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
