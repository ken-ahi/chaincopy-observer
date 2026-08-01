# 計算設計

最終更新: 2026-08-01

本書はPhase 4Aの監査結果と、Phase 4Bで実装する決定論的計算の仕様を定義する。Phase 4Aではコード、Prisma schema、Migrationを変更しない。

## 1. 共通規則

- 金額、価格、数量、率は入力から出力までDecimal文字列として扱い、JavaScript `number` を金融計算に使わない。
- Phase 4Bは `Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_EVEN })` 相当の専用contextを使う。中間値は丸めず、永続化境界で `numeric(38,18)` に収まることを確認して18桁へhalf-even丸めする。
- DBと計算境界はUTCとし、日次境界は `[00:00:00Z, 24:00:00Z)` とする。Asia/Tokyoへの変換は表示だけで行う。
- 損益とcash flowの符号は、口座資産を増やす値を正、減らす値を負とする。
- 値を0で補完せず、計算不能は型付きエラーにする。`NaN`、`Infinity`、無限大相当の比率を返さない。
- 結果には `calculationFrom`、`calculationTo`、`metricVersion`、`dataCompleteness`、`precision` を付ける。

精度区分は次の意味とする。

| 区分          | 意味                                                                 |
| ------------- | -------------------------------------------------------------------- |
| `EXACT`       | 公式API値をDecimalのまま保存した値。宣言した取得範囲内だけで有効     |
| `DERIVED`     | `EXACT`入力だけから本書の式で決定論的に算出した値                    |
| `ESTIMATED`   | 補間、時刻仮定、ヒューリスティックを含む値。Phase 4Bの正式値にしない |
| `UNAVAILABLE` | 必要入力が保存されていない、または意味を確定できず計算しない値       |

## 2. データ充足性監査

「実装可」は、必要条件を満たさない入力に対して値ではなくエラーを返す実装を含む。

