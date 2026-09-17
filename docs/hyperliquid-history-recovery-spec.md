# Hyperliquid History Recovery Specification

最終更新: 2026-09-14 (Asia/Tokyo)

## 1. 目的と適用範囲

本書は、Selection readinessを阻害している次の2種類の履歴不足を、Hyperliquid公式sourceから決定論的・追跡可能・fail-closedに回復する契約を定める。

1. WebSocket切断区間を公式Info APIの明示的な`startTime` / `endTime`でbounded recoveryする。
2. Info APIの直近10,000 Fill上限に到達したwalletについて、公式Requester Pays bucket `s3://hl-mainnet-node-data/node_fills*`をtrusted secondary sourceとして利用する。

本変更ではInfo API側の契約・offline parser・inventory coverage判定・dedup判定・cost estimatorまでを実装する。Requester Pays LIST / HEAD / GET、archive download、実DB ingestion、DQ lifecycle更新、Performance / Selection / Behaviorの再実行は行わない。

`performance-v3`、`wallet-selection-v1`、Selection threshold、manual override、Behavior selection SSoTは変更しない。

## 2. 公式sourceから確定できた事実

### 2.1 Info API

- `userFillsByTime`は`startTime`と`endTime`をmillisecond・inclusiveで受ける。
- 1 responseは最大2,000 Fillであり、利用可能なのはwalletごとの直近10,000 Fillだけである。
- Fillは`time`、`coin`、`tid`、`hash`、`oid`、`side`、`sz`、`px`、`startPosition`等を持つ。
- したがって、対象rangeへの成功responseだけでは、そのrangeが直近10,000 Fillより古く切り落とされていないことを証明できない。

正本: [Hyperliquid Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)

### 2.2 official historical fills

- `s3://hl-mainnet-node-data/node_fills_by_block`はnon-validating nodeの`--write-fills --batch-by-block`出力である。
- 旧データは`s3://hl-mainnet-node-data/node_fills`にあり、公式資料はこれを「API formatと一致」と説明する。`node_trades`はAPI formatと一致せず、本契約のsourceにしない。
- node writerの通常`--write-fills`は1 event/line、`--batch-by-block`は1 block/lineで、後者のenvelopeは`{local_time, block_time, block_number, events}`である。
- 公式資料は、公開archiveの正確な開始hour、旧新formatのcutover hour、全hourの連続性、各object byte sizeを公表していない。

