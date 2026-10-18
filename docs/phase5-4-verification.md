# Phase 5.4 verification — 2026-10-18

Current status: **live persistence, idempotency and saved API verification PASS**.
Owner explicitly approved the disposable evidence-serialization correction and
resumption after the first attempt's guard stop. The approved migration was NOT
rerun. Final documentation-head CI and conditional merge are tracked in PR #39.
Earlier stopped-attempt and October 10 records below are retained as history.

## 2026-10-18 corrected-harness resumption — PASS

Preflight PR/local head `3808b9322ff0907e22b926740629e38cb8d88ea0` matched; worktree
was clean. Execution image
`sha256:a2accc83e3273c8194d0d59dc3398eb669984c7d35f1ee5bf7ced4937fd9a843`
is labeled with that head. Only committed documentation differs from the prior
validated image; no tracked executable, test, dependency, schema, SQL or formula
changed in this resumption.

### Serialization correction and fresh read-only gates

The disposable harness now binds a single LF byte (`String.fromCharCode(10)`) as
a Prisma SQL parameter for the `string_agg` row separator. This removes the extra
JavaScript/SQL escape layer, rather than changing the hash algorithm, table/row
allowlist, ordering, identity/fingerprint or assertions. The original formal
preview SQL is retained unchanged as an independent comparison query.

At `2026-10-18T09:05:43.192Z`, corrected-harness hashes equaled the independently
executed formal SQL for **all 17 protected tables**. All also matched the known-safe
baseline. Explicit current checks: 14 applied / zero pending, target checksum
unchanged, DirectionChange0, Signal1,332, same Selection/cohort/weight, OPEN Behavior
DQ0, healthy PostgreSQL/Redis, unchanged queues, ordinary Worker stopped. Only
`prisma migrate status` was used: no migrate deploy/dev/resolve or DDL was rerun.

Fresh formal READ ONLY preview completed `2026-10-18T09:08:54.508Z`, again checking
all 1,332 persisted Signal receipts against current provenance. Its 269 comparable
results and expected fingerprints—not the historical receipt—were supplied to
the existing `PrismaDirectionChangeService.persist` path. The preview's protected
hashes matched both the corrected harness and formal-query preflight results.
Canonical fresh results SHA256:
`66e154a2af1e83e4177d51a0b7d6e84a9705dcfcc1e158c02c8050738404914d`.

### Formal persistence, idempotency and saved API

Completed `2026-10-18T09:12:14.711Z`. Concurrency1; every pair uses the existing
Serializable transaction and fresh expected-fingerprint gate. Only the new
DirectionChange table receives inserts. No ad hoc SQL INSERT/UPDATE or contract
change is involved.

| Pass              | Saved total | Additional rows | Verification                                                              |
| ----------------- | ----------: | --------------: | ------------------------------------------------------------------------- |
| First             |         269 |             269 | Every ID and complete result equals fresh preview                         |
| Same-input repeat |         269 |               0 | Full returned rows, including calculatedAt, deep-equal first pass         |
| Saved API read    |         269 |               0 | All 269 authenticated GET responses CURRENT and equal saved/fresh results |

Both persistence passes and the post-API read have the identical full-row JSON
SHA256 (sorted by ID, including immutable metadata and calculatedAt):
`5ceddcb417b36d921bcdccc1fa5d99903d356271aa4eff67204db056f04b75e4`.
Each API response is `Cache-Control: no-store`; unauthenticated read returns401.
The actual API route was exercised via Fastify injection with the real formal
service/database. Unrelated services throw if called; no HTTP listener, BullMQ
Queue instance, scheduler or ordinary API/Worker process was started.

| Saved event type  | Count |
| ----------------- | ----: |
| BULLISH_REVERSAL  |    82 |
| BEARISH_REVERSAL  |   100 |
| BUY_WEAKENING     |    11 |
| SELL_WEAKENING    |    11 |
| BUY_ACCELERATING  |     0 |
| SELL_ACCELERATING |     0 |
| NONE              |    65 |
| Total             |   269 |

Saved counts by coin: ASTER6 / BTC92 / ETH45 / SOL108 / XPL16 / xyz:CL2.
HYPE has no comparable pair and no row. All 1,056 gap boundaries and seven initial
observations were excluded, not filled with zero or NONE. Source IDs, input
fingerprints and immutable rows match the fresh formal calculation; invalid
`id <> input_fingerprint` count0.

