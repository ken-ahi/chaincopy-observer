import { PrismaClient } from "@prisma/client";

import { e2eAddress, e2eAdminEmail, e2eSessionToken } from "./fixtures";

const databaseUrl = localDatabaseUrl(
  process.env.DATABASE_URL ??
    "postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy?schema=public",
);

function localDatabaseUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname === "postgres") {
    url.hostname = "127.0.0.1";
  }
  return url.toString();
}

export default async function globalSetup() {
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
  await database.$disconnect();

  return async () => {
    const cleanup = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    await cleanup.walletAddress.deleteMany({ where: { address: e2eAddress } });
    await cleanup.session.deleteMany({
      where: { sessionToken: e2eSessionToken },
    });
    await cleanup.$disconnect();
  };
}
