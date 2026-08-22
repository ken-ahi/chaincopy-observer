# Phase 5 Behavior / Signal Roadmap

最終更新: 2026-08-22

## 1. 位置づけと目的

Phase 5では、Phase 4.3で正式選定された参考ウォレットのHyperliquid上のFill・Position変化を、決定論的かつ追跡可能な方法で分析し、通貨ごとのBUY / SELL判断材料へ変換する。

処理の責務は次の順に分離する。

```text
個々のFill・Position変化
  -> ウォレット単位の意味ある売買行動
  -> 複数ウォレットの通貨別集約
  -> ウォレット実績を考慮した重み付け
  -> BUY / SELL指標
  -> 指標の時間変化・方向転換
```

Phase 5は「判断を作る」ところまでを担当し、通知、デモトレード、実注文は実装しない。

本書は`docs/implementation-plan.md`のPhase 5.0〜5.4を詳細化するロードマップである。`docs/SPEC.md`末尾の旧フェーズ表と現行実装計画にPhase 6〜8の番号差があるため、本書では、より新しく具体的な`docs/implementation-plan.md`に従い、Phase 6をメール通知、Phase 7をデモトレード、Phase 8を戦略検証・改善として扱う。`docs/SPEC.md`に定める各機能要件、禁止事項、品質要件は変更しない。

## 2. 最終目的とMVPの流れ

ChainCopy Observerの目的は、成績の良いウォレットを一覧表示するだけではない。公開オンチェーンデータから次を実現する。

1. 長期間良好な実績を持つウォレットを発見する。
2. データ品質とパフォーマンスを評価する。
3. 参考にするウォレット集合を正式に選定する。
4. 選定ウォレットの現在の売買行動を分析する。
5. 複数ウォレットの集合知から再現可能な売買判断を生成する。
6. 判断を通知する。
7. 同じ判断をコピーした場合の仮想収益をデモトレードで検証する。
8. 検証結果を使って戦略を改善する。

```text
Data Collection
  -> Wallet Discovery
  -> Performance Analysis
  -> Reference Wallet Selection
  -> Behavior Analysis
  -> Signal Generation
  -> Notification
  -> Demo Trading
  -> Strategy Evaluation
```

実注文、ウォレット署名、秘密鍵・seed phraseの取得または保存、自動資金移動はMVP対象外とする。

## 3. Phase 5の入力契約

Phase 5が対象にするウォレット集合は、Phase 4.3のSelection機能をSingle Source of Truthとする。

- サービス契約: `listEffectiveSelectedWallets()`
- API契約: `GET /api/wallet-selection/effective-selected`
- 利用する識別・追跡情報: `walletAddressId`、`address`、`automaticStatus`、`manualOverride`、`selectionRunId`、`performanceRunId`

Phase 5側で独自の選定条件を再実装してはならない。`wallet-selection-v1`の判定規則、保存済み`performance-v3`の値および計算式も変更しない。Weightは選定集合内での影響度であり、Selectionとは別の責務とする。

## 4. Phase 5.0: Selected Wallet Behavior Event Normalization

### 4.1 責務

Hyperliquidの正規化済みFillやPosition変化を、「そのウォレットが何をしたか」を表すBehavior Eventへ変換する。Phase 5.0では、複数ウォレット集約、weight、BUY / SELL score、signal、通知、デモトレードを扱わない。

### 4.2 入力候補

- `listEffectiveSelectedWallets()`が返すselected wallet
- normalized fill
- position event
- position snapshot
- 必要な場合だけaccount snapshot

Fundingは売買方向判定そのものには使用せず、将来の補助情報として扱う。

### 4.3 出力候補

初期イベント候補は次のとおりとし、正式な名前と状態遷移はPhase 5.0仕様で固定する。

- `POSITION_OPEN`
- `POSITION_INCREASE`
- `POSITION_REDUCE`
- `POSITION_CLOSE`
- `DIRECTION_FLIP`

