# Performance run quarantine specification

## Scope

Issue #22 defines a durable exclusion mechanism for contaminated `MetricCalculationRun` records. It does not change `performance-v3` calculations or `wallet-selection-v1` thresholds. Applying the migration or changing trust state in a real database requires a separate Owner-approved operation.

## Decision

Calculation outcome and downstream trust are separate concepts. A contaminated run remains `SUCCEEDED`; `trustState` determines whether it may be selected as current input. `MetricCalculationRun.trustRevision` and the append-only `PerformanceRunTrustTransition` log form the durable, auditable state machine.

- Existing runs migrate to `TRUSTED`, revision `0`, without synthetic history.
- `TRUSTED -> QUARANTINED` and `QUARANTINED -> TRUSTED` are the only transitions.
- Every actual transition records reason code/detail, incident reference, actor, operation key, revision, and time.
- A unique operation key makes retries idempotent. Reusing it for another run or target state fails closed.
- A run with revision `0` is valid only as legacy `TRUSTED`. Revision `n > 0` is valid only when its latest transition has revision `n` and the same resulting state. Unknown/inconsistent provenance throws and is never consumed.
- Transition rows use `ON DELETE RESTRICT`; quarantining never deletes or rewrites run metrics, NAV, cycles, or selection history.

## Trusted-run SSoT

`apps/api/src/performance-run-trust.ts` owns the trusted predicate and consistency check. Consumers must use `trustedPerformanceRunWhere` and `assertPerformanceRunTrustConsistency`; they must not duplicate `trustState` rules.

For each supported calculation version, the newest `SUCCEEDED + TRUSTED` run ordered by `requestedAt DESC, id DESC` is current. A quarantined newest run permits fallback to an older trusted run of that version. A newer trusted successor becomes current automatically. If no trusted run exists, the consumer returns explicit absence and existing fail-closed selection behavior applies.

Explicit historical `runId` reads remain available, including quarantined runs. Run DTOs expose `trustState` and `trustRevision`. Implicit overview/NAV/cycle reads use only the latest trusted run. Selection evaluation and `listEffectiveSelectedWallets()` never consume a quarantined run; this also protects a previously persisted selection after its performance run is later quarantined.

## Schema and indexes

- `metric_calculation_runs.trust_state`: non-null enum, default `TRUSTED`.
- `metric_calculation_runs.trust_revision`: non-negative integer, default `0`.
- `performance_run_trust_transitions`: append-only provenance with unique `(performance_run_id, revision)` and globally unique `operation_key`.
- `metric_runs_trusted_lookup_idx`: `(wallet_address_id, calculation_version, status, trust_state, requested_at DESC)` supports current trusted selection.
- `performance_run_trust_run_created_idx`: audit history by run and time.

The migration is additive. Existing run IDs and selection references are preserved. No incident-specific run IDs are embedded in schema, code, or downstream queries.

## Operational contract

Quarantine and restoration are explicit administrative operations using `PerformanceRunTrustService`; no automatic data-quality mutation changes trust. Restoration requires a new reason and operation key, typically after evidence review or a clean successor is available. Issue #22 does not execute either operation against real data.

Before a future production migration, validate migration status, backup/restore readiness, table size, lock budget, and query plans. After applying it under Owner approval, verify defaults, constraints, indexes, existing row counts, and the trusted lookup plan before any real quarantine.
