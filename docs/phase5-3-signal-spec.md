# Phase 5.3 — deterministic observational signal-v1

Status: implementation contract; real migration requires separate Owner approval.

## Input audit and scope

Main `0cde866ece640abef318c137fe5ae9df031c87d2` includes PR #37. On 2026-10-06,
READ ONLY inspection found 1,332 VALID aggregation revisions with 2,012 event
receipts, none missing wallet/semantic/notional/generation provenance. All use
Selection `cmujbqjbu2af4nq01zg56l0vc`, Performance `cmujbpj6527jdnq01t6zuxi9u`,
cohort `fe0406a83061090efe9fb2dc83008e8b1cf62f567a186cb15cb4a21a54190a8a`.
Weight snapshot `df5787c523f18a541b8fe127bbfa651ce13b1beaf2601ac9638218bfc602c9cd`
has normalized weight 1 for wallet `cmuh1wwf4001wk70ynvgjo7a3`. OPEN Behavior DQ=0.
The immutable per-event receipts, not aggregate totals alone, are sufficient.

This is a retrospective, current-selected-cohort **observational score**, not a
trade recommendation, actionable strategy signal, profitability estimate, or
SPEC §17 notification confidence. SPEC's risk/amount/allowlist/liquidity and
notification gates remain deferred, not bypassed. No strategy_signals row,
notification, demo order, momentum detection or execution is created.

## Direction and bounded contribution

BUY: LONG_OPEN, LONG_INCREASE, SHORT_REDUCE, SHORT_CLOSE.
SELL: SHORT_OPEN, SHORT_INCREASE, LONG_REDUCE, LONG_CLOSE.
Use Behavior semantics only; reversal CLOSE/OPEN legs retain their existing
identity and map independently. Raw Fill.side is not reinterpreted.

For each selected wallet in a 15-minute UTC half-open bucket, collect the set of
observed directions. No events: b=s=0; BUY only: b=1,s=0; SELL only: b=0,s=1;
both: b=s=0.5. Repeated events, many semantic cells, and reversal legs cannot
multiply the vote. These fixed coefficients are structural, not fitted.

Let w be the immutable normalized weight, sum(w)=1 exactly:

```text
B = Σ(w_i * b_i); S = Σ(w_i * s_i); net = B - S
P = Σ(w_i for participating wallets); n = unique participating wallet count
agreement = max(B,S)/P (0 when P=0)
breadth = n/(n+2)
confidence = P * agreement * breadth
```

Decimal precision 80, HALF_EVEN. B/S/net/P are exact with <=19 decimals;
confidence/diagnostic ratios rounded to 18 decimals. `weightedParticipatingWalletCount`
is the legacy output name for P, a **weight mass**, not an effective headcount.
The fixed breadth anchor 2 makes a single-wallet result at most 1/3 confidence;
this is evidence breadth, not calibrated probability or independent-owner proof.
Confidence differs from abs(net): balanced disagreement can have positive evidence
confidence but zero direction. No NAV dependency.

Proof: b,s>=0 and b+s is 0 or 1, hence B+S=P<=1, B/S∈[0,1], net∈[-1,1].
All participating BUY gives B=P,S=0 (all cohort BUY gives B=1); SELL is symmetric.
Equal two-wallet opposite votes give B=S=0.5, net=0, confidence=0.25. Unequal
weights 0.8/0.2 give net=0.6 and confidence=0.4. A single mixed wallet gives
B=S=0.5, confidence=0.166666666666666667. Valid empty input yields NO_SIGNAL,
all scores zero; it is not a neutral trading recommendation. Participating
zero-weight wallets with P=0 also yield NO_SIGNAL, with explicit counts retained.

Separate diagnostics preserve BUY-only / SELL-only / mixed unique wallet counts,
per-wallet event counts and BUY/SELL USD notionals. Raw or capped notional is NOT
used in direction/confidence: arbitrary dollar caps add cross-market assumptions
without formal calibration. Giant notional cannot dominate a wallet vote.

## Provenance and fail closed

One repeatable-read snapshot verifies current effective Selection via existing
SSoT, trusted current Performance and weight input receipt, plus the aggregation
current revision by recomputing the existing Phase 5.1 validation (including
source/Behavior DQ, cursor coverage, Fill-leg/generation provenance). Stored
aggregation snapshot/totals must equal canonical recomputation. Versions must be
behavior-v1 / behavior-aggregation-v1 / wallet-weight-v1, Selection/cohort equal.
Stale means changed input/coverage, not simply the age of a closed historical bucket.
No missing value is replaced with zero. Invalid/stale/missing receipt produces
BLOCKED without saving a Signal. No automatic upstream recalculation is invoked.

## Immutable persistence and API

Smallest equivalent schema: one `behavior_signal_snapshots` table, one immutable
row per version + aggregation revision + weight snapshot. It contains source
FKs, coin/time/cohort, exact canonical input fingerprint, full deterministic
result JSON, and calculatedAt. RESTRICT FKs reference aggregation revision,
weight snapshot and Selection Run. No existing data/schema alteration. Unique
input identity and coin/time/scope index; no retention or mutable current pointer.
The current row is resolved by current upstream identities, never latest timestamp.
calculatedAt is persistence time excluded from fingerprint. Historical result
meaning remains unchanged when current quality/cohort changes.

Preview is READ ONLY and needs no Signal table. Persist requires the preview's
expected fingerprint; serializable transaction, <=3 attempts for P2034/P2002,
immutable existing row equality check. Each bucket is an independent transaction;
retry/resume the explicit bucket after partial batch failure. No scheduler/queue.
No history-wide heap: bounded 2,000 planned buckets, 10,000 events/bucket and 200
members from existing contracts. The CLI accepts one explicit coin/bucket per call.

Authenticated GET `/api/behavior-signals?coin=...&bucketStart=...` returns only a
saved current result, NOT_COMPUTED, NO_SELECTED_WALLETS or BLOCKED. It does not
save or present a stale historical row as current. Provenance, score, confidence,
participants and persistence timestamp are returned; no new frontend is needed.

## Phase 5.4 immutable consumption contract

Consume snapshot ID, signalVersion, aggregation revision ID/input fingerprint,
weight snapshot ID, Selection/cohort fingerprint, coin, UTC bucketStart/end,
result (including NO_SIGNAL) and calculatedAt. Compare only a coherent version,
cohort and weight basis. A late aggregate revision creates a new snapshot only
for that bucket; downstream series must explicitly pin revisions and invalidate
affected comparisons, never overwrite history. Missing/BLOCKED/NOT_COMPUTED or
NO_SIGNAL is not interpolated into a neutral trading observation. Consecutive
15-minute buckets and comparable provenance are prerequisites for future
acceleration/weakening/reversal rules; thresholds and implementation are deferred.

## Acceptance / approval gate

Semantic, bounds, dedup, reorder, stale/DQ/provenance, idempotency and late-revision
tests; full isolated validation and bounded live READ ONLY preview are required.
No real migration, persistence, upstream processing or merge before separate
Owner approval. Leave PR open with READY_FOR_MIGRATION_APPROVAL when all other
gates pass. Prior Phase 5.1/5.2 migration approvals do not cover this table.
