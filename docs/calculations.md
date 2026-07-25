# 計算設計

最終更新: 2026-07-25

Phase 1 は金融計算を実装しない。本書はPhase 4–7で実装する決定論的計算の境界、式、精度、テスト要件を定義する。

## 1. 共通ルール

- 金額・価格・数量・率の演算にJavaScript `number` を使わない。
- APIから受けた数値文字列を `decimal.js` またはPrisma Decimalへ変換する。
- 永続化はPostgreSQL `numeric`、JSON出力は文字列とする。
- 入力不足時に0を補わず、`UNKNOWN` または計算不能を返す。
- 最終表示以外で丸めない。
- 丸め方法は原則 `ROUND_HALF_EVEN`。取引所固有のtick/lot丸めはadapter側で別途定義する。
- すべての計算結果に入力範囲、計算version、品質区分を関連付ける。

## 2. Time-Weighted Return

外部cash flow直前・直後で評価期間を分割する。

```text
periodReturn_i = (endingValue_i - externalFlow_i) / beginningValue_i - 1
TWR = Π(1 + periodReturn_i) - 1
```

### 境界条件

- `beginningValue_i <= 0` の期間は通常のTWRを計算しない。
- cash flowのtimestampが同一の場合は、transaction内順序または確定したordering ruleを使う。
- `UNKNOWN_CASH_FLOW` が含まれる場合、結果を推定値に格下げし、品質スコアを減点する。

## 3. 年率換算収益率

```text
annualizedReturn = (1 + cumulativeReturn)^(365.2425 / elapsedDays) - 1
```

- 分析期間が365日未満の場合は参考値表示とし、ランキングの長期評価には使わない。
- 累積リターンが `-100%` 以下、または期間が0以下の場合は計算不能。

## 4. 最大ドローダウン

```text
peak_t = max(equity_0 ... equity_t)
drawdown_t = equity_t / peak_t - 1
maxDrawdown = min(drawdown_t)
```

- 外部入出金調整済みequity curveを使う。
- 同一timestampは確定したevent orderに正規化する。
- peakが0以下の場合は計算不能。

## 5. 実効レバレッジ

```text
effectiveLeverage = grossPositionNotional / accountEquity
grossPositionNotional = Σ abs(positionQuantity * markPrice)
```

- `accountEquity <= 0` は有限値に捏造せず、リスク警告と計算不能を返す。
- 価格欠損が1銘柄でもある場合は品質状態を落とし、シグナルをfail closedにする。

## 6. Funding、手数料、損益

- 実現損益、含み損益、Funding、feeは別ledgerに記録する。
- 損益の符号規則は「口座残高を増やす値が正」。
- 取引所/APIが提供する実現損益を保存し、再構築値とは別カラムまたはprovenanceで比較する。
- ポジション損益は平均取得単価方式など採用方式をPhase 4で確定し、`docs/decisions.md`へ追記する。

## 7. スコア

```text
totalScore =
  performanceScore * 0.30 +
  riskScore * 0.25 +
  consistencyScore * 0.20 +
  reproducibilityScore * 0.15 +
  dataQualityScore * 0.10
```

- 各下位スコアは0–100へclampしたDecimal。
- 重み合計は厳密に1.00とする。
- 入力不足を0点扱いして順位を歪めず、計算不能または品質不足として分類する。

## 8. シグナル信頼度

```text
confidence =
  addressScore * 0.35 +
  dataQualityScore * 0.25 +
  signalFreshnessScore * 0.20 +
  liquidityScore * 0.10 +
  consensusScore * 0.10
```

- 70点未満はメール通知しない。
- LLM出力は入力にしない。
- 計算version、各項目、重み、最終値を保存する。

## 9. デモ約定

```text
demoExecutionPrice =
  detectedMarketPrice
  + signedSpread
  + signedSlippage
  + copyDelayAdjustment
```

- 売買方向に応じて不利な方向へコストを加える。
- fee、gas、funding、slippageを別ledgerで追跡する。
- 同じsignalとmodeから生成するdemo orderは一意にする。
- 実注文API・署名処理と共通interfaceを作らない。

## 10. テストベクトル

Phase 4以降で以下をfixture化する。

- 外部入出金のない単純な上昇・下落
- 複数cash flowを挟むTWR
- 0または負のequity
- 順不同eventの整列
- 同一eventの重複
- 価格・Funding欠損
- long/short、部分決済、反転
- 端数、非常に大きい値、非常に小さい値
- スコア境界の69.999…/70
- timezoneの日付境界

期待値はDecimal文字列として固定し、snapshotではなく明示的な値で検証する。