| 指標                       | 必要な入力                              | 現在のPrismaモデル                                              | 現在保存しているフィールド                                  | 計算可能性                                             | 精度          | 欠損条件                                         | 履歴打切りの影響                    | 追加保存         | Phase 4B                         |
| -------------------------- | --------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ | ------------- | ------------------------------------------------ | ----------------------------------- | ---------------- | -------------------------------- |
| 口座純資産                 | cash、spot時価、perp含み損益、liability | `PortfolioSnapshot`、`SpotBalanceSnapshot`、`PerpPositionEvent` | `accountValue`、spot `total/entryNotional`、`unrealizedPnl` | Perp口座のsnapshot値は取得可。spotを含む全口座式は不可 | `UNAVAILABLE` | spot評価価格、cash/liability内訳、同期時点不一致 | 任意の過去時点を再構築不能          | 必要             | 全口座は不可。Perp NAV限定なら可 |
| 実現損益                   | 各Fillの公式`closedPnl`                 | `NormalizedTrade`                                               | `closedPnl`、`occurredAt`、`coin`                           | 完全な対象区間の合計は可                               | `EXACT`       | Fill gap、開始前position、API上限                | 上限以前を含む期間は不可            | 検算値保存を推奨 | 可                               |
| 含み損益                   | 同時点の全open position                 | `PerpPositionEvent`                                             | `unrealizedPnl`、`occurredAt`                               | 保存snapshot時点だけ可                                 | `EXACT`       | position snapshot欠損・部分失敗                  | 欠けた時点は復元不能                | 不要             | 可                               |
| Funding                    | Funding ledger                          | `FundingPayment`                                                | `amount`、`coin`、`occurredAt`                              | 完全な対象区間の合計は可                               | `EXACT`       | Funding gap                                      | 上限以前を含む期間は不可            | 不要             | 可                               |
| 手数料                     | 全Fill fee、builder fee、rebate         | `NormalizedTrade`、`RawEvent`                                   | `fee`、`feeToken`。`builderFee`はrawのみ                    | 保存済みfeeの合計は可。総手数料は条件付き              | `DERIVED`     | builder fee、異なるfee token、Fill gap           | 区間総額を過少計上し得る            | 必要             | base feeのみ可                   |
| 入金・出金                 | type、符号付き額、USD額、相手、口座境界 | `CashFlow`                                                      | `flowType`、`amount`、`usdValue`、`counterparty`、raw       | 明示分類できる行だけ集計可                             | `DERIVED`     | nullable額、未知type、transfer境界不明           | TWR全体を停止                       | 必要             | 条件付き可                       |
| 日次NAV                    | UTC日次の全口座NAV                      | `PortfolioSnapshot`                                             | clearinghouse `accountValue`、portfolio履歴はrawのみ        | Perp NAV履歴だけ条件付き可                             | `DERIVED`     | 日次点欠損、全口座内訳欠損                       | 欠損日以後の系列指標を停止          | 必要             | Perp NAV限定で可                 |
| 日次収益率                 | 連続日次NAV、cash flow境界              | 同上、`CashFlow`                                                | 同上                                                        | 適格なPerp NAV系列で可                                 | `DERIVED`     | 非正NAV、未知flow、日次gap                       | 連続系列として不可                  | 出力保存を推奨   | 可                               |
| TWR                        | flow直前・直後NAV、外部cash flow        | 同上                                                            | snapshotとledger                                            | 境界NAVが揃う区間だけ可                                | `DERIVED`     | 境界NAVなし、未知flow、非正NAV                   | path依存のため対象期間全体を停止    | 必要             | 可                               |
| 累積収益率                 | 適格な期間収益率系列                    | 同上                                                            | 同上                                                        | 可                                                     | `DERIVED`     | TWR停止条件と同じ                                | 対象期間全体を停止                  | 出力保存を推奨   | 可                               |
| 年率換算収益率             | 累積収益率、経過日数                    | 同上                                                            | 同上                                                        | 30日以上で可                                           | `DERIVED`     | 30日未満、wealth factor非正                      | 有効期間だけで評価し、5年扱いしない | 不要             | 可                               |
| 最大ドローダウン           | cash flow調整済みNAV/wealth curve       | 同上                                                            | 同上                                                        | 適格系列で可                                           | `DERIVED`     | peak非正、系列gap                                | 欠損を跨いで計算しない              | 不要             | 可                               |
| ボラティリティ             | 30点以上の日次収益率                    | 同上                                                            | 同上                                                        | 適格系列で可                                           | `DERIVED`     | 30点未満、系列gap                                | 有効な連続区間だけ                  | 不要             | 可                               |
| Sharpe Ratio               | 日次収益率、risk-free rate              | 同上                                                            | 同上                                                        | 適格系列で可                                           | `DERIVED`     | 30点未満、標準偏差0                              | 有効な連続区間だけ                  | 不要             | 可                               |
| Sortino Ratio              | 日次収益率、downside threshold          | 同上                                                            | 同上                                                        | 適格系列で可                                           | `DERIVED`     | 30点未満、downside deviation 0                   | 有効な連続区間だけ                  | 不要             | 可                               |
| Calmar Ratio               | 年率換算収益率、最大DD                  | 同上                                                            | 同上                                                        | 180日以上で可                                          | `DERIVED`     | 180日未満、最大DD 0                              | 対象期間全体を停止                  | 不要             | 可                               |
| Profit Factor              | 完了Position Cycleのnet PnL             | `NormalizedTrade`、`FundingPayment`                             | Fill、fee、Funding                                          | 完全cycleだけで可                                      | `DERIVED`     | 開始position不明、gap、総損失0                   | 未完cycleを除外し、打切り期間は不可 | Cycle保存を推奨  | 可                               |
| 勝率                       | 完了Position Cycleのnet PnL             | 同上                                                            | 同上                                                        | 完全cycleだけで可                                      | `DERIVED`     | 完了cycleなし、gap                               | 打切り期間は不可                    | Cycle保存を推奨  | 可                               |
| 平均利益・平均損失         | 完了Position Cycleのnet PnL             | 同上                                                            | 同上                                                        | 可                                                     | `DERIVED`     | 対応する勝ち/負けcycleなし                       | 打切り期間は不可                    | Cycle保存を推奨  | 可                               |
| 最大連敗                   | 時系列の完了Position Cycle              | 同上                                                            | 同上                                                        | 可                                                     | `DERIVED`     | cycle順序不明、gap                               | gapを跨いで連結しない               | Cycle保存を推奨  | 可                               |
| 月間プラス率               | 6か月以上の完全な月次TWR                | NAV/return関連モデル                                            | snapshotとledger                                            | 条件付き可                                             | `DERIVED`     | 完全月6未満、月内gap                             | 不完全月を分母に入れない            | Return保存を推奨 | 可                               |
| 実効レバレッジ             | 同時点のgross notional、Perp equity     | `PortfolioSnapshot`                                             | `totalNotionalPosition`、`accountValue`                     | clearinghouse snapshot時点で可                         | `DERIVED`     | equity非正、片方欠損                             | 欠けた時点を除外                    | 不要             | 可                               |
| レバレッジ95パーセンタイル | 十分な時系列leverage                    | `PortfolioSnapshot`                                             | 同上                                                        | 観測snapshot分布として可                               | `DERIVED`     | snapshot不足・偏在、equity非正                   | 欠損期間を代表しない                | 日次値保存を推奨 | 可                               |
| 銘柄集中度                 | 同時点のcoin別absolute notional         | `PerpPositionEvent`                                             | `coin`、`positionValue`、`occurredAt`                       | snapshot時点で可                                       | `DERIVED`     | position snapshot部分失敗                        | 欠けた時点は不可                    | 不要             | 可                               |
| 清算回数                   | 明示的liquidation event/flag            | `RawEvent`                                                      | Fill/WS rawには存在し得るが正規化列なし                     | 信頼できる重複排除集計は不可                           | `UNAVAILABLE` | liquidation flag/event未正規化                   | 過去清算を数えられない              | 必要             | 不可                             |
| 単一取引への利益依存度     | 完了Position Cycle別net利益             | Fill/Funding関連モデル                                          | 同上                                                        | 完全cycleだけで可                                      | `DERIVED`     | 正利益cycleなし、gap                             | 打切り期間は不可                    | Cycle保存を推奨  | 可                               |

