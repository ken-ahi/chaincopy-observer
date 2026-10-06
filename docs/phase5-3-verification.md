# Phase 5.3 verification — 2026-10-06

Status: approved security repair, exact live migration and bounded Signal
persistence **PASS** on 2026-10-06. Final documentation-head CI/merge is gated by
the Owner's standing authorization; PR #38 checks/merge record are authoritative.
Prior BLOCKED observations below remain historical evidence, not current blockers.

## Approved dependency repair

Before editing, `pnpm why source-map-js` and `pnpm -r why source-map-js --json`
were captured from the prior validation image (pnpm 11.9.0). Exactly 1.2.1 was
resolved, through these paths (deduplicated branches expanded here):

- web → @tailwindcss/postcss → @tailwindcss/node → source-map-js;
- web → @tailwindcss/postcss → postcss → source-map-js;
- web → next → postcss → source-map-js;
- web → next-auth → next → postcss → source-map-js;
- web → @next-auth/prisma-adapter → next-auth → next → postcss → source-map-js;
- root → vitest → vite → postcss → source-map-js;
- root → vitest → @vitest/mocker → vite → postcss → source-map-js;
- api, worker, analytics, blockchain-adapters, config, database and ui → tsup →
  postcss → source-map-js (each also through tsup → postcss-load-config → postcss).

Root workspace override `source-map-js: 1.2.2` forces every transitive branch to
the exact approved patch. `CI=true pnpm install --lockfile-only
--frozen-lockfile=false --ignore-scripts` used pnpm 11.9.0. The lockfile changes
only this package's version/integrity, its two parent dependency edges and the
override. No release-age exemption, unrelated update, application logic or
audit-gate change. The new image's `pnpm why source-map-js` and recursive JSON
inventory resolve every path above to **1.2.2**, with no 1.2.1 remaining.

Repair commit: `752e3a833d0c78520724845799aa800f1080f08a`. Exact execution image:
`sha256:eaefe48d0202b4d827e282713586b47a6546cc6af6090fdc68f50a71f2e20090`,
revision label equal to that commit. pnpm 11.9.0 frozen installation succeeded.
Full validation was rerun against explicit isolated PostgreSQL 55433 / Redis 56380
targets: format/lint PASS, typecheck 11/11 plus strict audit-script check,
81 files / 825 tests PASS, build 11/11, E2E 23/23 PASS. Next production build and
standalone E2E server, Fastify auth/routing tests all passed. Isolated containers
were stopped afterward; these tests never used real runtime DB/Redis endpoints.

`pnpm security:audit` **PASS**: critical 0 / high 1 / moderate 7. The only high is
the unchanged Owner-approved `braces@3.0.3 / GHSA-vfj7-8cjw-p6xm` tooling exception.
`GHSA-68fv-2mgg-jv7q` is absent. Plain audit JSON still reports braces; no new ignore,
gate weakening or suppression was added. GitHub CI #99 on `752e3a8` also passed;
the documentation follow-up must pass its own final-head CI before merge.

## Owner-authorized live migration — 2026-10-06

Owner approved only the Signal SQL with SHA256
`e32b7973dd002e83fb2127cf86cb2a7862ba37aa38826cad811898173de72c0e` and fresh
expected-fingerprint persistence of the 1,332 reviewed buckets. Execution used
the exact `752e3a8` image above, never its ordinary Worker entrypoint.

Full preflight and the immediately-before-deploy recheck both passed:

- Feature HEAD and image revision matched; migration bytes matched the approved SHA.
- PostgreSQL 17.10 and Redis healthy. Ordinary Worker/API/web stopped.
- Exactly 12 applied migrations and exactly one pending: `20261006000000_behavior_signal`.
  Signal table absent; no failed/rolled-back/unknown migration records.
- Filesystem 1,007 GiB total / 289 GiB used / 667 GiB available (31% used).
  PostgreSQL filesystem available: 699,383,908 KiB.
- Selection `cmujbqjbu2af4nq01zg56l0vc`, selected wallet
  `cmuh1wwf4001wk70ynvgjo7a3` / `0x34112cf6672cbad0f44b5a77857099417dc686af`,
  trusted Performance `cmujbpj6527jdnq01t6zuxi9u`.
- Weight snapshot `df5787c523f18a541b8fe127bbfa651ce13b1beaf2601ac9638218bfc602c9cd`,
  one entry, normalized weight exactly 1. Cohort fingerprint
  `fe0406a83061090efe9fb2dc83008e8b1cf62f567a186cb15cb4a21a54190a8a`.
- Exactly 1,332 VALID current aggregation revisions. All 16 protected-table
  count/full-row hashes and queue states matched the reviewed evidence, OPEN Behavior DQ 0.

`pnpm exec prisma migrate status` reported the one expected pending migration
(expected exit 1). Only after this check, `pnpm exec prisma migrate deploy` ran
with the explicitly authorized real PostgreSQL URL. It applied **only** the
approved migration, finishing at `2026-10-06T13:37:24.545898Z` (exit 0).
Post-status: **13 applied / 0 pending**, schema up to date.

