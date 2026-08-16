import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("queue cleanup CLI runtime", () => {
  it("starts from the repository root, prints help without Redis, and exits zero", async () => {
    const executable = process.execPath;
    const result = await execFileAsync(
      executable,
      [
        resolve("node_modules", "tsx", "dist", "cli.mjs"),
        "apps/worker/src/maintenance/queue-cleanup-cli.ts",
        "--help",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, REDIS_URL: "" },
        timeout: 30_000,
      },
    );
    expect(result.stdout).toContain("Usage: pnpm queue:cleanup");
    expect(result.stderr).not.toContain("ECONNREFUSED");
  }, 35_000);
});
