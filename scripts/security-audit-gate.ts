import { spawnSync } from "node:child_process";
import { basename } from "node:path";

import { evaluateSecurityAudit } from "./security-audit-policy.js";

function runPnpm(args: string[]) {
  const cli = process.env.npm_execpath;
  if (!cli || !/^pnpm\.(?:c?js|mjs)$/.test(basename(cli))) {
    throw new Error("Run this gate through pnpm security:audit (pnpm 11.9.0).");
  }
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.signal || result.status === null) throw new Error("pnpm did not exit normally");
  return result;
}

try {
  const version = runPnpm(["--version"]);
  if (version.status !== 0 || version.stdout.trim() !== "11.9.0") {
    throw new Error("Audit parser requires repository-pinned pnpm 11.9.0");
  }
  // Do not filter or hide the original findings. Nonzero audit is evidence, not
  // automatic success: the strict policy must account for every high/critical.
  const audit = runPnpm(["audit", "--audit-level", "high", "--json"]);
  process.stdout.write(audit.stdout);
  process.stderr.write(audit.stderr);
  const inventory = runPnpm(["-r", "list", "braces", "--depth", "Infinity", "--json"]);
  if (inventory.status !== 0) throw new Error(`Dependency inventory failed: ${inventory.stderr}`);
  const result = evaluateSecurityAudit(
    JSON.parse(audit.stdout) as unknown,
    audit.status,
    JSON.parse(inventory.stdout) as unknown,
  );
  console.log(JSON.stringify(result));
  console.log(
    result.exceptionUsed
      ? "TEMPORARY OWNER EXCEPTION USED: remove when a patched public dependency path exists."
      : "No high findings; exception unused. Review whether the temporary gate can be removed.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
