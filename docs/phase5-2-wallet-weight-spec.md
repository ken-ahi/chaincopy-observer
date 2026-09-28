# Phase 5.2 — deterministic wallet-weight-v1

Status: implementation contract; real migration/persistence requires separate Owner approval.
Date: 2026-09-28. Base: PR #36 / `db8ac2cc5160948db8b9c4a970c6d1656cb6bb3b`.
SSoT: SPEC, wallet-selection-v2, performance-v3, Phase 5.1; decision ADR-043.

## 1. Boundary

Selection admits; weight allocates influence **within** the effective-selected cohort.
Only `listEffectiveSelectedWallets()` supplies members. QUALIFIED/REVIEW/EXCLUDED,
watched wallets and manual INCLUDE cannot substitute for admission. Administrative
EXCLUDE remains effective. No second gate, ranking/threshold change, NAV input,
annualizedReturn, maxDrawdown, LLM calculation, signal, notification or order.

Weights are a bounded influence budget, not a probability of future profitability
or a trading recommendation. Current single-wallet weight 1 is mathematical
normalization, not proof of strategy quality or source-wide completeness.

## 2. Read-only distribution audit

The canonical local DB was inspected in a READ ONLY / REPEATABLE READ transaction.
Universe = Discovery-promoted automatic Hyperliquid wallets, not all watched rows.
46 wallets; 44 current trusted performance-v3 runs; 36 trade-history-evaluable;
SELECTED 1 / QUALIFIED 0. Trusted lookup retains quarantine consistency gates.
The audit uses the existing `isTradeHistoryEvaluable` contract, not a relaxed
history-completeness flag. GAP_DETECTED runs can contain proven closed cycles;
this does not certify full exchange history.

Quantiles: Decimal linear interpolation at `(N-1)*p`, after Decimal sorting.
Outliers: descriptive Tukey 1.5 IQR, never an admission filter. Missing includes
no trusted run or no AVAILABLE metric. Counts are integers; financial statistics
are Decimal strings.

### All 46 automatic wallets

| Input                  | Available / missing | Min                  | p25                      | Median                 | p75                    | Max                    |
| ---------------------- | ------------------- | -------------------- | ------------------------ | ---------------------- | ---------------------- | ---------------------- |
| Closed cycles          | 44 / 2              | 0                    | 3.75                     | 10                     | 30.5                   | 928                    |
| Win rate               | 40 / 6              | 0                    | 0.26320422535211267575   | 0.4147516679021497405  | 0.571875               | 0.9                    |
| Profit Factor          | 40 / 6              | 0                    | 0.2226395681938961175    | 0.683682676675125564   | 1.366476967903779138   | 135.348129941569652787 |
| Top trade contribution | 36 / 10             | 0.127714892493861886 | 0.342040677764367382     | 0.4704530361815463895  | 0.810736340997822921   | 1                      |
| Average win            | 36 / 10             | 0.073067             | 3.4657924166666666665    | 21.193490910892073794  | 44.375222479166666667  | 361.711202             |
| Average loss           | 40 / 6              | -674.755624          | -51.47504962499999999975 | -17.882856780224100967 | -3.5787476160714285715 | -0.593748449268008593  |
| Max losing streak      | 40 / 6              | 1                    | 2                        | 3                      | 6                      | 47                     |

### All 36 trade-history-evaluable wallets

All seven fields have 36 available / 0 missing values in this subset.

| Input                  | Min                  | p25                    | Median                  | p75                    | Max                    |
| ---------------------- | -------------------- | ---------------------- | ----------------------- | ---------------------- | ---------------------- |
| Closed cycles          | 2                    | 6.5                    | 13.5                    | 38.75                  | 928                    |
| Win rate               | 0.125                | 0.333333333333333333   | 0.443452380952380952    | 0.6                    | 0.9                    |
| Profit Factor          | 0.004381148595210699 | 0.40649149541717886925 | 0.8289786556675786845   | 1.86446858537961939575 | 135.348129941569652787 |
| Top trade contribution | 0.127714892493861886 | 0.342040677764367382   | 0.4704530361815463895   | 0.810736340997822921   | 1                      |
| Average win            | 0.073067             | 3.4657924166666666665  | 21.193490910892073794   | 44.375222479166666667  | 361.711202             |
| Average loss           | -360.504759          | -38.325159             | -15.1188568256786464215 | -3.5787476160714285715 | -0.593748449268008593  |
| Max losing streak      | 1                    | 2                      | 3                       | 6                      | 47                     |

Evaluable outliers: cycles 928; PF 4.060482752976556668,
4.114737022795513961, 21.992658842768692115, 26.136601002201527004,
30.188242273297035677, 135.348129941569652787; average win 118.9060415,
207.154487, 361.711202; average loss -360.504759, -235.832123, -128.931619,
-122.2756335, -119.032313857142857143, -105.197458666666666667; streak 14, 47.
Win rate and contribution have no Tukey outlier in this subset.

Machine-readable distributions (including all-universe outliers), all 46 wallet
metric values and latest trusted run/window provenance:
`docs/phase5-2-metric-audit.json`. No secret or raw exchange payload is included.