保持する属性の候補は次のとおりとする。

- `walletAddressId`
- `coin`
- `direction`: `LONG`または`SHORT`
- `occurredAt`
- `beforePosition`
- `afterPosition`
- `quantityDelta`
- `notionalDeltaUsd`
- `sourceEventId`
- `sourceType`
- `calculationVersion`

例として、直前positionが0 BTC、FillがBTC BUY 0.5、直後positionが+0.5 BTCであれば、`POSITION_OPEN`かつ`direction = LONG`となる。+0.5 BTCからBUY 0.2で+0.7 BTCなら`POSITION_INCREASE`、+0.7 BTCからSELL 0.3で+0.4 BTCなら`POSITION_REDUCE`となる。

### 4.4 必須特性と完了条件

- 決定論的かつ冪等である。
- 金融・数量計算にDecimalを使用する。
- sourceまで追跡でき、同じ入力とversionから同じイベントを生成できる。
- 不明確な状態を推測せず、position boundary不足時はfail closedとする。
- 選定ウォレットのHyperliquid履歴からBehavior Eventを再現可能に生成・保存できることを完了条件とする。

## 5. Phase 5.1: Coin-Level Wallet Behavior Aggregation

### 5.1 責務

Phase 5.0のウォレット単位Behavior Eventを、coin単位・時間bucket単位に集約する。walletの優劣による重み、BUY / SELL score、signal thresholdは扱わない。

### 5.2 出力契約候補

- `coin`
- `bucketStart`
- `bucketEnd`
- `uniqueWalletCount`
- behavior type別wallet数
- behavior type別notional
- direction別wallet数

同一walletが同一bucketで大量に取引しても、単純なFill件数だけで影響力が増えない設計とする。例えばBTCの15分bucketについて、LONG_OPEN、LONG_INCREASE、LONG_REDUCE、LONG_CLOSE、SHORT_OPEN、SHORT_INCREASEなどのwallet数を取得できる状態を目標とする。

完了条件は、「特定coinについて参考wallet群が何をしているか」を時間bucket単位で再現可能に取得できることである。

## 6. Phase 5.2: Wallet Weighting

### 6.1 責務

すべてのeffective selected walletを同じ1票として扱わず、保存済みPerformance情報を使って決定論的なweightを割り当てる。

Selectionは「参考集合に含めるか」、Weightは「集合内でどの程度影響させるか」を決める。Phase 5.2でSelection条件を再実装しない。

### 6.2 入出力と要件

入力候補はPhase 4で既に保存されている指標に限定する。

- `annualizedReturn`
- `maxDrawdown`
- `trustedClosedCycleCount`
- `topTradeContribution`
- data completeness

具体的な式はPhase 5.2仕様で固定する。計算はDecimalを使用し、weightを0以上の明示的な範囲に制限する。同一入力から同一weightを生成し、計算根拠とversionを保存する。欠損値を推測せず、LLMにweightを判断させない。

完了条件は、各effective selected walletについて再現可能なweightを取得できることである。

## 7. Phase 5.3: Deterministic BUY / SELL Signal Score

### 7.1 責務

Phase 5.1の行動集約とPhase 5.2のwallet weightを組み合わせ、coinごとのBUY / SELL判断指標を生成する。売買方向の指標を生成する責務はここで初めて持つ。

初期の方向対応候補は次のとおりとし、寄与係数はPhase 5.3仕様で固定する。

- LONG_OPEN / LONG_INCREASE: BUY方向
- LONG_REDUCE / LONG_CLOSE: SELL方向
- SHORT_OPEN / SHORT_INCREASE: SELL方向
- SHORT_REDUCE / SHORT_CLOSE: BUY方向

### 7.2 出力候補と制約

- `buyStrength`
- `sellStrength`
- `netSignal`
- `participatingWalletCount`
- `weightedParticipatingWalletCount`
- `confidence`
- `calculatedAt`
- `signalVersion`

