import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";

import { e2eAddress, e2eAdminEmail, e2eDiscoveryAddress, e2eSessionToken } from "./fixtures";

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
