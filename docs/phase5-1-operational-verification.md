# Phase 5.1 bounded operational verification

Date: 2026-09-27. Base main: `5f220cfee4b3df2a7dadf2f890c94101fa183121` (PR #35).
Aggregation execution commit: `a14777d6e6c6fb071470d3899779ee2d23872178`.
Runtime: local Node 24.12.0 / pnpm 11.9.0; formal bounded CLI, no queue consumer.

## Scope / authorization

- Only current selected wallet `0x34112cf6672cbad0f44b5a77857099417dc686af`,
  wallet ID `cmuh1wwf4001wk70ynvgjo7a3`.
- Selection Run `cmujbqjbu2af4nq01zg56l0vc`, wallet-selection-v2, selected 1.
  Trusted Performance `cmujbpj6527jdnq01t6zuxi9u` unchanged.
- Pin cohort fingerprint `fe0406a83061090efe9fb2dc83008e8b1cf62f567a186cb15cb4a21a54190a8a`
  on each execution bucket; stop if membership changes.
- Owner separately approved real migration of the two new tables/indexes/FKs only,
  after isolated migration/testing and SQL review.
- No sync, normalization replay, Discovery/enrichment, Performance/Selection
  evaluation, source/DQ/cursor edit, paid access or trading occurred.

## Migration / preflight

`prisma migrate status` showed exactly one pending migration:
`20260927160000_behavior_aggregation`. SQL contains only two new tables, their
five indexes (including PK indexes), three Restrict FKs and checks. No existing
table/row/index alterations. The isolated DB/schema diff was empty.

After explicit runtime URL selection, `node node_modules/prisma/build/index.js
migrate deploy` applied only that migration. Post-status: **up to date**; table,
FK, index definitions verified through PostgreSQL catalogs. No automatic rollback
or cleanup was used.

DB size before: 58,425,841,331 bytes. After migration + aggregation: 58,430,248,627
bytes. Disk remained 690 GiB available. PostgreSQL/Redis healthy throughout.
Sample aggregation load: PostgreSQL 42–44% CPU / approximately 179 MiB reported
container memory, Redis below 1% CPU / approximately 58 MiB. After full-table
read-only integrity counts, PostgreSQL reported 2.425 GiB / 7.681 GiB and 2.26% CPU;
Redis 57.31 MiB and 0.39% CPU. No worker/consumer was started.

## Bounded execution and reconciliation

For each of ASTER, BTC, ETH, HYPE, SOL, XPL, xyz:CL, run the formal CLI with
`--from 2025-05-01T00:00:00.000Z --to 2026-09-25T00:00:00.000Z`.
All buckets first passed dry-run. Persistence used the same arguments plus
`--execute --expected-scope <fingerprint above>`. One bucket transaction at a time.

The first read-only dry-run exposed a signed-zero bug in the new reconciliation:
Decimal `0 * negative` / `negative * 0` may be negative zero, not a flip. It stopped
before writing any aggregation receipt. Explicit nonzero/sign-change checks and
SHORT open/close integration regression tests fixed it. Existing Behavior was
correct and unchanged; all seven-coin dry-runs then passed.

| Coin   | Events consumed | VALID buckets |  USD notional |
| ------ | --------------: | ------------: | ------------: |
| ASTER  |              16 |            14 |     1370.6985 |
| BTC    |             779 |           516 |  321138.26527 |
| ETH    |             385 |           271 |  119228.11132 |
| HYPE   |               2 |             1 |        83.769 |
| SOL    |             670 |           419 |  126547.16805 |
| XPL    |             127 |            86 |   22615.87906 |
| xyz:CL |              33 |            25 |   2744.401366 |
| Total  |            2012 |          1332 | 593728.292566 |

Each bucket has union uniqueWalletCount **1**. Each nonempty semantic cell counts
that wallet once, including the largest 25-event BTC bucket. Event/notional totals
were independently reconciled in SQL against source Behavior, with 7/7 exact
count and Decimal-notional matches. No EMPTY/BLOCKED receipt was persisted.
Bucket range: `[2025-05-15T13:15:00.000Z, 2026-09-24T13:30:00.000Z)`.
This is historical persisted-input aggregation, not a claim of continuous full
exchange-history coverage or a neutral signal for missing intervals.

| Semantic       | Events |  USD notional |
| -------------- | -----: | ------------: |
| LONG_OPEN      |    445 | 151483.120188 |
| LONG_INCREASE  |    188 |   42903.69992 |
| LONG_REDUCE    |    217 |  25742.281948 |
| LONG_CLOSE     |    444 |  168212.82215 |
| SHORT_OPEN     |    266 |   68768.36368 |
| SHORT_INCREASE |    114 |    33926.7796 |
| SHORT_REDUCE   |     72 |    7543.98425 |
| SHORT_CLOSE    |    266 |   95147.24083 |

Repeat execution of the 25-event BTC bucket `2026-06-16T11:15Z` and first xyz:CL
bucket `2026-03-02T11:00Z` created **zero additional rows**. All 1,332 bucket and
1,332 revision row hashes remained identical:

- buckets SHA-256: `fe6cc0560c6ece135c094b371d0fde4f7637028a5ac60ee03ba1280251bf49d3`
- revisions SHA-256: `18fa77671bf88a0ae12593b07c609587a25fbaf2d6aa046e5f1028090aa4e77f`
- cross-bucket/invalid current pointers: 0

Read-service projection on real data returned VALID for two BTC June-16 buckets
and 23 xyz:CL March buckets, matching persisted fingerprints. API authentication,
bounded query parsing and stale suppression are also covered by isolated tests.

## Protected state / shutdown

All **2,012 existing Behavior rows** remained identical, including all fields:
SHA-256 before = after
`f8a450777e4a64d085edd13634150d1328f8b9e5b8ce239550910dc7db20739a`.
Hash construction: PostgreSQL SHA-256 over newline-separated `row_to_json(row)`
ordered by primary key, in read-only repeatable-read transactions.

Unchanged complete-row hashes/counts: 50 wallets, Selection settings, 73 Selection
Runs / 3,080 results, manual override, 403 sync cursors, seven Behavior cursors,
10 normalization Runs / 10 scopes, three Behavior DQ records, all 727 source DQ,
2,011 selected-wallet normalized fills, and 14 quarantined Performance Runs.
RawEvent count stayed 13,731,224; portfolio snapshot count stayed 1,542,367.
OPEN Behavior DQ **0 → 0**; global source OPEN DQ **638 → 638**; selected source
OPEN DQ **0 → 0**. Selection and latest activity `2026-09-24T13:21:27.107Z` unchanged.

| Queue                            | Prioritized before/after | Active before/after | Completed | Failed |
| -------------------------------- | -----------------------: | ------------------: | --------: | -----: |
| hyperliquid-sync                 |                    0 / 0 |               0 / 0 |       318 |    444 |
| address-performance              |                    1 / 1 |               0 / 0 |        66 |     14 |
| behavior-normalization           |                    0 / 0 |               0 / 0 |        24 |      0 |
| hyperliquid-discovery            |                    1 / 1 |               0 / 0 |        17 |    609 |
| hyperliquid-candidate-enrichment |              8427 / 8427 |               1 / 1 |        20 |      5 |

Waiting/paused/delayed/waiting-children remained zero. Existing enrichment active
job `enrich-cms9j6kxp1mskn90i477x9hxy-1627804426372-1785570826372` remained unlocked;
it was not consumed, retried or removed. Only read-only Redis commands were used.
All bounded CLI processes exited. Ordinary Workers remained stopped, and the two
isolated test containers were stopped after validation. Real PostgreSQL/Redis
remain running and healthy.

## Validation / next phase

- format, lint, typecheck 11/11, tests **76 files / 730**, build 11/11: PASS.
- E2E **22/22**, explicit isolated 55433/56380 endpoints: PASS.
- `pnpm audit --audit-level high`: PASS (four unrelated moderate advisories).
- `git diff --check`: PASS. No skipped/weakened tests.
- The permanent test guards now reject missing/normal runtime connection targets.
- PR/CI/merge gate remains required. Phase 5.2 needs a new weighting design using
  wallet-selection-v2 trusted closed-cycle metrics; no formula/Signal was added.
