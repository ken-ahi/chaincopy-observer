# Phase 5.0 実装前設計監査

監査日: 2026-08-22

## 1. 結論

**判定: Phase 5.0のmigration・実装開始は不可。設計修正と入力契約の補強が必要である。**

pure normalization関数とfixture作成の準備は開始できるが、現在の`docs/phase5-0-behavior-event-spec.md`のままschema、migration、backfill Workerへ進んではならない。

主なBLOCKERは次の3点である。

1. 同一wallet・coin・millisecondのFill順序を意味的に確定できるsource sequence列がない。
2. Behavior Event identityとSelection membership provenanceがEvent本体で混在している。
3. 監査正本として残すEventと、既存親modelの`onDelete: Cascade`が整合していない。

実DBにはSelection Runが0件であり、実データを用いたeffective selected wallet backfillの開始条件もまだ成立していない。

## 2. 監査方法と実DBスナップショット

次を読み取り専用で確認した。

- `docs/phase5-0-behavior-event-spec.md`
- `docs/phase5-behavior-signal-roadmap.md`
- `docs/calculations.md`
- `docs/database.md`
- `docs/decisions.md`
- `prisma/schema.prisma`
- Hyperliquid schema、mapper、HTTP client、repository、sync service
- Position Cycle計算とPerformance repository
- Sync Cursor、Gap Recovery、Data Quality実装
- PostgreSQLの件数、値域、timestamp衝突、index、table size

監査時の実DB事実:

| 項目 | 値 |
| --- | ---: |
| `normalized_trades` | 1,339,748行 |
| Fillを持つwallet | 14 |
| table + index size | 1,160,642,560 bytes、約1.08 GiB |
| 最大wallet Fill数 | 1,187,606 |
| wallet別中央値 | 5,079 |
| Fill期間 | 2024-12-06 21:58:22.299〜2026-08-18 14:36:26.339 |
| millisecond未満のtimestamp | 0件 |
| 同一wallet・coin・timestamp衝突group | 230,659 |
| 衝突group内Fill | 744,222行 |
| 最大同時刻group | 153行 |
| `perp_position_events` | 3,356,798行 |
| Data Quality Issue | 697件 |
| Performance Run | 21,031件 |
| Selection Run | 0件 |

## 3. PASS / BLOCKER / NEEDS_DECISION一覧

| # | 監査項目 | 判定 | 要旨 |
| --: | --- | --- | --- |
| 1 | Normalized Fill model | PASS | 必須position復元値は保存済み。ただしsource sequence欠如は項目3のBLOCKER |
| 2 | `startPosition` | PASS | 公式fieldを文字列のままmapperからDecimal列へ保存。通常遷移とflipを復元可能 |
| 3 | Canonical ordering | BLOCKER | 同時刻衝突が大量にあり、`tid`専用列なし。external ID fallbackは意味順序を保証しない |
| 4 | USD notional | NEEDS_DECISION | `price * size`契約は既存コードと整合するが、custom DEX coinを含む全coinのUSD quote provenanceが保存されない |
| 5 | Timestamp | PASS | APIは安全な整数millisecond、DBは`timestamp(3)`相当。精度損失はないが衝突は常態 |
| 6 | Decimal | PASS | 既存・候補とも`numeric(38,18)`。実値域と全Fillの積は収まる |
| 7 | Data Quality | NEEDS_DECISION | 汎用modelでcode/detailsは表現可能だがcoin/version/run/sourceの構造化参照がない |
| 8 | FK / lifecycle | BLOCKER | Wallet、Selection Result、Performance等のCascadeと監査正本保持が衝突 |
| 9 | Selection provenance | BLOCKER | Event非複製とEvent上の必須`selectionRunId`が複数Run membershipを表せない |
| 10 | Late Fill / backfill | BLOCKER | Fillは残るが、同時刻ordering未解決のためtrusted segmentを安全に再構築できない |
| 11 | Index | NEEDS_DECISION | 新table indexは通常migration可。1.08 GiB既存Fill tableへの複合indexはCONCURRENTLY分離が必要 |
| 12 | Worker負荷 | PASS（条件付き） | read 5,000 / write 1,000 / concurrency 1は安全な初期値。keyset streaming必須 |