`ESTIMATED`値として作り得るのは、最寄りsnapshotの流用、日中cash flowを日初または日末と仮定するTWR、spot `entryNotional`を時価とみなす全口座NAVなどである。これらは正式指標、スコア、ランキングには出力しない。

## 3. 履歴完全性

| 状態                   | 判定                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `COMPLETE`             | `calculationFrom`の初期NAV・初期positionが確定し、`calculationTo`まで内部gapもAPI打切りもない |
| `PARTIAL`              | 取得可能な有界区間は判明しているが、口座開始以前または要求期間の一部を含まない                |
| `TRUNCATED`            | API件数上限、同一timestampのページ進行不能などにより古い履歴が切れている                      |
| `GAP_DETECTED`         | 取得可能範囲の内部に未解消の欠損がある                                                        |
| `INSUFFICIENT_HISTORY` | 連続性は満たすが、指標の最低日数・点数・cycle数を満たさない                                   |

優先順位は `GAP_DETECTED`、`TRUNCATED`、`PARTIAL`、`INSUFFICIENT_HISTORY`、`COMPLETE` とする。5年未満は取得可能全期間を明示し、`STRICT_5Y`や5年評価済みにはしない。`PARTIAL`でも開始時NAVと開始positionが確定した区間内の非path依存集計は可能だが、precisionと完全性を別々に返す。

## 4. 損益、Position Cycle、cash flow

### 4.1 実現損益の正本

