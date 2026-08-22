# Phase 5.0 Selected Wallet Behavior Event 正規化仕様

最終更新: 2026-08-22（実装前設計監査反映版）

## 1. 目的と適用範囲

Phase 5.0は、Phase 4.3でeffective selectedとなったHyperliquid walletの保存済み正規化FillとPosition境界を、決定論的、冪等かつ追跡可能なBehavior Eventへ正規化する。

本仕様は実装前の正式設計である。この変更では実装コード、Prisma schema、migration、既存API、Workerを変更しない。

Phase 5.0は売買戦略を決めない。個々のwalletについて「positionがどの状態からどの状態へ変化したか」を事実として表現し、Phase 5.1以降が再集約できる安定した入力を作る。

## 2. 既存契約と設計原則

### 2.1 Selectionの正本

対象wallet集合のSingle Source of Truthは`listEffectiveSelectedWallets()`とする。戻り値の`walletAddressId`、`address`、`automaticStatus`、`manualOverride`、`selectionRunId`、`performanceRunId`をそのまま使用する。

- Phase 5側で`wallet-selection-v1`の条件を再実装しない。
- `performance-v3`の計算式、Metric、Runを変更しない。
- backfill開始後にSelectionが変化しても、作成済みEventのprovenanceを書き換えない。
- 新しいSelection Runは新しい正規化対象snapshotとして扱う。

### 2.2 既存仕様の継承

- signed positionはLONGを正、SHORTを負、FLATを正確なDecimal zeroとする。
- BUYのposition deltaは正、SELLは負とする。
- Fillの公式`startPosition`をFill直前のpositionとして使用する。
- 反転は旧positionの終了と逆方向positionの開始に分割する。
- 欠損、gap、順序不明、position不一致を0やFLATで補わない。
- 金融・数量計算にJavaScript `number`を使用しない。
- DB時刻はUTCを正本とし、表示時だけJSTへ変換する。

## 3. Behavior Event model

### 3.1 正式名称

- ドメイン型名: `SelectedWalletBehaviorEvent`
- 論理テーブル名: `SelectedWalletBehaviorEvent`
- 物理テーブル候補: `selected_wallet_behavior_events`
- 初期version: `behavior-v1`

`behavior-v1`の意味を変更しない。状態遷移、ordering、notional規則のいずれかを変更する場合は新しいversionを発行する。

### 3.2 enum

`BehaviorEventType`は次の4種類とする。

- `POSITION_OPEN`
- `POSITION_INCREASE`
- `POSITION_REDUCE`
- `POSITION_CLOSE`

`DIRECTION_FLIP`は保存Event typeにしない。反転Fillを同一sourceから生成される`POSITION_CLOSE`と`POSITION_OPEN`の2 Eventへ分割する。

`BehaviorDirection`は`LONG`または`SHORT`とする。FLATはposition stateでありBehavior Eventのdirectionではない。

`BehaviorSourceType`は初期実装では`NORMALIZED_FILL`だけを許可する。将来別sourceを採用する場合はversionを上げる。

### 3.3 field契約

| field                         | 型候補           | NULL | 契約                                                                                    |
| ----------------------------- | ---------------- | ---- | --------------------------------------------------------------------------------------- |
| `id`                          | text/UUID        | 不可 | 内部主キー。意味を持たせない                                                            |
| `sourceId`                    | text             | 不可 | Hyperliquid DataSourceへのFK                                                            |
| `walletAddressId`             | text             | 不可 | `WalletAddress.id`へのFK                                                                |
| `coin`                        | text             | 不可 | source Fillの正規化済みcoin。空文字禁止                                                 |
| `eventType`                   | enum             | 不可 | 4種類のposition event                                                                   |
| `direction`                   | enum             | 不可 | Eventが作用するposition legのLONG/SHORT                                                 |
| `occurredAt`                  | timestamp(3) UTC | 不可 | source Fillの取引時刻                                                                   |
| `beforePosition`              | numeric(38,18)   | 不可 | このEvent leg直前のsigned position                                                      |
| `afterPosition`               | numeric(38,18)   | 不可 | このEvent leg直後のsigned position                                                      |
| `quantityDelta`               | numeric(38,18)   | 不可 | `afterPosition - beforePosition`。signed                                                |
| `priceUsd`                    | numeric(38,18)   | 不可 | source Fillの約定価格                                                                   |
| `notionalDeltaUsd`            | numeric(38,18)   | 不可 | `abs(quantityDelta) * priceUsd * contractMultiplier`                                    |
| `quoteAsset`                  | text             | 不可 | USD相当と確認したquote/collateral asset                                                 |
| `contractMultiplier`          | numeric(38,18)   | 不可 | 初期標準marketは`1`                                                                     |
| `marketDefinitionVersion`     | text             | 不可 | notional契約のmarket metadata version                                                   |
| `sourceType`                  | enum             | 不可 | 初期値`NORMALIZED_FILL`                                                                 |
| `sourceEventId`               | text             | 不可 | 正規化Fillの内部IDまたは不変な一意ID                                                    |
| `sourceExternalId`            | text             | 不可 | Hyperliquid transport共通の正規化external ID                                            |
| `sourceTradeId`               | text             | 不可 | Hyperliquid `tid`のexact integer string。identity・trace用でありcausal sequenceではない |
| `sourceFingerprint`           | text             | 不可 | source Fillの既存fingerprint                                                            |
| `sourceOrdinal`               | smallint         | 不可 | 通常0、flipのCLOSE=0、OPEN=1                                                            |
| `behaviorFingerprint`         | text             | 不可 | 本仕様8章のSHA-256                                                                      |
| `behaviorVersion`             | text             | 不可 | 初期値`behavior-v1`                                                                     |
| `createdByNormalizationRunId` | text             | 不可 | 最初にEventを生成した正規化Run。generation provenanceでありidentityではない             |
| `createdAt`                   | timestamp(3)     | 不可 | DB作成時刻。計算順序には使わない                                                        |

