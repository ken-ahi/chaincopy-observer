// Temporary Owner-approved exception, 2026-10-03. Remove with the first patched
// public dependency path; see docs/security-audit-exception.md. Not an ignore list.
export const approvedBracesException = {
  advisory: "GHSA-vfj7-8cjw-p6xm",
  package: "braces",
  version: "3.0.3",
  path: ".>@next/eslint-plugin-next>fast-glob>micromatch>braces",
} as const;

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Security audit gate: ${message}`);
}

function record(value: unknown): Record<string, unknown> {
  requireCondition(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "expected object",
  );
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown): asserts value is string {
  requireCondition(typeof value === "string" && value.length > 0, "expected nonempty string");
}

/** Validate installed pnpm list output, independently of the vulnerability feed. */
export function verifyBracesInventory(input: unknown): void {
  requireCondition(Array.isArray(input) && input.length > 0, "missing dependency inventory");
  let found = 0;
  let visited = 0;
  function walk(value: unknown, path: string[], devRoot: boolean): void {
    requireCondition(++visited <= 10_000 && path.length <= 32, "inventory limit exceeded");
    const node = record(value);
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
      if (!(section in node)) continue;
      for (const [name, childValue] of Object.entries(record(node[section]))) {
        const child = record(childValue);
        const childPath = [...path, name];
        const dev = path.length === 1 ? devRoot && section === "devDependencies" : devRoot;
        if (
          name === approvedBracesException.package ||
          child.from === approvedBracesException.package
        ) {
          requireCondition(
            name === approvedBracesException.package &&
              child.from === approvedBracesException.package &&
              child.version === approvedBracesException.version &&
              childPath.join(">") === approvedBracesException.path &&
              dev,
            "braces inventory version/path/exposure changed; re-review or remove exception",
          );
          found += 1;
        }
        walk(child, childPath, dev);
      }
    }
  }
  for (const projectValue of input) {
    const project = record(projectValue);
    nonemptyString(project.name);
    const isRoot = project.name === "chaincopy-observer";
    walk(project, [isRoot ? "." : project.name], isRoot);
  }
  requireCondition(found > 0, "braces absent: stale exception must be removed");
}

/** Pinned pnpm 11 audit JSON: missing/malformed/contradictory evidence fails closed. */
export function evaluateSecurityAudit(
  audit: unknown,
  auditExitCode: number | null,
  inventory: unknown,
) {
  verifyBracesInventory(inventory);
  requireCondition(auditExitCode === 0 || auditExitCode === 1, "audit execution failed");
  const report = record(audit);
  requireCondition(!("error" in report), "audit returned an error");
  const counts = record(record(report.metadata).vulnerabilities);
  for (const severity of ["info", "low", "moderate", "high", "critical"] as const) {
    const count = counts[severity];
    requireCondition(
      typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
      "invalid severity counts",
    );
  }
  requireCondition(counts.critical === 0, "critical finding reported");
  let high = 0;
  for (const value of Object.values(record(report.advisories))) {
    const advisory = record(value);
    requireCondition(
      typeof advisory.severity === "string" &&
        ["info", "low", "moderate", "high", "critical"].includes(advisory.severity),
      "unknown advisory severity",
    );
    requireCondition(advisory.severity !== "critical", "critical advisory reported");
    if (advisory.severity !== "high") continue;
    high += 1;
    requireCondition(
      advisory.github_advisory_id === approvedBracesException.advisory &&
        advisory.module_name === approvedBracesException.package &&
        advisory.url === `https://github.com/advisories/${approvedBracesException.advisory}`,
      "unapproved high advisory identity/package",
    );
    requireCondition(
      Array.isArray(advisory.findings) && advisory.findings.length > 0,
      "missing high finding details",
    );
    for (const value of advisory.findings) {
      const finding = record(value);
      requireCondition(
        finding.version === approvedBracesException.version &&
          finding.dev === true &&
          finding.optional === false &&
          finding.bundled === false,
        "unapproved high version/exposure",
      );
      requireCondition(
        Array.isArray(finding.paths) &&
          finding.paths.length > 0 &&
          finding.paths.every((path: unknown) => path === approvedBracesException.path),
        "unapproved high dependency path",
      );
    }
  }
  requireCondition(
    high <= 1 && counts.high === high,
    "high summary/details mismatch or duplicate advisory",
  );
  requireCondition(
    auditExitCode === (high === 0 ? 0 : 1),
    "audit exit status contradicts findings",
  );
  return {
    status: "PASS" as const,
    critical: 0,
    high,
    exceptionUsed: high === 1,
    exception: high === 1 ? approvedBracesException : null,
  };
}