正本: [Hyperliquid Historical data](https://hyperliquid.gitbook.io/hyperliquid-docs/historical-data)、[hyperliquid-dex/node](https://github.com/hyperliquid-dex/node)

### 2.3 Requester Pays

- Requester Paysでは認証済みrequesterがrequest費用とdownload転送費用を負担する。
- LIST / HEAD / GET等の課金requestを行う前にOwner承認を必要とする。
- AWS単価・free tier・転送先・月間aggregate使用量で実費が変わるため、コードへ固定価格を埋め込まない。

正本: [AWS Requester Pays](https://docs.aws.amazon.com/AmazonS3/latest/userguide/RequesterPaysBuckets.html)、[AWS S3 pricing](https://aws.amazon.com/s3/pricing/)

## 3. WebSocket gap bounded recovery

### 3.1 range

- jobはcanonical DB `walletAddressId`と`walletAddress`、明示的なISO 8601 `startTime` / `endTime`を必須とする。
- DQの`disconnectedAt`を開始境界とし、終了境界は同walletの最初の信頼可能な再接続event timestampから事前manifestで確定する。終了境界を現在時刻や推測値で補完しない。
- Info APIへ同じinclusive millisecond rangeをfills / funding / ledgerの各laneで送る。
- API page、normalized row、cursor更新は既存正式sync契約を使用する。古いgap recoveryによって新しいcursorを巻き戻さない。

### 3.2 coverage evidence

HTTP adapterは次を区別する。

| evidence                                | 条件                                               | 意味                                  |
| --------------------------------------- | -------------------------------------------------- | ------------------------------------- |
| `BOUNDED_NON_EMPTY_EXHAUSTIVE_RESPONSE` | 1件以上、次pageなし、local safety limit未到達      | 指定rangeを非空responseとして走査完了 |
| `BOUNDED_EMPTY_EXHAUSTIVE_RESPONSE`     | 0件、成功response、local safety limit未到達        | 指定rangeの空responseを取得           |
| `UNPROVEN`                              | page進行不能、10,000件到達、range exhaustion未確認 | coverage未証明                        |

Gap解消条件はlaneごとに異なる。

- fills: `BOUNDED_NON_EMPTY_EXHAUSTIVE_RESPONSE`だけをInfo API単独のproofとして受理する。空responseは、直近10,000件より前が切り落とされた結果と真に0件のrangeを区別できないため受理しない。
- funding / ledger: 明示rangeへの`BOUNDED_NON_EMPTY_EXHAUSTIVE_RESPONSE`または`BOUNDED_EMPTY_EXHAUSTIVE_RESPONSE`を受理する。どちらもlocal 10,000 safety limit未到達を必須とする。
- requested boundsがjob boundsと1msでも異なる、いずれかのlaneが`UNPROVEN`、`reachedHistoryLimit=true`、HTTP/schema/save failureの場合はgapをOPENのまま残す。

3 laneのproofが成立した場合だけ、既存の`completeWebSocketGap()`とexact fingerprintのDQ lifecycle解消を実行する。これは該当gapの解消証拠であり、wallet全体を直接`HISTORY_COMPLETE`へ書き換える操作ではない。Performance再計算時に他のOPEN gap、Fill limit、boundary、cash-flow条件を再評価して初めて全体のcompletenessが決まる。

### 3.3 Info APIでproofできないrange

空fills、10,000件到達、同一timestampでpageが進行不能なrangeはInfo APIだけでは解消しない。対象hourをofficial historical fills manifestとdownload済みobjectの完全scanで証明するsecondary-source pathへ送る。

## 4. historical fills trusted secondary source

### 4.1 period coverage

公開ドキュメントだけでは正確な期間coverageを確定できない。よって次を正式なcoverage proofとする。

1. Owner承認済みRequester Pays LIST / HEADで、必要rangeと重なる全objectの`key`、`ETag`、`VersionId`（存在時）、`ContentLength`、`LastModified`を取得する。
2. 各objectへUTC `hourStart`と`NODE_FILLS` / `NODE_FILLS_BY_BLOCK`を割り当てたimmutable inventory manifestを作る。
3. 対象rangeに含まれる各UTC hourがexactly one objectへ対応することをoffline policyで検証する。
4. hour欠損、同一hourの複数候補、format/key不整合はfail closedとする。旧新prefixのcutoverを日付推測で補完しない。
5. download後はobject SHA-256、byte count、ETag / VersionIdをmanifestと照合する。

このproofが成立するまでは、official archiveの開始日・cutover・全期間連続性は「未確認」であり、DB ingestionを許可しない。

### 4.2 wallet抽出とformat差異

| source                | 1 lineの期待shape                                | wallet抽出                                 | provenance                                 |
| --------------------- | ------------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| `node_fills`          | `[address, fill]`の1 event                       | tuple第1要素をEVM canonical lowercase化    | object + line number + event index 0       |
| `node_fills_by_block` | `{local_time, block_time, block_number, events}` | `events`内の`[address, fill]` tuple第1要素 | object + line + block number + event index |

parserは`lossless-json`と既存`fillSchema`を使い、大きい`tid` / `oid`をJavaScript numberへ丸めない。未知shape、addressなし、schema不一致、invalid Decimal / timestampはrejectする。旧formatの実object sampleがこのshapeに一致することは、初回Owner承認済みdownload後かつDB投入前にfixture化して再確認する。一致しない場合はparserを推測で緩めず停止する。

全世界のfillが同じhour objectに入るため、download byte量はwallet数で比例して減らない。streaming line parserで対象3 canonical addressだけを抽出し、object全体やwallet全履歴をJS heapへ保持しない。

### 4.3 identity / dedup

source identityは次のtupleとする。

```text
canonical wallet address + time + coin + tid
```

- `tid`はidentity/traceへ使うがcausal orderには使わない。
- 同一identityが複数source/objectに現れ、既知payload fieldsをDecimal canonical formで比較して同値ならduplicateとして1件へ縮約する。
- 同一identityで`hash`、`oid`、`side`、`dir`、`px`、`sz`、`startPosition`、`closedPnl`、`fee`等が異なる場合はsource conflictとして全batchを停止する。
- 既存normalized fillとの照合は、既存の`externalTradeId = time:coin:tid`、`sourceTradeId=tid`、walletを含むfingerprint、`hash`、`oid`を用いる。既存rowとpayloadが競合する場合、`skipDuplicates`で隠さずfail closedとする。
- source間の重複を解消しても、同一timestampのposition causal orderはPhase 5.0の一意transition-chain規則で決める。`tid`順へ変更しない。

### 4.4 canonical source provenance

DB投入前のingestion manifestは最低限次を固定する。

- source名 `HYPERLIQUID_OFFICIAL_NODE_FILLS`
- bucket `hl-mainnet-node-data`
- key、ETag、VersionId nullable、ContentLength、LastModified
- format、UTC hour、download時刻、`x-amz-request-charged=requester`確認
- download済みobjectのSHA-256とbyte count
- parser / normalization version
- line number、block number nullable、event index
- canonical wallet address / walletAddressId、requested from/to
- inventory manifest SHA-256、実行run ID、入力object allowlist

現行`RawEvent.transport`と`NormalizedTrade`だけではこのobject-level provenanceを損失なく保持できない。そのため、初回実DB ingestion前にappend-only import run / source object / fill observationの論理schemaとmigrationを別レビューする。schemaが承認・適用されるまでhistorical parserの出力を既存`saveFills()`へ直接投入しない。

## 5. 対象3 walletと最小download範囲

2026-09-14のread-only DB確認で、OPEN `HYPERLIQUID_FILL_HISTORY_LIMIT`対象は3件だった。開始はSelectionが参照するtrusted performance inputの最古`calculationFrom`、終了は既存normalized fillの最古timestampを含むUTC hourとし、少なくとも境界hourを完全scanしてoverlapを照合する。

| walletAddressId / canonical address                                        | required from            | existing earliest fill   | inclusive UTC hours |
| -------------------------------------------------------------------------- | ------------------------ | ------------------------ | ------------------: |
| `cms39x9ni000umw0iw2zkbf1e` / `0x06438b0d1bb6f8aa4a455a4f2c1b1e744d53c760` | 2025-06-25T15:26:46.163Z | 2026-07-21T13:52:34.735Z |               9,383 |
| `cms3a3y460035mw0ij745hy53` / `0x72d73fea74d7ff40c3e5a70e17f5b1aaf47dfc26` | 2025-04-24T00:00:00.000Z | 2026-07-21T18:14:22.232Z |              10,891 |
| `cms3a522z0044mw0ib2uingps` / `0xf5d81a135f756ca16544e53c20fc20643ec3ad53` | 2025-12-17T00:00:00.000Z | 2026-07-27T11:08:25.539Z |               5,340 |

ID/addressは承認済みinventory生成時にもDBから再抽出し、上表と一致する場合だけmanifestへ固定する。3 rangeのhour unionは2025-04-24T00:00:00.000Zから2026-07-27T11:59:59.999Zまでの11,028 object-hour候補である。wallet別downloadは同じglobal objectを重複取得せず、unionを1回取得する。

archiveがrequired fromより後に開始する、または途中hourが欠ける場合、official archive単独では当該walletの完全性を証明できない。開始日を短縮せず`PARTIAL`のまま停止する。

## 6. cost estimation

`pnpm hl:historical-fills:estimate <input.json>`は課金APIへ接続せず、Owner承認後に得たinventoryをofflineで検証・集計する。入力単価はAWS pricingと実行accountのfree-tier / region条件を確認してDecimal文字列で渡す。

```text
downloadGiB = sum(ContentLength) / 2^30
GET cost = selected object count / 1000 × GET rate
inventory cost = actual LIST/HEAD count / 1000 × corresponding rate
egress cost = billable downloadGiB × egress rate
total = GET + inventory + egress
```

公式object sizeが未取得のため現時点でexact見積りは出さない。感度だけを示すと、11,028 hours（約459.5日）に対して平均0.5 / 1 / 2 GiB/dayなら約230 / 460 / 919 GiBである。仮にbillable egressが0.09 USD/GiBなら転送分は約20.7 / 41.4 / 82.7 USDであり、これは承認額ではない。実download承認要求にはinventoryから算出したexact byte count、request count、適用単価、上限額を添付する。

## 7. DB投入前の完全性証明

次のすべてを満たした場合だけingestionをREADYとする。

1. inventory manifestがrequired rangeの全UTC hourをexactly once覆う。
2. 旧format sampleがstrict parser fixtureと一致し、新format fixtureも一致する。
3. 全download objectのsize / ETag / VersionId / SHA-256がmanifestと一致する。
4. 各objectをEOFまでstream scanし、line count、parse count、target match count、reject countを記録する。reject countは0。
5. target addressは実DB canonical addressと再照合し、不一致なら開始前に停止する。
6. source内部duplicateは同値だけ、source conflictは0。
7. 既存DBとのoverlap hourでidentity/payload conflictが0、既存rowがarchive抽出結果のsubsetとして一致する。
8. required fromより前のtrusted boundary、またはrequired from自身が評価開始境界であることをperformance input契約から確認する。
9. append-only provenance schema / migrationがreview済みで、実DB migrationとingestionにOwner承認がある。
10. dry-run manifestがinsert / duplicate / conflict / outside-range件数をexactに提示する。

件数が多いこと、API最古fillへ接続したこと、時間範囲の先頭と末尾にeventがあることだけでは完全性proofにしない。

## 8. lifecycleと後続処理

- historical ingestion成功後も`HYPERLIQUID_FILL_HISTORY_LIMIT`やgap DQを直接UPDATE/resolveしない。正式DQ lifecycleがmanifest/run evidenceを検証して対象issueだけを再評価する。
- 14 walletのうちproofが成立したwalletだけを`performance-v3`で再計算する。不明walletを0/FLAT/HISTORY_COMPLETEと推測しない。
- Performance全件成功・TRUSTED確認後に`wallet-selection-v1`を1回評価する。threshold変更、manual INCLUDE、watched fallbackは禁止する。
- effective selected walletが存在する場合だけ通常Behavior processingを実行する。
- selected 0なら、`REVIEW`のdata-quality理由と`EXCLUDED`の投資基準未達理由を分離して報告する。

## 9. 承認gate

現時点の判定は次のとおり。

- Info API bounded gap recovery code / unit test: READY。
- historical parser / dedup / inventory coverage / offline cost estimator: READY。ただし旧formatは実sample照合前なのでlive ingestionへ使わない。
- Requester Pays LIST / HEAD / GET: OWNER APPROVAL REQUIRED。
- historical provenance schema / migrationの実DB適用: OWNER APPROVAL REQUIRED。
- historical fills実DB ingestionとDQ再評価: OWNER APPROVAL REQUIRED。
- Performance → Selection → Behavior: ingestionとDQ proof完了までBLOCKED。

Ownerへ次に求める承認は、まず課金を伴うinventory取得だけである。承認要求には対象prefix、対象UTC range、予想LIST/HEAD request数、AWS account/region、cost capを明示する。download承認はinventoryによるexact cost算出後に別途求める。
