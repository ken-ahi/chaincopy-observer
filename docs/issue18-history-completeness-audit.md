# Issue #18: Hyperliquid history completeness audit

Date: 2026-08-23  
Code baseline: `ce3d688d366a8bb3fda53212706e8d876362af1a`  
Scope: 14 watched Hyperliquid wallets; read-only production-like data inspection. No recovery job was enqueued and no real-data row was changed.

## Verdict

The blockers are a mixture of real source boundaries and three concrete lifecycle/normalization defects. The code defects are fixed by Issue #18, but real-data recovery still requires Owner approval.

- 10 wallets are `GAP_DETECTED` because 441 historical `HYPERLIQUID_WEBSOCKET_GAP` issues remain OPEN even though all current cursors are `SUCCEEDED`.
- 57 `HYPERLIQUID_INCOMPLETE_INITIAL_SYNC` issues are stale: all four required cursors (`fills`, `funding`, `ledger`, `account-snapshot`) now succeeded, but the audit path never resolved old fingerprints.
- 11 `HYPERLIQUID_PARTIAL_API_FAILURE` issues are stale candidates: the implementation recorded each failed snapshot part but did not resolve the same part after a later successful call.
- The portfolio adapter validated and archived `perpAllTime.accountValueHistory` but did not normalize it into NAV inputs. Existing raw responses contain 45--123 recoverable perp NAV points per wallet (1,011 total).
- Three `HYPERLIQUID_FILL_HISTORY_LIMIT` issues are real source limitations. Hyperliquid documents that `userFillsByTime` exposes only the 10,000 most recent fills; time-window partitioning cannot retrieve older fills.
- Four wallets currently reported as `PARTIAL` are blocked by a missing trusted initial position and/or NAV boundary, not by an OPEN issue matched by the completeness function.

`performance-v3` and `wallet-selection-v1` remain unchanged and fail closed.

## Code-path findings

`assessHistoryCompleteness()` applies this order:

1. a `GAP_DETECTED` cursor or OPEN issue containing `GAP` => `GAP_DETECTED`;
2. OPEN history/pagination/truncation issue => `TRUNCATED`;
3. no fills or fewer than two NAV snapshots => `INSUFFICIENT_HISTORY`;
4. failed cursor or OPEN issue containing `INCOMPLETE`/`PARTIAL` => `PARTIAL`;
5. first fill for any coin has non-zero `startPosition` => `PARTIAL`;
6. first NAV date is later than `calculationFrom` => `PARTIAL`;
7. otherwise => `COMPLETE`.

Current cursors do not by themselves prove that an old WebSocket interval was recovered. The existing recovery job calls bounded HTTP fill, funding, and ledger endpoints. Before this fix it then required the mutable connection cursor still to point to that old disconnect. A newer successful connection therefore made historical recovery impossible. The revised contract leaves a newer cursor untouched, resolves only the exact gap fingerprint after all three bounded requests succeed, and refuses resolution when any request reports a history/pagination limit.

## Wallet-by-wallet classification

All latest runs below are `performance-v3 / SUCCEEDED`; all current required cursors are `SUCCEEDED`; failed and gap cursor counts are zero.

