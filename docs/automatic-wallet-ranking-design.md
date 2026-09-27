# Automatic Ranking and Reference Wallet Selection

最終更新: 2026-09-23

## 1. 目的

所有者が候補を探してwatch登録する方式を正常系から外し、無料データの範囲で`Discovery -> sync / DQ -> performance-v3 -> wallet-selection-v2 -> Behavior`を自動で接続する。v1はNAV-based policyとして保持し、通常自動flowはclosed-cycle trade qualityを使うv2を採用する。評価可能性を証明できないwalletやhard gate不通過walletは内部監査には残すが、通常rankingへ表示しない。

## 2. 実装前監査

| 項目                | 実装前の事実                                                                          | 再利用 / 変更                                                 |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Discovery           | market tradeからCandidateを自動作成・enrichment・filterしていた                       | 既存処理を再利用                                              |
| Candidate promotion | `ELIGIBLE`後もAPI / CLIからpromotionを明示enqueueする必要があった                     | `ELIGIBLE`確定時に自動enqueue                                 |
| wallet sync         | promotionが`WalletAddress.isWatched=true`を設定し、正式backfill / schedulerが同期した | 既存同期契約を再利用                                          |
| Performance         | DQ audit / gap recovery成功後に`performance-v3`をenqueueしていた                      | 既存計算・trust gateを再利用                                  |
| Selection universe  | `DataSource`と`isWatched=true`で全手動watchを含めていた                               | Discovery promotion relationを正本に変更                      |
| Selection gate      | v1はcompleteness、期間、NAV metric、鮮度をfail closed判定していた                     | v1を保持し、別versionのtrade-quality v2を追加                 |
| Ranking             | v1はannualized return、drawdown、closed cycle、address順だった                        | v2はwin rate、cycle、Profit Factor、集中度、address順         |
| Manual override     | AUTO / INCLUDE / EXCLUDEが通常画面に表示され、INCLUDEでREVIEWも有効選定できた         | API / auditは保持、通常画面から除外。EXCLUDEはrankingにも反映 |
| Selection execution | APIの明示evaluateだけだった                                                           | Performance成功後に自動evaluate                               |
| Behavior            | `listEffectiveSelectedWallets()`だけを読み、0件はno-opだった                          | Selection確定後にcontrol jobを自動enqueue。fallbackなし       |
| UI                  | REVIEW / EXCLUDED / reason / settings / overrideを同じ一覧に表示していた              | eligible-only ranking projectionへ変更                        |

## 3. 自動flow

```text
Hyperliquid market trade Discovery
  -> Candidate lightweight filter
  -> full enrichment / completeness proof
  -> ELIGIBLE only: idempotent automatic promotion
  -> canonical wallet backfill / scheduled sync / DQ
  -> trusted performance-v3
  -> automatic wallet-selection-v2 evaluation
  -> persisted Selection Run / rank
  -> effective selected wallets
  -> Behavior control
```

Candidateが`INSUFFICIENT_HISTORY / EXCLUDED`ならpromotionしない。Performanceが`SUCCEEDED`以外ならSelectionへ進まない。SelectionやBehavior enqueueが失敗した場合はPerformance jobを成功扱いにせず、既存idempotencyを使ってretryする。Behavior queue backlog上限に達した場合もfail closedとする。

## 4. Automatic Selection universe

次をすべて満たすwalletだけを評価入力にする。

- Hyperliquid mainnet DataSourceに属する。
- 同じDataSourceの`AddressCandidate.promotedWalletId`から参照される。
- current trusted lookupが返す`performance-v3`だけを使用する。quarantine / provenance不整合は既存契約どおりfail closedとする。

`WalletAddress.isWatched`は同期schedulerの購読実装として残るが、Selection query条件ではない。promotionが購読を自動設定するため、所有者のwatch操作は不要である。手動登録しただけのwalletはautomatic universeへ混入しない。

## 5. Hard gateとranking policy

`wallet-selection-v1`を変更しない。通常自動flowのhard gateとrankingは`docs/free-data-wallet-selection-v2.md`を正本とする。

### Hard gate

- trusted `performance-v3`
- `TRADE_HISTORY_EVALUABLE(closed-position-cycle-v1)`
- trusted closed cycleが30件以上
- win rate、Profit Factor、average win/loss、max losing streak、top trade contributionが存在し有効
- 最終同期が24時間以内
- win rateが0.55以上
- Profit Factorが1.0以上
- top trade contributionが0.50以下

欠損値を0へ変換せず、REVIEW / EXCLUDED理由を内部Resultへ保持する。

### Overall ranking

1. win rate降順
2. trusted closed cycle count降順
3. Profit Factor降順
4. top trade contribution昇順
5. canonical address昇順

通常画面はclosed cycle、win rate、Profit Factor、average win/loss、top trade contributionを表示する。NAV由来のreturn / drawdownをv2の必須表示へ使わず、weighted scoreも導入しない。

high win-rateとhigh trade-countはv2の単一overall policyで扱う。risk-adjusted、low drawdown、long-term consistency、leverage、DCAの個別categoryは、十分な必須metricが未確定なため作らない。意味のないcategoryや欠損値の補完を避ける。

## 6. Reproducibility

既存の`WalletSelectionRun`と`WalletSelectionResult`を使用する。Runはpolicy snapshot、policy version、input fingerprint、evaluatedAt、件数を保持し、Resultはwallet、Performance Run、automatic status、rank、reasonを保持する。evaluation中に新しいPerformanceが現れても、作成済みRunの入力参照は変わらない。schema / migration追加は不要である。

## 7. API / UI

`GET /api/wallet-selection/ranking`を通常画面専用projectionとする。返すのは次を満たすResultだけである。

- automatic statusが`SELECTED / QUALIFIED`
- rank、Performance Run、lastSyncAtが存在
- manual overrideが`EXCLUDE`ではない

DTOはrank、wallet、automatic status、Performance Run、closed cycle count、trusted metrics、last activityを返す。REVIEW、EXCLUDED、reason code、manual INCLUDE状態は返さない。通常画面はこのAPIだけを使い、rank、完了取引、勝率、Profit Factor、平均勝ち / 平均負け、最大利益依存、最終活動を表示する。

full Selection API、settings、evaluate、overrideは監査・管理用として保持する。`INCLUDE`は後方互換の管理機能だがautomatic rankingを迂回できない。`EXCLUDE`はdenylistとしてrankingとeffective selected setの双方に反映する。

## 8. Safety boundary

- completeness、DQ、freshness、quarantine、trusted provenanceを緩和しない。
- thresholdと`performance-v3`計算式を変更しない。
- selected 0を正常状態として保持する。
- Behaviorはwatched walletへfallbackしない。
- paid data、AWS Requester Pays、manual INCLUDEによる水増しを使用しない。
- 実注文、署名、秘密鍵、資金移動を扱わない。
- 本変更はschema migrationと実DB mutationを必要としない。
