import { describe, expect, it } from "vitest";

import { approvedBracesException, evaluateSecurityAudit } from "./security-audit-policy.js";

function inventory(version = "3.0.3", rootSection = "devDependencies") {
  return [
    {
      name: "chaincopy-observer",
      [rootSection]: {
        "@next/eslint-plugin-next": {
          dependencies: {
            "fast-glob": {
              dependencies: {
                micromatch: { dependencies: { braces: { from: "braces", version } } },
              },
            },
          },
        },
      },
    },
  ];
}

function approvedAdvisory() {
  return {
    severity: "high",
    module_name: "braces",
    github_advisory_id: approvedBracesException.advisory,
    url: `https://github.com/advisories/${approvedBracesException.advisory}`,
    findings: [
      {
        version: "3.0.3",
        dev: true,
        optional: false,
        bundled: false,
        paths: [approvedBracesException.path as string],
      },
    ],
  };
}

function report(
  advisories: Record<string, unknown> = { "1240992": approvedAdvisory() },
  high = 1,
  critical = 0,
) {
  return {
    advisories,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 7, high, critical } },
  };
}

describe("temporary exact braces security audit gate", () => {
  it("passes only the approved high and keeps it visible in the receipt", () => {
    expect(evaluateSecurityAudit(report(), 1, inventory())).toMatchObject({
      status: "PASS",
      high: 1,
      critical: 0,
      exceptionUsed: true,
      exception: approvedBracesException,
    });
  });
  it("passes no high findings without claiming the exception was used", () => {
    expect(evaluateSecurityAudit(report({}, 0), 0, inventory())).toMatchObject({
      status: "PASS",
      exceptionUsed: false,
      exception: null,
    });
  });
  it("rejects an additional high even when approved braces also exists", () => {
    const additional = { ...approvedAdvisory(), module_name: "other" };
    expect(() =>
      evaluateSecurityAudit(
        report({ approved: approvedAdvisory(), additional }, 2),
        1,
        inventory(),
      ),
    ).toThrow();
  });
  it.each(["3.0.2", "3.0.4", "*"])("rejects finding version %s", (version) => {
    const advisory = approvedAdvisory();
    advisory.findings[0]!.version = version;
    expect(() => evaluateSecurityAudit(report({ advisory }), 1, inventory())).toThrow();
  });
  it.each(["github_advisory_id", "module_name", "url"] as const)("rejects wrong %s", (key) => {
    const advisory = { ...approvedAdvisory(), [key]: "unexpected" };
    expect(() => evaluateSecurityAudit(report({ advisory }), 1, inventory())).toThrow();
  });
  it("rejects a critical summary even if details omit it", () => {
    expect(() => evaluateSecurityAudit(report(undefined, 1, 1), 1, inventory())).toThrow();
  });
  it("rejects critical details even if the summary claims zero", () => {
    expect(() =>
      evaluateSecurityAudit(report({ critical: { severity: "critical" } }, 0), 1, inventory()),
    ).toThrow();
  });
  it("rejects missing high details and summary inconsistencies", () => {
    expect(() => evaluateSecurityAudit(report({}, 1), 1, inventory())).toThrow();
    expect(() => evaluateSecurityAudit(report(undefined, 2), 1, inventory())).toThrow();
    expect(() =>
      evaluateSecurityAudit(
        report({ a: approvedAdvisory(), b: approvedAdvisory() }, 2),
        1,
        inventory(),
      ),
    ).toThrow();
  });
  it("rejects empty findings and empty or additional paths", () => {
    for (const findings of [
      [],
      [{ ...approvedAdvisory().findings[0]!, paths: [] }],
      [
        {
          ...approvedAdvisory().findings[0]!,
          paths: [approvedBracesException.path, "apps__api>braces"],
        },
      ],
    ]) {
      expect(() =>
        evaluateSecurityAudit(
          report({ advisory: { ...approvedAdvisory(), findings } }),
          1,
          inventory(),
        ),
      ).toThrow();
    }
  });
  it.each(["dev", "optional", "bundled"] as const)(
    "rejects changed finding exposure %s",
    (field) => {
      const advisory = approvedAdvisory();
      advisory.findings[0]![field] = field !== "dev";
      expect(() => evaluateSecurityAudit(report({ advisory }), 1, inventory())).toThrow();
    },
  );
  it("checks every finding, not just the first", () => {
    const advisory = approvedAdvisory();
    advisory.findings.push({ ...advisory.findings[0]!, version: "3.0.4" });
    expect(() => evaluateSecurityAudit(report({ advisory }), 1, inventory())).toThrow();
  });
  it("rejects changed inventory versions even when audit reports no highs", () => {
    expect(() => evaluateSecurityAudit(report({}, 0), 0, inventory("3.0.4"))).toThrow();
  });
  it("rejects stale exception when braces disappears", () => {
    expect(() => evaluateSecurityAudit(report({}, 0), 0, [{ name: "chaincopy-observer" }])).toThrow(
      /stale exception/,
    );
  });
  it("rejects production dependency exposure in the inventory", () => {
    expect(() => evaluateSecurityAudit(report(), 1, inventory("3.0.3", "dependencies"))).toThrow();
  });
  it("rejects additional workspace paths in inventory", () => {
    expect(() =>
      evaluateSecurityAudit(report(), 1, [
        ...inventory(),
        { name: "@chaincopy/api", dependencies: { braces: { from: "braces", version: "3.0.3" } } },
      ]),
    ).toThrow();
  });
  it.each([null, {}, { error: "registry unavailable" }, { advisories: {}, metadata: {} }])(
    "rejects malformed audit %j",
    (audit) => {
      expect(() => evaluateSecurityAudit(audit, 1, inventory())).toThrow();
    },
  );
  it("rejects unknown severity and invalid counts", () => {
    expect(() =>
      evaluateSecurityAudit(report({ unknown: { severity: "HIGH" } }), 1, inventory()),
    ).toThrow();
    expect(() => evaluateSecurityAudit(report(undefined, -1), 1, inventory())).toThrow();
    expect(() => evaluateSecurityAudit(report(undefined, 0.5), 1, inventory())).toThrow();
  });
  it.each([{ severity: ["high"] }, { severity: null }, { severity: 1 }, { severity: {} }])(
    "rejects non-string severity $severity",
    ({ severity }) => {
      expect(() =>
        evaluateSecurityAudit(report({ malformed: { severity } }, 0), 0, inventory()),
      ).toThrow();
    },
  );
  it.each([
    { value: null },
    { value: [] },
    { value: {} },
    { value: [{ name: "chaincopy-observer", devDependencies: null }] },
  ])("rejects malformed inventory $value", ({ value }) => {
    expect(() => evaluateSecurityAudit(report(), 1, value)).toThrow();
  });
  it.each([null, 2, 127, 0])("rejects failed/contradictory audit exit %s", (exit) => {
    expect(() => evaluateSecurityAudit(report(), exit, inventory())).toThrow();
  });
  it("rejects nonzero audit exit with no high/critical findings", () => {
    expect(() => evaluateSecurityAudit(report({}, 0), 1, inventory())).toThrow();
  });
});
