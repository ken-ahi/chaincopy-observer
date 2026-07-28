import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import {
  e2eAddress,
  e2eAdminEmail,
  e2eDiscoveryAddress,
  e2eInsufficientPerformanceAddress,
  e2eManualPerformanceAddress,
  e2ePerformanceAddress,
  e2eSessionToken,
} from "./fixtures";

const schemaName = "chaincopy_e2e";
const databaseUrl = e2eDatabaseUrl(
  process.env.DATABASE_URL ??
    "postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy?schema=public",
);

function e2eDatabaseUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname === "postgres") {
    url.hostname = "127.0.0.1";
  }
  url.searchParams.set("schema", schemaName);
  return url.toString();
}

export default async function globalSetup() {
  const administrationUrl = new URL(databaseUrl);
  administrationUrl.searchParams.set("schema", "public");
  const administration = new PrismaClient({
    datasources: { db: { url: administrationUrl.toString() } },
  });
  await administration.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await administration.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  await administration.$disconnect();
  execFileSync(
    process.execPath,
    [resolve(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    },
  );

  const database = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  const user = await database.user.upsert({
    create: {
      email: e2eAdminEmail,
      name: "E2E Owner",
    },
    update: {
      name: "E2E Owner",
    },
    where: { email: e2eAdminEmail },
  });
  await database.session.upsert({
    create: {
      expires: new Date(Date.now() + 60 * 60 * 1_000),
      sessionToken: e2eSessionToken,
      userId: user.id,
    },
    update: {
      expires: new Date(Date.now() + 60 * 60 * 1_000),
      userId: user.id,
    },
    where: { sessionToken: e2eSessionToken },
  });
  await database.walletAddress.deleteMany({ where: { address: e2eAddress } });
  const source = await database.dataSource.upsert({
    create: {
      enabled: true,
      key: "hyperliquid-mainnet",
      kind: "HYPERLIQUID",
      name: "Hyperliquid Mainnet",
    },
    update: { enabled: true },
    where: { key: "hyperliquid-mainnet" },
  });
  const performanceWallet = await database.walletAddress.create({
    data: {
      address: e2ePerformanceAddress,
      displayName: "E2E Performance Success",
      isWatched: false,
      ownerUserId: user.id,
      sourceId: source.id,
    },
  });
  const insufficientWallet = await database.walletAddress.create({
    data: {
      address: e2eInsufficientPerformanceAddress,
      displayName: "E2E Performance Insufficient",
      isWatched: false,
      ownerUserId: user.id,
      sourceId: source.id,
    },
  });
  await database.walletAddress.create({
    data: {
      address: e2eManualPerformanceAddress,
      displayName: "E2E Performance Manual",
      isWatched: true,
      ownerUserId: user.id,
      sourceId: source.id,
    },
  });
  const calculationFrom = new Date("2026-06-01T00:00:00.000Z");
  const calculationTo = new Date("2026-06-30T23:59:59.999Z");
  const successRun = await database.metricCalculationRun.create({
    data: {
      calculationFrom,
      calculationTo,
      calculationVersion: "performance-v1",
      completedAt: new Date("2026-07-01T00:00:02.000Z"),
      deduplicationKey: "phase4e-e2e-success-deduplication-key",
      historyCompleteness: "COMPLETE",
      id: "phase4e-e2e-success-run",
      inputFingerprint: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      precision: "EXACT",
      requestedAt: new Date("2026-07-01T00:00:00.000Z"),
      requestedBy: "phase4e-browser-e2e",
      startedAt: new Date("2026-07-01T00:00:01.000Z"),
      status: "SUCCEEDED",
      walletAddressId: performanceWallet.id,
      warningCodes: [],
      warningCount: 0,
    },
  });
  await database.addressPerformanceMetric.createMany({
    data: [
      ["cumulativeReturn", "0.123456789012", "EXACT"],
      ["maxDrawdown", "-0.045", "EXACT"],
      ["sharpeRatio", "1.23456789", "DERIVED"],
      ["winRate", "0.625", "EXACT"],
      ["medianLeverage", "2.5", "EXACT"],
      ["largestCoinShare", "0.55", "ESTIMATED"],
    ].map(([metricKey, metricValue, precision]) => ({
      calculationFrom,
      calculationRunId: successRun.id,
      calculationTo,
      metricKey: metricKey!,
      metricValue: metricValue!,
      metricVersion: "performance-v1",
      precision: precision as "EXACT" | "DERIVED" | "ESTIMATED",
      status: "AVAILABLE" as const,
      walletAddressId: performanceWallet.id,
      warningCodes: [],
    })),
  });
  await database.dailyNav.createMany({
    data: [
      {
        cashBalance: "1000.123456789012",
        date: new Date("2026-06-01T00:00:00.000Z"),
        externalCashFlow: null,
        fees: "-0.000000000123",
        funding: "0.000000000001",
        historyCompleteness: "COMPLETE" as const,
        nav: "1000.123456789012",
        precision: "EXACT" as const,
        realizedPnl: null,
        unrealizedPnl: null,
      },
      {
        cashBalance: "1005.5",
        date: new Date("2026-06-02T00:00:00.000Z"),
        externalCashFlow: "5",
        fees: "-0.25",
        funding: "0.125",
        historyCompleteness: "COMPLETE" as const,
        nav: "1012.500000000001",
        precision: "DERIVED" as const,
        realizedPnl: "7.25",
        unrealizedPnl: "0.5",
      },
      {
        cashBalance: "995.25",
        date: new Date("2026-06-03T00:00:00.000Z"),
        externalCashFlow: null,
        fees: "-0.5",
        funding: "-0.125",
        historyCompleteness: "PARTIAL" as const,
        nav: "1008.000000000001",
        precision: "ESTIMATED" as const,
        realizedPnl: "-4",
        unrealizedPnl: "12.75",
      },
    ].map((item) => ({
      ...item,
      calculationRunId: successRun.id,
      walletAddressId: performanceWallet.id,
    })),
  });
  await database.positionCycle.createMany({
    data: [
      {
        averageEntryPrice: "60000.123456789012",
        averageExitPrice: "61000.5",
        closedAt: new Date("2026-06-05T01:00:00.000Z"),
        coin: "BTC",
        entryQuantity: "0.100000000001",
        exitQuantity: "0.100000000001",
        fees: "-1.25",
        fillCount: 2,
        funding: "0.25",
        grossRealizedPnl: "100.5",
        inputFingerprint: "phase4e-cycle-closed-long",
        netRealizedPnl: "99.5",
        openedAt: new Date("2026-06-04T00:00:00.000Z"),
        side: "LONG" as const,
        status: "CLOSED" as const,
      },
      {
        averageEntryPrice: "2500.5",
        averageExitPrice: "2550.75",
        closedAt: new Date("2026-06-07T01:00:00.000Z"),
        coin: "ETH",
        entryQuantity: "1.5",
        exitQuantity: "1.5",
        fees: "-2",
        fillCount: 3,
        funding: "-0.5",
        grossRealizedPnl: "-75.375",
        inputFingerprint: "phase4e-cycle-closed-short",
        netRealizedPnl: "-77.875",
        openedAt: new Date("2026-06-06T00:00:00.000Z"),
        side: "SHORT" as const,
        status: "CLOSED" as const,
      },
      {
        averageEntryPrice: "150.000000000001",
        averageExitPrice: null,
        closedAt: null,
        coin: "SOL",
        entryQuantity: "2.000000000001",
        exitQuantity: "0",
        fees: "-0.125",
        fillCount: 1,
        funding: "0.000000000001",
        grossRealizedPnl: "0",
        inputFingerprint: "phase4e-cycle-open-long",
        netRealizedPnl: "0",
        openedAt: new Date("2026-06-08T00:00:00.000Z"),
        side: "LONG" as const,
        status: "OPEN" as const,
      },
    ].map((item) => ({
      ...item,
      calculationRunId: successRun.id,
      walletAddressId: performanceWallet.id,
    })),
  });
  await database.metricCalculationRun.create({
    data: {
      calculationFrom,
      calculationTo,
      calculationVersion: "performance-v1",
      completedAt: new Date("2026-07-01T00:00:02.000Z"),
      deduplicationKey: "phase4e-e2e-insufficient-deduplication-key",
      historyCompleteness: "INSUFFICIENT_HISTORY",
      id: "phase4e-e2e-insufficient-run",
      inputFingerprint: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      precision: "UNAVAILABLE",
      requestedAt: new Date("2026-07-01T00:00:00.000Z"),
      requestedBy: "phase4e-browser-e2e",
      startedAt: new Date("2026-07-01T00:00:01.000Z"),
      status: "INSUFFICIENT_DATA",
      walletAddressId: insufficientWallet.id,
      warningCodes: ["MINIMUM_HISTORY_NOT_MET"],
      warningCount: 1,
    },
  });
  await database.addressCandidate.deleteMany({ where: { address: e2eDiscoveryAddress } });
  await database.discoverySettings.upsert({
    create: { enabled: false, sourceId: source.id },
    update: {
      enabled: false,
      minimumObservedNotionalUsd: "10000",
      minimumObservedTradeCount: 10,
      mode: "MAJOR",
    },
    where: { sourceId: source.id },
  });
  await database.addressCandidate.create({
    data: {
      activeDays: 2,
      activeHours: 12,
      address: e2eDiscoveryAddress,
      averageTradeUsd: "1250",
      coins: {
        create: [
          {
            coin: "BTC",
            firstSeenAt: new Date("2026-07-25T00:00:00.000Z"),
            lastSeenAt: new Date("2026-07-26T00:00:00.000Z"),
            tradeCount: 8,
          },
          {
            coin: "ETH",
            firstSeenAt: new Date("2026-07-25T01:00:00.000Z"),
            lastSeenAt: new Date("2026-07-26T00:00:00.000Z"),
            tradeCount: 4,
          },
        ],
      },
      dataQualityScore: 60,
      distinctCoins: 2,
      enrichmentStatus: "PENDING",
      estimatedNotionalUsd: "15000",
      filterStatus: "LIGHT_ELIGIBLE",
      firstSeenAt: new Date("2026-07-25T00:00:00.000Z"),
      largestTradeUsd: "5000",
      lastSeenAt: new Date("2026-07-26T00:00:00.000Z"),
      sourceId: source.id,
      tradeCount: 12,
    },
  });
  await database.$disconnect();
}