### Protection, process state and validation

Corrected and formal protected-state SQL agree before writes and after the entire
verification. Corrected hashes/queue counts also match after each persistence
pass. All 17 protected table counts/full-row hashes are unchanged, including
Signal1,332 (hash `e864bef7df600d63fb3dc04952e806cd`), Behavior2,012, aggregation
1,332 buckets + 1,332 revisions, weight1+1, Selection settings/results/overrides,
Performance/quarantine, DQ and cursors. OPEN Behavior DQ remains0. Selection/cohort/
weight IDs are unchanged from the preflight below. Queue counts are exactly the
previous baseline, including enrichment prioritized8,427/active1. No queue mutation
or backlog consumption. No upstream phase was executed or persisted.

Final read-only PostgreSQL checks confirm 269 saved rows, 14 applied migrations,
the original application timestamp/checksum unchanged, and all expected counts.
DB size58,437,629,619 bytes; disk free ~665 GiB WSL /257 GiB Windows. Sampled
persistence process RAM330.4 MiB, PostgreSQL117.1 MiB, Redis44.21 MiB. All temporary
containers exited; existing isolated test services and ordinary Worker remain
stopped. PostgreSQL/Redis healthy. Disposable harness files are removed before
commit; execution logs remain local/ignored. No business logic, fingerprint,
threshold, migration SQL, DQ/cursor or security policy was modified.

Per Owner instruction and the documentation-only workflow, local full isolated
validation was not repeated because tracked code/tests are unchanged from the
already passing 870-test /24-E2E run and CI #103. This follow-up runs formatting,
`git diff --check`, the live verification above and `pnpm security:audit` (PASS:
critical0/high1 only exact approved braces3.0.3/GHSA-vfj7-8cjw-p6xm; moderate7).
Final-head GitHub CI still runs the full isolated suite before conditional merge.
The CI result and merge commit are recorded in PR #39. No Phase 6 work is included.

## 2026-10-18 first attempt / stopped handoff (history, superseded above)

PR #39 is open. Preflight head `4c807c2f48283e049b6175268f87e436fae629dc`
matched the clean local feature branch and GitHub; base is PR #38 merge. Exact
execution image `sha256:89877b2ba5de181f2dc028adbde2753660d5848d7088925f0193b9dc4147f302`
has that revision label. It extends the previously validated Phase 5.4 image with
committed documentation only; git confirms no executable/schema/dependency changes
between the earlier image's `0a5bb55` code and this head.

### Preflight PASS

- PostgreSQL17.10 / Redis healthy, ordinary Worker/API/web stopped. No consumers
  started. Disk free: WSL/PostgreSQL volume ~664.8 GiB, Windows ~264 GiB.
- DB size before: 58,436,064,947 bytes. Thirteen applied migrations, no unfinished
  migration; exactly `20261010000000_direction_change` pending. Target table absent.
- Host and image SQL SHA256 both equal the Owner-approved
  `6409a6bc6005609198fd81d46dd271358abcf679b3c06b96896936d1e88cb761`.
- Pre-migration formal READ ONLY preview completed `2026-10-18T08:34:21.497Z`:
  all 1,332 saved signal-v1 rows current-valid, 269 comparable pairs. Counts and
  coin scope match the October 10 audit. Selection `cmujbqjbu2af4nq01zg56l0vc`,
  cohort `fe0406a83061090efe9fb2dc83008e8b1cf62f567a186cb15cb4a21a54190a8a`,
  weight `df5787c523f18a541b8fe127bbfa651ce13b1beaf2601ac9638218bfc602c9cd`.
- Protected 17-table full-row hashes/counts and all queue counts match the previous
  evidence; OPEN Behavior DQ0. Existing enrichment prioritized8,427/active1 untouched.
- Security gate rerun before mutation: PASS, critical0/high1 only the exact approved
  braces3.0.3/GHSA-vfj7-8cjw-p6xm path; moderate7/low0. No policy/exception changes.

### Approved migration / catalog PASS

Executed the exact image's `pnpm db:migrate:deploy` only after confirming the sole
pending migration and SQL checksum. Prisma applied only
`20261010000000_direction_change`, finished `2026-10-18T08:35:09.807455Z`.
Subsequent `pnpm exec prisma migrate status`: up to date, 14 applied.

