# Phase 5.2 — verification and migration approval handoff

Initial verification: 2026-09-28; live approval/execution: 2026-10-02.
Branch: `codex/phase5-2-wallet-weight`.
Base main: `db8ac2cc5160948db8b9c4a970c6d1656cb6bb3b` (PR #36).
Formal design: `phase5-2-wallet-weight-spec.md`, ADR-043.

## Dependency-security follow-up (2026-10-03)

The authorized live migration and weight persistence below are complete and must
not be repeated. [CI #93](https://github.com/ken-ahi/chaincopy-observer/actions/runs/37014531808)
on `d6088c2ef30c5f598b684b94f1b53078594ca82e` passed lint, typecheck,
unit/integration, build and E2E, but failed `pnpm audit --audit-level high`
(1 critical / 6 high / 9 moderate). Owner authorized only the following minimal
dependency repair, its necessary lockfile changes and isolated validation:

| Dependency                           | Before   | After    | Reason                                                                                          |
| ------------------------------------ | -------- | -------- | ----------------------------------------------------------------------------------------------- |
| `next`                               | `16.3.5` | `16.3.6` | Critical `GHSA-vcvr-r3jv-pc5j`                                                                  |
| `@next/eslint-plugin-next`           | `16.3.5` | `16.3.6` | Match the approved Next patch line                                                              |
| `fastify`                            | `5.10.0` | `5.12.2` | High `GHSA-667r-xxjv-c9mm`, `GHSA-p68q-wchp-6fh7`, `GHSA-hwr6-493r-vm6h`, `GHSA-9q9j-q6p8-xq58` |
| Workspace `brace-expansion` override | `5.0.9`  | `5.0.11` | High `GHSA-qhr7-859c-m2p7`, `GHSA-6j4f-fj2g-mc7p`                                               |

Before editing, `pnpm -r why next`, `pnpm -r why fastify` and
`pnpm -r why brace-expansion` recorded one version each. Next is required by
`@chaincopy/web` and the unchanged `next-auth` peer graph; Fastify is a direct
`@chaincopy/api` dependency; brace-expansion is reached through minimatch in the
ESLint/config-array/typescript-eslint graph. Raw output is retained locally in
gitignored `weight-security-why-before.log`.

Lockfile refresh used pnpm 11.9.0:
`CI=true pnpm install --lockfile-only --frozen-lockfile=false --ignore-scripts`.
Only the named versions, matching `@next/env`/platform SWC packages, affected
Next peer references, and Fastify's required `process-warning@5.1.0` were changed.
`pnpm view fastify@5.12.2 dependencies.process-warning` confirms `^5.1.0`;
other consumers retain `5.0.0`. No unrelated package was upgraded.
`minimumReleaseAgeExclude` was not changed: the existing policy accepted these
versions, including the clean image's frozen install. No advisory suppression,
threshold change, audit fix/force, or application compatibility edit was made.

### Additional external audit blocker

After this repair, the audit reports critical 0 / high 1 / moderate 7. The remaining
high is **`braces@3.0.3`**, not `brace-expansion`, through
`@next/eslint-plugin-next → fast-glob → micromatch → braces`:
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The audit feed advertises a patched range `>=3.0.4`, but an explicit
`pnpm view braces@3.0.4 version dist.integrity repository --json` returns
`ERR_PNPM_PACKAGE_NOT_FOUND`; the official advisory currently says patched
versions **None**. This metadata discrepancy is not treated as a verified fix.
An initially suggested 3.0.4 update was withdrawn after these read-only checks.
No braces override, unpublished version, fork or ignore was added. Merge remains
blocked until a published, proven fix and the necessary scope approval exist.

### Isolated compatibility validation

Validation image `chaincopy-weight-security:20261003` was built with the existing
`Dockerfile.e2e`, Node 24.12.0 / pnpm 11.9.0, from this dependency-only workspace.
The image excludes runtime `.env` files. Explicit TEST/E2E target validation
accepted only PostgreSQL `127.0.0.1:55433/chaincopy` and Redis
`127.0.0.1:56380/0`; E2E uses `chaincopy_e2e` / DB15. Only the previously identified
`behavior-test-postgres` and `behavior-test-redis` containers were started and
stopped. No command connected to the real PostgreSQL/Redis. Test schema/fixture
creation and cleanup remained inside those isolated services; the successful real
migration and weight persistence were not repeated.

| Command / check                                | Result                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`               | PASS in clean build and validation container                                              |
| `pnpm -r why next / fastify / brace-expansion` | Exactly `16.3.6` / `5.12.2` / `5.0.11` respectively                                       |
| `pnpm format:check`                            | PASS                                                                                      |
| `pnpm lint`                                    | PASS                                                                                      |
| `pnpm typecheck`                               | PASS, 11/11                                                                               |
| `pnpm test`                                    | PASS, 78 files / 756 tests; API `app.test.ts` 44/44 including auth/routing                |
| `pnpm build`                                   | PASS, 11/11; clean image build also 11/11 with no cache                                   |
| `pnpm test:e2e`                                | PASS, 22/22                                                                               |
| Standalone production server                   | Next 16.3.6 starts; `/login` 200, `X-Frame-Options: DENY`                                 |
| `pnpm audit --audit-level high`                | FAIL only on the additional braces high described above; critical 0 / high 1 / moderate 7 |
| `git diff --check`                             | PASS                                                                                      |

The existing E2E runner uses `next start` against `output: standalone`, which emits
the existing Next warning. This was not hidden or changed: all 22 E2E tests passed,
and a separate smoke test started the actual generated
`apps/web/.next/standalone/apps/web/server.js` after copying its static/public assets
as in the production Dockerfile. That server also passed and exited gracefully.
The initial temporary runner used a nonexistent `db:migrate:status` script name
and stopped before tests; it was corrected to `pnpm exec prisma migrate status`
against the isolated DB (already up to date), then the full run above completed.

No new migration exists; `git diff --exit-code -- prisma` passes and the approved
SQL SHA256 remains
`566d4ac9e246a6a072c56fbe308aabb5dc77940ed19bacbc1d562a6362ec9c67`.
No formula, Selection, application, schema, Behavior/aggregation or runtime data
change is included. Temporary validation/smoke helpers were removed; only the
five dependency files and two state/verification documents are committed.
Logs are local gitignored `weight-security-*.log` receipts. Final-head CI is still
required; its authoritative result is linked in PR #37. **Do not merge while the
remaining high finding exists.** The dependency-security step is BLOCKED, not a
failure or rollback of the already successful live Phase 5.2 operation.

## Evidence serialization correction (Owner authorized 2026-10-02)

The 2026-10-01 preflight stopped before any live mutation: the committed preview
had `metricFrom` serialized as `.45Z` rather than canonical `.450Z`. The prior
PowerShell JSON parse/serialize round trip interpreted the string as a timestamp
and trimmed the trailing zero. The instant and financial inputs did not change,
but this changed the canonical JSON bytes used by the fingerprint contract.
Only the two `metricFrom` strings (inputSnapshot and explanatory entry) are restored.
SHA256(JSON.stringify(inputSnapshot)) now exactly matches the declared fingerprint
`df5787c523f18a541b8fe127bbfa651ce13b1beaf2601ac9638218bfc602c9cd`
(before correction: `4e43117b7046f108a9afd0f22a05aedfc9b768313bb41d9b61f0d13892b0ff9a`).
New evidence must preserve JSON strings with Node JSON parsing/serialization;
do not round-trip fingerprinted evidence through automatic date conversion.
Formula, Selection, schema and migration SQL are unchanged. Owner explicitly
retained the migration approval and required restarting all live preflight checks;
no prior preview is used as the authority for new persistence.

## Approved live execution (2026-10-02, complete)

Owner explicitly approved only the SQL and checksum below, then authorized the
serialization-only correction and a completely fresh preflight. Execution used
HEAD/origin `12253b2c8350d44b10947ded1ee64a22ca3ca9d8`, main/base
`db8ac2cc5160948db8b9c4a970c6d1656cb6bb3b`, and image `chaincopy-weight:12253b2`
with immutable image ID
`sha256:b1abab1d53ce6793d85974d9596b755f9a6e6cb027902530f13d1eb522312f7d`.
The OCI revision matched HEAD. Host/image hashes matched for the migration,
weight service, CLI and analytics implementation. Before mutation the tracked
diff contained only this document and the two preview timestamp corrections;
no formula, application code, schema or SQL changed.

Fresh preflight at `2026-10-02T13:29:16.957Z` passed: PostgreSQL ready, Redis PONG,
Worker stopped, exactly one pending migration (the approved weight migration),
11 completed prior migrations, no failed/rolled-back entry, both new tables absent.
The current Selection/Performance cohort and canonical preview matched the
one-member evidence below. All protected hashes and queue counts were recaptured,
not reused from the earlier preview. Docker filesystem free space was
729,726,689,280 bytes; host C: free space was 335,175,331,840 bytes.

Commands ran in the pinned image with its Worker entrypoint overridden, explicit
real-local connection targets, and no scheduler/consumer:

```sh
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:migrate:status
pnpm wallet:weight
pnpm wallet:weight --execute --expected-fingerprint df5787c523f18a541b8fe127bbfa651ce13b1beaf2601ac9638218bfc602c9cd
pnpm wallet:weight --execute --expected-fingerprint df5787c523f18a541b8fe127bbfa651ce13b1beaf2601ac9638218bfc602c9cd
```

Only `20260928000000_wallet_weight` applied; its ledger checksum is exactly
`566d4ac9e246a6a072c56fbe308aabb5dc77940ed19bacbc1d562a6362ec9c67`,
finished `2026-10-02T13:30:06.498Z`, applied steps 1. Status is now up to date
(12 applied, 0 pending); all 11 previous ledger rows are unchanged.
No automatic rollback/drop/delete was performed.

### Catalog and immutable receipt

PostgreSQL catalogs verified both tables, all 14 non-null columns,
raw `numeric(38,36)`, normalized `numeric(38,18)`, and timestamp precision 3.
All seven indexes are valid/ready:

- `wallet_weight_snapshots_pkey`, `wallet_weight_snapshot_input_key` (unique),
  `wallet_weight_snapshot_scope_idx`;
- `wallet_weight_entries_pkey`, `wallet_weight_entry_address_key` (unique),
  `wallet_weight_entry_performance_idx`, `wallet_weight_entry_wallet_idx`.

All four validated FKs have ON DELETE RESTRICT / ON UPDATE CASCADE:
snapshot → Selection Run; entry → snapshot, WalletAddress and Performance Run.
Validated `wallet_weight_entry_bounds` enforces both weights between 0 and 1.
Catalog checks ran before persistence (0 rows) and after both calls.

The **post-migration fresh formal preview**, not the saved evidence, supplied
the execute fingerprint. Live inputs had not changed, so it independently
produced `df5787c523f18a541b8fe127bbfa651ce13b1beaf2601ac9638218bfc602c9cd`.
Persistence created exactly 1 snapshot / 1 entry, `calculatedAt`
`2026-10-02T13:31:01.653Z`. Raw weight is
`0.339174742605900594492010777724425848`; normalized weight is `1`.
PostgreSQL numeric SUM is exactly `1.000000000000000000`.
The repeat command returned the identical receipt and timestamp; full stored
snapshot/entry rows compared exactly equal, with 0 additional rows.

At `13:33:32.038Z`, the actual `createApi` route and real
`PrismaWalletWeightService` were verified via Fastify HTTP injection against the
live DB: unauthenticated 401, authenticated 200, `Cache-Control: no-store`,
`CURRENT`, and the full body identical to the saved receipt. No listening API,
Redis client or Worker was started for this harness. An initial temporary-harness
import resolution error occurred before connection; correcting only that local
import allowed the read-only check to complete. Production code was unchanged.

### Final conservation and shutdown

The final read-only audit at `2026-10-02T13:36:06.324Z` passed. Behavior 2,012,
aggregation buckets 1,332, revisions 1,332 and their full-row SHA256 values in the
historical table below remain identical. OPEN Behavior DQ remains 0.
Full projections/hashes also matched for current Selection settings/run/results,
manual override, selected Performance and metrics/cycles/trust evidence,
all 50 wallet rows, 403 cursors, 727 source DQ records, 3 Behavior DQ records,
10 data sources, 14 quarantined Runs and 14 trust transitions.
All five queue counts, active IDs and lock presence matched the baseline below;
the 8,427 enrichment backlog and old unlocked active job were untouched.

DB size: 58,430,248,627 → 58,430,404,275 bytes. Docker free space after execution:
729,725,726,720 bytes. PostgreSQL/Redis remained healthy; temporary containers and
API/DB connections exited, ordinary Worker remained stopped. No resync,
Performance/Selection recomputation, DQ/cursor mutation, Behavior/aggregation
processing, queue write, paid source or Phase 5.3 work was performed.

Local raw receipts are gitignored `weight-live-*.log` files (preflight, migration,
catalog, fresh preview, first/repeat persistence, postchecks and API). Temporary
read-only harness files were removed after verification. This follow-up changes
only preview evidence and verification/state documentation. Local format/lint,
fingerprint reproduction and diff checks are rerun; code/integration/E2E remain
covered by isolated validation below and the required final-head GitHub CI, never
by tests against the live DB. Owner authorizes PR #37 merge only after that final
head is green and mergeable. Phase 5.3 remains out of scope.

Documentation validation environment note: Windows `pnpm format:check` / `lint`
initially stopped on `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` during pnpm's
dependency check. No configuration/dependency change was made. The equivalent
`node node_modules/prettier/bin/prettier.cjs --check .` passed on the actual
worktree; `pnpm lint` passed in the pinned image. An image-wide format attempt
also encountered an old untracked audit helper embedded in that image, not a
tracked source file; the final format result is from the actual worktree.

## Historical read-only live result (2026-09-28)

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

## Isolated implementation validation (2026-09-28)

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
moderate findings, dependencies unchanged); diff check PASS. At that time real
migration and live persistence were unexecuted; the approved October 2 result above
supersedes that operational status.

## Historical migration approval handoff (fulfilled 2026-10-02)

Review the complete SQL file, not an inferred schema diff:
`prisma/migrations/20260928000000_wallet_weight/migration.sql`.
SHA256: `566d4ac9e246a6a072c56fbe308aabb5dc77940ed19bacbc1d562a6362ec9c67`.

Only two new tables (`wallet_weight_snapshots`, `wallet_weight_entries`), five
secondary indexes, two PK indexes, four Restrict FK constraints and one bounds
CHECK. No existing table/column/index alteration, backfill or existing-row mutation.
Parent references are wallet_addresses, wallet_selection_runs and
metric_calculation_runs; deletions of referenced provenance become restricted.
This is intentionally durable evidence, not a retention bypass.

Owner approval was required **before real application** and was explicitly granted
for this checksum. The previous Phase 5.1 approval covered different tables and
was not reused. A green CI alone is not migration authorization.

After explicit approval: recheck main/feature provenance, pending migration list,
DB health and disk, current Selection/Performance, protected hashes and queues.
Apply only the reviewed additive migration, inspect FK/indexes, then preview again
(never assume the saved input fingerprint is still current). Explicitly persist
that reviewed cohort via `pnpm wallet:weight --execute --expected-fingerprint ...`,
repeat to prove no new rows, inspect current API and recheck protected state.
Stop on any discrepancy; do not auto-rollback/drop/delete tables or change DQ.

The migration, immutable persistence and current API checks in this handoff are
now complete. Final-head CI/merge is the remaining PR gate; Phase 5.3 is deliberately
unperformed, not a skipped test failure.