- 正本は公式Fillごとの `closedPnl` とする。部分決済の `closedPnl` は同じcycleへ加算する。
- Fill再計算値は検算専用とし、正本を上書きしない。差異はData Quality Issueにする。
- 平均取得価格はopening数量の加重平均。縮小では変えず、反転時は旧cycleを閉じ、超過数量で逆方向の新cycleを同じFill時刻に開始する。
- `startPosition`をFill直前の公式signed positionとして使う。BUYは正、SELLは負のdeltaとし、計算後positionとの不一致は停止条件とする。
- gross realized PnLは `sum(closedPnl)`。net cycle PnLは `gross realized PnL - fee + funding`。feeは費用を正数で保存している前提とし、負のrebateを許容する。
- builder feeまたはfee tokenのUSD換算が欠けるcycleは、net指標に使わない。
- Fundingは同一coinでcycleがopenの時刻に割り当てる。同一timestampで前後関係を決められない場合は推測せず `DATA_ORDER_AMBIGUOUS` とする。

「1取引」はFill単位ではなく、wallet・coin・方向ごとにpositionが0からopenされ、部分決済を経て0へ戻るまでの `Position Cycle` とする。部分決済による勝率水増しを避け、反転と平均取得価格を一意に扱えるためである。

### 4.2 cash flow分類

| event                     | 扱い                                                                   |
| ------------------------- | ---------------------------------------------------------------------- |
| deposit                   | 正の外部cash flow                                                      |
| withdrawal                | 負の外部cash flow                                                      |
| bridge                    | 口座境界を跨ぐことが明示される場合だけ外部cash flow                    |
| transfer                  | 同一所有者・同一評価範囲内は内部移動。境界不明なら `UNKNOWN_CASH_FLOW` |
| referral reward           | 運用収益。外部cash flowにしない                                        |
| liquidation               | 取引損失・risk event。外部cash flowにしない                            |
| funding                   | 運用損益。外部cash flowにしない                                        |
| non-funding ledger update | 明示subtypeに従う。未知typeやUSD額不明は `UNKNOWN_CASH_FLOW`           |

不明な入出金は推測しない。`UNKNOWN_CASH_FLOW`が評価期間に1件でもあれば、NAV差分、TWR、return系列とその派生指標を停止する。

`accountClassTransfer`など現行分類で内部振替と確定したイベントは、Max Drawdown処理だけで外部Cash Flowへ再分類しない。ただし、Perpetuals口座だけを評価する場合、同一所有者の口座間移動であっても評価範囲を出入りする価値移動になり得る。全口座とPerpetuals口座の境界を履歴から常に確定できない点は既知の残存制約であり、今回のv3では新しい分類規則を導入しない。

## 5. NAVと収益率

全口座NAVの定義は次とする。

```text
totalAccountNav =
  cashBalance
  + Σ(spotQuantity × contemporaneousSpotMarkPrice)
  + perpetualUnrealizedPnl
  - liabilities
```

現在の `PortfolioSnapshot.accountValue` はPerpetuals clearinghouseの公式snapshot値として正本にできるが、spot時価、cash/liability内訳と同期していないため `totalAccountNav` とは呼ばない。Phase 4Bの初期対象は明示的に `PERP_ACCOUNT_NAV` とする。過去日次NAVの再構築には各日境界のNAVまたは履歴開始時の完全なbalance/position/price状態が必要であり、現在のsnapshotだけから任意の過去日を逆算しない。

日次NAVはraw `PortfolioSnapshot`由来であり、UTC日ごとに最後の正のPerpetuals account valueを選ぶ。表示・監査・永続化用のraw系列として維持し、Cash Flow調整済み系列へ書き換えない。最寄りsnapshotの流用や線形補間はしない。snapshot間の不規則系列は日次系列と区別する。

### 5.1 TWR

外部cash flowの各発生時刻で期間を分割し、cash flow直前・直後のNAVを要求する。

```text
subperiodReturn_i = navBeforeFlow_i / previousNavAfterFlow - 1
nextBaseNav_i = navAfterFlow_i
TWR = Π(1 + subperiodReturn_i) - 1
```

最終cash flow後は `endingNav / lastNavAfterFlow - 1` を加える。cash flowがない期間はsnapshot間returnを使う。`navAfterFlow - navBeforeFlow`とsigned cash flowの不一致もData Quality Issueにする。