## 4. Normalized Fillの実schema・保存契約

### 4.1 確認結果

実model名は`NormalizedTrade`、物理tableは`normalized_trades`である。

| 要求項目 | 実装 |
| --- | --- |
| PK | `id String @id @default(cuid())` |
| external/source ID | `externalTradeId = ${time}:${coin}:${tid}` |
| fingerprint | wallet、external ID、hash、oidから生成 |
| unique | `(sourceId, externalTradeId)`、`(sourceId, fingerprint)` |
| wallet | `walletAddressId String` |
| coin | `coin String` |
| side | `TradeSide`、API `B -> BUY`、`A -> SELL` |
| quantity | `size Decimal(38,18)` |
| price | `price Decimal(38,18)`、API `px` |
| startPosition | `startPosition Decimal(38,18)`、API同名field |
| occurredAt | `DateTime`、API millisecond epochから`Date`へ変換 |
| source sequence | 専用列なし。`tid`はexternal ID文字列へ埋込み |
| DataSource FK | `sourceId`、`onDelete: Restrict` |
| Wallet FK | `walletAddressId`、`onDelete: Cascade` |
| index | `(walletAddressId, occurredAt)`、`(coin, occurredAt)` |

`saveFills()`は`mapFill()`の全fieldを`createMany({ skipDuplicates: true })`で保存する。HTTP / WebSocket duplicateはDB uniqueで抑止される。identityが同じでpayloadが異なる場合、`skipDuplicates`により差異が明示されず既存行が残るため、Phase 5.0読込時のsource inconsistency検知だけでは過去の競合payloadを復元できない。この点はData Quality監査の追加候補である。

### 4.2 external IDの注意

external IDは`${time}:${coin}:${tid}`だが、実データには`xyz:COPPER`のようにcoin自体が`:`を含む。固定位置の`split(':')`で`tid`を安全に復元できない。末尾segmentとして抽出することは可能だが、これは保存契約として明示されておらず、source sequence列の代替にはしない。

## 5. `startPosition`監査

Hyperliquid Fill schemaは公式レスポンスの次をexact decimal stringとして受ける。

- `startPosition`
- `sz`
- `px`
- `side`
- `time`
- `tid`

`mapFill()`は`startPosition`を変換・丸め・符号変更せず返し、repositoryがPrisma Decimalへ保存する。情報損失は確認されなかった。

既存`docs/calculations.md`および`buildPositionCycles()`と同じ式を使用できる。

```text
signedDelta = BUY ? size : -size
afterPosition = startPosition + signedDelta
```

- `startPosition > 0`: LONG
- `startPosition < 0`: SHORT
- `startPosition = 0`: FLAT

afterとの符号・絶対値比較によりopen、increase、partial reduce、close、LONG→SHORT、SHORT→LONGを決定論的に分類できる。単一Fillの分類能力はPASSである。

ただし、複数Fill列として処理する場合は、直前Fillのafterと次Fillの`startPosition`が一致する意味順序が別途必要である。

## 6. Ordering監査

### 6.1 現在の情報では安全でない

既存Position Cycleは`occurredAt`、`externalId`で安定sortする。しかし、安定sortとpositionの意味順序は同義ではない。

実DBでは同一wallet・coin・millisecond衝突が230,659 group存在する。`tid`をexternal ID末尾から数値抽出して並べても、group内で比較可能な隣接513,563組のうち:

- `previous after == next startPosition`: 139,340組
- 不一致: 374,223組

であった。tid数値順をposition遷移順とみなす根拠はなく、実データも支持しない。external ID全体のlexical sortは、数値tidの桁数差とcoin内`:`のためさらに意味保証が弱い。

### 6.2 必要な仕様変更

次の順で解決することを推奨する。