`SelectedWalletBehaviorEvent`本体に`selectionRunId`と`performanceRunId`を置かない。市場行動identity、正規化実行、Selection membershipを分離し、Selection情報は`BehaviorSelectionScope`で保持する。同じsource Fill由来EventをSelection Runごとに複製しない。

`createdByNormalizationRunId`は最初に保存した実行の監査参照であり、fingerprintへ含めない。再処理や別Selection RunでEventが再利用されても書き換えない。

## 4. Position状態遷移

### 4.1 基本式

source Fillごとに次をDecimalで計算する。

```text
signedFillDelta = side == BUY ? size : -size
sourceBefore = startPosition
sourceAfter  = sourceBefore + signedFillDelta
```

`size`と`price`は厳密に正でなければならない。`-0`はcanonical zeroへ正規化する。

### 4.2 全遷移表

| sourceBefore | sourceAfter | 条件                    | 生成Event           | direction   | Event before -> after       |
| ------------ | ----------- | ----------------------- | ------------------- | ----------- | --------------------------- |
| FLAT         | LONG        | `0 < after`             | `POSITION_OPEN`     | LONG        | `0 -> after`                |
| LONG         | LONG        | `after > before > 0`    | `POSITION_INCREASE` | LONG        | `before -> after`           |
| LONG         | LONG        | `0 < after < before`    | `POSITION_REDUCE`   | LONG        | `before -> after`           |
| LONG         | FLAT        | `before > 0, after = 0` | `POSITION_CLOSE`    | LONG        | `before -> 0`               |
| FLAT         | SHORT       | `after < 0`             | `POSITION_OPEN`     | SHORT       | `0 -> after`                |
| SHORT        | SHORT       | `after < before < 0`    | `POSITION_INCREASE` | SHORT       | `before -> after`           |
| SHORT        | SHORT       | `before < after < 0`    | `POSITION_REDUCE`   | SHORT       | `before -> after`           |
| SHORT        | FLAT        | `before < 0, after = 0` | `POSITION_CLOSE`    | SHORT       | `before -> 0`               |
| LONG         | SHORT       | `before > 0, after < 0` | CLOSE + OPEN        | LONG, SHORT | `before -> 0`, `0 -> after` |
| SHORT        | LONG        | `before < 0, after > 0` | CLOSE + OPEN        | SHORT, LONG | `before -> 0`, `0 -> after` |

`sourceBefore = sourceAfter`となるzero-size Fillは無効であり、Eventを生成せずData Quality Issueとする。

### 4.3 DIRECTION_FLIPの決定

反転は1つの`DIRECTION_FLIP`にせず2 Eventへ分割する。

理由:

1. `docs/calculations.md`とADR-025のPosition Cycle契約に一致する。
2. Phase 5.1がclose側とopen側を独立して数えられる。
3. Phase 5.3が「旧方向の解消」と「新方向の開始」を別の寄与として説明できる。
4. 各Eventでdirection、before/after、notionalが一義的になる。

同一Fillからの2 Eventは同じ`occurredAt`、source ID、fingerprintを持ち、`sourceOrdinal`だけをCLOSE=0、OPEN=1とする。

## 5. FillとPositionの対応

### 5.1 source of truth

Behavior Event生成の正本は保存済み`NormalizedTrade`相当の正規化Fillとし、特に公式`startPosition`、side、size、price、occurredAt、external IDを使用する。

- `PerpPositionEvent`はsnapshot時点の検証、coverage、gap検出、backfill boundary確認に使う。
- current `PerpPosition` / position snapshotは現在状態の照合に使うが、過去Eventを逆算する正本にはしない。
- raw eventは監査・再正規化用であり、Behavior正規化がraw JSON fieldへ直接依存しない。

### 5.2 Fillだけで判定できる条件

次をすべて満たすFillは単体で遷移を判定できる。

- 公式`startPosition`が有効なDecimalとして存在する。
- side、size、price、coin、occurredAt、external IDが有効である。
- 同一wallet・coinの直前に処理したFillの再構築後positionと`startPosition`が一致する、または処理区間の最初のFillで`startPosition = 0`である。
- 対象区間にopenなgap / truncationがない。

### 5.3 boundaryが必要な条件

backfill開始時の最初のFillが非zero `startPosition`を持つ場合、そのFill以前に開始したpositionの由来が不明である。snapshotだけから取引順序を推測せず、次のどちらかまでEvent生成を開始しない。

1. 取得期間を拡張し、信頼できるFLAT boundaryから連続したFill列を得る。
2. 後続Fillに公式`startPosition = 0`が現れた地点から、新しいtrusted segmentを開始する。

不明prefixからclose/reduce Eventを生成しない。Position snapshotをFLATと推測するために使用しない。

### 5.4 HTTP / WebSocket重複

HTTPとWebSocketはtransport共通の正規化external ID / fingerprintにより同じFillへupsert済みであることを入力条件とする。同じ`sourceEventId`または`sourceFingerprint`が複数行存在する場合は片方を選ばず`SOURCE_DUPLICATE_CONFLICT`で停止する。同一の保存済みFillが再読込された場合はBehavior unique keyによりno-opとする。

## 6. Canonical ordering

### 6.1 timestamp group

wallet・coinごとに`occurredAt`昇順で処理する。同じ`occurredAt`を持つFill全件を1つのtimestamp groupとし、group内をexternal IDまたは`tid`順で処理してはならない。

`sourceTradeId`にはHyperliquid `tid`をexact integer stringとして独立保存する。source Fillの一意性、追跡、競合検出には使うが、positionのcausal orderingを表すとはみなさない。DB取得順、HTTP/WS到着順、`createdAt`もorderingに使用しない。

