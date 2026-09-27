# Hyperliquid xyz:CL — canonical quote provenance

Date: 2026-09-27. Contract: `hyperliquid-xyz-cl-usd-v1` (ADR-041).
Scope: selected wallet `0x34112cf6672cbad0f44b5a77857099417dc686af`,
`xyz:CL` only. No Selection, financial formula, or Behavior identity change.

## Read-only findings

The wallet has 33 saved normalized `xyz:CL` fills from
`2026-03-02T11:14:24.461Z` through `2026-04-06T22:43:58.553Z`.
All explicitly name `USDC` as `feeToken`. Their canonical `userFillsByTime:page`
RawEvents contain `coin`, `sz`, `px`, `startPosition`, `closedPnl`, `feeToken`,
`tid`, `oid`, `hash`, and millisecond `time`, but no market definition.
These fields alone do **not** prove quote currency; in particular, neither the
`CL` suffix nor a fee token alone is sufficient.

The first source fill is `cmuh27l5k05jjo30y4bi4j6k2`, tid `436169961373720`,
BUY `1.499`, price `72.246`, startPosition `0.0`. The first close is SELL
`1.499` at `70.499`, reported closedPnl `-2.618753` USDC. This is corroborating
source evidence, not an AI-computed metric or the authority for denomination.
The first RawEvent is `cmuh27l0x04nbo30yt6p4jf8x`.

No saved metadata of the queried standard Info response types was found.
The default-DEX saved clearinghouse response is not evidence for the XYZ DEX.
The free official `clearinghouseState` query with `dex: "xyz"` returned no open
positions; it supplies no historical position-value snapshot.

## Free official evidence

All four responses below came from `POST https://api.hyperliquid.xyz/info`,
HTTP 200. Times are UTC. SHA-256 covers the exact response text, not reserialized JSON.

| Request                                     | Observed at              | Canonical evidence                                                                                                                   | Response SHA-256                                                   |
| ------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `{"type":"perpDexs"}`                       | 2026-09-27T13:15:17.391Z | array index 1: name `xyz`, fullName `XYZ`, deployer `0x88806a71d74ad0a510b350545c9ae490912f0888`                                     | `4c641709ef032ee089509826462aef5c7793d48ba45d7681ca3d9f4fb3577807` |
| `{"type":"meta","dex":"xyz"}`               | 2026-09-27T13:15:17.501Z | `collateralToken: 0`; universe index 29 exact name `xyz:CL`, `szDecimals: 3`                                                         | `3e6d5ee25d955a6bcedfd8dfb0d873aee6d8099b4e36a78bf3ea01735dbb3c74` |
| `{"type":"spotMeta"}`                       | 2026-09-27T13:15:17.602Z | token index 0, `name: USDC`, `isCanonical: true`, tokenId `0x6d1e7cde53ba9467b783cb7c530ce054`                                       | `a84545ef4addc99185c5124f216902af6375ea43e8c64637bb546e3738863fc5` |
| `{"type":"perpAnnotation","coin":"xyz:CL"}` | 2026-09-27T13:15:17.644Z | category commodities, displayName WTIOIL, description explicitly identifies the USD price of one barrel of WTI Light Sweet Crude Oil | `0de3259ca0e5339ff223296c72351e1d3ba1b0f375e73bad6562f04f150a2254` |

The official [perpetual Info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)
provides DEX metadata and annotations; [spot metadata](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot)
identifies collateral by index and token ID. The namespace is a builder-deployed
perpetual DEX, not a quote prefix. The canonical asset ID is `110029`, using the
official [asset-ID mapping](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids).

[HIP-3](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals)
defines DEX collateral as a quote asset, with independent margining. Its documented
collateral migration remains a future upgrade. The [deployer contract](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-3-deployer-actions)
sets collateral in the initial DEX schema; notional is absolute native position
size times price, and account values/PnL use the venue collateral. There is no
additional exchange-futures lot multiplier. We do not multiply this market by
the size of a similarly named external futures contract.

