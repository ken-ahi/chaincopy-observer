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

Operational verification results will be appended after execution. Root-cause
evidence above is read-only and does not imply replay has occurred.
