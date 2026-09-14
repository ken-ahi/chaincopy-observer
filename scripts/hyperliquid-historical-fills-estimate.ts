import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  buildHistoricalFillPlan,
  estimateHistoricalFillCost,
  type HistoricalFillPricing,
} from "../packages/blockchain-adapters/src/hyperliquid/historical-fills.js";

interface EstimateInput {
  readonly inventory: unknown;
  readonly pricing: HistoricalFillPricing;
  readonly targets: ReadonlyArray<unknown>;
}

export async function runHistoricalFillEstimate(inputPath: string): Promise<void> {
  const rawInput = await readFile(inputPath, "utf8");
  const input = JSON.parse(rawInput) as EstimateInput;
  const plan = buildHistoricalFillPlan(input.inventory, input.targets);
  const estimate = estimateHistoricalFillCost(plan, input.pricing);
  process.stdout.write(`${JSON.stringify({ estimate, plan }, null, 2)}\n`);
  if (!plan.complete) process.exitCode = 2;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write(
      "Usage: pnpm hl:historical-fills:estimate <requester-pays-inventory-and-targets.json>\n",
    );
    process.exitCode = 1;
  } else {
    runHistoricalFillEstimate(inputPath).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