1. 今後取得するFillについて、公式payloadの`tid`を独立したexact integer string列`sourceTradeId`として保存する。
2. `tid`がposition causality sequenceであるという仮定は置かない。
3. 同一timestamp groupは`startPosition -> afterPosition`の連続性グラフを作り、全Fillを一度ずつ通るchainが一意の場合だけ正規化する。
4. chainが0件または複数なら`DATA_ORDER_AMBIGUOUS`でfail closedする。
5. sourceが公式sequenceを将来提供する場合だけ、それを優先keyとしてversion更新する。

単に別順序を総当たりして「都合のよい1本」を選ぶことは避ける。一意chainの存在を検証するpure関数として設計する。

この変更を固定するまでmigrationとbackfillへ進めない。

## 7. Notional監査

既存schemaはperpetual Fillの`price`と`size`を保存し、Discoveryでは同じ概念の`price * size`を`notionalUsd`として扱っている。標準Hyperliquid USDC建てPerpetualsではPhase 5.0の`abs(quantityDelta) * fillPrice`と整合する。

ただし実データにはDEX namespace付きcoinが存在し、`NormalizedTrade`には次がない。

- perp universe / DEX識別子のFK
- quote asset
- collateral token
- contract multiplier
- price provenance version

従って、保存済み全coinへ一律に`Usd`と命名できることは実schemaだけから証明できない。

推奨決定:

- `behavior-v1`対象を、同期時点の公式metaで「price × base sizeがUSD/USDC notional」と確認できるPerpetuals universeに限定する。
- Eventに`notionalQuoteAsset`と`marketDefinitionVersion`またはmarket metadata参照を持たせる。
- quoteを確認できないcoinは`UNSUPPORTED_NOTIONAL_CONTRACT`でfail closedする。
- 確認前に`notionalDeltaUsd`を全coin必須としてmigrationしない。

## 8. Timestamp監査

API schemaは`time`をsafe integerのmillisecond epochとして受け、JavaScript `Date`へ変換する。PostgreSQL実列はmillisecond精度で、実DBにmillisecond未満の値は0件だった。API→mapper→DBの精度損失は確認されなかった。

一方、同一millisecond衝突は744,222 Fillに及ぶ。`timestamp(3)`はsource精度を正しく保存しているが、timestampだけをordering keyにできない。timestamp schema自体はPASS、orderingはBLOCKERである。

## 9. Decimal監査

既存金融列とBehavior Event候補はいずれも`numeric(38,18)`で整合する。

実DB最大値:

| 値 | 最大絶対値 |
| --- | ---: |
| price | `123782.000000000000000000` |
| size | `27525913.800000000700000000` |
| startPosition | `27525913.890900000900000000` |
| price × size | `441490.000000000000000000000000000000000000` |

全1,339,748 Fillについて`price * size`を小数18桁へroundした際に値が変わる行は0件、整数20桁を超える行も0件だった。現データに`numeric(38,18)`は十分である。

実装では積をDecimalで無制限精度計算後、丸めずに`numeric(38,18)`へexactに収まることを検証する。将来market追加時は上限を再監査する。

なおadapterの`exactDecimalSchema`は指数表記とleading `+`を受理する。Phase 5.0仕様の「指数表記とleading `+`を拒否」と入力契約が異なる。保存済みPrisma Decimalを入力にするPhase 5.0ではcanonical化後の値だけを見るため実害はないが、仕様文言は「source parserでは受理し、Behavior fingerprintではcanonical non-exponent formへ変換」に修正すべきである。

## 10. Data Quality監査

既存`DataQualityIssue`は次を持つ。

- `issueType: String`
- `details: Json?`
- severity、status、message、検出・解消時刻
- DataSource FK `Restrict`
- Wallet FK `Cascade`
- fingerprint unique

したがってmissing boundary、ordering ambiguous、invalid decimal、source inconsistency、impossible transition、history gapのcodeとdetailsは技術的には保存できる。

不足点:

- `coin`、`behaviorVersion`、`normalizationRunId`、`sourceFillId`が構造化列/FKではない。
- fingerprintはwallet addressと任意detailsに依存し、details shape変更がidentity変更になる。
- Wallet削除でIssueがCascade削除される。
- 既存運用IssueとBehavior normalization Issueのcoverage queryが混在する。

推奨は専用`BehaviorDataQualityIssue`の追加である。汎用modelを再利用する場合でも、少なくともscope列、coin、behaviorVersion、normalizationRunId、sourceFillId、affectedFrom/Toを追加し、Wallet削除規則を見直す必要がある。既存modelの意味変更を避けるため専用modelを第一案とする。

## 11. FK / lifecycle監査

現行の主な削除規則:

| 親 | 子 | onDelete |
| --- | --- | --- |
| DataSource | NormalizedTrade | Restrict |
| WalletAddress | NormalizedTrade | Cascade |
| DataSource | WalletAddress | Restrict |
| DataSource | WalletSelectionRun | Cascade |
| WalletSelectionRun | WalletSelectionResult | Cascade |
| WalletAddress | WalletSelectionResult | Cascade |
| MetricCalculationRun | WalletSelectionResult | SetNull |
| WalletAddress | MetricCalculationRun | Cascade |
| WalletAddress | DataQualityIssue | Cascade |

Behavior Eventを監査正本として自動削除しない方針と、Wallet / Selection / PerformanceのCascade chainは矛盾する。

推奨:

- Behavior EventからDataSourceとWalletAddressへのFKは`Restrict`。
- source FillへのFKも`Restrict`を推奨し、NormalizedTrade retention対象外を維持する。
- Event identityからSelection Run / Performance Run FKを外す。
- normalization/membership provenance側でSelection Runへ`Restrict`、Performance Runへ`SetNull`またはID snapshotを持つ。
- 親削除を必要とする場合は、監査exportまたは明示的な所有者操作を別仕様にする。

既存親modelのonDeleteを変更すると広範な影響があるため、EventからのRestrict FKが親削除を止めることをmigration testで確認する。

## 12. Selection Run provenance重点監査

### 12.1 現仕様の矛盾

現仕様は同じ市場行動をSelection Runごとに複製しないため、Behavior fingerprintへSelection Runを含めない。一方、Event本体に必須`selectionRunId`を置き、「最初に正式生成したRun」を書き換えない。

この設計では次を表現できない。

- Event EがSelection Run Aでは対象外、Run Bでは対象になった。
- Event EがRun BとRun Cの両方の入力集合に属する。
- 手動Override変更により同じwalletのmembershipが変化した。
- Phase 5.1を「当時のSelection」で再計算する際の完全なmembership。

最初のRun IDはgeneration provenanceであってselection membership provenanceではない。

### 12.2 比較

| 案 | 長所 | 問題 |
| --- | --- | --- |
| EventをSelection Runごとに複製 | queryが単純 | 市場事実を重複保存し、identity・retention・再計算が肥大化 |
| Eventに最初の`selectionRunId`だけ保存 | 行数が少ない | 後続Run membershipを表現できない。現仕様の問題 |
| identity / generation / membership分離 | 市場事実は1件、全Runを再現可能 | join tableとqueryが増える |

### 12.3 推奨案

3責務を分離する。

1. `SelectedWalletBehaviorEvent`: 市場行動identity。Selection / Performance FKを持たない。
2. `BehaviorNormalizationRun`: behaviorVersion、入力期間、source coverage、実行状態を持つgeneration provenance。
3. `BehaviorSelectionScope`（または`BehaviorNormalizationRunWallet`）: Selection Run、wallet、Performance Run、manual/automatic状態、対象期間を保持するmembership provenance。

Eventは`createdByNormalizationRunId`を持ってよいが、これは生成元でありmembershipではない。Eventとscopeを直接N:Mで結ぶ必要はなく、wallet・source・期間・behaviorVersionで再現可能な場合はscope側にcoverageを持たせる。Phase 5.1のinput fingerprintには使用したSelection scope IDとEvent identityを含める。

この修正を`phase5-0-behavior-event-spec.md`へ反映してからschema設計する。