TWRと累積収益率は、`splitReturnPeriodsAtCashFlows()`が返した順序確定済み`ReturnPeriod`配列だけから計算する。外部Cash Flowは期間分割時に除外済みであるため、後段でCash Flow額を再度加減算しない。FeeとFundingは実際のNAV変化に含まれる運用損益であり、Return Periodのreturnへ別途加減算しない。

- 優先単位はcash flow発生時、次にUTC日次境界、最後に明示したsnapshot間である。
- 日中cash flowの直前・直後NAVがなければ、日次TWRへ丸め込まず `MISSING_CASH_FLOW_BOUNDARY_NAV` とする。
- 開始NAV、flow直前NAV、flow直後NAVのいずれかが0以下なら `NON_POSITIVE_NAV` とする。
- gap、打切り、未知flowを跨いだ積は計算しない。

### 5.2 累積・年率換算

```text
cumulativeReturn = Π(1 + periodReturn_i) - 1
annualizedReturn = (1 + cumulativeReturn)^(365 / elapsedDays) - 1
```

- 30日未満は年率換算しない。
- 30日以上180日未満は `REFERENCE_ONLY`、180日以上は通常評価可とする。
- この閾値はSPECの24か月・60か月のランキング適格性を緩和しない。
- `elapsedDays <= 0` または `1 + cumulativeReturn <= 0` は計算不能。

## 6. リスク・取引指標

`performance-v3`以降の最大ドローダウンは、raw Daily NAVではなく、TWRと同じ順序確定済み`ReturnPeriod`から構築したCash Flow調整済みWealth Indexに対して求める。Return Period配列は再ソートせず、同一timestampでは配列sequenceを正本とする。

```text
W_0 = 1
W_i = W_(i-1) × (1 + periodReturn_i)
P_0 = 1
P_i = max(P_(i-1), W_i)
D_i = W_i / P_i - 1
maxDrawdown = min(D_0 ... D_n)
```

同率Peakと同率Troughは最初の地点を保持する。終端`W_n`は厳密に`1 + TWR`と一致する。Cash Flowがない履歴ではraw NAV系列を定数倍した曲線になるためv2と同値である。`UNKNOWN_CASH_FLOW`、`MISSING_CASH_FLOW_BOUNDARY_NAV`、非正NAV、`1 + periodReturn <= 0`、またはReturn Periodを構築できない履歴では、推測、補間、Modified Dietzなどの近似を行わずReturn Laneを計算不能にする。

ボラティリティ、Sharpe、Sortinoの現行実装は、厳密にはUTC日ごとに再集約した系列ではなく、Cash Flow境界で分割された`ReturnPeriod`系列を使用する。同一日複数期間はsequenceで区別する。risk-free rateとdownside thresholdはともに0、年率換算係数は365、標準偏差は標本標準偏差 `n - 1` とする。

```text
annualizedVolatility = sampleStdDev(dailyReturns) × sqrt(365)
Sharpe = mean(dailyReturns) / sampleStdDev(dailyReturns) × sqrt(365)
downsideDeviation = sqrt(mean(min(dailyReturn, 0)^2))
Sortino = mean(dailyReturns) / downsideDeviation × sqrt(365)
Calmar = annualizedReturn / abs(maxDrawdown)
```

- volatility、Sharpe、Sortinoは30点以上を必要とし、30～179点は参考値、180点以上を通常評価とする。
- 標準偏差0ではvolatilityだけ0とし、Sharpeは `ZERO_VARIANCE`。downside deviation 0ではSortinoを無限大にせず `ZERO_DOWNSIDE_DEVIATION` とする。
- Calmarは180日以上を必要とし、最大ドローダウン0なら `ZERO_DRAWDOWN` とする。
- 月間プラス率は完全なUTC月のTWRが正の月数を完全月数で割る。0%月はプラスに含めず、最低6か月を必要とする。

Position Cycleのnet PnLを `p` として次を使う。