| WalletAddressId             | Address                                      | Latest sync (UTC) | Completeness | Concrete blockers and classification                                                                                                                                                                              | Current recovery action                                                                                                                               |
| --------------------------- | -------------------------------------------- | ----------------: | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cms3ab96ifgv3rv0iexiwudfo` | `0x02aaf19ae62d3194858c635224a2d9ab2a14d519` |          14:11:34 | GAP_DETECTED | 45 gaps: RECOVERABLE_WITH_CODE_CHANGE; 9 incomplete-sync: STALE_DQ_LIFECYCLE_BUG; perp NAV starts 2025-11-12 vs calculation 2025-11-10: SOURCE_LIMITATION                                                         | bounded gap recovery; audit re-evaluation; normalize 74 stored-source NAV points (still no earlier NAV proof)                                         |
| `cmsbxiv9a1zdhlr0ioe0i93id` | `0x0512aabfd51746c64202b3bd73a61af3a15c35e9` |          14:05:43 | PARTIAL      | first fills for 2/7 coins are non-flat and perp NAV starts 2025-12-17 vs calculation 2025-12-14: SOURCE_LIMITATION; WebSocket user-limit issue is not a completeness trigger                                      | normalize 57 NAV points; no action can prove the missing initial position/NAV boundary today                                                          |
| `cms39x9ni000umw0iw2zkbf1e` | `0x06438b0d1bb6f8aa4a455a4f2c1b1e744d53c760` |          14:11:34 | GAP_DETECTED | 44 gaps: RECOVERABLE_WITH_CODE_CHANGE; 3 incomplete and 4 partial failures: STALE_DQ_LIFECYCLE_BUG; fill limit and 2/2 non-flat first positions: SOURCE_LIMITATION                                                | recover gaps; audit and successful-part re-evaluation; normalize 64 NAV points; remains untrusted before first fill 2026-07-21                        |
| `cms4vuja6cppcp70i7m4ypf8n` | `0x1df3035fbfdf44d714ed64e4be52e049bfcb578d` |          14:11:34 | GAP_DETECTED | 39 gaps: RECOVERABLE_WITH_CODE_CHANGE; 5 incomplete: STALE_DQ_LIFECYCLE_BUG; NAV starts 2025-06-04 vs calculation 2025-06-02: SOURCE_LIMITATION                                                                   | recover gaps; audit; normalize 91 NAV points                                                                                                          |
| `cms3a3y460035mw0ij745hy53` | `0x72d73fea74d7ff40c3e5a70e17f5b1aaf47dfc26` |          14:11:34 | GAP_DETECTED | 44 gaps: RECOVERABLE_WITH_CODE_CHANGE; 5 incomplete and 2 partial failures: STALE_DQ_LIFECYCLE_BUG; fill limit, non-flat initial position, and NAV starts 2025-04-30 vs calculation 2025-04-24: SOURCE_LIMITATION | recover/re-evaluate stale issues; normalize 73 NAV points; remains source-limited before first fill 2026-07-21                                        |
| `cms3a8cf1csmqrv0itq1be3e9` | `0x815d735c7e52c9ccb5fd14cb52f42fd2f862b58d` |          14:11:35 | GAP_DETECTED | 44 gaps: RECOVERABLE_WITH_CODE_CHANGE; 4 incomplete: STALE_DQ_LIFECYCLE_BUG; NAV starts 2025-09-03 vs calculation 2025-08-29: SOURCE_LIMITATION                                                                   | recover gaps; audit; normalize 66 NAV points                                                                                                          |
| `cms0kgxt00002u19cp0uln7mz` | `0x831ea8a4a4d7ea2657ba48f8c074d69bdaece05c` |          14:11:34 | GAP_DETECTED | 50 gaps: RECOVERABLE_WITH_CODE_CHANGE; 4 incomplete and 2 partial failures: STALE_DQ_LIFECYCLE_BUG; first positions are flat and perp NAV begins on calculation date                                              | recover gaps; re-evaluate stale issues; normalize 53 NAV points. This is the only wallet presently capable of reaching COMPLETE on available evidence |
| `cmsbx4ocf0ldmlr0iw7xnjvat` | `0x8d1548a936241928cef288a1c377919a5d511f7a` |          14:04:41 | PARTIAL      | first fills for 3/49 coins are non-flat: SOURCE_LIMITATION; NAV begins on calculation date; WebSocket user-limit issue is not a completeness trigger                                                              | normalize 56 NAV points; no current source contract proves initial position                                                                           |
| `cmsbx4odr0ldxlr0i7hnntap9` | `0x9023a51e17d4fa4125d30d6b0a149faa31dff9bc` |          14:04:47 | PARTIAL      | perp NAV starts 2024-12-11 vs calculation 2024-12-06: SOURCE_LIMITATION; first positions are flat                                                                                                                 | normalize 123 NAV points; no earlier NAV is exposed by the stored official response                                                                   |
| `cms3a8vzgd9s7rv0ii5gqaekv` | `0xa19ed0ae46e89461e56063f1ed268a0dc225745f` |          14:11:35 | GAP_DETECTED | 46 gaps: RECOVERABLE_WITH_CODE_CHANGE; 4 incomplete: STALE_DQ_LIFECYCLE_BUG; NAV starts 2025-09-10 vs calculation 2025-09-07: SOURCE_LIMITATION                                                                   | recover gaps; audit; normalize 61 NAV points                                                                                                          |
| `cms4ouz5bfb9ar40ik911rd42` | `0xdc59c9045fd5a44b2a3f572b28c2dd652b80c9bc` |          14:11:34 | GAP_DETECTED | 37 gaps: RECOVERABLE_WITH_CODE_CHANGE; 8 incomplete: STALE_DQ_LIFECYCLE_BUG; NAV starts 2025-03-26 vs calculation 2025-03-20: SOURCE_LIMITATION                                                                   | recover gaps; audit; normalize 89 NAV points                                                                                                          |
| `cmsbx4of40leelr0is8g0kp3h` | `0xdcc133518fe21500b205eb90a788c5fe01bf6f95` |          14:05:35 | PARTIAL      | perp NAV starts 2025-11-05 vs calculation 2025-11-04: SOURCE_LIMITATION; first positions are flat                                                                                                                 | normalize 78 NAV points; no earlier NAV is exposed by the stored official response                                                                    |
| `cms3a522z0044mw0ib2uingps` | `0xf5d81a135f756ca16544e53c20fc20643ec3ad53` |          14:11:35 | GAP_DETECTED | 47 gaps: RECOVERABLE_WITH_CODE_CHANGE; 3 incomplete and 2 partial failures: STALE_DQ_LIFECYCLE_BUG; fill limit and 19/20 non-flat first positions: SOURCE_LIMITATION                                              | recover/re-evaluate stale issues; normalize 45 NAV points; remains source-limited before first fill 2026-07-27                                        |
| `cms3ab95rfgulrv0ierrcpfz9` | `0xf6042de98e4e8c50cee1cdc36fea6ad640e21615` |          14:11:35 | GAP_DETECTED | 45 gaps: RECOVERABLE_WITH_CODE_CHANGE; 12 incomplete and 1 partial failure: STALE_DQ_LIFECYCLE_BUG; 30/43 non-flat first positions and NAV starts 2025-11-19 vs calculation 2025-11-16: SOURCE_LIMITATION         | recover/re-evaluate stale issues; normalize 81 NAV points; initial boundary remains unproven                                                          |

Open `HYPERLIQUID_WEBSOCKET_ERROR` records are retained for audit but do not contain `GAP`, `INCOMPLETE`, or `PARTIAL`, so they do not determine performance completeness.

## Fill-history-limit determination

Affected wallets and maximum trustworthy local boundaries:

| Address            | Earliest normalized fill (UTC) | Finding                                                                             |
| ------------------ | -----------------------------: | ----------------------------------------------------------------------------------- |
| `0x06438b...c760`  |        2026-07-21 13:52:34.735 | 60,141 locally accumulated fills, but history before this boundary is not proven    |
| `0x72d73f...dfc26` |        2026-07-21 18:14:22.232 | 66,012 locally accumulated fills, but history before this boundary is not proven    |
| `0xf5d81a...ad53`  |        2026-07-27 11:08:25.539 | 1,210,917 locally accumulated fills, but history before this boundary is not proven |

The limit is an upstream retention/API contract, not merely this client's loop bound. Official `userFillsByTime` documentation states that only the 10,000 most recent fills are available. The public monthly archive/node-fill stream is not an existing wallet-normalized recovery contract and cannot be substituted without a separate design and provenance review.

## Owner-approval recovery plan (not executed)

Prerequisite: merge and deploy the Issue #18 Worker image with exact commit provenance. Keep concurrency at 1 and apply the Phase 4.3.1 queue/backpressure limits.

1. Run one official portfolio snapshot job per wallet (14 jobs, 14 portfolio API calls). Expected normalized NAV upper estimate from the latest stored responses: 1,011 rows plus 14 raw audit snapshots; inserts are idempotent by fingerprint.
2. Run one official account/data-quality sequence for wallets with stale partial failures (`06438b`, `72d73f`, `831ea8`, `f5d81a`, `f6042d`): 5 account-snapshot jobs, 25 part calls, followed by 14 audit jobs. A part issue resolves only after that exact part succeeds; incomplete-sync issues resolve only when all four required cursors are currently successful.
3. For each of the 441 OPEN gap fingerprints, derive a bounded end from the first stored WebSocket event after `details.disconnectedAt`, present the generated manifest for review, then enqueue one gap-recovery job. Expected minimum is 441 jobs and 1,323 HTTP endpoint calls (fills/funding/ledger); pagination can increase calls. Never merge intervals for DQ resolution unless every enclosed fingerprint is retained and individually resolved.
4. Stop immediately on any history/pagination limit, API error storm, queue backlog above the configured cap, Worker heap growth, PostgreSQL saturation, or Redis memory pressure. The revised job leaves the issue OPEN when coverage is not proven and is retry-safe through normalized-row fingerprints and exact DQ fingerprints.
5. Recompute `performance-v3` only after all approved jobs settle, then run `wallet-selection-v1` exactly once. Do not run Behavior Stage 4 or backfill in this issue.

Before approval, record per-gap start/end, expected page count from the interval, current queue counts, DB size/free disk, and Worker/PostgreSQL/Redis baseline. The exact manifest is intentionally not generated/enqueued by this code PR because that is an operational recovery write boundary.

## Stage 4 readiness

Issue #15 Stage 4 remains **BLOCKED** now. No effective selected wallet exists, and no real-data recovery was authorized. After the code is merged and the approved recovery completes, `0x831ea8...e05c` is the only wallet for which current stored evidence satisfies all non-DQ boundary checks; Selection still decides independently using unchanged policy inputs. The other 13 wallets retain at least one source-limited initial position or NAV boundary (and three retain a hard fill-history limit), so they must not be promoted by resolving stale DQ alone.