### 6.2 一意transition chain

各Fillについて次の有向edgeを作る。

```text
edge.before = startPosition
edge.after  = startPosition + signedSizeDelta
```

timestamp group直前のtrusted positionをchain開始値とし、未使用edgeの`before`が現在positionと一致するFillを次候補とする。全Fillを1度ずつ使用してgroup後positionへ到達するchainを列挙・検証し、次の条件をすべて満たす場合だけEventを生成する。

1. 完全chainがちょうど1つ存在する。
2. 各stepのDecimalとtransitionが有効である。
3. group内の全Fillを過不足なく1度だけ使用する。
4. group終了positionが次のtimestamp groupのtrusted `startPosition`と整合する。ただし評価区間末尾ではこの後方検証を省略できる。

完全chainが0件なら`IMPOSSIBLE_TRANSITION`、2件以上なら`ORDERING_AMBIGUOUS`としてgroup全体をfail closedにする。最初に見つかったchain、external ID順、tid数値順などを恣意的に採用しない。

同じbefore/afterを持つidentityの異なるFillによりEvent列が意味的に同一でも、source対応が複数成立する場合は複数chainと判定する。

### 6.3 paginationとtimestamp group完全性

- keyset paginationの基本keyは`occurredAt`と安定したDB PKとするが、page末尾timestampと同じFillを追加queryで全件取得してからgroupを処理する。
- 同じtimestamp groupをread batch、write batch、transaction、continuation jobの境界で分割しない。
- group全体を取得できたことを確認できない場合は`INCOMPLETE_TIMESTAMP_GROUP`とし、cursorをgroup手前に留める。
- 通常read batch 5,000件をgroupが超える場合もgroupだけは全件取得する。ただし専用のtimestamp-group安全上限を設け、上限超過はfail closedとする。初期上限は実装前の負荷testで決定する。

### 6.4 逆転、duplicate、競合

- 遅れて到着したFillが確定済みcursor以前に入った場合、本仕様10章に従いtrusted boundaryから再処理する。
- 同一identity・同一payloadのduplicateはno-op、同一identity・異なるpayloadは`SOURCE_INCONSISTENT`とする。
- 不正timestamp、timestamp groupの取得不完全、chain不成立または複数成立を推測で補わない。

## 7. Decimalとnotional規則

### 7.1 canonical Decimal

Phase 5.0の保存済み入力はPrisma Decimalとして受け、計算には`decimal.js`またはPrisma Decimalを使用する。source adapterは既存契約どおり指数表記とleading `+`を含むexact decimal stringを受理し得るが、Behavior fingerprintとEvent出力では必ず次のcanonical non-exponent formへ変換する。NaN、Infinity、空文字は拒否する。

canonical formは次のとおりとする。

- base-10の非指数表記
- canonical出力にleading `+`なし
- 不要なleading zeroとfraction末尾zeroを除去
- 小数点以下が0だけなら整数表記
- `-0`、`0.0`、`00.000`はすべて`"0"`
- DB保存精度`numeric(38,18)`にexactに収まらない値は丸めず`INVALID_DECIMAL`とする

例: source parserが受理した`"+01.2300"`と`"01.2300"`はともに`"1.23"`、`"-0.000"`は`"0"`となる。

### 7.2 各値の符号

- `beforePosition` / `afterPosition`: LONG正、SHORT負、FLAT zero
- `quantityDelta`: `afterPosition - beforePosition`のsigned値
- `priceUsd`: 正のFill価格
- `notionalDeltaUsd`: 常に0より大きい`abs(quantityDelta) * priceUsd`

### 7.3 notional価格とquote provenance

`behavior-v1`はsource Fillの約定価格だけを使用する。mark price、oracle price、現在価格、近傍snapshot価格へ置換しない。

- 通常Event: `abs(sourceAfter - sourceBefore) * fillPrice * contractMultiplier`
- flip CLOSE: `abs(sourceBefore) * fillPrice * contractMultiplier`
- flip OPEN: `abs(sourceAfter) * fillPrice * contractMultiplier`

`price * abs(quantityDelta)`をUSD notionalとするのは、対象FillがHyperliquid Perpetualsであり、同期時点の公式market metadataから次を確認できる場合に限る。

- quantityがbase contract quantityである。
- Fill priceのquote/collateralがUSDまたはUSDC等のUSD相当資産である。
- contract multiplierが1、または保存済みmetadataにより決定論的に適用できる。
- 使用したmarket definition/versionを追跡できる。

標準Hyperliquid USDC建てPerpetualsはこの契約を満たすものとして扱える。custom DEX / custom marketは`quoteAsset`、`collateralAsset`、`contractMultiplier`、`marketDefinitionVersion`のprovenanceを必須とする。

quoteがUSD相当と証明できない場合の候補は、(A) Eventを保存して`notionalDeltaUsd = null`とする、(B) Event全体をfail closedにする、の2案である。Phase 5.1以降がwallet countだけを誤って有効集合へ含める危険を避けるため、**behavior-v1は(B)を採用し、`UNSUPPORTED_QUOTE`でEvent全体をfail closedにする。**

Fill価格が欠損、不正、非正の場合も`MISSING_OR_INVALID_FILL_PRICE`でfail closedとする。`SelectedWalletBehaviorEvent`には`quoteAsset`、`contractMultiplier`、`marketDefinitionVersion`を必須source snapshotとして保持する。

## 8. Idempotencyとfingerprint

### 8.1 source単位とtransition単位

1 Fillがflip時に2 Eventを生むため、冪等性はsource eventだけでなくtransition ordinalまで含める。

`behaviorFingerprint`は次のcanonical JSONをキー名順にUTF-8 encodeし、SHA-256 lowercase hexで作る。

