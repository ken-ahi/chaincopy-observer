import { parseArgs } from "node:util";
import { loadRootEnvironment } from "@chaincopy/config";
import { prisma, disconnectDatabase } from "@chaincopy/database";
import { PrismaDirectionChangeService } from "../../../api/src/direction-change-service.js";

loadRootEnvironment();
try {
  const { values } = parseArgs({
    options: {
      coin: { type: "string" },
      "bucket-start": { type: "string" },
      execute: { type: "boolean", default: false },
      "expected-fingerprint": { type: "string" },
    },
  });
  if (
    !values.coin ||
    !values["bucket-start"] ||
    (values.execute && !values["expected-fingerprint"])
  )
    throw new Error(
      "Explicit coin/current bucket required; execute requires approved expected fingerprint",
    );
  const service = new PrismaDirectionChangeService(prisma);
  const result = values.execute
    ? await service.persist(values.coin, values["bucket-start"], values["expected-fingerprint"]!)
    : await service.preview(values.coin, values["bucket-start"]);
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