### Selected provenance

- Wallet: `0x34112cf6672cbad0f44b5a77857099417dc686af` /
  `cmuh1wwf4001wk70ynvgjo7a3`.
- Selection: `cmujbqjbu2af4nq01zg56l0vc` (wallet-selection-v2).
- Current trusted Performance: `cmujbpj6527jdnq01t6zuxi9u` (performance-v3).
- Run completed: `2026-09-27T04:33:24.598Z`; history GAP_DETECTED.
- Run window: `2025-04-24T17:19:01.487Z` → `2026-09-27T04:26:55.552Z`.
- **Metric window**: `2025-05-15T13:26:43.450Z` → `2026-03-22T21:04:53.949Z`.
  Do not relabel calculation time as wallet activity or extend metric coverage.
- Closed cycles 57; win rate `0.684210526315789474`; PF `1.011095793418617382`;
  top contribution `0.127714892493861886`; average win `0.538291941475826972`;
  average loss `-1.153500206530958439`; max losing streak 4.

## 3. Formula and rationale (versioned, not fitted to one wallet)

Let w = winRate, p = profitFactor, n = trusted closed cycle count,
c = topTradeContribution:

```text
profitShare   = p / (1 + p)
quality       = (w + profitShare) / 2
confidence    = n / (n + 30)
concentration = 1 - c
rawWeight     = roundHalfEven(quality * confidence * concentration, 36)
```

- PF/(1+PF) maps nonnegative PF to [0,1), with break-even PF=1 at 0.5.
  The denominator's 1 is the formal break-even anchor, not a fitted cap.
  PF's median ~0.829 versus max 135.35 makes unbounded proportional PF unsuitable.
  This transform avoids an arbitrary percentile cliff and preserves ordering.
- Win rate already lies in [0,1]. The coefficient 1/2 is the symmetric mean
  of two unit-scale quality facets (success frequency and aggregate payoff),
  avoiding an unsupported claim that one deserves more influence. Not optimized.
- n/(n+30) is continuous concave confidence with half-confidence at the existing
  v2 minimum evidence count 30. No extra admission test is applied here. The
  wider median 13.5, p75 38.75 and max 928 support saturation rather than linear
  domination by activity. The anchor is frozen in wallet-weight-v1 even if a
  future Selection version changes; such change requires explicit design review.
- 1-c is the fraction of winning PnL outside the single largest winner, a direct
  repeatability proxy with natural endpoints. No additional exponent/cap is used.
  It is not a portfolio diversification or future-loss probability estimate.
- Each exponent is 1: no evidence supports nonlinear extra penalties. Multiplying
  the three complementary facets ensures strong quality cannot erase low sample
  confidence or concentrated outcome risk. These are explainable policy choices,
  not statistically fitted predictions.
- averageWin/averageLoss are retained as evidence, not multiplied into the score:
  absolute USD amounts are size-dependent, and their ratio with win/loss counts
  largely duplicates PF's aggregate payoff information. Breakeven cycles mean
  winRate alone does not exactly reconstruct PF; no such equivalence is claimed.
- Max losing streak is deterministically available but depends on observed sequence
  length and gaps, not a comparable normalized risk measure; retain, do not score.
- Alternatives rejected: equal weights ignore requested confidence/concentration;
  universe percentile normalization drifts when unrelated candidates change;
  linear PF/cycle count permits outlier domination; NAV metrics are unavailable.

## 4. Decimal and normalization

Decimal precision 80 / HALF_EVEN. Input canonicalization accepts plain finite
decimal strings with ≤18 fractional places and absolute value <10^20 (existing
numeric(38,18) contract). No exponent notation, NaN, Infinity or implicit zero.
n must be positive integer; w/c in [0,1], p>=0; averageWin>0, averageLoss<0;
streak nonnegative integer. These are data-domain checks, not investment gates.
Required six metrics must be AVAILABLE/performance-v3 over one non-inverted
window, match the wallet and a SUCCEEDED/trust-consistent current trusted run.
Missing/invalid member input blocks the entire cohort, never renormalizes survivors.

Raw scores use 36 decimal places (numeric(38,36)); normalized weights use 18.
Convert raw scores to exact integers in units 10^-36. Allocate exactly 10^18
normalized units by floor of raw_i*10^18/sumRaw, then one unit to each largest
remainder, ties by canonical lowercase address ascending. Only the residual
allocation count (bounded <200) uses a JS integer; all scores/units use Decimal.
Sum is exactly 1, not approximately 1. Individual zero scores remain members with
zero weight; all-zero cohort fails closed (no invented equal weights).

One member with positive raw score naturally gets 1. Two equal scores get 0.5.
Three equal scores give address-first 0.333333333333333334, others
0.333333333333333333. Fixed vector w=.6,p=1,n=30,c=.2 gives raw .22.
Reordering input or lexical Decimal variants does not change the fingerprint.

## 5. Immutable persistence / trust

New `WalletWeightSnapshot` + `WalletWeightEntry` tables, not reuse of mutable
Selection or semantically unrelated aggregation/Performance rows. Exact SQL:
`prisma/migrations/20260928000000_wallet_weight/migration.sql`.

