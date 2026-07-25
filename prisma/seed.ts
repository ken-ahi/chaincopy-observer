import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.dataSource.upsert({
    where: { key: "phase1-system" },
    update: {
      enabled: true,
      name: "Phase 1 system checks",
    },
    create: {
      key: "phase1-system",
      name: "Phase 1 system checks",
      kind: "SYSTEM",
      enabled: true,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
