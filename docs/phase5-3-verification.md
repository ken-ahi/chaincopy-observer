# Phase 5.3 verification — 2026-10-06

Status: **BLOCKED** by the new dependency security finding below. Independently,
real Signal migration/persistence and merge require separate Owner approval.

## Provenance and contract audit

Feature `codex/phase5-3-signal`, base main/PR #37 merge
`0cde866ece640abef318c137fe5ae9df031c87d2`. No previous recovery, sync, Selection,
Performance, Behavior, aggregation or weight write was repeated. Runtime Worker
stayed stopped. Stage 1 READ ONLY audit verified all 1,332 immutable aggregation
receipts contain 2,012 per-wallet semantic/notional events, zero missing evidence.
The current cohort and immutable weight snapshot match exactly; no Phase 5.1
schema extension was needed. Full contract: `phase5-3-signal-spec.md`, ADR-045.

## Bounded live READ ONLY preview

Completed `2026-10-06T11:57:31.304Z` using the new Signal service in
`chaincopy-signal-validation:phase53`, overridden command (not Worker entrypoint):

```sh
node --import tsx apps/worker/src/maintenance/behavior-signal-preview.ts
```

DATABASE_URL/REDIS_URL were explicitly set to existing local service endpoints.
Every PostgreSQL transaction used SET TRANSACTION READ ONLY. Redis commands were
LLEN/ZCARD only (plus connection health); no consumers/enqueue/delete. The script
requires exactly the reviewed 1,332 bucket scope and consistent cohort throughout.
Separate per-bucket repeatable-read snapshots avoid one long transaction; protected
before/after hashes verify no input changed across the batch. No Signal table is
needed or accessed by preview. No real Signal persisted.

Receipt: `phase5-3-readonly-preview.json` (Node JSON serialization preserves exact
canonical timestamp strings). It includes source identity, newest results, all
protected hashes, queue states and SHA256 of the ordered 1,332 preview fingerprints:
`354e956ea5a83b3483836c8703d0b01ffdfa5031c1ae61edccc395f6e472e561`.

- Evaluable: 1,332 / 1,332, all 7 coins.
- BUY-dominant: 606; SELL-dominant: 572; mixed/balanced: 154; NO_SIGNAL: 0.
- Buy scores: 0=572, 0.5=154, 1=606; sell scores: 0=606, 0.5=154, 1=572.
- Net: -1=572, 0=154, +1=606.
- Confidence: `0.333333333333333333`=1,178;
  `0.166666666666666667`=154. Each has exactly **one** participant, not broad consensus.
- These observations do not establish profitability, freshness for execution, or
  fill-free coverage between populated historical buckets.

| Coin   | Newest bucket UTC start  | BUY | SELL | Net |
| ------ | ------------------------ | --- | ---- | --- |
| ASTER  | 2025-09-25T22:00:00.000Z | 1   | 0    | 1   |
| BTC    | 2026-09-24T13:15:00.000Z | 1   | 0    | 1   |
| ETH    | 2025-10-02T10:30:00.000Z | 1   | 0    | 1   |
| HYPE   | 2026-03-17T21:00:00.000Z | 0.5 | 0.5  | 0   |
| SOL    | 2026-04-17T17:15:00.000Z | 1   | 0    | 1   |
| XPL    | 2025-10-09T19:45:00.000Z | 0.5 | 0.5  | 0   |
| xyz:CL | 2026-04-06T22:30:00.000Z | 0.5 | 0.5  | 0   |

Protected-state hashes equal before/after for Behavior (2,012), aggregation
buckets/revisions (1,332 each), weights (1 snapshot/1 entry), Selection settings,
runs/results/overrides, Behavior DQ/cursors, Performance Runs/trust transitions,
sync cursors, source DQ and wallets. OPEN Behavior DQ remains 0. The 14 trust
transitions were untouched. Existing enrichment prioritized backlog 8,427 and
active 1 remain unchanged; no attempt to consume/repair that job.