PostgreSQL catalog inspection, in a READ ONLY transaction, confirmed one table,
13 columns, 7 indexes (PK + 2 unique + 4 secondary), 3 `ON DELETE RESTRICT` FKs
and both CHECKs (`bucketEnd = bucketStart + 15 minutes`, `id = inputFingerprint`).
Signal rows were 0 immediately after DDL. Database size was 58,430,404,275 bytes
before / 58,430,478,003 bytes after DDL. No other migration, existing-table DDL,
DROP, rollback, DELETE, repair or cleanup was performed.

## Fresh preview, bounded persistence and postcheck — PASS

After migration, all 1,332 buckets were previewed again through
`PrismaBehaviorSignalService.preview()` in READ ONLY transactions, completing
`2026-10-06T13:39:53.909Z`. No historic expected fingerprint was blindly reused.
The ordered fresh plan (coin/start/revision/fingerprint/scores/status) SHA256 was
`0ef92696e0937b684764e1089f91677ad9990a437f25afc55313a434d1629bbd`.

A temporary bounded orchestrator called the same formal
`PrismaBehaviorSignalService.persist(coin, bucketStart, expectedFingerprint)`
used by `pnpm behavior:signal --execute --expected-fingerprint ...`, sequentially
for exactly the fresh plan's 1,332 unique buckets. It rejected a stale plan,
changed inputs/cohort/queues, nonempty initial Signal table, or identity mismatch.
The existing service revalidated receipts within each Serializable transaction.
This is Signal receipt verification, **not** upstream recalculation/persistence.

It repeated the identical 1,332 persistence calls, then compared all columns,
JSON and timestamps of every saved row. **Created 1,332; repeat created 0;
immutable rows 1,332**, byte-equivalent canonical row serialization before/after.
SHA256 of id-ordered Prisma rows via `JSON.stringify`:
`bf42213f58aaa4d00d18330fc6de85f5361a98b922aaa201d808351eb969f7f0`.
The seven coins' newest buckets were tested through the actual Fastify route
using in-process injection: unauthenticated 401, authenticated 200,
`Cache-Control: no-store`, `CURRENT`, saved receipt and calculatedAt exact match.
No ordinary API/Worker/consumer was started.

Final `LIVE_VERIFICATION_PASS`: `2026-10-06T13:45:01.965Z`.

- BUY dominant **606**, SELL dominant **572**, mixed/balanced **154**, NO_SIGNAL **0**;
  exactly reconciled with fresh preview. Mixed is the same 154 balanced buckets,
  not an additional category. 606 + 572 + 154 = 1,332.
- Behavior **2,012** and aggregation **1,332 buckets / 1,332 revisions** unchanged.
- Weight **1 snapshot / 1 entry**, Selection/current pointer/overrides, trusted
  Performance Runs, 14 trust transitions, wallets, all DQ/cursors unchanged.
- All 16 protected count/full-row hashes equal the committed READ ONLY evidence
  before and after. OPEN Behavior DQ **0 → 0**; queues exactly equal the table below.
- Final catalog recheck: Signal rows **1,332**, approved constraints/indexes intact.
  DB size **58,436,064,947 bytes**; final disk **668 GiB free**
  (699,401,488 KiB available); PostgreSQL/Redis healthy.
- Observed single-process load: preview/persistence about 339–344 MiB RAM,
  PostgreSQL about 115 MiB, Redis about 45 MiB; no backlog drain/retry storm.
- Temporary execution process exited successfully; temporary scripts removed;
  isolated validation services and ordinary Worker remained stopped.

Commands used the exact image above with explicit runtime endpoints, overridden
entrypoint command and read-only bind-mounted temporary orchestration/plan:

```sh
pnpm exec prisma migrate status
pnpm exec prisma migrate deploy # exactly one approved pending SQL, checked immediately before
pnpm exec prisma migrate status
node --import tsx apps/worker/src/maintenance/.tmp-phase53-live.ts preview
node --import tsx apps/worker/src/maintenance/.tmp-phase53-live.ts persist
# persist mode also repeats the same formal calls and verifies saved API/protected hashes
# catalog checks: psql -v ON_ERROR_STOP=1, BEGIN READ ONLY / COMMIT
```

No wallet sync, Performance/Selection evaluation, Behavior normalization,
aggregation or weight write, DQ/cursor mutation, Redis mutation, paid data or
Phase 5.4 work. The only real changes were approved additive Signal DDL and
1,332 new Signal snapshots. Do not repeat the completed migration or persistence.

## Provenance and contract audit

Feature `codex/phase5-3-signal`, base main/PR #37 merge
`0cde866ece640abef318c137fe5ae9df031c87d2`. No previous recovery, sync, Selection,
Performance, Behavior, aggregation or weight write was repeated. Runtime Worker
stayed stopped. Stage 1 READ ONLY audit verified all 1,332 immutable aggregation
receipts contain 2,012 per-wallet semantic/notional events, zero missing evidence.
The current cohort and immutable weight snapshot match exactly; no Phase 5.1
schema extension was needed. Full contract: `phase5-3-signal-spec.md`, ADR-045.

## Initial bounded live READ ONLY preview (historical, before approval)

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

## Initial isolated validation (historical, before security repair)

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

## Original migration approval handoff (historical)

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
