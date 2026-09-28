# Phase 5.2 — verification and migration approval handoff

Date: 2026-09-28. Branch: `codex/phase5-2-wallet-weight`.
Base main: `db8ac2cc5160948db8b9c4a970c6d1656cb6bb3b` (PR #36).
Formal design: `phase5-2-wallet-weight-spec.md`, ADR-043.

## Read-only live result

At `2026-09-28T14:23:02.846Z`, the normal weight service preview was executed
twice in READ ONLY / REPEATABLE READ transactions. No migration, weight write,
worker/consumer, sync, Performance calculation, Selection evaluation, Behavior
processing or Redis write was performed. Source-wide audit data and exact selected
preview are committed in `phase5-2-metric-audit.json` and
`phase5-2-readonly-preview.json` respectively.

- Effective-selected wallet: `0x34112cf6672cbad0f44b5a77857099417dc686af`.
- Selection: `cmujbqjbu2af4nq01zg56l0vc`.
- Performance: `cmujbpj6527jdnq01t6zuxi9u`, trust revision 0;
  source fingerprint `7d9b36200dfdccdf522f58ca193bf33f9ffe143271111c2472b6797b3f5c5e5c`.
- rawWeight: `0.339174742605900594492010777724425848`.
- normalizedWeight: `1` (positive one-member cohort, no address special case).
- Weight input fingerprint / proposed snapshot ID:
  `df5787c523f18a541b8fe127bbfa651ce13b1beaf2601ac9638218bfc602c9cd`.
- Cohort fingerprint: `fe0406a83061090efe9fb2dc83008e8b1cf62f567a186cb15cb4a21a54190a8a`.
- Both previews identical, including components, membership and provenance.
- Live `wallet_weight_snapshots` and `wallet_weight_entries`: **absent** before/after.
  This is preview determinism, not a claim that live persistence was tested.

Protected selected-wallet Behavior rows and all current aggregation rows were
read in ID order, Prisma-serialized as JSON and SHA256 hashed before/after:

| Protected state       | Before / after | SHA256 (identical)                                                 |
| --------------------- | -------------- | ------------------------------------------------------------------ |
| Behavior rows         | 2,012 / 2,012  | `0a4a244e034cf7488df5a2218e723bbf6341d03907eabf3422dddf46d8893fbc` |
| Aggregation buckets   | 1,332 / 1,332  | `073c8e4a3da416f62b9c81e3f27c549dc0a6b0441728fa4226c3673aca805225` |
| Aggregation revisions | 1,332 / 1,332  | `19399c489b50a45212ac9edecef451641d2b5610a3b386550e536aa5f97c4129` |
| OPEN Behavior DQ      | 0 / 0          | count                                                              |

Hashes are specific to this Prisma JSON projection (not interchangeable with a
prior SQL row-serialization hash). Full Selection results/settings and the selected
wallet row also compared exactly unchanged. No source activity or latestActivity
was reinterpreted.

### Queues before = after

| Queue                            | Prioritized | Active | Completed | Failed |
| -------------------------------- | ----------- | ------ | --------- | ------ |
| hyperliquid-sync                 | 0           | 0      | 318       | 444    |
| address-performance              | 1           | 0      | 66        | 14     |
| behavior-normalization           | 0           | 0      | 24        | 0      |
| hyperliquid-discovery            | 1           | 0      | 17        | 609    |
| hyperliquid-candidate-enrichment | 8,427       | 1      | 20        | 5      |

wait/paused/delayed/waiting-children = 0 throughout. Existing enrichment active ID
`enrich-cms9j6kxp1mskn90i477x9hxy-1627804426372-1785570826372` has no lock,
unchanged. It was not consumed, repaired or deleted. No runtime Worker started.

## Isolated validation

Test endpoints are explicit reserved PostgreSQL `127.0.0.1:55433/chaincopy` and
Redis `127.0.0.1:56380/0`, E2E schema `chaincopy_e2e` / Redis DB15. Normal runtime
URLs are never inherited. The weight integration suite additionally creates one
UUID-named schema **inside the already-validated isolated DB** to avoid racing
other suites' current Selection settings, applies all migrations there, and removes
only that test schema after verification.

Windows-local port access was unavailable. WSL stops the isolated services when
its session exits; an initial isolated migration attempt failed P1001 before any
SQL applied. Running isolated container start + Docker validation within one WSL
session fixed this environment issue. No runtime URL fallback was used.

Validation image: `chaincopy-weight-validation:phase52` from the feature workspace,
not a deployed Worker image. Tests also exercise:

- concurrent duplicate persistence, exact normalization and immutable historical rows;
- EXCLUDE, REVIEW + manual INCLUDE, QUALIFIED, missing metric, inconsistent window,
  wrong-wallet metric provenance, new trusted Performance and quarantine;
- corrupt immutable receipt detection, no silent current fallback;
- additive migration, unique entry, bounds CHECK and all 4 Restrict FKs.

Repository validation commands:

```sh
pnpm db:migrate:deploy  # explicitly isolated DB only
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm audit --audit-level high
git diff --check
```

Results: format/lint PASS; typecheck 11/11; unit/integration 78 files / 756 tests
PASS; build 11/11; isolated E2E 22/22; audit high/critical 0 (4 existing unrelated
moderate findings, dependencies unchanged); diff check PASS. Real migration and
live persistence remain unexecuted regardless of these passing tests.

## Exact real migration approval request (NOT executed)

Review the complete SQL file, not an inferred schema diff:
`prisma/migrations/20260928000000_wallet_weight/migration.sql`.
SHA256: `566d4ac9e246a6a072c56fbe308aabb5dc77940ed19bacbc1d562a6362ec9c67`.

Only two new tables (`wallet_weight_snapshots`, `wallet_weight_entries`), five
secondary indexes, two PK indexes, four Restrict FK constraints and one bounds
CHECK. No existing table/column/index alteration, backfill or existing-row mutation.
Parent references are wallet_addresses, wallet_selection_runs and
metric_calculation_runs; deletions of referenced provenance become restricted.
This is intentionally durable evidence, not a retention bypass.

Owner approval is needed **before real application**. The previous Phase 5.1
approval covered different tables and is not reused. PR must remain unmerged
while this approval is pending; a green CI is not migration authorization.

After explicit approval: recheck main/feature provenance, pending migration list,
DB health and disk, current Selection/Performance, protected hashes and queues.
Apply only the reviewed additive migration, inspect FK/indexes, then preview again
(never assume the saved input fingerprint is still current). Explicitly persist
that reviewed cohort via `pnpm wallet:weight --execute --expected-fingerprint ...`,
repeat to prove no new rows, inspect current API and recheck protected state.
Stop on any discrepancy; do not auto-rollback/drop/delete tables or change DQ.

Unperformed: real migration, real immutable snapshot persistence/current API read
against those tables, main merge, Phase 5.3. These are deliberate approval/phase
boundaries, not skipped test failures.
