# Phase 4.3 参考ウォレット選定仕様

最終更新: 2026-09-23

## 1. 目的

Discoveryが自動発見・評価・昇格したHyperliquidウォレットから、Phase 5以降で売買行動の参考にする正式な集合を決定論的に作る。選定は投資推奨や利益保証ではなく、公開データ分析の入力集合を管理する処理である。所有者によるwatch登録やmonitor操作を正常系の前提にしない。

Phase 4.3では重み付き総合スコアを作らない。データの信頼性と最低条件をルール判定し、通過したウォレットだけを年率換算収益率で順位付けする。重み付けはPhase 5.2で扱う。

## 2. 対象集合と正本

- `DataSource.kind = HYPERLIQUID`
- 同DataSourceの`AddressCandidate.promotedWalletId`から参照される`WalletAddress`
- 保存済みの成功 `MetricCalculationRun`
- `calculationVersion = performance-v3`

Discovery Candidateは完全enrichmentで`ELIGIBLE`となり、自動promotionによって`WalletAddress`へ昇格するまで対象にしない。`WalletAddress.isWatched`は既存sync schedulerの購読状態としてpromotion時に有効化するが、Selection universeの条件には使用しない。したがって手動watch登録だけのwalletは自動universeに入らず、Discovery由来walletは所有者操作なしでuniverseに入る。`performance-v2`へfallbackせず、欠損値を0や推測値で補わない。Performanceの式と保存値は変更しない。

最低評価期間はPerformance Run全体の要求期間ではなく、`annualizedReturn`の`AddressPerformanceMetric.calculationFrom / calculationTo`で判定する。年率収益率Metricの期間が欠損、不正、逆転している場合はfail closedでREVIEWとする。

## 3. wallet-selection-v1

| 設定                          | 初期値 |
| ----------------------------- | -----: |
| `maxAutoSelected`             |    100 |
| `minimumEvaluationDays`       |     90 |
| `minimumTrustedClosedCycles`  |     20 |
| `minimumAnnualizedReturn`     |    `0` |
| `maximumDrawdown`             | `0.50` |
| `maximumTopTradeContribution` | `0.75` |
| `maximumDataAgeHours`         |     24 |

率と閾値はDecimal文字列またはPrisma Decimalとして扱う。金融比較にJavaScript `number`を使わない。

## 4. 自動判定

### REVIEW（要確認）

次の順で該当理由をすべて保持する。

| 条件                                                 | 理由コード                    |
| ---------------------------------------------------- | ----------------------------- |
| 成功したperformance-v3 Runがない                     | `NO_PERFORMANCE_V3`           |
| 履歴完全性が`COMPLETE`以外                           | `HISTORY_INCOMPLETE`          |
| 評価期間が最低日数未満                               | `EVALUATION_PERIOD_TOO_SHORT` |
| 完了取引が最低件数未満                               | `TOO_FEW_COMPLETED_TRADES`    |
| 年率収益率、最大下落、一取引利益寄与のいずれかがない | `REQUIRED_METRIC_MISSING`     |
| 最終同期が許容時間より古い、または不明               | `DATA_STALE`                  |

Performance Runがない場合は、その事実だけを`NO_PERFORMANCE_V3`として記録する。

### EXCLUDED（対象外）

REVIEWに該当しない場合だけ判定する。

| 条件                                                 | 理由コード                |
| ---------------------------------------------------- | ------------------------- |
| `annualizedReturn < minimumAnnualizedReturn`         | `RETURN_BELOW_MINIMUM`    |
| `abs(maxDrawdown) > maximumDrawdown`                 | `DRAWDOWN_TOO_HIGH`       |
| `topTradeContribution > maximumTopTradeContribution` | `PROFIT_TOO_CONCENTRATED` |

### SELECTED / QUALIFIED

REVIEWにもEXCLUDEDにも該当しないウォレットを次の順で並べる。

1. `annualizedReturn` 降順
2. `abs(maxDrawdown)` 昇順（保存Metricの符号契約を維持したうえで下落幅を比較）
3. `trustedClosedCycleCount` 降順
4. address 昇順

1位から`maxAutoSelected`件を`SELECTED`（参考対象）、残りを`QUALIFIED`（候補）とする。通過件数が上限未満でも水増ししない。通過ウォレットには上限外を含めて順位を保存する。

## 5. 手動Override

- `AUTO`: 自動判定を有効状態とする
- `INCLUDE`: 有効状態を`SELECTED`相当とする
- `EXCLUDE`: 有効状態を`EXCLUDED`相当とする