```text
profitFactor = Σ(p where p > 0) / abs(Σ(p where p < 0))
winRate = count(p > 0) / count(all completed cycles)
singleTradeProfitDependency = max(p where p > 0) / Σ(p where p > 0)
```

損失cycleが0件ならProfit Factorは無限大にせず `ZERO_GROSS_LOSS`。平均利益は正のcycleだけ、平均損失は負のcycleだけの符号付き平均とする。損益0のcycleは勝率の分母に含み、連敗を中断する。

```text
effectiveLeverage = abs(totalNotionalPosition) / accountValue
coinConcentration = max(abs(coinPositionNotional)) / Σabs(coinPositionNotional)
```

leverage 95パーセンタイルは有効snapshotを昇順にし、`PERCENTILE_CONT(0.95)`相当の線形補間をDecimalで行う。非正equityは除外せず計算停止とし、欠損期間を含む分布を通常評価しない。

## 7. データ品質による停止条件

次のいずれかが評価範囲にあれば、関係するpath依存指標を保存しない。

- openな `GAP_DETECTED`、API上限による `TRUNCATED`
- `UNKNOWN_CASH_FLOW`
- cash flow直前・直後NAV、開始NAV、開始positionの欠損
- 非正NAV、position連続性不一致、同時刻event順序不明
- builder feeやfee token換算欠損を含むnet取引指標
- 指標固有の最低日数、点数、完了cycle数未達

停止結果は0ではなく `calculationStatus=FAILED` または `INSUFFICIENT_DATA` とし、`calculationError`へ機械可読codeを保存する。

## 8. Phase 4B純粋関数案

共通入力の金額はDecimal文字列、時刻はUTC ISO文字列、配列はreadonlyかつ関数内で副作用を起こさない。共通出力は `CalculationResult<T> = { ok: true; value: T; precision; completeness } | { ok: false; error: CalculationError }` とする。

`CalculationError.code` は最低限 `INVALID_DECIMAL`、`DATA_GAP`、`HISTORY_TRUNCATED`、`INSUFFICIENT_HISTORY`、`MISSING_INITIAL_STATE`、`UNKNOWN_CASH_FLOW`、`MISSING_CASH_FLOW_BOUNDARY_NAV`、`NON_POSITIVE_NAV`、`DATA_ORDER_AMBIGUOUS`、`ZERO_DENOMINATOR` を持つ。

| 関数                            | 入力型                                              | 出力型                  |
| ------------------------------- | --------------------------------------------------- | ----------------------- |
| `classifyCashFlows`             | `CashFlowInput[]`                                   | `ClassifiedCashFlow[]`  |
| `buildPositionCycles`           | `FillInput[]`, `FundingInput[]`, `Coverage`         | `PositionCycle[]`       |
| `calculateRealizedPnl`          | `PositionCycle[]`                                   | `PnlBreakdown`          |
| `calculateDailyNav`             | `NavSnapshot[]`, `ClassifiedCashFlow[]`, `Coverage` | `DailyNavPoint[]`       |
| `splitReturnPeriodsAtCashFlows` | `NavPoint[]`, `ClassifiedCashFlow[]`                | `ReturnPeriod[]`        |
| `calculateTwr`                  | `ReturnPeriod[]`                                    | `MetricValue`           |
| `calculateCumulativeReturn`     | `ReturnPeriod[]`                                    | `MetricValue`           |
| `buildTwrWealthIndex`           | `ReturnPeriod[]`, `Coverage`                        | `WealthPoint[]`         |
| `calculateAnnualizedReturn`     | `MetricValue`, `from`, `to`                         | `MetricValue`と評価区分 |
| `calculateMaxDrawdown`          | `WealthPoint[]`                                     | `DrawdownResult`        |
| `calculateVolatility`           | `DailyReturn[]`                                     | `MetricValue`           |
| `calculateSharpe`               | `DailyReturn[]`, `riskFreeRate`                     | `MetricValue`           |
| `calculateSortino`              | `DailyReturn[]`, `threshold`                        | `MetricValue`           |
| `calculateCalmar`               | `annualizedReturn`, `maxDrawdown`, `elapsedDays`    | `MetricValue`           |
| `calculateProfitFactor`         | `PositionCycle[]`                                   | `MetricValue`           |
| `calculateWinRate`              | `PositionCycle[]`                                   | `TradeStatistics`       |
| `calculateLeverageMetrics`      | `AccountSnapshot[]`                                 | `LeverageStatistics`    |
| `calculateCoinConcentration`    | `PositionSnapshot[]`                                | `MetricValue[]`         |
| `calculateProfitDependency`     | `PositionCycle[]`                                   | `MetricValue`           |