## Formal resolution contract

- Identity: official mainnet endpoint + DEX index/name/deployer + exact universe
  index/name. Registry support is **only** `xyz:CL`; not all `xyz:*` or `*:CL`.
- Base: native perp quantity unit; current official annotation identifies WTI
  crude oil, one barrel. It is not a fungible spot base-token ID.
- Price reference: USD per native unit (currently one barrel). Settlement,
  margin, closedPnl and fee asset: canonical USDC. Source `feeToken` must agree.
- Valuation: USD-compatible under the existing Phase 5 USDC convention, not an
  assertion of a live USD/USDC FX conversion. Multiplier is exactly `1`.
- Event notional: **source Fill price** × absolute leg quantity; never a new
  mark/oracle price. No financial use of JavaScript `number`.
- Every nonempty custom normalization page obtains fresh official metadata
  using the existing HTTP client's timeout/retry/rate limit. The reviewed
  fields and the annotation must match exactly; missing, duplicate, conflicting,
  changed, mirror/testnet or unavailable evidence stays `UNSUPPORTED_QUOTE`.
  A conflicting per-fill collateral token is `SOURCE_INCONSISTENT`.
- Exact description comparison is a conservative change detector against a
  reviewed definition, **not** a search for the word USD. No symbol guessing.

### Temporal scope and limitations

The responses are observations at normalization time, **not** backdated metadata
or a historical oracle archive. USD-compatible native notional for the saved
fills follows from the DEX's registration-time collateral and HyperCore's native
size × price contract, corroborated by each saved fill's explicit USDC fee asset.
The current annotation explains the current underlying; it does not prove that
mutable descriptions were byte-identical in March. HIP-3 can halt/resume and
recycle an asset. This implementation does not infer continuous underlying
exposure across such a change, manufacture history, or convert historical PnL.
Existing position-continuity/FLAT gates remain mandatory. If collateral migration
becomes supported, or conflicting denomination/unit evidence appears, this
reviewed contract must be re-audited before admitting that new definition.

## Persistence, retention and identity

No schema/migration is needed. The physical schema currently has no event quote
columns. Instead, keep an append-only evidence envelope in existing RawEvent:

- `eventType = behavior-market-provenance-v1`, `transport = HTTP`;
- `externalEventId = behavior-market-provenance-v1:<normalizationRunId>`;
- canonical source/wallet IDs, `eventTime = null` (not a wallet activity event);
- payload: normalization Run ID, complete reviewed contract, each request,
  endpoint, observedAt, exact raw response text and its SHA-256;
- evidence fingerprint: deterministic contract + request/response hashes,
  excluding observation time; the Run input fingerprint includes this hash;
- write and verify evidence before any successful event group. A persistence
  error stops processing. Retry uses unique keys and never overwrites evidence.

Event → normalization Run → unique source/external-ID RawEvent is the durable
trace. Normal raw HTTP retention must exclude this evidence type in both count
and delete candidate queries. No cleanup is executed by this task. Existing
Behavior Wallet/Run restrictive FKs prevent silently deleting their wallet and
cascading its evidence. Explicit maintenance must preserve evidence while its
Run/events remain audit records; there is no new automatic pruning policy.

`behavior-v1`, fingerprint inputs (Fill ID/version/ordinal), existing event rows,
Selection/Performance versions, thresholds, latestActivity and original Fill
data remain unchanged. Metadata changes may distinguish executions, **never**
event identity. Empty cursor pages are normal no-ops, with no new metadata fetch.

## DQ and bounded verification contract

Use the selected wallet's normal `processWalletCoin` for `xyz:CL` only, without
`rebuildFrom`, sync, control jobs or queue consumers. Standard successful-group
persistence resolves OPEN issues for that exact wallet/coin/timestamp. Thus it
may naturally resolve both current UNSUPPORTED_QUOTE and the legacy misclassified
MISSING_BOUNDARY at the same first group. Their rows/evidence remain preserved;
no manual lifecycle edit or special-case resolver is introduced.

