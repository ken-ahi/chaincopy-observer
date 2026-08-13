import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { parseCleanupOptions } from "./db-cleanup-options.js";

const execFileAsync = promisify(execFile);

describe("database cleanup CLI runtime", () => {
  it("resolves @chaincopy/database through the root workspace dependency", () => {
    const resolved = import.meta.resolve("@chaincopy/database");
    expect(resolved.replaceAll("\\", "/")).toContain("/packages/database/dist/index.js");
  });

  it("parses root CLI arguments without crossing the database package boundary", () => {
    expect(
      parseCleanupOptions([
        "--dry-run",
        "--table",
        "order_history",
        "--status",
        "badAloPxRejected",
      ]),
    ).toMatchObject({
      dryRun: true,
      status: "badAloPxRejected",
      table: "order_history",
    });
  });

  it("starts from the root, resolves @chaincopy/database, prints help, and exits zero", async () => {
    const windows = process.platform === "win32";
    const executable = windows ? process.execPath : "corepack";
    const pnpmCli = process.env.COREPACK_HOME
      ? `${process.env.COREPACK_HOME}/v1/pnpm/11.9.0/bin/pnpm.mjs`
      : `${process.env.LOCALAPPDATA}/node/corepack/v1/pnpm/11.9.0/bin/pnpm.mjs`;
    const arguments_ = windows
      ? [pnpmCli, "db:cleanup", "--help"]
      : ["pnpm", "db:cleanup", "--help"];
    const result = await execFileAsync(executable, arguments_, {
      cwd: process.cwd(),
      env: { ...process.env, CI: "true" },
      timeout: 30_000,
    });
    expect(result.stdout).toContain("Usage: pnpm db:cleanup");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  }, 35_000);

  it("rejects malformed root arguments before database access", () => {
    expect(() => parseCleanupOptions(["--table"])).toThrow("requires a value");
    expect(() => parseCleanupOptions(["--unknown"])).toThrow("Unknown cleanup option");
  });
});