Signalは必ず決定論的に計算し、入力、寄与、除外理由を説明可能にする。LLMはSignalを生成・変更してはならない。将来利用する場合も、決定済みSignalの理由を自然言語化する用途だけに限定する。

Phase 5.3ではEmail、push notification、demo order、actual orderを扱わない。完了条件は、coinごとに説明可能かつ再現可能なBUY / SELL指標を生成できることである。

## 8. Phase 5.4: Momentum / Direction Change Detection

### 8.1 責務

Phase 5.3で保存した過去Signal系列から、現在値だけでなく勢い、弱まり、方向転換を決定論的に検出する。

イベント候補は次のとおりとし、名前とthresholdはPhase 5.4仕様で固定する。

- `BUY_ACCELERATING`
- `BUY_WEAKENING`
- `SELL_ACCELERATING`
- `SELL_WEAKENING`
- `BULLISH_REVERSAL`
- `BEARISH_REVERSAL`

thresholdをversion管理し、過去Signalから再計算できるようにする。DB時刻はUTCを正本とし、表示時のJST変換と区別する。必要なbucketが欠損している場合はfail closedとし、補間や中立値への置換を行わない。Phase 5.4は通知を発行しない。

完了条件は、Signalの勢い、弱まり、方向転換を再現可能に判定できることである。

## 9. 全体データフロー

```text
listEffectiveSelectedWallets() ------------------------+
  -> Selected Wallets                                  |
  -> Hyperliquid normalized data                       |
  -> Phase 5.0 Behavior Event                          |
  -> Phase 5.1 Coin Aggregation ----+                  |
                                    |                  |
保存済みperformance-v3 -------------+-> Phase 5.2 Wallet Weight
                                                       |
Phase 5.1 Aggregation + Phase 5.2 Weight               |
  -> Phase 5.3 BUY / SELL Signal                       |
  -> Phase 5.4 Momentum / Direction Change             |
  -> Phase 6 Notification                              |
  -> Phase 7 Demo Trading                              |
  -> Phase 8 Strategy Evaluation                       |
```

Phase 5.2はPhase 5.1の集約結果を変換する工程ではなく、Selection SSoTと保存済みPerformanceを入力にweightを供給する独立責務である。Phase 5.3がPhase 5.1と5.2の成果を結合する。

## 10. Phase 6〜8との境界

### 10.1 Phase 6: メール通知

Phase 6はPhase 5.3 / 5.4で生成・保存済みのSignalとDirection Change Eventを届ける。通知側でSignalやthreshold判定を再計算しない。notification fingerprint、重複抑止、配信状態、rate limit、suppressionはPhase 6の責務とする。

### 10.2 Phase 7: デモトレード

Phase 7はPhase 5 Signalを入力に、仮想売買した場合のreturn、drawdown、win rate、fee、funding、slippage、copy delay、benchmarkとの差を検証する。Phase 7側で独自Signalを生成しない。実注文interfaceと共通化しない。

### 10.3 Phase 8: 戦略検証・改善

Phase 8はデモトレード結果を使い、wallet weight version、signal rule version、threshold version、aggregation windowなどを評価する。改善ルールは既存versionを書き換えず、新しいversionとしてPhase 5へ戻す。過去の入力と結果を再現可能に保つ。

## 11. 監査、再現性、冪等性

Phase 5の重要な結果から、少なくとも次を追跡可能にする。

- source walletとsource event
- `selectionRunId`と`performanceRunId`
- behavior version、weight version、signal version、threshold version
- input period
- `calculatedAt`

同じversionと同じ入力から同一結果を再生成できることを目標とする。同一イベントを再処理してもBehavior EventやSignalを重複生成せず、後続の通知・デモ注文の重複原因を作らない。

## 12. Fail-Closed原則

次の場合は推測でSignalを生成しない。

