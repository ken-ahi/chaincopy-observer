# Phase 4.3 参考ウォレット選定仕様

最終更新: 2026-08-08

## 1. 目的

監視中のHyperliquidウォレットから、Phase 5以降で売買行動の参考にする正式な集合を決定論的に作る。選定は投資推奨や利益保証ではなく、公開データ分析の入力集合を管理する処理である。

Phase 4.3では重み付き総合スコアを作らない。データの信頼性と最低条件をルール判定し、通過したウォレットだけを年率換算収益率で順位付けする。重み付けはPhase 5.2で扱う。

## 2. 対象集合と正本

- `DataSource.kind = HYPERLIQUID`
- `WalletAddress.isWatched = true`
- 保存済みの成功 `MetricCalculationRun`
- `calculationVersion = performance-v3`

Discovery Candidateは`WalletAddress`へ昇格するまで対象にしない。`performance-v2`へfallbackせず、欠損値を0や推測値で補わない。Performanceの式と保存値は変更しない。

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

## 6. 永続化と冪等性

- `WalletSelectionSettings`: Hyperliquid DataSourceごとの現行設定と、現在有効なSelection Runへのnullable pointer
- `WalletSelectionRun`: policy、設定snapshot、入力fingerprint、件数
- `WalletSelectionResult`: Run内のウォレット別自動状態、順位、理由、Performance Run参照
- `WalletSelectionOverride`: ウォレットごとの所有者指定

fingerprintにはsource、policy、設定、対象wallet ID、使用Performance Run ID、`lastSyncAt`、現在時点でのstale判定を安定順で含める。同一fingerprintの成功Runを再利用する。明示的な評価で新規作成または再利用したRunを現在有効なRunとしてsettingsのpointerへ設定する。新規Run、全Result、current pointerは1 DB transactionで保存し、部分結果やpointerだけの切替を残さない。過去Runの`evaluatedAt`は変更しない。

## 7. APIと再評価

- `GET /api/wallet-selection`
- `GET /api/wallet-selection/settings`
- `PATCH /api/wallet-selection/settings`
- `POST /api/wallet-selection/evaluate`
- `PATCH /api/wallet-selection/:address/override`
- `GET /api/wallet-selection/effective-selected`

自動schedulerやPerformance完了後の自動連鎖は追加しない。設定保存後も明示的な再評価が必要である。

## 8. Phase 5契約

`listEffectiveSelectedWallets()`と`GET /api/wallet-selection/effective-selected`をSelectionのSingle Source of Truthとする。戻り値は`walletAddressId`、`address`、`automaticStatus`、`manualOverride`、`selectionRunId`、`performanceRunId`を含む。Phase 5側で独自の選定条件を再実装しない。