```text
{
  behaviorVersion,
  walletAddressId,
  coin,
  sourceType,
  sourceEventId,
  sourceExternalId,
  sourceTradeId,
  sourceFingerprint,
  sourceOrdinal,
  eventType,
  direction,
  occurredAtUtcIso,
  beforePositionCanonical,
  afterPositionCanonical,
  quantityDeltaCanonical,
  priceUsdCanonical,
  notionalDeltaUsdCanonical,
  quoteAsset,
  contractMultiplierCanonical,
  marketDefinitionVersion
}
```

Selection Run、Performance Run、Normalization RunはEvent identityではないためfingerprintへ含めない。flipのCLOSE / OPENは同じsource Fillを持つため、ordinal 0 / 1を必ず含める。

### 8.2 unique constraint候補

- `UNIQUE (behavior_version, source_id, source_event_id, source_ordinal)`
- `UNIQUE (behavior_fingerprint)`

同じsource identityでfingerprintが異なる場合はupsert更新せず`SOURCE_INCONSISTENT`とする。backfillとincrementalは同じversion、source、ordinalを使うため二重生成しない。

## 9. Backfillとincremental処理

### 9.1 初回backfill

1. `listEffectiveSelectedWallets()`を1回呼び、Selection snapshotを固定する。
   current Selection Runが存在しない、またはeffective selectedが0件の場合は正常no-opで終了する。watched walletへfallbackしない。
2. walletを安定した`walletAddressId`順に分割する。
3. Selection membershipを`BehaviorSelectionScope`へ保存し、wallet・coinごとのNormalization Runを作る。
4. wallet・coinごとに有界期間、通常最大5,000 Fillのkeyset batchで取得する。
5. page末尾のtimestamp groupを追加取得し、同一groupを完全に揃える。
6. inclusive cursorにより最後に完了したtimestamp groupを次batchでも再取得し、DB uniquenessでduplicateを除く。
7. 最初のtrusted FLAT boundaryを確定する。
8. timestamp groupごとに一意transition chain、Decimal、gap、position連続性を検証する。
9. Behavior Eventを生成し、batch transactionで保存する。
10. wallet・coin cursorはtimestamp group全体とEvent保存成功後だけ単調に進める。

同一timestampだけで取得上限が埋まりcursorが進まない場合は`PAGINATION_STALLED`として停止する。

### 9.2 incremental

- Fill同期完了後に対象wallet・coin・時刻範囲をdedupeしたjobとして投入する。
- schedulerによる全wallet定期scanは初期実装では追加しない。
- job開始時にも現在のeffective selectionを確認する。未選定になったwalletの新規Event生成は停止するが、既存Eventを削除しない。
- cursorの一意keyは`sourceId + walletAddressId + coin + behaviorVersion`とする。
- cursorは`lastCompletedTimestamp`、`lastCompletedGroupFingerprint`、`lastAfterPosition`、`trustedBoundaryAt`、`trustedBoundaryPosition`、`behaviorVersion`を保持する。source external IDやtid 1件だけをgroup完了の証拠にしない。
- inclusive cursorで最後に完了したtimestamp group全体を再読込し、group fingerprintとEvent unique keyでno-opにする。

### 9.3 resumeとretry

- retryは最後にcommit済みのcursorから再開する。
- cursorより古いlate Fillは通常resumeで無視せず、本仕様9.4のbounded rebuild jobを作る。
- backfillとincrementalは同じpure normalization関数、ordering、fingerprintを使用する。
- version変更時は既存versionのEventを更新せず、新versionのbackfillを別Runで作る。

### 9.4 late Fillのbounded rebuild

late Fillを検知した場合、そのFillを含むtimestamp group以降を再構築する。

1. late Fill時刻以前へwallet・coin複合indexを逆向きkeyset scanする。
2. open Data Quality Issueやgapを跨がず、一意chain検証済みでpositionがFLATとなった直近timestamp groupをtrusted boundaryとする。
3. FLAT boundaryが有界探索上限内にない場合はwallet全履歴へ拡張せず`MISSING_BOUNDARY`で停止する。
4. boundary翌groupから、既存cursorまたは次の確定FLAT checkpointまでを再構築する。
5. 1 jobの最大Fill数・期間を超える場合はcontinuation jobへ分割する。ただしtimestamp groupは分割しない。
6. 影響範囲の旧Eventと新Eventをfingerprint比較し、Event置換、cursor、Issueを同一transactionで確定する。

初期の探索上限は最大50,000 Fillまたは30日間の先に到達した方とし、large dataset testで縮小方向に調整できる。上限拡大はversioned設定と負荷reviewを必要とする。

## 10. Fail ClosedとData Quality

| 条件                                 | code                            | 処理                                                       |
| ------------------------------------ | ------------------------------- | ---------------------------------------------------------- |
| boundary position不明                | `MISSING_BOUNDARY`              | trusted FLAT boundaryまでskipし、該当prefixはEvent化しない |
| open gap / API打切り                 | `HISTORY_GAP`                   | wallet・coinのgap以降または不完全範囲を停止                |
| API打切り                            | `HISTORY_TRUNCATED`             | 完全boundary外を停止                                       |
| timestamp不正                        | `INVALID_TIMESTAMP`             | sourceをpoison扱いにし停止                                 |
| Decimal不正・精度超過                | `INVALID_DECIMAL`               | sourceをpoison扱いにし停止                                 |
| 完全chainが複数                      | `ORDERING_AMBIGUOUS`            | timestamp group以降を停止                                  |
| timestamp group取得不完全            | `INCOMPLETE_TIMESTAMP_GROUP`    | groupを処理せずcursorを手前に保持                          |
| source identity衝突                  | `SOURCE_INCONSISTENT`           | 自動上書きせず停止                                         |
| chainが0件、position不連続、zero遷移 | `IMPOSSIBLE_TRANSITION`         | group以降を停止                                            |
| quote provenance不足                 | `UNSUPPORTED_QUOTE`             | Eventを作らず停止                                          |
| Fill価格欠損・非正                   | `MISSING_OR_INVALID_FILL_PRICE` | Eventを作らず停止                                          |
| 同一timestamp pagination停止         | `PAGINATION_STALLED`            | cursorを進めず停止                                         |