PostgreSQL catalogs confirm 19 columns (nets/delta numeric(38,19)), six valid/ready
indexes (PK + two unique + three secondary), two validated ON DELETE RESTRICT /
ON UPDATE CASCADE Signal FKs and four validated CHECKs. Zero rows immediately
after DDL. No existing-table SQL, backfill, automatic rollback/drop or cleanup.
DB size after DDL/final check: 58,436,155,059 bytes (+90,112 bytes).

### Fresh post-migration preview PASS; persistence NOT complete

Formal READ ONLY preview reran after catalog verification and completed
`2026-10-18T08:38:18.650Z`. It independently revalidated all 1,332 source receipts;
historical fingerprints were not reused blindly. Fresh results:

| Result            | Count |
| ----------------- | ----: |
| BUY_ACCELERATING  |     0 |
| BUY_WEAKENING     |    11 |
| SELL_ACCELERATING |     0 |
| SELL_WEAKENING    |    11 |
| BULLISH_REVERSAL  |    82 |
| BEARISH_REVERSAL  |   100 |
| NONE              |    65 |
| Comparable total  |   269 |

1,056 gaps and seven first observations remain non-comparable. Fresh canonical
results SHA256 is `66e154a2af1e83e4177d51a0b7d6e84a9705dcfcc1e158c02c8050738404914d`;
protected tables and queues match the pre-migration baseline.

A temporary execution harness was prepared to call the existing formal
`PrismaDirectionChangeService.persist` with each fresh expected fingerprint,
repeat it, compare immutable rows, and verify the authenticated read API. It did
**not reach any persist call**:

1. First launch failed during ESM import resolution: root workspace does not expose
   `@chaincopy/config`. No DB connection/write occurred. Only the temporary import
   was corrected to the existing compiled config module; no application code changed.
2. Second launch stopped at its first protected-state assertion. Its SQL delimiter
   was over-escaped: the temporary TypeScript/JavaScript source contained four
   backslashes before `n`, whereas the formal preview contains two. Thus multi-row
   `string_agg` hashes differed despite matching counts/single-row hashes.
3. In accordance with STOP-on-discrepancy, no write retry followed. A separate
   READ ONLY verifier copied the formal preview's exact static SQL/evidence function
   unchanged. At `2026-10-18T08:40:57.444Z` all 17 hashes matched the fresh baseline
   and the new table contained **0 rows**. This proves an evidence-serialization
   defect in the disposable harness, not changed protected data.

Final read-only catalog/state check: 14 applied / zero unfinished migrations,
DirectionChange0, Signal1,332, Behavior2,012, aggregation1,332 buckets/revisions,
weight1, unchanged Selection, OPEN Behavior DQ0. Queue counts unchanged. Temporary
containers exited; ordinary Worker remains stopped. No upstream jobs, real DQ /
cursor / Redis mutation, paid source, threshold change or trading occurred.

### Validation and resumption boundary

