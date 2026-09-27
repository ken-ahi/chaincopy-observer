# Free-data Wallet Selection v2

最終更新: 2026-09-27

## 1. 目的と非目的

`wallet-selection-v2`は、無料のHyperliquid公式データから決定論的に再構築できた完了Position Cycleと、保存済み`performance-v3`取引指標だけで参考walletを選ぶversioned policyである。連続Daily NAVを必要とする`wallet-selection-v1`は変更・削除しない。v2はNAV、年率収益率、累積収益率、最大drawdownを生成・補完せず、`performance-v3`の計算式も変更しない。

v2は「全取引履歴が完全」とは主張しない。境界と連続性を証明できたclosed cycleの集合だけを`TRADE_HISTORY_EVALUABLE`として扱う。評価不能な入力、古い入力、metric欠損は`REVIEW`、取引品質hard gate不通過は`EXCLUDED`とする。selected 0は正常状態である。

## 2. Stage 1 read-only監査

2026-09-27に、current automatic universe 46 walletを実PostgreSQLへread-only transactionで監査した。current Selection Runは`cmuhtckgd00y6my1o09dvalza`（`wallet-selection-v1`）、selected 0 / qualified 0 / review 46 / excluded 0だった。

### 2.1 Performanceとcycle分布

| 項目                                             |          実測 |
| ------------------------------------------------ | ------------: |
| automatic universe                               |            46 |
| current trusted `performance-v3`あり             |            44 |
| trusted Runなし                                  |             2 |
| completeness `COMPLETE / PARTIAL / GAP_DETECTED` |   0 / 31 / 13 |
| closed cycle `min / median / max`                | 0 / 8.5 / 251 |
| closed cycle 20件以上                            |            13 |
| closed cycle 30件以上                            |            12 |
| closed cycle 50件以上                            |             7 |
| closed cycle 100件以上                           |             1 |

### 2.2 取引指標availability

| metric                 | 有効wallet | min / median / max                              |
| ---------------------- | ---------: | ----------------------------------------------- |
| `winRate`              |         40 | 0 / 0.41475166790214973 / 0.9                   |
| `profitFactor`         |         40 | 0 / 0.7041641645726249 / 135.348129941569652787 |
| `averageWin`           |         36 | 0.073067 / 21.193490910892073 / 361.711202      |
| `averageLoss`          |         40 | -674.755624 / -17.882856780224103 / -0.6697205  |
| `topTradeContribution` |         36 | 0.127714892493861886 / 0.4828391015258 / 1      |
| `maxLosingStreak`      |         40 | 1 / 3 / 14                                      |

6必須metricが同一Run・同一coverage windowで`AVAILABLE`となるwalletは36件、そこから30 closed cycle以上は12件、win rate 0.55以上は3件、Profit Factor 1以上は2件、top trade contribution 0.50以下まで通るものは2件だった。24時間freshnessまで含めると監査時点では0件である。

`sum(PositionCycle.netRealizedPnl)`と平均hold時間は監査可能だが、正式な保存Metricではない。wallet規模に依存する累積USD PnLと、選定閾値が未定義のhold時間はv2の必須metric・rankingへ使わない。

### 2.3 orderingと境界の事実

同一wallet + coin + timestampの複数Fill groupは16,343 group / 46 wallet / 83,306 fills、最大group size 146だった。group内で同一`startPosition`を持つ分岐は0 groupだった。`tid` / external IDはidentityでありcausal orderとは扱わない。

現行`performance-v3` cycle builderは、coin先頭が非FLATなら最初の`startPosition=0`までprefixを除外する。以後は各Fillの`startPosition`と再構築positionを照合し、不一致時は進行中cycleを破棄して、そのcoinの後続Fillを除外する。したがって保存されるclosed cycleは、既知FLATから開始し、全Fill境界が連続し、FLATで終了した区間だけである。後続のunresolved gapやdiscontinuityより前に完了したcycleは保持するが、gapを跨ぐcycleや不明prefixをcompleteへ昇格しない。cycleのinput fingerprintはcycle ID、source Fill ID集合、Funding ID集合を固定する。

## 3. `TRADE_HISTORY_EVALUABLE`契約

versionは`closed-position-cycle-v1`とする。次をすべて満たす場合だけtrueである。

1. current trusted lookupが返した`SUCCEEDED / TRUSTED / performance-v3` Runである。
2. 同じRunにclosed `PositionCycle`が1件以上ある。
3. `winRate / profitFactor / averageWin / averageLoss / maxLosingStreak / topTradeContribution`が全件存在する。
4. 6 metricがすべて`metricVersion=performance-v3`かつ`status=AVAILABLE`である。
5. 6 metricの`calculationFrom / calculationTo`が一致し、逆転していない。
6. metric Decimalの意味制約を満たす。win rateとtop contributionは0..1、Profit Factorとlosing streakは0以上、average winは正、average lossは負、losing streakは整数である。

