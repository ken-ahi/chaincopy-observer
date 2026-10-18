# Phase 5.4 — direction-change-v1

Status: implementation contract; new real migration requires separate Owner approval.
Base: PR #38 merge `4999b15db3fcfc761864237c77c4cd23a43d5127`.

## Comparable persisted evidence

Only saved, current-valid signal-v1 receipts may enter this calculation. In one
repeatable-read (preview/read) or Serializable (persist) transaction, revalidate
both receipts using Phase 5.3's existing Selection/trusted Performance/weight,
current aggregation revision, source/cursor and relevant DQ checks. Never write
or recompute upstream _persisted_ state. Missing/stale/invalid receipts block.

Require same coin, signal version, Selection run, cohort fingerprint, immutable
weight snapshot/input fingerprint/version, Behavior and aggregation versions.
Aggregation revisions differ by bucket but each must match its current canonical
receipt. Each bucket is exactly 15 minutes UTC, aligned, half-open, and previous
end equals current start. NO_SIGNAL is not neutral: exclude it. Missing, BLOCKED,
NOT_COMPUTED and gaps are not interpolated, bridged or converted to zero.

Choose strict same-basis comparison, not cross-cohort normalization. Equal numeric
netSignal under different voters/weights need not mean equal behavior. No proof
exists to treat a membership/weight change as momentum. Reordered source reads
cannot affect the result: pin previous/current by timestamps and immutable IDs.

## Exact semantics (not trading recommendations)

Let a=previous netSignal, b=current netSignal, delta=b-a. Decimal precision 80,
HALF_EVEN; preserve canonical source precision (net <=19 decimals), no epsilon,
no extra rounding or profitability fitting. This is a first difference of bounded
observational strength, not a physical second derivative or forecast.

| Previous → current           | Result                        |
| ---------------------------- | ----------------------------- |
| a<0, b>0                     | BULLISH_REVERSAL              |
| a>0, b<0                     | BEARISH_REVERSAL              |
| a>0, b>a                     | BUY_ACCELERATING              |
| a>0, 0<=b<a                  | BUY_WEAKENING                 |
| a<0, b<a                     | SELL_ACCELERATING             |
| a<0, a<b<=0                  | SELL_WEAKENING                |
| a=0, b>0                     | NONE / DIRECTION_EMERGED_BUY  |
| a=0, b<0                     | NONE / DIRECTION_EMERGED_SELL |
| a=b (including balanced 0→0) | NONE / UNCHANGED_NET          |

Direct opposite nonzero signs alone are reversals. Zero→nonzero is emergence,
not acceleration of an existing direction or reversal. Nonzero→zero is complete
weakening, not reversal. A genuine VALID mixed/balanced observation is zero;
an absent observation or NO_SIGNAL is not. No look-through across zeros.

Tiny representable changes in future multi-wallet cohorts intentionally count as
changes. Record exact delta and both strengths for explainability; v1 makes no
claim of materiality. A noise/minimum-delta filter belongs to a separately
reviewed/versioned rule or future notification policy, never a hidden epsilon.

## Confidence and NONE

Confidence does not affect direction or gate observation persistence. Preserve
both confidence values and delta, both participant counts and weight masses.
It represents evidence breadth, not probability. Single-wallet evidence remains
explicit; no high/low threshold or market consensus claim is introduced.
Unchanged net with changed confidence remains NONE/UNCHANGED_NET.

Persist explicit NONE for comparable pairs. Absence of a result is never NONE:
the read contract distinguishes NOT_COMPUTED, NO_SELECTED_WALLETS, BLOCKED with
reason, and CURRENT (eventful or NONE). Invalid pairs produce no saved result
and no manual DQ mutation. Their reason is returned by preview/read and audit.

## Immutable identity, schema and lifecycle

One new `direction_change_snapshots` table. Two RESTRICT FKs point to previous
and current Signal snapshots; their upstream RESTRICT chains retain Selection,
weight and aggregation provenance. Store coin, both bucket starts, both source
IDs, versions, event type, previous/current net and delta, Selection/cohort/weight
identity, canonical input receipt/result JSON and calculatedAt. Confidence and
all source receipt IDs/fingerprints/versions are in JSON. Financial columns use
numeric(38,19). No existing row/table alteration or new index on a large table.

Identity = SHA256(canonical policy + ordered previous/current evidence), excludes
calculatedAt. Unique version/source pair and version/input fingerprint. PK equals
fingerprint. CHECKs enforce aligned exact adjacency, identity and delta bounds/
equation. Index coin/current bucket/version, previous source FK, current source FK.
No retention deletes, updates, mutable latest pointer or silent cascade.

Late revision of bucket t creates new results only for (t-15m,t) and (t,t+15m)
when explicit inputs are again current-valid. Old rows remain immutable and are
not exposed as CURRENT; unrelated comparisons keep identical IDs and rows.
There is no automatic rebuild scheduler. One explicit bucket command, two
receipts/transaction, concurrency 1. Serializable persistence requires a fresh
expected fingerprint; at most three retries for serialization/unique conflicts.
Existing row must match every semantic field/JSON. Partial batch failure stops;
resume only reviewed explicit pairs with revalidation, never broad history replay.

## API and Phase 6 contract

Authenticated GET `/api/direction-changes?coin=...&bucketStart=...` (current bucket)
is read-only/no-store. Return saved current result and calculatedAt, or explicit
unavailable status; never substitute historical latest or fabricate an event.
CLI preview requires no new table; execute is separately authorized and requires
the preview input fingerprint. No Worker, queues or automatic consumers added.

Phase 6 consumes saved immutable result ID/version/event type, two Signal IDs,
coin/times, exact nets/delta, confidence evidence and complete provenance. It
must not recalculate direction rules. NONE is processed-but-no-event, not an
undelivered notification. Delivery identity pins result ID/channel/recipient;
dedup, delivery state, rate limits, suppression/freshness and message formatting
are notification concerns. Current-valid eligibility must be checked before use;
old invalidated results cannot be treated as active. Phase 6 and SPEC §17
notification-specific confidence/risk gates are not implemented or bypassed here.

## Acceptance and approval boundary

Deterministic vectors, strict continuity/provenance/NO_SIGNAL validation,
idempotency/concurrency, late revisions/unaffected history, source FK lifecycle,
saved read/auth and explicit isolated integration/E2E are required. Live audit and
preview are read-only and bounded to 1,332 saved signals, no profitability claims.
Full validation including exact existing security gate is required. Do not apply
the new migration to real DB, persist real results or merge without the separate
Owner approval. Handoff status: READY_FOR_MIGRATION_APPROVAL only if all gates pass.
