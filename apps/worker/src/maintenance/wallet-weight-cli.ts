import { parseArgs } from "node:util";
import { loadRootEnvironment } from "@chaincopy/config";
import { prisma, disconnectDatabase } from "@chaincopy/database";
import { PrismaWalletWeightService } from "../../../api/src/wallet-weight-service.js";

// No queues, sync, Selection evaluation, or migrations. Preview is READ ONLY.
loadRootEnvironment();
try {
  const { values } = parseArgs({
    options: {
      execute: { type: "boolean", default: false },
      "expected-fingerprint": { type: "string" },
    },
  });
  const service = new PrismaWalletWeightService(prisma);
  if (values.execute && !values["expected-fingerprint"])
    throw new Error("--execute requires --expected-fingerprint from the reviewed preview.");
  const result = values.execute
    ? await service.persist(values["expected-fingerprint"]!)
    : await service.preview();
  console.log(
    JSON.stringify({
      status: result
        ? values.execute
          ? "PERSISTED"
          : "PREVIEW_NOT_PERSISTED"
        : "NO_SELECTED_WALLETS",
      result,
    }),
  );
} finally {
  await disconnectDatabase();
}
