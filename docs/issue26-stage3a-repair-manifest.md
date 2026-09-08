# Issue #26 Stage 3A read-only repair manifest

## Status and safety boundary

This document is the read-only Stage 3A manifest for the wrong-address incident tracked by Issues #20 and #26. It is **not authorization to mutate production data**. No DELETE, UPDATE, invalidation, DQ mutation, replay, performance calculation, Selection evaluation, Behavior processing, WebSocket-gap recovery, or Redis mutation was performed.

Source commit: `8aca1f9537204c337563b4b449296ee3a4033554`.

The machine-readable exact row allowlist is [issue26-stage3a-repair-manifest.json](./issue26-stage3a-repair-manifest.json). Its SHA-256 is `effe5f8c8c294d3071b45422ddc463bc87fab4a3f67fa0c12613d2d63aff0329`. The JSON uses positional row arrays; each class declares its column order, and the shared `jobs` array supplies the exact incident `sync_jobs` provenance.

## Exact inventory and recommendation

| Class | Table | Rows | Exact action proposed for Stage 3B | Class SHA-256 |
| --- | --- | ---: | --- | --- |
| Portfolio history points | `portfolio_snapshots` | 143 | `DELETE` | `0c3b4345a866839de38fc9d01721847071df64323064ff7d65939cff74649ef0` |
| Portfolio envelopes | `portfolio_snapshots` | 13 | `DELETE` | `e0c44f691b35c99bd3224738394486611e016cc76c95b456aa7a1c0a76453555` |
| Clearinghouse/current-state snapshots | `portfolio_snapshots` | 5 | `DELETE` | `bdab83ff7a44fe43597387f65a70cb1f615ce949038db07abf7ecfb0b4e57357` |
| Corrected source/raw-event allowlist | `raw_events` | 42 | `KEEP` | `34c14c130320915ef3824f8a74ee76c3a6967085f82b3679e198540975fc432c` |

The class hashes use rows ordered by `id` and UTF-8 newline-separated canonical records:

- portfolio classes: `id|wallet_address_id|source_id|fingerprint|captured_at UTC millisecond|created_at UTC millisecond`;
- raw events: `id|wallet_address_id|source_id|event_type|fingerprint|received_at UTC millisecond`.

The combined machine-readable manifest hash is the SHA-256 of the checked-in JSON bytes above.

## Incident provenance proof

The exact source-write execution consists of the `sync_jobs` whose idempotency keys end in `-1787576910176-issue15-account`. The JSON records the exact job ID, key, job type, wallet ID, start time, and finish time used for every row.

The proof chain is:

1. the incident runner supplied the audited wrong `(walletAddressId, address)` pairs;
2. the pre-fix Worker used the supplied address for Hyperliquid requests but the supplied wallet ID for persistence;
3. `createEventFingerprint()` includes that supplied address;
4. each listed row was inserted inside the matching incident job's observed execution interval and carries the incident-derived fingerprint;
5. the 13 portfolio wallets exclude the sole correctly paired wallet `cms3ab96ifgv3rv0iexiwudfo`; the raw-event allowlist intentionally retains the complete 42-event incident execution, including that wallet's one correctly addressed portfolio event.

BullMQ job payloads have expired, so the supplied address literal can no longer be independently recovered from Redis. `sync_jobs` retains the execution identity but not the address payload. This does not broaden the allowlist: every proposed mutable row is fixed by primary key, fingerprint, wallet ID, source ID, timestamp, and source-job identity captured in the JSON.

All 161 proposed portfolio deletions have `existedBeforeIncident=false`: their `created_at` falls within the matching job execution and they did not exist before that execution. The 42 raw events are also incident-created, but are retained as audit evidence.

## Why DELETE for the 161 portfolio rows

`portfolio_snapshots` has no row validity/status field, so `INVALIDATE` is not currently representable without a new schema and consumer changes. `KEEP` would allow these rows to remain inputs to portfolio/NAV and future `performance-v3` calculations. Exact-row `DELETE` is therefore the only existing operation that removes them from financial input queries.

Deletion must use the JSON primary-key allowlist and additionally assert the recorded fingerprint, wallet ID, source ID, snapshot type, and timestamps. A time-window-only deletion is prohibited.

The 14 incident performance runs and their 115 Metrics, 171 Cycles, and 68 DailyNav rows are `KEEP`. They are already quarantined, remain explicit audit evidence, and must not be used as justification for cascading or broad source deletion.

## Why KEEP for the 42 raw events