## 9. 固定テストケース

すべてDecimal文字列を入力し、feeとFundingが省略されたcaseは `"0"` とする。

|   # | case             | 入力                                                                                                                | 期待値                                                                      |
| --: | ---------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
|   1 | 単純ロング利益   | BUY `1@100`、SELL `1@120`、`closedPnl=20`                                                                           | 1 cycle、gross/net `"20"`                                                   |
|   2 | 単純ショート利益 | SELL `1@100`、BUY `1@80`、`closedPnl=20`                                                                            | 1 cycle、gross/net `"20"`                                                   |
|   3 | 部分決済         | BUY `2@100`、SELL `1@110` `closedPnl=10`、SELL `1@120` `closedPnl=20`                                               | 1 cycle、gross `"30"`                                                       |
|   4 | ポジション反転   | BUY `1@100`、SELL `2@90` `closedPnl=-10`、BUY `1@80` `closedPnl=10`                                                 | 2 cycles、`["-10","10"]`                                                    |
|   5 | Funding支払い    | 完了cycle gross `"0"`、Funding `"-2"`                                                                               | net `"-2"`                                                                  |
|   6 | Funding受取り    | 完了cycle gross `"0"`、Funding `"2"`                                                                                | net `"2"`                                                                   |
|   7 | 手数料込み損益   | `closedPnl=20`、open fee `"1"`、close fee `"1"`                                                                     | net `"18"`                                                                  |
|   8 | 入金を含むTWR    | NAV `"100"`→flow前`"110"`、deposit `"100"`、flow後`"210"`→`"231"`                                                   | returns `["0.1","0.1"]`、TWR `"0.21"`                                       |
|   9 | 出金を含むTWR    | NAV `"100"`→flow前`"110"`、withdrawal `"-50"`、flow後`"60"`→`"66"`                                                  | returns `["0.1","0.1"]`、TWR `"0.21"`                                       |
|  10 | 最大ドローダウン | wealth `["100","120","90","108"]`                                                                                   | max drawdown `"-0.25"`                                                      |
|  11 | 全勝             | cycle PnL `["10","5"]`                                                                                              | win rate `"1"`、average profit `"7.5"`、Profit Factor `ZERO_GROSS_LOSS`     |
|  12 | 全敗             | cycle PnL `["-10","-5"]`                                                                                            | win rate `"0"`、average loss `"-7.5"`、Profit Factor `"0"`、最大連敗`2`     |
|  13 | 標準偏差ゼロ     | 日次return `"0"`を30点                                                                                              | volatility `"0"`、Sharpe `ZERO_VARIANCE`、Sortino `ZERO_DOWNSIDE_DEVIATION` |
|  14 | 負のNAV          | beginning NAV `"-1"`                                                                                                | `NON_POSITIVE_NAV`、値なし                                                  |
|  15 | 履歴Gap          | 範囲内にopen `GAP_DETECTED`                                                                                         | `DATA_GAP`、path依存値なし                                                  |
|  16 | 履歴打切り       | `TRUNCATED`かつ要求開始がavailableFrom以前                                                                          | `HISTORY_TRUNCATED`、期間値なし                                             |
|  17 | Decimal大桁      | long size `"1000000000000000000.000000000000000001"`、entry `"1.000000000000000001"`、exit `"1.000000000000000002"` | 検算PnL `"1.000000000000000001"`                                            |