- selected wallet情報が不整合
- position boundaryが不明
- 必要な履歴が欠損
- data completenessが基準未満
- timestampが不正または順序が確定できない
- Decimalへ変換できない
- aggregation bucketの必須入力が不足
- Signal生成に必要な市場価格を取得できない

問題はData Qualityとして明示し、0や中立値で隠さない。Gap Recoveryが完了するまで新規Signalを停止し、復旧前の古いSignalを通知対象にしないという`docs/SPEC.md`の原則を後続Phaseでも維持する。

## 13. Worker / DB非機能要件

Phase 4.3.1で確立したWorker / DB安定化方針を維持する。

- DB queryは期間・件数をboundedにする。
- 大量入力はbatch processingし、一括`findMany`や巨大なJSON生成を避ける。
- Worker concurrencyを明示し、Queue backlog上限とbackpressureを設ける。
- jobと保存処理を冪等にし、同一wallet/jobの重複投入を抑止する。
- retry stormを防ぎ、次回tickによる安全な再試行を優先する。
- graceful shutdownでactive jobの完了を待つ。
- 件数、所要時間、失敗理由をstructured JSON logへ記録する。
- Worker heapを無制限に増加させない。
- 中間・監査データは再現性要件を確認したうえでretentionを設計する。
- cleanupはdry-run、bounded batch、index preflightを前提とし、Phase 4.3.1の保護対象を不用意に削除しない。

Phase 5追加によって、Phase 4.3.1以前の高負荷状態へ戻してはならない。

## 14. 共通完了ゲート

各sub-phaseで最低限次を実施する。

- 設計更新とschema / migration review
- Unit TestとIntegration Test
- 固定Decimalのdeterministic test vector
- idempotency test
- 欠損、重複、遅延、順序逆転のtest
- large dataset testとDB / Worker負荷確認
- E2Eへの影響確認とsecurity audit
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git diff --check`

設計だけを行うsub-phaseではschema / migrationを変更せず、review結果を仕様へ記録する。テストを無効化または省略して完了扱いにしない。

## 15. 実装順序

実装は必ずPhase 5.0、5.1、5.2、5.3、5.4の順に進める。各sub-phaseの入力契約と完了ゲートを満たしてから次へ進み、Phase 5.0完了前にPhase 5.3のSignal実装へ進まない。

## 16. 最終成果イメージ

Phase 5完了後は、Web上でcoinごとに、現在のBUY / SELL strength、一定期間の変化、参加wallet数、主なBehavior Event、上位weight walletの行動、`BUY_ACCELERATING`などの状態を表示できる設計とする。

表示は保存済みの決定論的結果を説明するものであり、WebやLLMがSignalを再計算しない。Phase 6はこれを通知し、Phase 7は同じSignalを仮想売買で検証する。

## 17. 禁止事項

- 実注文、実売買APIまたはExchange endpointの呼び出し
- wallet署名、秘密鍵・seed phrase・取引用APIキーの取得または保存
- 自動資金移動
- LLMまたはAIの判断によるSignalやweightの生成・変更
- Phase 4.3 Selection条件の再実装
- `performance-v3`の指標、式、保存値の変更
- 欠損データの推測補完
- Signal結果を良く見せるための恣意的な後付けルール
- JavaScript `number`による金融計算

## 18. Phase 5.0着手条件と次成果物

Phase 5.0実装は次を確認した後に開始する。

- Phase 4.3 Selectionが完了している。
- Phase 4.3.1 Runtime安定化が完了している。
- `listEffectiveSelectedWallets()`を利用できる。
- `performance-v3`が安定稼働している。
- Worker / DB負荷が許容範囲にある。
- 本ロードマップのレビューが完了している。

次の成果物は`docs/phase5-0-behavior-event-spec.md`とする。同仕様でBehavior Eventの型、状態遷移、source対応、冪等性、DB schema、backfill、incremental処理、fail-closed条件を確定する。