Behavior専用の`BehaviorDataQualityIssue`を正式採用する。最低限の正式reasonは`MISSING_BOUNDARY`、`ORDERING_AMBIGUOUS`、`INVALID_DECIMAL`、`SOURCE_INCONSISTENT`、`IMPOSSIBLE_TRANSITION`、`HISTORY_GAP`、`UNSUPPORTED_QUOTE`、`INCOMPLETE_TIMESTAMP_GROUP`とする。補助reasonを追加しても、この8 reasonの意味を変更しない。

Issue scopeはwallet、coin、source Fillまたはtimestamp group、normalization run、behaviorVersion、影響期間を構造化field/FKで保持する。fingerprintはreason、sourceId、walletAddressId、coin、group timestampまたはsourceEventId、behaviorVersionから作り、messageや可変detailsをidentityにしない。

lifecycleは`OPEN -> RESOLVED -> OPEN`の再検出を許可する。検出時は同一fingerprintをupsertして`lastDetectedAt`を更新し、解消確認後のbounded repair成功transactionでだけ`RESOLVED`へ移す。再評価で再現した場合は同じIssueを`OPEN`へ戻す。問題を0、FLAT、中立、nullable notionalで隠さない。

一部coinの停止は別coinを停止させない。ただし同一wallet・coinでは問題点より後のpath-dependent Eventを生成しない。

## 11. 論理DB schema案

実migrationは本作業では作成しない。migration設計時は既存物理名、enum、FK削除規則、PostgreSQLコメント規約を再確認する。

### 11.1 `BehaviorNormalizationRun`

正規化execution provenanceを保持する。候補物理名は`behavior_normalization_runs`。

- `id`
- `sourceId`: DataSource FK、Restrict
- `behaviorVersion`
- `walletAddressId`: WalletAddress FK、Restrict
- `coin`
- `calculationFrom` / `calculationTo`
- `inputFingerprint`
- `status`: `PENDING / RUNNING / SUCCEEDED / PARTIAL / FAILED / NOOP`
- `startedAt` / `completedAt`
- 入出力件数、Issue件数、error code/message
- unique候補: `(behaviorVersion, walletAddressId, coin, calculationFrom, calculationTo, inputFingerprint)`

`inputFingerprint`は対象期間、source Fill identityとfingerprint、timestamp group fingerprint、coverage、behaviorVersion、market definitionを安定順でincremental hash化する。Selection Runは市場入力identityではないため含めない。

### 11.2 `BehaviorSelectionScope`

Selection membership provenanceを保持する。候補物理名は`behavior_selection_scopes`。

- `id`
- `selectionRunId`: WalletSelectionRun FK、Restrict
- `walletAddressId`: WalletAddress FK、Restrict
- `performanceRunId`: nullable MetricCalculationRun FK、`SetNull`
- `behaviorNormalizationRunId`: BehaviorNormalizationRun FK、Restrict
- `automaticStatus`と`manualOverride`のsnapshot
- `evaluatedAt`: Selection Runの評価時刻
- `processedAt`: Phase 5.0でscopeを固定した時刻
- unique候補: `(selectionRunId, walletAddressId, behaviorNormalizationRunId)`

current Selection Runがなければscopeを作らず`NOOP`として終了する。同一Behavior EventをSelection Runごとに複製しない。

### 11.3 `SelectedWalletBehaviorEvent`

3章のfieldを保持する。

- FK: `sourceId -> DataSource.id`はRestrict
- FK: `walletAddressId -> WalletAddress.id`はRestrict
- FK: `sourceEventId -> NormalizedTrade.id`はRestrict
- FK: `createdByNormalizationRunId -> BehaviorNormalizationRun.id`はRestrict
- Selection Run / Performance Run FKはEvent本体に置かない
- source snapshotとしてexternal ID、sourceTradeId、fingerprint、side、size、price、startPosition、occurredAt、quoteAsset、contractMultiplier、marketDefinitionVersionを保持する
- unique: 8.2節の2制約
- index: `(walletAddressId, coin, occurredAt, sourceOrdinal, id)`
- index: `(coin, occurredAt, walletAddressId)`。Phase 5.1のbounded scan用
- index: `(createdByNormalizationRunId)`

source Fillは現行では分析正本としてretention対象外でありRestrict FKと整合する。将来Fill retentionを導入する場合、Behavior Eventのsource snapshotだけで再現・監査できることを別ADRで確認し、FKを`SetNull`へ変更するmigrationを先に行う。silent cascade deleteは禁止する。

### 11.4 `BehaviorNormalizationCursor`

候補物理名は`behavior_normalization_cursors`。`(sourceId, walletAddressId, coin, behaviorVersion)`で一意とし、9.2節のgroup-safe cursor値、`lastAttemptedAt`、`lastSuccessfulAt`、status、errorを保持する。cursor更新はtimestamp group Event保存と同じtransactionで行う。

### 11.5 `BehaviorDataQualityIssue`

候補物理名は`behavior_data_quality_issues`。fingerprint一意、正式reason、status、severity、message/details、source・wallet・coin・behaviorVersion・normalization run・nullable source Fill / group timestamp・影響期間、first/last detected、resolvedAtを持つ。DataSource、Wallet、Normalization RunはRestrict、source FillはEventと同じlifecycle方針とする。

