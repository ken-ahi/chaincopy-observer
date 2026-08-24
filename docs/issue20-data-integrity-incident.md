# Issue #20 Data Integrity Incident Analysis

## Status and safety boundary

Issue #15 remains **BLOCKED**. This document is based only on read-only queries. No repair, DQ mutation, replay, Selection evaluation, or Behavior processing was performed.

Incident execution commit: `0359b3226ea038b482ba6b612b105798bc4b6af5`. Source-write window: `2026-08-24 13:08:30.214Z` through `13:08:33.857Z`; DQ audit completed through `13:08:43.918Z`; derived performance completed through `13:11:35.356Z`.

## Root cause

The incident had two necessary causes:

1. The one-off Issue #15 runner copied addresses from a manually assembled summary instead of loading them from `wallet_addresses`. Its IDs were correct, but 13 of 14 literal addresses differed from the canonical DB addresses. The dry-run checked job counts and prohibited job types, but did not join every pair back to the DB.
2. `HyperliquidJobProcessor` trusted both fields in `HyperliquidJobData`. It never proved that `walletAddressId` owned `walletAddress`; the service therefore used the queued address for the upstream request and the queued ID for persistence.

The source manifest, iteration, and BullMQ payload preserved the erroneous pairs unchanged. The processor passed them unchanged to `HyperliquidSyncService`; repository fingerprints used the wrong address while FK ownership used the intended ID. This is both an operational runner defect and a missing application invariant.

## Canonical mapping and contamination predicate

The exact canonical mapping is obtained only by:

```sql
SELECT id, address FROM wallet_addresses WHERE is_watched = true ORDER BY address;
```

The only matching incident pair was wallet ID `cms3ab96ifgv3rv0iexiwudfo`, address `0x02aaf19ae62d3194858c635224a2d9ab2a14d519`. The other 13 wallet IDs are contaminated.

The primary execution identity is the 32 `sync_jobs.idempotency_key` values ending in `-1787576910176-issue15-account` or `-1787576910176-issue15-audit`. Exact selective predicates must combine those job identities, affected wallet IDs, and the table-specific timestamps below; a broad wallet deletion is not acceptable.

## Read-only contamination inventory

| Model/table                                                   | Exact incident set                                                                       |                    Rows | Pre-existing?              | Selective repair                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------: | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `PortfolioSnapshot` / `portfolio_snapshots`, type `portfolio` | `created_at` `13:08:30.465Z..13:08:31.948Z`; exclude the sole valid wallet               |   13 contaminated of 14 | No                         | Yes: wallet ID + creation window + wrong-address-derived fingerprint                                      |
| Same, type `portfolio-history`                                | Same creation window; exclude valid wallet's 79 rows                                     | 143 contaminated of 222 | No                         | Yes, using the same provenance predicate; do not select by `captured_at`, which contains historical dates |
| Same, type `clearinghouseState`                               | `created_at` `13:08:32.050Z..13:08:33.474Z` for the five current-state jobs              |                       5 | No                         | Yes: five job wallets + creation window/fingerprint                                                       |
| `PerpPositionEvent`                                           | incident creation window                                                                 |                       0 | N/A                        | None required                                                                                             |
| `SpotBalanceSnapshot`                                         | incident creation window                                                                 |                       0 | N/A                        | None required                                                                                             |
| `OrderHistory`                                                | incident creation window                                                                 |                       0 | N/A                        | None required                                                                                             |
| `RawEvent` / `raw_events`                                     | `received_at` `13:08:30.441Z..13:08:33.698Z`                                             |                      42 | No                         | Yes: wallet, event type, received window, and raw-event fingerprint/ID                                    |
| `DataQualityIssue`                                            | type `HYPERLIQUID_INCOMPLETE_INITIAL_SYNC`, `resolved_at` `13:08:34.325Z..13:08:43.638Z` |                      57 | Yes; lifecycle was changed | Re-derive only; never blanket-flip status                                                                 |
| `MetricCalculationRun`                                        | `requested_at` `13:08:30.176Z` or `13:08:44.363Z` and the 14 recorded run IDs            |                      14 | No                         | Preserve as incident audit evidence; supersede after repair                                               |

Raw-event breakdown is: portfolio 14, clearinghouseState 5, spotClearinghouseState 5, openOrders 5, frontendOpenOrders 5, userRateLimit 5, and historicalOrders 3. Historical-order normalized inserts were zero.

The 14 performance runs produced 111 metrics, 159 position cycles, and 57 daily NAV rows. Every run currently has zero `wallet_selection_results` and zero `behavior_selection_scopes` references. The one correctly addressed wallet run is still incident-associated; all 14 must remain excluded from Selection until an Owner-approved repair/recalculation establishes trusted successors.

Full row IDs and DQ fingerprints are reproducible with the read-only inventory SQL used for this audit. The stable DQ predicate is the issue type plus the exact `resolved_at` window and incident wallet set; all 57 IDs/fingerprints were captured in the audit output.

## Runtime invariant

`HyperliquidJobProcessor` now loads `WalletAddress.address` by ID before SyncJob persistence, locks, upstream calls, or domain persistence. An absent ID or normalized address mismatch throws BullMQ `UnrecoverableError`. Case-only differences are accepted, but the canonical DB value is passed downstream. Logs contain job name/ID and wallet ID, not the supplied/canonical address values.

This check belongs at execution, not only enqueue, because queued data can be stale, manually produced, or imported by another producer.

## Owner-approved repair design (not executed)

1. Export the exact incident row IDs and fingerprints in a transactionally consistent read-only snapshot and checksum it.
2. Add an auditable incident/quarantine mechanism before changing source rows. Selection must reject the 14 listed performance run IDs until trusted successor runs exist; currently the operational Selection prohibition and zero downstream references provide the gate.
3. For source rows, prepare narrowly scoped repair SQL keyed by exported IDs, fingerprints, wallet IDs, and incident creation window. Review row counts before any mutation. Preserve raw/sync-job evidence or archive it with explicit incident provenance.
4. After source repair, run the normal DQ audit. Let it reopen/resolve each issue from trustworthy cursor and source evidence; do not set the 57 statuses directly.
5. Generate a clean manifest by selecting ID and canonical address in one DB query. Re-read and compare all pairs immediately before enqueue, reject any missing/duplicate/mismatch, and publish a canonical JSON checksum.
6. Replay only after separate Owner approval, then recompute `performance-v3`. Trusted successor runs must be newer and input-fingerprint-distinct before Selection is unblocked. Contaminated runs remain auditable and must not be selected.

No existing schema safely marks a performance run as quarantined. A durable database-level quarantine/status design therefore remains an Owner decision before repair; hard-coding incident IDs into Selection is not recommended.

## Acceptance status

- Root cause, runtime invariant, regression tests, contamination predicates, DQ re-audit, and clean-manifest procedure: defined.
- Repair/replay: not executed and requires separate approval.
- Selection/Behavior: blocked.
- Durable contaminated-run quarantine: design decision required before Selection can be unblocked.