Before/after: hash every existing 1,979 event row, Selection state, wallets,
other Behavior state and queue counts/active IDs. Verify 33 Fill input identities,
proof durability, generated event endpoints, DQ lifecycle, and a second empty-page
no-op. Do not process BTC or any unrelated wallet/coin. Record actual results
below after isolated validation and the bounded execution.

## Operational result

Completed `2026-09-27T13:33:37.785Z` using code commit
`2f5a33c63a6ea30f4cdcb57efda2ea378a328af6` (base main / PR #34 merge
`b66e1f723dcc4d60c561013505b965562bcaed4b`). Worker image
`chaincopy-worker:quote-2f5a33c`, OCI revision equals that full code commit,
image digest `sha256:15451cbb7ec21477cea9952da1e110034fa9d034db3dee47740f9c8031aeb062`.
The build used `git archive <commit> | docker build --target worker ... -`.

A temporary, read-only-mounted runner first checked the exact scope and performed
a Decimal normalization preview; then called the existing `processWalletCoin`
once for this wallet/coin, without `rebuildFrom`. Container limits: 1 CPU / 1 GiB.
No consumer, scheduler, other wallet/coin job, sync, Performance or Selection
evaluation was started. A second cursor-resume call returned completed / 0 events.
The temporary runner was removed after verification, not added to the PR.

| Check                            | Before                   | After                            |
| -------------------------------- | ------------------------ | -------------------------------- |
| Source xyz:CL fills              | 33                       | 33, unchanged                    |
| xyz:CL Behavior events           | 0                        | 33                               |
| Total Behavior events            | 1,979                    | 2,012                            |
| Existing valid event rows        | 1,979                    | 1,979, all columns/IDs identical |
| OPEN selected-wallet Behavior DQ | 2                        | 0                                |
| Selected wallets / rank          | 1 / 1                    | 1 / 1, unchanged                 |
| latestActivityAt                 | 2026-09-24T13:21:27.107Z | unchanged                        |
| Quarantined incident Runs        | 14                       | 14, unchanged                    |

- First appended event: `cmujv08nk000hl401lxaix54g`, LONG POSITION_OPEN,
  `2026-03-02T11:14:24.461Z`, `0 → 1.499`, source price `72.246`,
  computed notional `108.296754`.
- Last appended event: `cmujv08sa002zl401zrjjij5y`, LONG POSITION_CLOSE,
  `2026-04-06T22:43:58.553Z`, `0.49 → 0`, source price `112.78`,
  computed notional `55.2622`. Final cursor boundary is FLAT.
- Normalization Run: `cmujv08ku000dl401j8yurrcb`; appended fingerprints exactly
  match the read-only deterministic preview. No previously valid event changed.
- Existing event SHA-256 before/after, over ID-ordered JSON with every column:
  `ec45ef175d96f92a93df593bc92eae20eb290b8853d5f3d6d4b8c8c3c6fdbb57`.
- Source Fill page SHA-256:
  `dcfd56e8d5f70f1aa481f9ba91e7fd53d33d47a680c9b59dfd5b723fc472646f`.
- Protected-state SHA-256 before/after:
  `521950e6f663c90f2ab9b7140b7a985481b053b0b8cabd92390fa70e6a6579b7`.
  This includes all WalletAddress rows, Selection settings/runs/results/overrides,
  selected-wallet fills/source DQ/sync cursors, all quarantined Runs, and unrelated
  Behavior cursors/runs/DQ. All were row-identical.
- Current Selection Run remains `cmujbqjbu2af4nq01zg56l0vc`, policy
  `wallet-selection-v2`, trusted Performance Run `cmujbpj6527jdnq01t6zuxi9u`.
  Full normal ranking API projection was identical before/after.

### Durable receipt and DQ lifecycle

New RawEvent `cmujv08me000gl401kw4uvk0k` contains the full official responses and
contract, with evidence fingerprint
`f5b29f86aa6b1822d8ebe8100d94c380c768e70ac085b093866cdae975029f85`.
All four saved raw-text hashes were revalidated after persistence.