### 11.6 retention

Behavior EventはPhase 5.1以降の分析正本かつ再現性根拠なので初期実装では自動削除しない。Run、cursor、open Data Quality Issueも削除しない。将来retentionを導入する場合は、元Fillの保持、再生成時間、下流集約の再現性を確認し、別ADRとmigrationで決定する。

### 11.7 index導入方針

既存`normalized_trades`の想定queryは、wallet・coin・期間のkeyset scan、timestamp group全件取得、late Fill時の過去方向trusted boundary探索である。候補indexは`(wallet_address_id, coin, occurred_at, id)`とし、`sourceTradeId`列追加後に実際のkeyset keyを含めるか`EXPLAIN`で比較する。

実DBで約1.08 GiBの既存tableに通常の`CREATE INDEX`を含むPrisma migrationを適用してはならない。schema変更と新規Behavior table作成をmigrationで行い、既存tableの大規模indexはtransaction外のmaintenance SQLによる`CREATE INDEX CONCURRENTLY`へ分離する。`pg_stat_progress_create_index`、`indisready`、`indisvalid`を確認し、代表queryの`EXPLAIN`でIndex Scanが選ばれるまでbackfillを開始しない。

新規空Behavior tableのunique/indexはmigration内で作成できる。Phase 5.1向けに`SelectedWalletBehaviorEvent(coin, occurredAt, walletAddressId)`を設ける。scopeは`(selectionRunId, walletAddressId)`、Issueは`(walletAddressId, coin, status, affectedFrom)`、cursorは11.4節の複合uniqueを候補とする。

## 12. Worker設計案

- queue名: `behavior-normalization`
- backfill job名: `backfill-selected-wallet-behavior`
- incremental job名: `normalize-selected-wallet-behavior`
- repair job名: `rebuild-wallet-coin-behavior-segment`
- `concurrency = 1`
- `read batch = 5,000` Fill
- `write batch = 1,000` Event
- priority: 通常同期、Gap Recovery、手動同期、候補Enrichmentより低い`20`を推奨。既存Performanceの`15`よりも低くする
- attempts: 最大3回、指数backoff。poison eventは自動retryしない
- backlog limit: 専用設定、初期値500。上限時は新規incremental投入を止める
- deduplication key: job name、walletAddressId、coin、behaviorVersion、bounded range
- scheduler: 初期実装ではなし。明示backfillとFill同期完了eventだけを使用

同一timestamp groupはread 5,000またはwrite 1,000を超えても分割しない。group完全取得後に安全上限を超えた場合はIssue化する。巨大walletでも全履歴をJS heapへ保持せず、keyset batchごとに処理し、入力が残ればbounded rangeとcursorを持つcontinuation jobを投入する。job dedupeにより同じcontinuationを重複投入しない。

Phase 4.3.1に従い、無制限catch-up、全wallet一括query、巨大JSON fingerprint、一括transactionを禁止する。専用queue backlogが500以上なら新規enqueueを止め、次のFill同期完了機会へ委ねる。shutdownはactive timestamp group / batch完了を待ち、wallet、coin、入力件数、出力件数、group件数、cursor、durationMs、heap使用量、停止codeをstructured JSON logへ出す。

## 13. Transaction、partial failure、poison event

### 13.1 transaction境界

1 transactionは1 wallet・1 coin・通常最大1,000 Eventとする。同一timestamp groupが1,000 Eventを超える場合はgroupを分割せず、timestamp-group安全上限まで1 transactionで扱う。安全上限超過は`INCOMPLETE_TIMESTAMP_GROUP`として保存を行わない。同transactionで次を行う。

1. source continuityの再確認
2. Eventのinsert / late-event rebuild時の対象区間置換
3. normalization runの件数更新
4. cursor更新
5. 発生または解消したData Quality Issue更新

transaction commit前にcursorを進めない。複数wallet・coinを1 transactionへ入れない。

### 13.2 partial failure

- batch失敗時は全rollbackし、直前cursorからretryする。
- あるwallet・coinの失敗は別wallet・coinのcommitをrollbackしない。
- Runは全対象成功で`SUCCEEDED`、一部がData Qualityで停止し他が成功した場合`PARTIAL`、保存可能Eventがなくsystem errorなら`FAILED`とする。
- `PARTIAL`を完全な成功として下流へ渡さず、coin/期間coverageを明示する。

### 13.3 poison event

同じsourceで決定論的validation errorが再現する場合はpoison eventとし、Data Quality Issueを記録してそのwallet・coinを停止する。指数retryを繰り返さない。source correctionまたはIssue解消を確認した明示repair jobだけが再開する。

## 14. 固定Decimalテストベクトル

共通条件: wallet=`wallet-1`、coin=`BTC`、price=`"100"`、`behaviorVersion="behavior-v1"`。各caseは独立し、sideとsizeからsigned deltaを作る。表のposition、delta、notionalはcanonical Decimal文字列である。