手動指定は自動状態、順位、理由コードを変更・削除しない。画面とPhase 5契約は`automaticStatus`と`manualOverride`を別々に返す。

通常画面は手動操作を提供しない。`EXCLUDE`はdenylist・調査対応用の管理機能として保持し、overall rankingとeffective selected setから対象walletを除外する。`INCLUDE`は後方互換の管理機能として保持するが、Discovery promotion、automatic universe、hard gate、overall rankingの成立条件には使用せず、REVIEW / EXCLUDED walletを通常rankingへ表示しない。将来の削除は別の移行判断とする。

## 6. 永続化と冪等性

- `WalletSelectionSettings`: Hyperliquid DataSourceごとの現行設定と、現在有効なSelection Runへのnullable pointer
- `WalletSelectionRun`: policy、設定snapshot、入力fingerprint、件数
- `WalletSelectionResult`: Run内のウォレット別自動状態、順位、理由、Performance Run参照
- `WalletSelectionOverride`: ウォレットごとの所有者指定

fingerprintにはsource、policy、設定、対象wallet ID、使用Performance Run ID、`lastSyncAt`、現在時点でのstale判定を安定順で含める。同一fingerprintの成功Runを再利用する。明示的な評価で新規作成または再利用したRunを現在有効なRunとしてsettingsのpointerへ設定する。新規Run、全Result、current pointerは1 DB transactionで保存し、部分結果やpointerだけの切替を残さない。過去Runの`evaluatedAt`は変更しない。

## 7. 自動連鎖、API、再評価

正常系は次の順で進む。

1. full enrichment済みCandidateが`ELIGIBLE`になった時点で、idempotentなpromotion jobを自動enqueueする。
2. promotionは既存の正式wallet backfillをenqueueし、既存sync / DQ契約で入力を作る。
3. DQ audit / gap recovery後の`performance-v3`成功時、Selectionを自動評価する。
4. Selection Runの保存または再利用後、そのRunの`evaluatedAt`をidentityに含むBehavior control jobをenqueueする。
5. effective selectedが0件ならBehaviorは従来どおり正常no-opとし、watched walletへfallbackしない。

Performance、Selection、Behaviorのどこかが失敗した場合、上流の保存済み成果を推測で補わず、idempotent job retryへ失敗を返す。Behavior queueのbackpressureでenqueueできない場合も成功扱いにしない。

- `GET /api/wallet-selection`
- `GET /api/wallet-selection/ranking`
- `GET /api/wallet-selection/settings`
- `PATCH /api/wallet-selection/settings`
- `POST /api/wallet-selection/evaluate`
- `PATCH /api/wallet-selection/:address/override`
- `GET /api/wallet-selection/effective-selected`

`GET /api/wallet-selection/ranking`は通常画面用であり、自動状態が`SELECTED / QUALIFIED`、rank・trusted performance・鮮度情報が存在し、`EXCLUDE`されていないwalletだけをrank順で返す。REVIEW / EXCLUDED、理由コード、手動INCLUDEによる見かけ上のSELECTEDは返さない。既存のfull Selection API、settings、evaluate、overrideは監査・管理用途として保持する。

設定変更直後の再評価は既存管理APIから明示実行できる。正常なデータ処理ではPerformance成功後に自動評価されるため、所有者操作は不要である。

## 8. Phase 5契約

`listEffectiveSelectedWallets()`と`GET /api/wallet-selection/effective-selected`をSelectionのSingle Source of Truthとする。戻り値は`walletAddressId`、`address`、`automaticStatus`、`manualOverride`、`selectionRunId`、`performanceRunId`を含む。Phase 5側で独自の選定条件を再実装しない。

## 9. Ranking表示

通常画面のdefault categoryはoverall rankingだけとする。overallは`wallet-selection-v1`の保存済みrankをそのまま表示し、UIで再計算しない。完了取引数、勝率、年率・累積収益率、Profit Factor、最大ドローダウン、最終活動を保存済みtrusted Performance / wallet snapshotから表示する。欠損値は`-`とし、0を捏造しない。

高勝率、取引数、risk-adjusted、low-drawdown、long-term consistency、leverage、DCAの別categoryは、現時点では独立した正式policy・必要metric・永続run contractがないため作らない。任意の重み付きscoreも導入しない。これらは信頼できる入力とversioned policyを別途承認できた場合に追加する。