| Request                     | Persisted observedAt (UTC) | Response SHA-256                                                   |
| --------------------------- | -------------------------- | ------------------------------------------------------------------ |
| perpDexs                    | 2026-09-27T13:33:36.565Z   | `d0825f924a67bcba0bd6c4e2902511c5e7861e7e9e710b6b7706396ca34d5ecb` |
| meta, dex xyz               | 2026-09-27T13:33:36.615Z   | `3e6d5ee25d955a6bcedfd8dfb0d873aee6d8099b4e36a78bf3ea01735dbb3c74` |
| spotMeta                    | 2026-09-27T13:33:36.704Z   | `a84545ef4addc99185c5124f216902af6375ea43e8c64637bb546e3738863fc5` |
| perpAnnotation, coin xyz:CL | 2026-09-27T13:33:36.748Z   | `0de3259ca0e5339ff223296c72351e1d3ba1b0f375e73bad6562f04f150a2254` |

`perpDexs` contains changing fields unrelated to the pinned definition; its full
response hash changed between the initial audit and execution. The exact reviewed
identity/quote fields passed both times. No newly fetched price was used.

At `2026-09-27T13:33:36.863Z`, the unchanged successful-group lifecycle resolved:

- UNSUPPORTED_QUOTE `cmujrop0f008ojw01vqlf59d3`;
- legacy MISSING_BOUNDARY `cmujbqvnn2elbnq01tjgsjrh5`.

Both refer to the same now-successful first timestamp group. Row IDs, original
details, fingerprints, first/last-observed times and original blocked-Run links
remain intact. Only normal status/resolvedAt/updatedAt changed; no manual DQ edit.
BTC was not processed and its prior resolved issue was unchanged.

### Queues and resource checks

All queue values below and all active-job identities were unchanged. Waiting,
paused, delayed and waiting-children were zero for every listed queue.

| Queue                            | Prioritized |           Active | Completed | Failed |
| -------------------------------- | ----------: | ---------------: | --------: | -----: |
| hyperliquid-sync                 |           0 |                0 |       318 |    444 |
| address-performance              |           1 |                0 |        66 |     14 |
| behavior-normalization           |           0 |                0 |        24 |      0 |
| hyperliquid-discovery            |           1 |                0 |        17 |    609 |
| hyperliquid-candidate-enrichment |       8,427 | 1 stale/unlocked |        20 |      5 |

The existing stale enrichment job
`enrich-cms9j6kxp1mskn90i477x9hxy-1627804426372-1785570826372` remained untouched;
no lock or consumer existed. No queue/Redis write was required.

Post-check: PostgreSQL healthy, CPU 0.03%, memory 75.81 MiB; Redis healthy,
CPU 0.38%, memory 46.71 MiB (point-in-time Docker samples, not peak measurements).
Runner reported RSS 209,293,312 bytes / heap used 72,088,704 bytes and exited.
All persistent Workers remain stopped. Isolated test containers were stopped,
not deleted; real PostgreSQL/Redis remain healthy/running.

### Validation / delivery

- `pnpm format:check`, `pnpm lint`: PASS.
- `pnpm typecheck`: 11/11 PASS.
- `pnpm test`: 73 files / 694 tests PASS.
- `pnpm build`: 11/11 PASS.
- `pnpm test:e2e`: 22/22 PASS.
- `pnpm audit --audit-level high`: PASS, 0 high/critical, 4 existing moderate.
- `git diff --check`: PASS.
- Integration/E2E targets were explicitly isolated PostgreSQL `55433`, Redis
  `56380` (E2E schema `chaincopy_e2e`, Redis DB 15). No tests used runtime targets.
- PR: [#35](https://github.com/ken-ahi/chaincopy-observer/pull/35).
  Owner authorizes merge after final-head CI passes and mergeability is confirmed.
  No destructive operation, paid source, resync, threshold/manual INCLUDE change,
  manual DQ/cursor edit, signing, trade or fund movement occurred.