|   # | case / input                                                                                               | 期待Behavior Event                                                                                                                  |
| --: | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
|   1 | LONG open: before `"0"`, BUY size `"0.5"`                                                                  | OPEN LONG, `0 -> 0.5`, delta `"0.5"`, notional `"50"`, ordinal 0                                                                    |
|   2 | LONG increase: before `"0.5"`, BUY `"0.2"`                                                                 | INCREASE LONG, `0.5 -> 0.7`, delta `"0.2"`, notional `"20"`                                                                         |
|   3 | LONG partial reduce: before `"0.7"`, SELL `"0.3"`                                                          | REDUCE LONG, `0.7 -> 0.4`, delta `"-0.3"`, notional `"30"`                                                                          |
|   4 | LONG close: before `"0.4"`, SELL `"0.4"`                                                                   | CLOSE LONG, `0.4 -> 0`, delta `"-0.4"`, notional `"40"`                                                                             |
|   5 | SHORT open: before `"0"`, SELL `"0.5"`                                                                     | OPEN SHORT, `0 -> -0.5`, delta `"-0.5"`, notional `"50"`                                                                            |
|   6 | SHORT increase: before `"-0.5"`, SELL `"0.2"`                                                              | INCREASE SHORT, `-0.5 -> -0.7`, delta `"-0.2"`, notional `"20"`                                                                     |
|   7 | SHORT reduce: before `"-0.7"`, BUY `"0.3"`                                                                 | REDUCE SHORT, `-0.7 -> -0.4`, delta `"0.3"`, notional `"30"`                                                                        |
|   8 | SHORT close: before `"-0.4"`, BUY `"0.4"`                                                                  | CLOSE SHORT, `-0.4 -> 0`, delta `"0.4"`, notional `"40"`                                                                            |
|   9 | LONG -> SHORT: before `"0.5"`, SELL `"0.8"`                                                                | ordinal 0 CLOSE LONG `0.5 -> 0`, delta `"-0.5"`, notional `"50"`; ordinal 1 OPEN SHORT `0 -> -0.3`, delta `"-0.3"`, notional `"30"` |
|  10 | SHORT -> LONG: before `"-0.5"`, BUY `"0.8"`                                                                | ordinal 0 CLOSE SHORT `-0.5 -> 0`, delta `"0.5"`, notional `"50"`; ordinal 1 OPEN LONG `0 -> 0.3`, delta `"0.3"`, notional `"30"`   |
|  11 | duplicate: 同一external ID、fingerprintのcase 1を2回入力                                                   | Eventは1件。2回目はunique keyでno-op、Issueなし                                                                                     |
|  12 | same timestamp unique chain: Fill A before `0.2` BUY `0.3`、Fill B before `0` BUY `0.2`をA,Bの到着順で入力 | ID/tid/到着順でなくtransition接続によりB,Aの一意chain。OPEN LONG `0 -> 0.2`、INCREASE LONG `0.2 -> 0.5`                             |
|  13 | same timestamp ambiguous chain: identityの異なるA/Bがともに`0 -> 0.2`、C/Dがともに`0.2 -> 0`               | A-C-B-D、B-C-A-D等が成立。`ORDERING_AMBIGUOUS`、group Eventなし、cursor不進行                                                       |
|  14 | same timestamp > batch: 5,001 Fillが各`i * 0.001 -> (i+1) * 0.001`の一意chain                              | read 5,000で分割せず5,001件groupを追加取得し、1 chainとして処理。writeはgroup単位transaction                                        |
|  15 | tid numeric order != causal: tid `"100"`が`0 -> 0.2`、tid `"2"`が`0.2 -> 0.5`                              | tid 2を先にせずtid 100、2のtransition chain。sourceTradeIdはEventへ保持                                                             |
|  16 | missing boundary: 履歴最初のFillがbefore `"1"`, SELL `"0.2"`                                               | `MISSING_BOUNDARY`。このreduce Eventを作らず、次のtrusted FLAT boundaryまでskip                                                     |
|  17 | gap detected: before `"0"`のOPEN後、coverageにopen gap、後続before `"0.5"` SELL `"0.5"`                    | gap前のOPENだけ保存可。後続CLOSEは作らず`HISTORY_GAP`、cursorはgap前まで                                                            |
|  18 | late Fill rebuild: 保存済み`0 -> 0.5 -> 0`の間へ同時刻groupを完成させるlate Fillが到着                     | 直近trusted FLAT boundaryからbounded rebuildし、影響Eventを置換。無関係な前segmentは不変                                            |
|  19 | no Selection Run                                                                                           | current Selection Runなしでbackfill起動                                                                                             | `NOOP`、scope/Event/job追加なし。watched wallet fallbackなし          |
|  20 | Selection Run変更                                                                                          | Run Aで生成済みEventのwalletがRun Bでもselected                                                                                     | Event行・fingerprintは増えず、Run Bの`BehaviorSelectionScope`だけ追加 |
|  21 | unsupported quote                                                                                          | custom marketでquote/collateral provenanceなし                                                                                      | `UNSUPPORTED_QUOTE`、Eventなし、Issue OPEN                            |
|  22 | source Fill lifecycle                                                                                      | Event参照中のNormalizedTradeまたはWallet削除を試行                                                                                  | Restrict FKで拒否され、Eventとsource snapshotが残る                   |
|  23 | incomplete timestamp group                                                                                 | page末尾groupの追加取得が失敗                                                                                                       | `INCOMPLETE_TIMESTAMP_GROUP`、group Eventなし、cursorはgroup手前      |
|  24 | source identity conflict                                                                                   | 同じsource IDでfingerprintまたはsnapshot値が異なる                                                                                  | `SOURCE_INCONSISTENT`、既存Eventを上書きしない                        |

追加必須testとして、`"+01.2300" -> "1.23"`、`"-0.000" -> "0"`、38桁超過、非正price、flip retry、group-safe resume、continuation重複、batch途中rollback、複数Selection Scopeから同一Eventを参照する再計算も実装する。

## 15. Phase 5.0の対象外

- coin-level aggregation
- wallet weight
- BUY / SELL signalおよびconfidence
- momentum / direction change
- notification
- demo trade
- actual order、Exchange endpoint、wallet署名、秘密鍵、seed phrase、資金移動
- Fundingを用いた方向判定
- `wallet-selection-v1`の再実装
- `performance-v3`の変更
- LLMによるEvent分類またはSignal生成

## 16. 実装完了時の受入条件