- Snapshot id = SHA256 of canonical ordered input snapshot: policy/version,
  Selection ID, cohort fingerprint, wallet IDs/addresses, Performance IDs/source
  fingerprints/trust revisions, metric windows/counts and all six metric strings.
- Entry binds wallet, source Performance, raw and normalized weights and complete
  metric/reason components. Snapshot has immutable first calculatedAt (DB timestamp).
- Cohort fingerprint reuses Phase 5.1 `aggregationScope` canonical membership
  definition, including Selection and Performance IDs. Max 200 admitted members;
  no wallet history/fills are loaded. Closed cycles use DB count, not heap loading.
- Four FKs (snapshot→Selection; entry→snapshot/wallet/Performance) use Restrict.
  Five secondary indexes plus two PK indexes exist only on the new tables.
  Unique(version,input fingerprint), PK(snapshot,wallet), unique(snapshot,address).
  Check constraint bounds both weights [0,1]. No existing large-table index.
- Retention is indefinite audit evidence; no purge endpoint. Restrict deliberately
  prevents parent deletion silently destroying weight provenance. Existing retention
  must not bypass this. Normal service only CREATE/find; never UPDATE/DELETE weights.
  DB owner administrative privileges are not represented as an immutability guarantee.
- Preview/read: READ ONLY, REPEATABLE READ, 30s timeout. Settings absence is no-op;
  existing SSoT empty-update upserts only read already-existing settings/source.
- Persist: one SERIALIZABLE transaction for cohort/metrics and parent+all entries,
  30s timeout/10s maxWait; ≤3 attempts on P2034/P2002. Expected preview fingerprint
  is mandatory. Any changed input rolls back without partial cohort. Duplicate
  concurrent calculations converge on same id/calculatedAt. No worker/Redis needed.
- New trusted Performance that differs from Selection-bound evidence blocks current
  weights (`STALE_SELECTION_EVIDENCE`) until the normal Selection flow re-evaluates.
  Do not silently rebind a historically admitted cohort to different Performance.
- Addition/removal/EXCLUDE/new Selection/new Performance produces a new snapshot.
  Old snapshot is immutable. A→B→A with identical complete input can reuse A.
  Quarantined runs are never rebound as trusted evidence; standard trust lookup and
  transition consistency checks remain authoritative.

## 6. Execution and read API

`pnpm wallet:weight` is read-only preview of current selected cohort (no new table
needed). `pnpm wallet:weight --execute --expected-fingerprint <reviewed SHA256>`
is explicit bounded persistence, **only after Owner approves real migration**.
No scheduler, consumer, sync, Discovery, Performance or Selection execution added.

Authenticated `GET /api/wallet-weights/current`, Cache-Control no-store:

- CURRENT: snapshotId, weightVersion, selectionRunId, cohortFingerprint,
  inputFingerprint, calculatedAt and items with walletAddressId/address,
  performanceRunId/fingerprint/trustRevision, metric window/inputs, rawWeight,
  normalizedWeight and reason components.
- NOT_COMPUTED: matching current input fingerprint has no persisted snapshot.
- NO_SELECTED_WALLETS: legitimate no-op, no fallback.
- BLOCKED: invalid/stale evidence, reason; items empty. Infrastructure/trust
  consistency errors are not swallowed. No stale historical weight returned current.

## 7. Phase 5.3 consumption contract

Future Signal must persist **weight snapshot ID + aggregation revision ID**,
wallet-weight-v1, behavior-aggregation-v1, behavior-v1, common Selection ID and
cohort fingerprint. Join only matching cohorts; mismatch fails closed and requests
normal upstream recomputation, never silently recalculates Selection/Performance.
Read the stored immutable metric/weight inputs, not latest mutable metrics.

Phase 5.1 semantic wallet-ID sets support weighted participation (sum each unique
member's normalized weight once per semantic set). If later weighting notional,
use the immutable aggregation revision's per-event wallet/notional input receipt;
do not multiply whole-coin notional by an average weight or count fills as votes.
Historical aggregates remain unchanged. Current-cohort evaluation of old buckets
is not an assertion that those wallets were selected at event time. Direction
coefficients/windows/thresholds and actual signal scoring remain Phase 5.3 work.

## 8. Acceptance / approval boundary

Focused tests cover exact vectors, extremes, equal scores, concentration, rounding,
permutation, invalid/missing data, cohort/provenance changes, SSoT admission,
EXCLUDE, idempotent concurrent persistence, immutable historical receipts, API auth,
and migration constraints in explicitly isolated DB/Redis only. Full repository
format/lint/typecheck/test/build/E2E/audit/diff validation is required.

Real validation before approval is **preview only**, repeat fingerprint comparison
and read-only conservation checks: selected cohort, 2,012 Behavior events, 1,332
aggregation buckets/revisions, OPEN Behavior DQ 0 and queues. No real snapshot
persistence, migration or merge until separate Owner decision. After approval,
apply only the reviewed additive SQL, persist exactly the previewed cohort once,
repeat idempotently, inspect current API, and reconfirm all protected state.