| Queue                            | Prioritized | Active | Completed | Failed |
| -------------------------------- | ----------: | -----: | --------: | -----: |
| hyperliquid-sync                 |           0 |      0 |       318 |    444 |
| address-performance              |           1 |      0 |        66 |     14 |
| behavior-normalization           |           0 |      0 |        24 |      0 |
| hyperliquid-discovery            |           1 |      0 |        17 |    609 |
| hyperliquid-candidate-enrichment |       8,427 |      1 |        20 |      5 |

wait/paused/delayed/waiting-children=0, before=after. Observed preview memory
~292 MiB, runtime PostgreSQL ~121 MiB, runtime Redis ~46 MiB. All temporary
validation/preview processes finished; isolated services stopped, ordinary Worker
remained stopped. No destructive real DB/Redis operation or paid source.

## Isolated validation

Explicit reserved TEST endpoints: PostgreSQL `127.0.0.1:55433/chaincopy?schema=public`,
Redis `127.0.0.1:56380/0`; E2E schema `chaincopy_e2e` / Redis DB15. The new integration
suite uses a UUID schema inside that isolated DB and validates endpoints before
creating/removing fixtures. Normal runtime URLs are never inherited.

`Dockerfile.e2e` built the current source; current API/worker/analytics/test/docs
sources were mounted read-only for final validation. Commands:

```sh
pnpm db:migrate:deploy # isolated endpoint ONLY
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm security:audit
git diff --check
```

Results: format/lint PASS; typecheck 11/11 plus security-script strict check;
81 test files / 825 tests PASS; build 11/11; E2E 23/23 PASS; diff check PASS.
Initial formatting failure on the new export line was corrected and rerun.
New tests cover 8 semantics, votes/intensity separation, Decimal bounds, equal/
different weights, single/empty/mixed cohorts, reorder/dedup, stale/DQ/provenance,
expected fingerprint, concurrent idempotency, late revision, immutable unaffected
history, corrupt saved receipt, Restrict FKs and authenticated saved-result API.

Security audit **FAIL**, critical 0 / high 2 / moderate 7. Exact approved
`braces@3.0.3 / GHSA-vfj7-8cjw-p6xm` remains unchanged. The additional finding is
`source-map-js@1.2.1 / GHSA-68fv-2mgg-jv7q`, patched `1.2.2`, reported through
Next/PostCSS, Tailwind and build/test tooling. Official advisory:
<https://github.com/advisories/GHSA-68fv-2mgg-jv7q> (updated/reviewed October 5).
Gate correctly rejects it; no exception expansion, dependency update or lowered
severity was performed. Owner was asked about a separate narrowly scoped repair.
CI must be green before any subsequent merge or migration readiness declaration.

## Exact migration approval handoff (NOT applied to real DB)

`prisma/migrations/20261006000000_behavior_signal/migration.sql`
SHA256 `e32b7973dd002e83fb2127cf86cb2a7862ba37aa38826cad811898173de72c0e`.

One new table, one PK index, two unique indexes, four secondary indexes, three
RESTRICT FKs, two CHECKs (15-minute width and id=input fingerprint). Only new-table
DDL; no existing table/index/row alteration, historical backfill or auto scheduler.
Referenced provenance cannot silently cascade-delete. Isolated migrations and
FK/idempotency tests passed. Existing Phase 5.2 SQL SHA remains
`566d4ac9e246a6a072c56fbe308aabb5dc77940ed19bacbc1d562a6362ec9c67`.

After security repair/green CI and explicit Owner approval: restart read-only
preflight (HEAD/SQL SHA/pending migration/health/disk/cohort/queues/protected hashes),
apply only approved SQL, inspect catalogs, obtain a fresh live preview, then
explicit per-bucket `pnpm behavior:signal --coin ... --bucket-start ... --execute
--expected-fingerprint ...`. Reusing this historic preview without revalidation
is prohibited. Verify idempotency, saved API and unchanged protected state, stop
temporary processes. Do not apply this plan automatically. Phase 5.4 remains
unimplemented; immutable consumption requirements are in the specification.