Run全体の`historyCompleteness`はv2 gateにしない。これはNAV laneや、信頼済みclosed cycleより後のgapによって`PARTIAL / GAP_DETECTED`になり得るためである。一方、保存closed cycleの構築契約は緩めない。`TRADE_HISTORY_PREFIX_SKIPPED`、`POSITION_DISCONTINUITY`は、問題区間をcycle集合から除外した証跡であり、除外前後を接続して完全履歴とみなす理由にはしない。

同一timestampで境界chainが複数成立する将来入力は評価不能である。現行実データでは同一startPosition分岐は0件であり、現行builderはstartPosition不一致時に進行中cycleを保存しない。ordering契約を変更する場合はevaluability versionを上げ、既存Runを暗黙再解釈しない。

## 4. v2 policy

| gate                           |     値 | 根拠                                                                  |
| ------------------------------ | -----: | --------------------------------------------------------------------- |
| minimum trusted closed cycles  |     30 | 実分布で12/46。20件の小標本より厳しく、50件の7/46より探索可能性を残す |
| minimum win rate               |   0.55 | 実中央値約0.415を明確に上回る                                         |
| minimum Profit Factor          |    1.0 | gross profitがgross loss以上である最低線                              |
| maximum top trade contribution |   0.50 | 実中央値約0.483。一取引が利益の過半を占めるwalletを除外               |
| maximum data age               | 24時間 | v1と同じfreshness契約                                                 |
| max auto selected              |    100 | v1と同じ上限。通過基準を緩めない                                      |

`averageWin / averageLoss / maxLosingStreak`は欠損・不正値を見逃さないため必須だが、現時点では投資閾値を追加しない。値を0で補完しない。

### 判定順

- `REVIEW`: Performanceなし、trade history評価不能、closed cycle不足、必須metric欠損・不正、stale。
- `EXCLUDED`: 評価可能かつfreshだがwin rate、Profit Factor、top contributionのいずれかがhard gate不通過。
- `QUALIFIED`: 全gate通過。ranking対象。
- `SELECTED`: rankが`maxAutoSelected`以内。

### deterministic ranking

1. win rate降順
2. trusted closed cycle count降順
3. Profit Factor降順
4. top trade contribution昇順
5. canonical address昇順

5取引で90%のwalletのようなsmall-sample dominanceは30-cycle hard gateでranking前に除外する。その後は要求された取引成功率を第一順位とし、同率時に標本数を優先する。weighted scoreやJavaScript `number`による金融比較は使わず、Decimal比較を行う。

## 5. v1/v2共存と永続化

- `wallet-selection-v1`: 連続NAV、annualized return、max drawdownを要求する従来policy。純粋関数、型、管理settingsを保持する。
- `wallet-selection-v2`: 無料sourceで証明できるclosed-cycle品質を使う通常自動policy。
- `WalletSelectionRun.policyVersion / policySnapshot / inputFingerprint`で両versionを区別する。
- `WalletSelectionResult.performanceRunId`は同じtrusted Runを参照し、Selection Runごとに結果を監査保存する。
- 既存schemaで表現できるためPrisma schema / migrationは不要である。
- v1用`WalletSelectionSettings`は後方互換の管理契約として維持する。v2 thresholdはpolicy versionのコード定数とRun snapshotを正本とし、v1設定更新で暗黙変更しない。

## 6. 自動flowとUI

正常系は`Discovery -> automatic promotion -> canonical sync / DQ -> trusted performance-v3 -> wallet-selection-v2 -> ranking -> Behavior`である。universeは同じDataSourceのDiscovery promotion relationだけを使う。`isWatched`やmanual INCLUDEへfallbackしない。既存EXCLUDEだけはdenylistとしてrankingとeffective selected setの両方へ適用する。

通常ranking UIはv2通過walletだけを表示し、rank、address、selected/qualified、closed cycle数、win rate、Profit Factor、average win、average loss、top trade contribution、latest activityを表示する。NAV由来のannualized return、cumulative return、max drawdownをv2画面の必須列にしない。

Behaviorは引き続き`listEffectiveSelectedWallets()`だけをSSoTとする。selected 0なら正常no-opであり、watched walletを代入しない。

## 7. Safety / acceptance

- `performance-v3`の金融式、cycle式、DQ lifecycle、quarantine、Selection v1を変更しない。
- incomplete historyをCOMPLETEへ変更しない。v2の`EVALUABLE`は証明済みclosed-cycle subsetの性質であり、source history completenessとは別概念である。
- threshold緩和、manual INCLUDE、有料source、Requester Pays、synthetic NAV、DB/Redis destructive操作を使わない。
- v2 policy、hard gate、tie breaker、missing/invalid/stale、v1 regression、API projection、UIを自動testする。
- live validationはcurrent 46 walletだけに限定し、既存8k+ enrichment backlogをdrainしない。
