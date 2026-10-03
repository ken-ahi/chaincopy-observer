# Temporary exact security exception: braces 3.0.3

Owner approval: **2026-10-03 (Asia/Tokyo)**, PR #37 follow-up. This is temporary
technical debt, not a permanent waiver or a claim that the vulnerability is fixed.

## Identity and exposure

- Package/version: **`braces@3.0.3`**, not `brace-expansion`.
- Advisory: **[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)**,
  High, stack-exhaustion denial of service from deeply nested patterns.
- Only approved path: root dev dependency
  `@next/eslint-plugin-next → fast-glob → micromatch → braces`.
- No patched npm release was available at approval. The audit feed advertised
  `>=3.0.4`, but registry lookup returned `ERR_PNPM_PACKAGE_NOT_FOUND`, and the
  official advisory listed no patched version. Do not install an invented version.
- This transitive lint/glob dependency is not an application request processor.
  No direct user-controlled request input is intentionally passed to it. This
  reduces runtime exposure, but does not eliminate tooling/CI denial-of-service
  risk from malicious repository-controlled patterns/paths. Untrusted change
  review remains necessary.
- The other current critical/high findings were fixed by the preceding approved
  Next/Fastify/brace-expansion update; this exception does not cover them.

## Enforcement

`pnpm security:audit` runs `scripts/security-audit-gate.ts`, which invokes the
unmodified **`pnpm audit --audit-level high --json`** and prints its original JSON
and stderr. No pnpm ignores, `--prod`, severity reduction, `audit --fix`, `|| true`
or configurable bypass is introduced. Only pinned pnpm 11.9.0 is accepted.

The gate checks both summary counts and advisory details. All Critical findings
fail. Every High must match the exact GHSA, package, version, canonical advisory
URL, dev-only finding flags and approved path. Changed identity, additional High,
unknown severity, missing findings/paths, invalid JSON/counts, summary/exit-status
contradiction, process/network error or timeout fails closed. There is no extensible
ignore list: expansion requires code review and new Owner authorization.

Independent `pnpm -r list braces --depth Infinity --json` checks the resolved
installation. Unexpected versions, aliases, production/other workspace paths and
absent braces fail even if audit has no High. This catches stale exceptions after
upgrades/removals. Zero High/Critical passes only while the inventory contract
still holds, reporting `exceptionUsed: false` with a removal-review message.
The approved High reports `exceptionUsed: true`, retains High count 1 and prints
a temporary-debt reminder. Never describe that result as zero plain-audit High.

CI invokes this gate as its required audit step. Existing lint, tests, build and
E2E gates are unchanged. The new scripts/tests also receive strict TypeScript
checking through `pnpm typecheck`.

## Removal condition

**Remove immediately when a patched, publicly available dependency path exists.**
The Owner/maintainer must review this during dependency updates and when an
upstream fix is announced. A passing gate is not proof that no fix exists; it
does not use mutable latest-version lookup to authorize dependency changes.

Verify the published fix and resolved path, make the minimal dependency update,
remove this exact exception/gate and its dedicated tests/typecheck wiring, restore
direct `pnpm audit --audit-level high` in CI, and run full isolated validation.
Mark this document/ADR removed while retaining the historical approval evidence.
No automatic renewal or acceptance of another version/advisory is permitted.
The inventory check forces review when braces changes/disappears. No runtime
DB/Redis operation is required for removal.

## Validation

Policy tests cover approved/no High, additional High, Critical in summary or
details, wrong package/version/GHSA/URL/path/exposure, missing details, duplicate
advisory, malformed report, summary/exit mismatch, and stale/changed inventory.
Live audit is evaluated as-is; plain audit still reports the advisory.
Full isolated results and final-head CI are recorded in `phase5-2-verification.md`
and PR #37. Real migration and weight persistence are never repeated by this gate.