## 13. Late Fill / backfill監査

Normalized Fillは原則retention対象外で、公式`startPosition`も各Fillに残るため、再構築材料自体は存在する。trusted boundary候補は次である。

- `startPosition = 0`のFill
- 連続性を検証済みsegmentの保存checkpoint
- open gap / truncationが存在しないcoverage区間

ただし現indexは`(walletAddressId, occurredAt)`で、coinを含まない。さらに同時刻orderingが未解決である。現状では「late Fillより前の最新FLAT Fill」を安全かつ効率的に確定できない。

推奨rebuild:

1. late Fillのwallet・coin・occurredAtを受ける。
2. 新複合indexで過去方向へkeyset scanする。
3. ordering一意性とgap absenceを満たす直近FLAT boundaryを探す。
4. 次の確定checkpointまたは現在までをbounded segmentに分割して再生成する。
5. 影響segmentの旧Eventと新Eventをtransaction内でfingerprint比較・置換する。
6. 1 jobの最大範囲を超える場合はcontinuation jobを投入する。

Ordering BLOCKERとindex整備が完了するまでlate Fill rebuildを実装しない。

## 14. 推奨DB schema案

### 14.1 `BehaviorNormalizationRun`

- `id`
- `behaviorVersion`
- `sourceId` FK Restrict
- `selectionScopeId`
- `inputFrom` / `inputTo`
- `inputFingerprint`
- `status`
- counts、error、started/completedAt
- unique `(behaviorVersion, selectionScopeId, inputFingerprint)`

### 14.2 `BehaviorSelectionScope`

- `id`
- `selectionRunId` FK Restrict
- `walletAddressId` FK Restrict
- `performanceRunId` nullable、FK SetNull
- `automaticStatus`
- `manualOverride`
- `effectiveFrom` / `effectiveTo`またはbackfill対象期間
- unique `(selectionRunId, walletAddressId)`

### 14.3 `SelectedWalletBehaviorEvent`

- identity fields: sourceId、walletAddressId、coin、type、direction、occurredAt
- signed before/after/delta、price、notional、quote asset
- `sourceTradeId`、`sourceFillId`、`sourceOrdinal`
- `behaviorVersion`、`behaviorFingerprint`
- `createdByNormalizationRunId`
- Selection / Performance Runは持たない
- unique `(behaviorVersion, sourceId, sourceFillId, sourceOrdinal)`
- unique `(behaviorFingerprint)`

### 14.4 `BehaviorNormalizationCursor`

- `(sourceId, walletAddressId, coin, behaviorVersion)`一意
- last occurredAt、sourceTradeId、sourceFillId、afterPosition
- trustedBoundaryAt、status、lastAttempt/success、error

### 14.5 `BehaviorDataQualityIssue`

- fingerprint unique
- source、wallet、coin、behaviorVersion、normalizationRun、sourceFill参照
- issue type、severity、status、message、details
- affectedFrom / affectedTo、first/last detected、resolvedAt

## 15. 推奨index案

### 15.1 既存`normalized_trades`

必要候補:

```text
(wallet_address_id, coin, occurred_at, id)
(wallet_address_id, coin, occurred_at DESC, id DESC)
(source_id, wallet_address_id, coin, occurred_at, id)
```

最初の1本を基本とし、PostgreSQLが逆scanできるためASC/DESC両方を重複作成しない。`sourceTradeId`列を追加するなら末尾を`source_trade_id`と`id`にする。

tableは約1.08 GiB、133万行で運用中である。既存巨大tableへのindexは通常migration内`CREATE INDEX`でlockさせず、Phase 4.3.1と同様に:

1. schema migrationと新table作成を行う。
2. maintenance SQLで`CREATE INDEX CONCURRENTLY`をtransaction外実行する。
3. `pg_stat_progress_create_index`を監視する。
4. `indisready` / `indisvalid`を確認する。
5. `EXPLAIN`でIndex Scanを確認してからbackfillを許可する。

### 15.2 新Event table