Full isolated validation reran on the approved execution image with explicit
PostgreSQL127.0.0.1:55433 / Redis127.0.0.1:56380 targets (E2E schema chaincopy_e2e,
Redis15). `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `pnpm test:e2e`, `pnpm security:audit` all PASS: 11/11 typecheck/build,
83 files / 870 tests, E2E24/24, critical0/high1 exact braces exception. Test services
stopped afterward. Final documentation format and `git diff --check` are verified
separately; final-head CI is recorded in PR #39 checks.

Real persistence, repeat/idempotency, saved-result API reconciliation and merge
are **not completed**. Stop status is BLOCKED, not recovery success. Temporary
operational harnesses are removed from the worktree; no new runtime tooling ships.
Local ignored execution logs retain the preflight/migration/catalog/preview/guard
and isolated-validation evidence.

Required Owner direction: approve correcting only the disposable evidence-hash
serialization and resuming the existing formal persistence flow after a fresh
read-only preflight/preview. **Do not apply the migration again**; verify its
existing approved checksum and zero pending migrations. Do not weaken any hash,
identity, fingerprint or protected-state condition. Do not rerun upstream phases.
Conditional merge authorization remains gated on completed live verification and
passing final-head CI; this blocked attempt does not satisfy it.

## Stage 1 READ ONLY series audit

Base main `4999b15db3fcfc761864237c77c4cd23a43d5127` (PR #38). Feature
`codex/phase5-4-direction-change`. Initial audit completed
`2026-10-10T10:20:45.036Z`. Explicit existing local PostgreSQL endpoint and
Phase 5.3 image `sha256:eaefe48d0202b4d827e282713586b47a6546cc6af6090fdc68f50a71f2e20090`;
ordinary Worker stayed stopped. SET TRANSACTION READ ONLY verified all 1,332 saved
Signal receipts against current canonical Selection/weight/aggregation/DQ, not
merely their historical stored status. Signal rows were identical before/after.

| Coin   | Count | First bucket UTC | Last bucket UTC  | Adjacent pairs | Gaps | Longest run |
| ------ | ----: | ---------------- | ---------------- | -------------: | ---: | ----------: |
| ASTER  |    14 | 2025-09-23 19:30 | 2025-09-25 22:00 |              6 |    7 |           4 |
| BTC    |   516 | 2026-02-23 21:00 | 2026-09-24 13:15 |             92 |  423 |           7 |
| ETH    |   271 | 2025-05-15 13:15 | 2025-10-02 10:30 |             45 |  225 |           6 |
| HYPE   |     1 | 2026-03-17 21:00 | 2026-03-17 21:00 |              0 |    0 |           1 |
| SOL    |   419 | 2025-09-14 20:30 | 2026-04-17 17:15 |            108 |  310 |           5 |
| XPL    |    86 | 2025-09-25 23:15 | 2025-10-09 19:45 |             16 |   69 |           3 |
| xyz:CL |    25 | 2026-03-02 11:00 | 2026-04-06 22:30 |              2 |   22 |           2 |

There are 1,325 consecutive **stored-row** pairs: 269 exact 15-minute adjacent
pairs and 1,056 gap boundaries. Seven first observations have no predecessor.
Gap count is not the number of missing 15-minute slots. No absent slot is a zero
or evidence of inactivity. Full consecutive-run ranges are recorded by the final
preview evidence, along with missing-slot counts for explanation only.

| Coin   | net +1 | net 0 | net -1 | Direct reversal | Same-sign strengthen/weaken | Zero entry | Zero exit | Equal |
| ------ | -----: | ----: | -----: | --------------: | --------------------------- | ---------: | --------: | ----: |
| ASTER  |      6 |     2 |      6 |               5 | 0 / 0                       |          0 |         0 |     1 |
| BTC    |    242 |    42 |    232 |              69 | 0 / 0                       |          8 |         7 |     8 |
| ETH    |    119 |    35 |    117 |              26 | 0 / 0                       |          5 |         4 |    10 |
| HYPE   |      0 |     1 |      0 |               0 | 0 / 0                       |          0 |         0 |     0 |
| SOL    |    187 |    58 |    174 |              69 | 0 / 0                       |         15 |         9 |    15 |
| XPL    |     41 |    12 |     33 |              11 | 0 / 0                       |          0 |         2 |     3 |
| xyz:CL |     11 |     4 |     10 |               2 | 0 / 0                       |          0 |         0 |     0 |

Total net +1/0/-1 = 606/154/572. buyStrength 1/0.5/0 = 606/154/572;
sellStrength 1/0.5/0 = 572/154/606. Confidence
`0.333333333333333333` occurs 1,178 times, `0.166666666666666667` 154 times.
Per coin, confidence counts equal (nonzero nets)/(zero nets) in the table.
Every observation has one participant: this is not broad consensus. There are
182 direct opposite-sign reversals, 22 exits to zero, 28 emergences from zero,
37 equal values. No same-direction nonzero magnitude changes exist in this
one-wallet sample. These are descriptive observations, not profitability results.

## Design / implementation

`direction-change-v1` / ADR-046 / `phase5-4-direction-change-spec.md` fix strict
same-basis comparison, no epsilon, explicit NONE, independent confidence and
immutable source-pair identity. Existing Signal math/identity, Selection thresholds,
weights and upstream writes are unchanged. The only upstream code addition is a
read-only saved Signal verification method sharing the caller's transaction.

One new table with 19 columns; numeric(38,19) nets/delta; two Signal RESTRICT FKs,
six indexes (PK, two unique, three secondary), four CHECK constraints. No existing
table SQL, large index, backfill, consumer or scheduler. New authenticated read API
and explicit-bucket/fingerprint CLI; no notification, demo, paid source or trading.

## Isolated validation and security repair

Explicit PostgreSQL 127.0.0.1:55433 / Redis 127.0.0.1:56380 only; integration
uses UUID schemas, E2E uses chaincopy_e2e / Redis15. No runtime fallback.
Commands: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm build`, `pnpm test:e2e`, `pnpm security:audit`, `git diff --check`.
Format/lint PASS, typecheck/build 11/11 PASS, 83 files / 870 tests PASS,
E2E 24/24 PASS. Isolated migration and 38 pure / 6 persistence tests passed,
including concurrent idempotency, late middle revisions affecting two neighbors,
unchanged historical rows, DQ, receipt tampering, CHECKs and source RESTRICT FKs.
Initial formatting and trust-inconsistency response failures were corrected and
the full suite rerun; no test was disabled. API explicitly returns BLOCKED for an
inconsistent Performance trust receipt rather than swallowing it or using it.