`raw_events` has no inbound FK and is not read by the current normalization, Performance, Selection, or Behavior paths. Deleting it would remove the strongest payload/fingerprint audit evidence without improving current financial calculations. `INVALIDATE` is not representable in the current schema. The safer current action is `KEEP` all 42 rows, including the one correctly addressed incident event.

If a future raw-event replay consumer is introduced, it must gain an explicit quarantine/validity contract before these rows are eligible as input. Archive-then-delete would require a separately reviewed retention operation.

## FK and unique/upsert impact

Read-only catalog inspection found zero inbound foreign keys to either `portfolio_snapshots` or `raw_events`; exact deletion is physically legal and cannot create FK orphans.

Both tables have `(source_id, fingerprint)` unique identities. Deleting a row does not resurrect an older row automatically, but it permits a later canonical sync to insert a different fingerprint because the wallet address participates in fingerprint generation. No consumer resolves duplicates through this unique key; portfolio consumers query by wallet and `captured_at`.

`portfolio_snapshots` participates directly in latest/range semantics:

- all 143 history points currently have no same-wallet/type/time canonical replacement;
- 13 of the 143 history points are the current maximum `captured_at` for their wallet/type;
- all 13 portfolio envelopes and all 5 clearinghouse snapshots are currently latest for their wallet/type;
- deleting them will intentionally expose an older, stale snapshot until canonical replay writes a successor.

Consequently, Stage 3B must keep Selection, performance recomputation, and Behavior blocked, and must report this temporary stale-latest condition. It must not present the exposed predecessor as freshly synchronized data.

## Additional objectively linked state

No incident-window rows exist in `perp_position_events`, `spot_balance_snapshots`, or `order_history`; their proposed mutable allowlists are empty.

Five pre-existing `account-snapshot/timestamp` cursor rows and the corresponding five `wallet_addresses.last_sync_at` fields were updated during the wrong-address current-state jobs:

| Cursor ID | Wallet ID | Incident `last_successful_at` |
| --- | --- | --- |
| `cms3ab0sbf70irv0iansqfpzt` | `cms39x9ni000umw0iw2zkbf1e` | `2026-08-24T13:08:32.377Z` |
| `cms3alb1do1m7rv0iffyu4isz` | `cms3a3y460035mw0ij745hy53` | `2026-08-24T13:08:32.647Z` |
| `cms0kgz5j02lku19c58mklf4z` | `cms0kgxt00002u19cp0uln7mz` | `2026-08-24T13:08:32.980Z` |
| `cms3ay6sexfqwrv0i78h370rr` | `cms3a522z0044mw0ib2uingps` | `2026-08-24T13:08:33.340Z` |
| `cms3u5ejk000vnx0is8le5dgl` | `cms3ab95rfgulrv0ierrcpfz9` | `2026-08-24T13:08:33.708Z` |

These rows pre-date the incident and their previous values are not recoverable from the current tables. They therefore cannot be selectively deleted or restored with objective proof. Recommendation: `KEEP`; let the later approved canonical current-state replay update them through the normal sync contract. Direct cursor or `last_sync_at` mutation is not part of Stage 3B.

The 57 DQ lifecycle changes remain outside this manifest. They must be re-derived by the official DQ audit in the later approved stage, not updated directly.

## Expected Stage 3B row counts

Current counts at Stage 3A:

- `portfolio_snapshots`: 1,511,569;
- `raw_events`: 13,512,217.

After the proposed 161 exact portfolio deletions and 42 raw-event `KEEP` decisions:

- `portfolio_snapshots`: **1,511,408**;
- `raw_events`: **13,512,217**;
- incident performance runs: 14, still `SUCCEEDED / QUARANTINED / revision 1`;
- performance trust transitions: 14, unchanged;
- incident child Metrics/Cycles/DailyNav: 115/171/68, unchanged.

## Stage 3B gate

Stage 3B is **READY FOR SEPARATE OWNER REVIEW**, not approved by this document. Before any write it must re-read the JSON allowlist and fail closed unless all 203 rows still match their recorded identities, all 14 performance runs remain quarantined, and Selection/Behavior references remain zero.

The only recommended Stage 3B mutation is exact deletion of the 161 `portfolio_snapshots` rows in a bounded transaction with asserted affected-row count. The 42 raw events, sync jobs, quarantined runs and children, five cursors, five wallet lifecycle fields, and DQ rows remain untouched. Any mismatch changes the verdict to `BLOCKED`.
