# Phase 5.4 verification — 2026-10-10

Implementation, full isolated validation and live READ ONLY preview **PASS**;
**no real migration/persistence or merge authorized**. Final-head CI is tracked
in the PR checks. Handoff: READY_FOR_MIGRATION_APPROVAL after final CI success.

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