- `(wallet_address_id, coin, occurred_at, source_ordinal, id)`
- `(coin, occurred_at, wallet_address_id)`：Phase 5.1のcoin/time bucket scan
- `(created_by_normalization_run_id)`
- unique identityとfingerprint index

新規空tableのindexはmigration内で通常作成してよい。

### 15.3 scope / issue / cursor

- Scope: `(selection_run_id, wallet_address_id)` unique
- Issue: `(wallet_address_id, coin, status, affected_from)`
- Cursor: `(source_id, wallet_address_id, coin, behavior_version)` unique

## 16. Worker処理フロー案

初期値read 5,000、write 1,000、concurrency 1は、Performance v3で確立済みの5,000行読込と現DB規模から安全な開始値である。ただし最大walletが約119万Fillあるため、全履歴の配列化は禁止する。

推奨フロー:

```text
listEffectiveSelectedWallets()を1回取得
  -> Selection scopeをtransaction保存
  -> walletAddressId / coinを安定順にjob分割
  -> cursor + trusted boundary取得
  -> 5,000行keyset read
  -> timestamp groupをbatch境界で分割しない
  -> 同時刻groupの一意transition chain検証
  -> pure normalization
  -> 最大1,000 Event + cursor + issueをtransaction保存
  -> 入力が残ればcontinuation job
```

要件:

- offset paginationではなくkeyset pagination
- 同一timestamp groupは次batchへcarryし、最大153行の実績を考慮
- fingerprintはincremental hash
- transactionはwallet・coin単位
- backlog 500で投入停止
- concurrency 1、priority 20、最大3 retry
- deterministic poison eventはretryせずIssue化
- active batch完了を待つgraceful shutdown
- input/output件数、heap、duration、cursor、coverageをJSON logへ出す
- schedulerは追加せず、明示backfillとFill同期完了enqueueだけ

実Selection Runが0件なので、Selection scope 0件は正常no-opとして扱い、全watched walletへfallbackしてはならない。

## 17. `phase5-0-behavior-event-spec.md`との矛盾と変更要求

migration前に次を仕様へ反映する必要がある。

1. `occurredAt -> source sequence -> sourceExternalId`だけのorderingを廃止し、同時刻transition chainの一意性検証を追加する。
2. `sourceTradeId`を独立列として入力・schema候補へ追加する。ただしcausal sequenceとはみなさない。
3. Event本体から`selectionRunId`と`performanceRunId`を外し、Selection scopeへ移す。
4. Event identity、generation provenance、membership provenanceを分離する。
5. Decimal入力規則を既存adapterと整合させ、source exponent表記受理とfingerprint canonical formを区別する。
6. `notionalDeltaUsd`必須化の前にmarket/quote契約を固定し、quote metadataを追加する。
7. generic Data Quality再利用ではなく専用modelを第一案とする。
8. Wallet / source Fill / Selection lifecycleと監査保持をRestrict FKで保護する。
9. late Fill rebuild開始条件へ複合index、unique ordering、gap-free trusted boundaryを追加する。
10. existing table indexはCONCURRENTLY maintenanceへ分離する。

これらは既存仕様を本監査で変更するものではない。次の設計改訂で正式に合意・反映する変更要求である。

## 18. Phase 5.0実装開始可否

### 現時点

**BLOCKED**。schema、migration、repository、Worker backfillの実装を開始しない。

### 開始条件

1. Orderingの一意transition chain規則を固定し、実DB衝突sampleで検証する。
2. identity / generation / membership分離案を仕様へ反映する。
3. notional対象marketとquote provenanceを固定する。
4. FK lifecycleと専用Data Quality modelを確定する。
5. 既存Fill複合indexのCONCURRENTLY作成・検証手順を確定する。
6. Phase 4.3で少なくとも1つのcurrent Selection Runを生成し、effective selected契約を実DB検証する。
7. 改訂仕様の固定test vectorへ同時刻一意chain、複数chain、coin内colon、Selection Run切替を追加する。

以上を満たした後、pure normalization、schema review、migration、bounded backfillの順に実装する。
