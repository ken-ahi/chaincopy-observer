# Phase 5.4 verification — 2026-10-10

Implementation/isolated validation and live READ ONLY preview; **no real
migration/persistence or merge authorized**. This document will record each gate
before handing off the exact additive SQL for Owner approval.

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

## Migration approval handoff (NOT applied to real DB)

## Isolated validation and current security blocker

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

The gate correctly fails; no suppression, new exception, dependency change or
lowered severity. A separate narrow patch approval was requested. This finding
blocks readiness/merge even though functional validation passes.

## Exact SQL handoff (not yet ready while security gate fails)

`prisma/migrations/20261010000000_direction_change/migration.sql`

SHA256: `6409a6bc6005609198fd81d46dd271358abcf679b3c06b96896936d1e88cb761`.

After separate exact-SQL approval: restart preflight from current HEAD/image,
SQL SHA, health/disk, exact pending set, current Signal/Selection/weight/aggregation,
protected hashes and queues. Apply only approved SQL, inspect catalogs, rerun
fresh READ ONLY preview, persist only newly validated comparable pairs using each
fresh expected fingerprint, repeat to prove idempotency, verify saved read API and
protected state, stop temporary processes. Do not reuse historic preview without
revalidation. Do not repeat Phase 5.3 persistence or upstream jobs.
