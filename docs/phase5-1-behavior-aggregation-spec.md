# Phase 5.1 — Coin-Level Wallet Behavior Aggregation

Contract: `behavior-aggregation-v1`; source: `behavior-v1`. Date: 2026-09-27.
SSoT: SPEC, Phase 5 roadmap, Phase 5.0 contract, wallet-selection-v2, ADR-042.

## Audit / interval decision

Main `5f220cfee4b3df2a7dadf2f890c94101fa183121` contains PR #35. Read-only live
audit found 2,012 events / one selected wallet / seven coins, no OPEN Behavior or
source DQ for that wallet, and seven committed timestamp-group cursors.

| Coin   | Events | 5-minute buckets | 15-minute buckets | 60-minute buckets |
| ------ | -----: | ---------------: | ----------------: | ----------------: |
| ASTER  |     16 |               15 |                14 |                 9 |
| BTC    |    779 |              551 |               516 |               403 |
| ETH    |    385 |              304 |               271 |               216 |
| HYPE   |      2 |                2 |                 1 |                 1 |
| SOL    |    670 |              469 |               419 |               302 |
| XPL    |    127 |               97 |                86 |                66 |
| xyz:CL |     33 |               29 |                25 |                24 |

Choose fixed **15-minute UTC, half-open [start,end)** buckets. Current density
yields 1,332 nonempty buckets, max 25 events per bucket. SPEC §17.4's future
30-minute consensus window can compose two adjacent buckets; 60 minutes loses
that resolution. Five minutes is finer but fragments participation more, and
SPEC's five-minute email batching is a different responsibility. This is not a
15-minute Signal delay or recommendation, and the one-wallet sample does not
prove a profitable trading interval. A different interval requires a new version.

## Scope and meaning

Use `listEffectiveSelectedWallets()` only, with the current Selection Run and
trusted Performance references frozen as an aggregation cohort. This is a
retrospective projection of **currently selected** wallets' persisted Behavior;
it does not claim historical membership at event time. No watched fallback,
Selection threshold/weight/Signal/notification/demo implementation.

Keep generation provenance separate: Event → Normalization Run → original
BehaviorSelectionScope (Selection/Performance references). An older originating
Selection Run is allowed; absent/mismatched/untrusted provenance is not. Changing
the current cohort produces a distinct aggregation scope, not duplicate Behavior.
Old BTC Run BLOCKED contains 688 valid prefix events; successfully committed
groups remain usable after their DQ is resolved. Run status alone must not erase
these valid events.

## Arithmetic and participation

Map `(direction,eventType)` directly to LONG/SHORT × OPEN/INCREASE/REDUCE/CLOSE.
Persist all eight semantic cells with eventCount, uniqueWalletCount, sorted
wallet IDs and notionalUsd. Also persist union uniqueWalletCount, eventCount and
notionalUsd. Wallets count once in a semantic cell and once in the bucket union,
even after many fills. A wallet can legitimately occur in several cells; summing
cell wallet counts is not a union vote. Counts/notionals are observations, not
weights or Signal strength. Flip close/open ordinals are consumed as persisted.

Use Decimal precision 80; sum positive absolute-leg USD notionals, never signed
net quantity/notional. Validate finite nonnegative canonical decimals and input
event fingerprint/semantic/time/version. Duplicate identical fingerprints count
once; conflicting duplicates fail closed. Sort cohort, inputs, issues and wallet
sets explicitly before hashing. Wall-clock execution time is not input identity.

## Validity / observability

`VALID` means complete aggregation of the **persisted, reconciled Behavior input
set**, not proof of all exchange history or a new HISTORY_COMPLETE declaration.
The bucket must have ended. Check every cohort wallet for upstream gap / OPEN
source DQ, and the coin's OPEN Behavior DQ whose group can affect this bucket
(unknown group affects all; a failure affects its group and following buckets).
Never skip a wallet with a failed gate to make a smaller apparently valid cohort.
Other-coin Behavior DQ does not block this coin; wallet-wide source gaps do.

Require a committed coin cursor covering every input group and no stored
normalized Fill in the range lacking its corresponding persisted Behavior legs.
Check native source identities and original Selection/Performance provenance.
No financial intent is reinterpreted. A missing coin boundary/cursor is not FLAT.
Failed checks yield `BLOCKED`, explicit reasons, null totals—not zero signals.