Security audit FAIL: critical 0 / high 3 / moderate 11 / low 1. Existing exact
braces exception is unchanged. Newly reported High dependencies on October 10:

- next 16.3.6, patched >=16.3.8: [GHSA-cjq9-62q9-8jv4](https://github.com/advisories/GHSA-cjq9-62q9-8jv4).
- sharp 0.35.4, patched >=0.35.5: [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).

The gate correctly failed before repair; no suppression or lowered severity.
Owner explicitly approved the narrow patch: next/plugin 16.3.8, sharp override
0.35.5 and necessary lockfile only. Before editing, recursive pnpm why confirmed
Next16.3.6 through web/next-auth/adapter, sharp0.35.4 through those Next paths,
and root eslint plugin16.3.6. pnpm11.9.0 lockfile-only installation used CI=true;
no release-age exception was needed. Exact braces exception remains unchanged.
Repair commit `0a5bb551d245e05ee54551cfe999b6cd614287be`; all paths now resolve to
next/plugin16.3.8 and sharp0.35.5. Only those packages, required Next internal/peer
references and sharp platform binaries/libvips changed in the lockfile.
No unrelated package updates or application compatibility changes.

Full isolated validation on the repaired image **PASS**: format/lint, typecheck
11/11 plus strict security-script check, 83 files / 870 tests, build11/11,
E2E24/24 (including Next16.3.8 production/standalone and authenticated API),
security:audit PASS. Critical0 / High1 (only exact approved braces advisory) /
moderate7 / low0. Next/sharp findings gone. The plain JSON still exposes the
approved braces advisory; the gate/exception were not changed. Isolated services
were stopped afterward. Final documentation format/diff check and final-head CI
are checked separately before the migration-approval handoff.

## Final bounded READ ONLY preview — PASS

Completed `2026-10-10T10:38:02.216Z` with execution commit
`0a5bb551d245e05ee54551cfe999b6cd614287be` and image
`sha256:ff4748758278a0245c0cc6f56d54ead3be0b1a0a9d6d887096a10c80779af6b1`;
image revision label matches exactly. Command (explicit runtime URLs, overridden
image command, **not** ordinary Worker/API):

```sh
node --import tsx apps/worker/src/maintenance/direction-change-preview.ts
```

All PostgreSQL transactions are READ ONLY. Preview does not access or require the
new table, never calls persist, and never saves upstream recalculations. Redis
only LLEN/ZCARD for existing queues; no consumers, enqueue or mutation.

Receipt: `phase5-4-readonly-preview.json`. It includes coin-level distributions,
all multi-bucket consecutive sequence ranges and isolated-bucket counts, missing
slot counts, latest eventful result per coin with both immutable Signal IDs and
provenance, protected hashes and queues. UTC timestamp strings use Node JSON
serialization; no PowerShell timestamp reserialization. SHA256 of ordered result
fingerprints: `6908e1edbc19539f664f5bb2f86bbcd007c73b12f029256a1e4516e2380832b4`.
SHA256 of all 269 canonical result objects:
`66e154a2af1e83e4177d51a0b7d6e84a9705dcfcc1e158c02c8050738404914d`.

| Coin   | Comparable | BUY accel | BUY weaken | SELL accel | SELL weaken | Bullish reversal | Bearish reversal | NONE |
| ------ | ---------: | --------: | ---------: | ---------: | ----------: | ---------------: | ---------------: | ---: |
| ASTER  |          6 |         0 |          0 |          0 |           0 |                3 |                2 |    1 |
| BTC    |         92 |         0 |          2 |          0 |           5 |               24 |               45 |   16 |
| ETH    |         45 |         0 |          2 |          0 |           2 |               14 |               12 |   15 |
| HYPE   |          0 |         0 |          0 |          0 |           0 |                0 |                0 |    0 |
| SOL    |        108 |         0 |          6 |          0 |           3 |               36 |               33 |   30 |
| XPL    |         16 |         0 |          1 |          0 |           1 |                4 |                7 |    3 |
| xyz:CL |          2 |         0 |          0 |          0 |           0 |                1 |                1 |    0 |
| Total  |        269 |         0 |         11 |          0 |          11 |               82 |              100 |   65 |

1,056 non-adjacent stored-row pairs were blocked, plus seven first observations
without a predecessor. No comparable pair failed current-valid provenance checks.
204 eventful + 65 explicit NONE = 269; 37 unchanged + 28 zero emergences = 65 NONE.
Historical missing intervals are not neutral buckets or evidence of inactivity.

| Coin   | Latest eventful current bucket UTC | Event               |
| ------ | ---------------------------------- | ------------------- |
| ASTER  | 2025-09-25T22:00:00.000Z           | BULLISH_REVERSAL    |
| BTC    | 2026-09-09T16:30:00.000Z           | BEARISH_REVERSAL    |
| ETH    | 2025-10-02T10:30:00.000Z           | BULLISH_REVERSAL    |
| HYPE   | none (no adjacent pair)            | no result, not NONE |
| SOL    | 2026-04-17T17:15:00.000Z           | BULLISH_REVERSAL    |
| XPL    | 2025-10-09T02:30:00.000Z           | BEARISH_REVERSAL    |
| xyz:CL | 2026-03-17T22:00:00.000Z           | BEARISH_REVERSAL    |

These are retrospective observations, not fresh trade recommendations or
profitability evidence. BTC's latest saved Signal is later than its latest
comparable event; the gap is not bridged. Confidence is one-wallet evidence only.

Selection remains `cmujbqjbu2af4nq01zg56l0vc`, cohort
`fe0406a83061090efe9fb2dc83008e8b1cf62f567a186cb15cb4a21a54190a8a`, weight
`df5787c523f18a541b8fe127bbfa651ce13b1beaf2601ac9638218bfc602c9cd`.
Protected full-row hashes/counts of **17 tables**, including all 1,332 Signal
snapshots, match before/after. Behavior2,012; aggregation1,332+1,332; weight1+1;
Selection/Performance/quarantine/DQ/cursors/wallets unchanged. OPEN Behavior DQ0.

| Queue                            | Prioritized | Active | Completed | Failed |
| -------------------------------- | ----------: | -----: | --------: | -----: |
| hyperliquid-sync                 |           0 |      0 |       318 |    444 |
| address-performance              |           1 |      0 |        66 |     14 |
| behavior-normalization           |           0 |      0 |        24 |      0 |
| hyperliquid-discovery            |           1 |      0 |        17 |    609 |
| hyperliquid-candidate-enrichment |        8427 |      1 |        20 |      5 |

All wait/paused/delayed/waiting-children=0; before=after. Existing backlog/active
job untouched. Preview ~321 MiB RAM, PostgreSQL ~121 MiB, Redis ~48 MiB at sampled
load. No retry storm or queue drain. Temporary processes finished, isolated
services stopped and ordinary Worker remains stopped. PostgreSQL/Redis healthy.
Final read-only catalog/state check: **13 applied**, Phase5.3 checksum unchanged,
new `direction_change_snapshots` table **absent**. No real DDL/persistence, sync,
Performance/Selection/Behavior/aggregation/weight processing or manual DQ/cursor
mutation. Temporary build/validation/postcheck scripts removed before final commit.

## Exact SQL handoff (NOT applied to real DB)

`prisma/migrations/20261010000000_direction_change/migration.sql`

SHA256: `6409a6bc6005609198fd81d46dd271358abcf679b3c06b96896936d1e88cb761`.

After separate exact-SQL approval: restart preflight from current HEAD/image,
SQL SHA, health/disk, exact pending set, current Signal/Selection/weight/aggregation,
protected hashes and queues. Apply only approved SQL, inspect catalogs, rerun
fresh READ ONLY preview, persist only newly validated comparable pairs using each
fresh expected fingerprint, repeat to prove idempotency, verify saved read API and
protected state, stop temporary processes. Do not reuse historic preview without
revalidation. Do not repeat Phase 5.3 persistence or upstream jobs.