1. `listEffectiveSelectedWallets()`だけから対象集合を取得する。
2. 本仕様の4 Event typeと全10状態遷移を実装する。
3. flipをCLOSE + OPENへ決定論的に分割する。
4. normalized Fillを正本とし、公式`startPosition`との連続性を検証する。
5. timestamp groupの一意transition chainがarrival順、external ID順、tid順に依存しない。
6. 全金融・数量計算がDecimalで、canonical formと`numeric(38,18)`を守る。
7. USD相当quote provenanceを確認できるmarketだけFill価格からnotionalを計算し、unsupported quoteをfail closedにする。
8. backfill、incremental、retry、late-event rebuildが同じEventを重複生成しない。
9. boundary、gap、timestamp、Decimal、ordering、source、transition不整合がfail closedになる。
10. Event、Normalization Run、Selection Scope、Cursor、Behavior Data Qualityのmigrationがreview済みで、FK、unique、index、削除規則が確認される。
11. queryとtransactionがboundedで、backpressure、concurrency 1、graceful shutdownを満たす。
12. 14章の固定test vector、Unit、Integration、idempotency、large dataset、retry testが成功する。
13. 同一入力と`behavior-v1`から同一fingerprintとEvent列を再生成できる。
14. Phase 5.1がcoin・期間でboundedにEventを取得できるindexとcoverage契約を持つ。
15. `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、security audit、`git diff --check`が成功する。
16. 実注文、署名、秘密情報、通知、デモ注文、Signal生成が実装に含まれない。

## 17. 実装時の変更予定ファイル群

実際の配置は着手時のリポジトリ構成を再確認するが、変更範囲は次を想定する。

- `prisma/schema.prisma`
- `prisma/migrations/<timestamp>_phase5_0_behavior_events/migration.sql`
- `scripts/maintenance/create-phase5-behavior-indexes-concurrently.sql`
- `packages/analytics/src/`配下のpure normalization型・関数・test
- `apps/worker/src/behavior/`配下のqueue、service、fingerprint、backfill/incremental処理・test
- 既存Fill同期完了箇所のbounded job enqueue連携
- `packages/database`の生成client/export
- `docs/database.md`、`docs/architecture.md`、`docs/operations.md`、`docs/decisions.md`
- `.env.example`とREADME（新しいWorker設定を追加する場合）

既存APIの変更はPhase 5.0の必須範囲に含めない。Phase 5.1またはWeb表示で必要になるまで公開APIを追加しない。

## 18. migration前の再確認事項

設計監査で実名・値域・timestamp衝突・既存index・lifecycleは確認済みである。物理schemaへ落とす直前には次を検証する。

1. `NormalizedTrade`へ`sourceTradeId`をbackfillできるraw/source契約と、coin内`:`に依存しない抽出方法。
2. 標準Perpetualsとcustom marketを区別するmarket metadataの取得・version・保存方法。
3. `BehaviorSelectionScope`で当時の集合と現在の集合を再現するPhase 5.1 query。
4. Restrict FK追加が既存Wallet、Fill、Selection、Performanceの削除・cleanup運用へ与える影響。
5. `(walletAddressId, coin, occurredAt, id)`候補indexとsourceTradeIdを含む候補を代表queryの`EXPLAIN`で比較する。
6. concurrent index用の空き容量、replication lag、長時間transaction、invalid index回復手順。
7. 5,000読込、1,000書込、concurrency 1、最大timestamp groupでのDB lock、WAL、heap、処理時間。
8. 50,000 Fill / 30日のlate Fill探索上限でtrusted boundaryを取得できない実データ比率。
9. migrationに日本語table/column commentを付け、新table indexだけが通常migrationに含まれること。

## 19. 実装READYと運用backfill開始条件

本仕様改訂によりordering、provenance分離、unsupported quoteのfail-closed方針、Behavior専用Data Quality、FK基本方針、index/Worker方針は設計上確定した。実装READYと実DB backfillの運用開始は別の判定とする。

### 19.1 実装READY条件

Phase 5.0のschema / migration / pure normalization / Worker実装Issueへ進む最低条件は次のすべてである。

1. 本仕様の一意transition chain規則がreview承認されている。
2. Event identity / Normalization Run / Selection Scopeの分離schemaがreview承認されている。
3. 標準marketとcustom marketのnotional quote provenance取得契約がadapter仕様として固定されている。
4. Event、source Fill、Wallet、Normalization Run、Selection Run、Performance RunのFK lifecycleがmigration reviewで確定している。
5. `BehaviorDataQualityIssue`のreason、scope、再評価lifecycleが確定している。
6. 既存Fill indexの`CREATE INDEX CONCURRENTLY` maintenance手順と新table indexが確定している。
7. current Selection Runなしを正常no-opとし、watched walletへfallbackせず、Phase 5実装がSelection Runを作らない契約が固定されている。
8. 14章の追加test vectorをpure設計testへ落とせることがreviewされている。
9. Phase 5.0仕様レビューが完了し、未解決の設計BLOCKERが0件である。

current Selection Runが0件であることは実装BLOCKERではない。no-op、scope/Event/job非生成をtestするための正式な入力状態である。

### 19.2 実DB backfill運用開始条件

実装・migration review・CI完了後も、実DB backfillは次を満たすまで開始しない。

1. Phase 4.3の正式evaluate手順によりcurrent Selection Runが作成されている。
2. `listEffectiveSelectedWallets()`を実データで検証している。
3. 既存Fill複合indexのCONCURRENTLY作成と`EXPLAIN`確認がOwner承認下で完了している。
4. market metadata、quote provenance、Data Quality、Worker負荷のoperational validationが完了している。
5. migrationの実DB適用とbackfill起動についてOwnerが明示承認している。

実装READY条件未達は`BLOCKED`、実装READY後に運用条件だけが未達の場合は「implementation READY / operational backfill BLOCKED」と報告する。