Explicitly requested, checked buckets without events are `EMPTY` (observed empty,
not asserted exchange inactivity); no synthetic empty grid is generated during
backfill. Unrequested/missing buckets are `NOT_COMPUTED`. The read API rechecks
input fingerprints/quality and returns `STALE` with null totals if persisted
output no longer matches current inputs. Consumers must not treat EMPTY,
NOT_COMPUTED, STALE or BLOCKED as neutral Signal data.

## Persistence / reproducibility

New tables are required: existing Behavior Runs are wallet/coin normalization
executions; RawEvent, PerformanceMetric and Signal are not coin-bucket storage.
Do not overload them or rewrite existing Behavior.

- `BehaviorAggregationBucket`: deterministic key for aggregation/source version,
  current Selection Run, cohort fingerprint, coin, bucketStart; bucketEnd and
  currentRevisionId. Unique key prevents repeated bucket rows.
- `BehaviorAggregationRevision`: immutable input snapshot/fingerprint, status,
  explicit issues, nullable totals, eight semantic cells, execution timestamp.
  Unique `(bucketId,inputFingerprint)`; the bucket pointer can return to an older
  identical revision after A→B→A without duplicating history.
- Restrict Selection/parent/revision deletion. No retention/cleanup introduced.
  Snapshot includes event identities and canonical values, generation provenance,
  cohort and quality decisions for reproducibility after upstream changes.
- New-table indexes only: coin/start/scope lookup and bucket/fingerprint.
  Existing Behavior wallet/coin/time and coin/time indexes are reused. No large
  existing-table index migration or concurrent maintenance is needed.
- Per-bucket SERIALIZABLE transaction, bounded reads, immutable revision insert
  and current-pointer update atomically. Serialization conflicts retry at most
  twice with a fresh snapshot. Read/plan uses REPEATABLE READ. Timeout 30 seconds;
  no partial numeric bucket commits.

## Processing / late events / API

Bounded Worker entry point accepts coin/range, discovers nonempty source buckets
plus existing buckets in that range, and processes sequentially. Maximum 2,000
buckets per invocation, 10,000 events/fills per bucket, 200 cohort wallets. Limits
fail closed; never truncate. No scheduler/backlog consumer is enabled by this
phase, so no enrichment drain or hidden catch-up. A specific bucket invocation
is the canonical late-event recomputation mechanism; only that bucket's current
pointer changes. Range refresh reuses identical revisions without modifying rows.

Minimal authenticated GET projection: bounded coin/UTC range/limit, persisted
current-cohort results with versions, Selection provenance, fingerprint, status,
wallet/event counts and decimal-string notionals. No write HTTP endpoint or
BUY/SELL recommendation UI. Future continuous orchestration must use the same
bounded entry point; this phase does not claim an always-on scheduler.

## Test and operational gates

Dedicated `TEST_DATABASE_URL` / `TEST_REDIS_URL` for integration and
`E2E_DATABASE_URL` / `E2E_REDIS_URL` for E2E are mandatory. Reject missing values,
normal runtime ports/hosts, malformed URLs and wrong E2E schema before connecting.
CI binds its disposable services to the same explicitly isolated test ports.
Ordinary DATABASE_URL/REDIS_URL are never fallback targets.

Tests cover UTC edges, all semantic mappings, wallet uniqueness, Decimal sums,
duplicate/conflicting input, deterministic fingerprints, late revisions, A→B→A,
unrelated preservation, DQ and provenance fail-close, per-coin isolation, API auth
and stale suppression. Full workflow validation remains mandatory.

Real verification is restricted to the current selected wallet and existing
2,012 events. Owner explicitly approved migration of the two new tables only
after isolated validation and SQL review; no auto-migrate behavior is added.
Save event row hashes/DQ/queues before/after,
reconcile counts and Decimal totals, verify repeat no-op, leave Workers stopped.
No sync, Discovery, source/DQ/cursor edit or historical repair is authorized.

## Phase 5.2 follow-up

Before weighting implementation, redesign its contract against wallet-selection-v2
and trusted closed-cycle metrics. Annualized return/max drawdown/complete Daily
NAV are not mandatory free-data inputs. Audit win rate, trusted cycle count,
Profit Factor and top-trade contribution later; do not invent a formula here.
