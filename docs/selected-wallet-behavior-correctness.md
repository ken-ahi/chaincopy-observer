# Selected-wallet Behavior correctness

## Scope and read-only evidence (2026-09-27)

Base: main `79af442cd3abc1fc5ee901deee21b167521635d5` (PR #33).
Only selected wallet `0x34112cf6672cbad0f44b5a77857099417dc686af`, ID
`cmuh1wwf4001wk70ynvgjo7a3`, source `cms0i0jq20000mr0icnf1kvj7`.
Audit SQL used a REPEATABLE READ, READ ONLY transaction. All times are UTC.
Every coin's first saved fill has explicit source `startPosition=0`.

| Coin   | Saved fills before | Behavior events before | Last fill               |
| ------ | -----------------: | ---------------------: | ----------------------- |
| ASTER  |                 16 |                     16 | 2025-09-25 22:02:18.398 |
| BTC    |                777 |                    688 | 2026-09-24 13:21:27.107 |
| ETH    |                384 |                    385 | 2025-10-02 10:30:22.391 |
| HYPE   |                  2 |                      2 | 2026-03-17 21:07:42.934 |
| SOL    |                670 |                    670 | 2026-04-17 17:27:09.142 |
| XPL    |                127 |                    127 | 2025-10-09 19:56:28.836 |
| xyz:CL |                 33 |                      0 | 2026-04-06 22:43:58.553 |

## BTC: proven source-ingestion identity defect

Last persisted group: `2026-08-03T00:38:33.720Z`, SELL `0.02552`,
start `0.02552`, price `63354`, after `0`; source row
`cmuh27l66064oo30ydl2e2s4j`, tid `702683842235325`. Cursor correctly records FLAT.

Failing group: `2026-08-04T19:16:40.471Z`, exactly one saved fill,
row `cmuh27l66064qo30y2v8ygdg7`, tid `1006758369528899`, SELL `0.01601`,
start `0.01601`, price `64293`, after `0`. Expected start `0`, actual `0.01601`.
Transition normalization correctly fails closed. This is not same-timestamp
ordering or replay duplication: no duplicate `(coin, sourceTradeId)` exists for this wallet.

Canonical HTTP raw page `cmuh27l0x04nbo30yt6p4jf8x` (`userFillsByTime:page`,
received `2026-09-25T14:31:58.257Z`) contains the missing opening:

| Epoch ms      | Side | Quantity | startPosition | Price   | tid             | oid          |
| ------------- | ---- | -------- | ------------- | ------- | --------------- | ------------ |
| 1785858599780 | BUY  | 0.01601  | 0.0           | 64119.0 | 908928218771332 | 509958558519 |
| 1786218079285 | BUY  | 0.02478  | 0.0           | 65001.0 | 854111491586039 | 512903710437 |

The second row is another missing BTC opening later in the same raw page.
Their hashes are respectively
`0xd475fcf931aefb69d5ef044170510e02043c00decca21a3b783ea84bf0a2d554` and
`0x1d30f98548a1c1001eaa0441bd1ddf020157006ae3a4dfd2c0f9a4d807a59aea`.
Raw BTC has 779 distinct tids; normalized BTC has 777.

The legacy external ID `1785858599780:BTC:908928218771332` is already owned by
row `cmseu3mtb0wsjlr0ireo176ti`, another wallet `cms3a522z0044mw0ib2uingps`:
SELL `0.01601`, start `-3.70177`. The source-wide unique
`(sourceId, externalTradeId)` and `saveFills()`'s `skipDuplicates` silently
drop the second participant. Fingerprint includes wallet identity; external ID did not.
The source evidence exists: this is an ingestion implementation defect, not proof
that Hyperliquid lacks history or that Behavior should skip a discontinuity.

Fix: new wallet Fill external IDs are `canonicalAddress:time:coin:tid`.
Keep the legacy fingerprint payload (`externalTradeId=time:coin:tid`, hash, oid,
within the existing wallet-scoped envelope) unchanged. Old rows are deduplicated
by fingerprint, preserving IDs, FKs and Behavior identity. No UPDATE, migration,
index change, or old-row rewrite. Discovery market trades remain global matches.

Both missing fills are after the BTC cursor. A bounded formal fill sync followed
by normal incremental Behavior needs no `rebuildFrom`, event deletion, cursor
rewind, fabricated opening, or late-FLAT skip.

## xyz:CL: diagnostic defect, quote provenance still blocks

First fill `cmuh27l5k05jjo30y4bi4j6k2`, tid `436169961373720`, at
`2026-03-02T11:14:24.461Z`: BUY `1.499`, start `0`, price `72.246`.
The canonical raw page agrees (`dir=Open Long`). Next fill at
`16:48:56.225Z` sells `1.499` from `1.499` to FLAT. Later FLAT openings exist,
including `2026-03-03T23:13:11.798Z`. History does not begin mid-position.
Trusted Performance run `cmujbpj6527jdnq01t6zuxi9u` has 11 closed xyz:CL cycles
starting at the first opening: existing closed-cycle logic handles that boundary.

Initial-boundary resolution discarded all failed normalization results and
returned `MISSING_BOUNDARY`. Actual failure is `UNSUPPORTED_QUOTE`: custom-market
quote provenance is not available to Behavior. The raw feeToken USDC is not
proof of notional quote. Keep the custom-market gate; do not fabricate USD notional.

Fix: canonicalize initial positions, require explicit source FLAT, then preserve
the normalizer's precise error. Unknown nonzero prefix stays `MISSING_BOUNDARY`;
invalid Decimal and ambiguous chains keep their own reasons. Never skip bad
groups to later FLAT. No new trusted-segment restart algorithm is introduced.

Legacy misclassified DQ remains audit evidence: normal retry creates the correct
`UNSUPPORTED_QUOTE` issue but cannot prove the whole group successful. Do not
manually resolve/rewrite old `MISSING_BOUNDARY`. Successful group persistence
remains the existing automatic DQ-resolution mechanism.

## Latest activity semantics

Old ranking mapped `performanceCalculationTo` to `latestActivityAt`:
`2026-09-27T04:26:55.552Z`, an evaluation boundary, not wallet activity.
Real latest saved fill: `2026-09-24T13:21:27.107Z`.

For eligible trusted ranking entries, return latest observed canonical Hyperliquid
`NormalizedTrade.occurredAt`, scoped to exact wallet ID/address/source. One indexed
descending lookup per eligible wallet, no history load. Missing fills return null,
never calculation time, sync time or now. This does not promise complete history
or latest economic activity across all sources. It is independent of the
Performance window and is not a ranking/freshness gate.
UI: `最終約定（取得済み）`; null displays `-`.

## Version and safety

`behavior-v1` event identity, transition table, Decimal arithmetic, causal ordering
and notional gate do not change. Initial-boundary correction restores existing
§5.3, not a new recovery rule. Existing valid events are not rebuilt.
No Performance/Selection formula or threshold, schema or migration change.
No paid source, Discovery expansion, manual INCLUDE, destructive DB/Redis
operation, manual DQ/cursor edit, or quarantine change.

## Bounded verification

### Execution and provenance

- Implementation commit: `4f73756fca8ef560145276a44fc7f6461ee67b50`.
- Image built from that exact `git archive`, not the dirty working directory:
  `chaincopy-worker:behavior-4f73756`, digest
  `sha256:eb3f24b3a7d6022308e4718beaa5473fad1ece77f5d6492cf02dd11b2b528ce2`.
  OCI revision label matches the implementation commit. Subsequent commit is documentation only.
- Temporary bounded runner SHA-256 at execution:
  `348689dacda3f5988513f0b0380fe99e7935165b8c81b9fcdd8cf01716fd23ad`.
  Runner was mounted read-only and removed from the worktree afterward.
- Preflight: exact current selected wallet, source/address, event count, cursor,
  idle sync/Behavior queues and free API interval evidence checked before mutation.
- Normal `HyperliquidJobProcessor` / `HyperliquidSyncService.syncFills` invoked once,
  new job ID `selected-behavior-fill-d9b5170c-2520-441f-807b-6d7ee239bfe1`.
  Interval `2026-08-04T15:49:59.780Z`–`2026-08-08T19:41:19.285Z`.
  Free official Info API: 9 fills fetched, coverage proven, no history cap, 2 inserted.
  New rows: `cmujroo6r0009jw01gtxlndch`, `cmujroo6r000hjw017tfwkxyn`.
- Normal `BehaviorNormalizationService.processWalletCoin` invoked sequentially for
  the selected wallet's 7 coins. No `rebuildFrom`; no queue consumer/scheduler
  started, no extra wallet, no Performance or Selection recalculation.
- Redis changes were only the normal sync processor's owned ephemeral lock
  acquisition/renewal/release; no manual key/queue deletion or backlog consumption.
  Verification container limited to 1 CPU / 768 MiB and exited afterward.

### Results

| Check                       | Before                                    | After                                       |
| --------------------------- | ----------------------------------------- | ------------------------------------------- |
| Saved selected-wallet fills | 2,009                                     | 2,011 (BTC 777 → 779)                       |
| Total Behavior events       | 1,888                                     | 1,979                                       |
| BTC events / result         | 688 / blocked                             | 779 / completed, 91 added                   |
| BTC cursor                  | 2026-08-03 00:38:33.720, FLAT             | 2026-09-24 13:21:27.107, FLAT               |
| xyz:CL                      | 0 events / misclassified missing boundary | 0 / UNSUPPORTED_QUOTE, blocked              |
| Other 5 coins               | completed                                 | completed, 0 new events                     |
| OPEN Behavior DQ            | 2                                         | 2, both xyz:CL                              |
| Selected-wallet source DQ   | 0                                         | 0                                           |
| Quarantined runs            | 14                                        | 14, trust state/revision unchanged          |
| latestActivityAt            | 2026-09-27 04:26:55.552 (wrong semantic)  | 2026-09-24 13:21:27.107 (actual saved fill) |

BTC issue `cmujbqpi82c31nq01w9uvy3j4` was automatically RESOLVED by successful
group persistence at `2026-09-27T12:00:38.482Z`, not by manual DQ mutation.
xyz legacy `MISSING_BOUNDARY` issue `cmujbqvnn2elbnq01tjgsjrh5` remains OPEN as
misclassified historical evidence. Current correct `UNSUPPORTED_QUOTE` issue is
`cmujrop0f008ojw01vqlf59d3`. These are two records for one blocked coin, not two
independent history defects. No quote provenance was invented to resolve them.

All 1,888 previously persisted events and all 2,009 prior selected-wallet fills
are byte-equivalent under the same ordered JSON serialization (including IDs,
source snapshots, timestamps and run references). SHA-256 before = after:

- Existing events: `313f0e93f04c2190054756e278b21f4ffcd05a3dd9b3192e3e8eb141b229b2b1`.
- Existing fills: `209c9e211ca9d967beb3d3ddde6080168485be1de16e54145e5f5a61c6732cf4`.

Other participant rows, source DQ, quarantine state and Selection settings
compared equal before/after. Ranking still contains only the same SELECTED
wallet at rank 1, current Selection Run `cmujbqjbu2af4nq01zg56l0vc`, trusted
Performance Run `cmujbpj6527jdnq01t6zuxi9u`, 57 closed cycles. No policy change.

The operational runner completed all processing, then failed an over-strict
postcheck requiring the entire wallet row to remain unchanged. Inspection of
`completeCursor()` confirmed that normal successful sync updates `lastSyncAt`
(`04:24:54.176Z` → `12:00:38.293Z`) and `updatedAt`; identity/watch/ownership did
not change. This was a validation assumption error, not a manual timestamp edit.
No replay was repeated. A separate read-only snapshot/postcheck plus the normal
ranking read completed all remaining checks successfully. Sync cursor timestamps
were not manually modified or rewound.

### Queue/resource state

Every queue count and existing active job identity was identical before/after:

| Queue                            | Prioritized |                   Active | Completed | Failed |
| -------------------------------- | ----------: | -----------------------: | --------: | -----: |
| hyperliquid-sync                 |           0 |                        0 |       318 |    444 |
| address-performance              |           1 |                        0 |        66 |     14 |
| behavior-normalization           |           0 |                        0 |        24 |      0 |
| hyperliquid-discovery            |           1 |                        0 |        17 |    609 |
| hyperliquid-candidate-enrichment |       8,427 | 1 pre-existing stale job |        20 |      5 |

Waiting/delayed/paused/waiting-children counts were 0 throughout. No backlog drain
or stale-job recovery attempted. Sampled idle real Postgres: 0% CPU / 49.25 MiB;
Redis: 0.13% / 44.57 MiB (not claimed as workload peak). No persistent Worker was
started. The bounded run finished in seconds, without retries or continuation jobs.

### Validation / remaining work

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`: PASS (11/11 typecheck).
- `pnpm test`: 71 files / 671 tests PASS on explicitly isolated PostgreSQL/Redis
  containers, ports 55433/56380. No real DB/Redis test fixtures.
- `pnpm build`: 11/11 PASS. `pnpm test:e2e`: 22/22 PASS on isolated services.
  Initial E2E was launched before the concurrent build completed and failed on
  missing `.next` build; rerun after build passed. No test or validation weakened.
- `pnpm audit --audit-level high`: PASS, high+ 0; 4 unrelated moderate findings.
- `git diff --check`: PASS. PR #34 initial implementation CI passed; final
  documentation commit CI must pass before Owner-authorized merge.
- xyz:CL remains intentionally partial: canonical custom-market quote provenance
  is the next blocker. Do not process more candidates or relax gates to bypass it.
- Source-wide collision may have affected other wallets, but this task neither
  recovers nor audits their full histories. Future recovery needs a separately
  bounded scope; no global replay is implied by this fix.
