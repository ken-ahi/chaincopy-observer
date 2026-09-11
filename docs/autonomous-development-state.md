# Autonomous Development State

最終更新: 2026-09-12 (Asia/Tokyo)

## 目的と正本

本書は、`docs/codex-autonomous-master-prompt.md` に従う作業再開用の状態記録である。プロダクト仕様は `docs/SPEC.md`、段階計画は `docs/implementation-plan.md`、確定判断は `docs/decisions.md`、AI開発手順は `docs/ai-development-workflow.md` を正とする。本書はこれらを変更しない。

## 現在のGitHub状態

- branch: `codex/issue-15-data-readiness`
- `HEAD` / `origin/main`: `7524a7f4e493c4a7ae42f7179774df09d553c5a0` (`Merge pull request #27 from ken-ahi/codex/issue-26-incident-repair`)
- Issue 26: PR #27のmain mergeにより完了。Stage 3B/3Cやdownstream rebuildは再実行しない。
- 本branchは、Owner承認済みの14 wallet正式sync・Performance再計算・Selection再評価の実施結果を記録する。
- state更新commit `f47ec42`と認証blocker記録commit `af1c1e0`は`origin/codex/issue-15-data-readiness`へpush済み。GitHub CLIがなく、利用可能なbrowser sessionもGitHub未認証のため、PR作成とPR CI起動は未実施。

## 完了済みで再実行しない作業

- Issue 26 Stage 3Bでmanifest許可済みの `portfolio_snapshots` 161件を削除した。
- Issue 26 Stage 3Cでcanonical replay 18/18を完了し、対象latest/current group 31/31を復元した。
- 14 incident performance runは `QUARANTINED` のまま保持した。
- Stage 3Cで解消された8件のDQは監査済みで、8/8 `RESOLVED_IS_CANONICAL` と判定した。
- Issue 26 downstream Performance rebuild、Selection evaluation、Behavior no-opを完了した。後述の2026-09-08 data-readiness remediationとは別の完了済み処理である。
- 一時的なStage 3B destructive runnerとStage 3C replay/postcheck runnerは削除済みである。
- Stage 3B/3C、downstream rebuild、32件のnon-gap recoveryを再実行しない。
- 削除前判定用Stage 3B preflightを、復旧後に `ready: true` に戻すことを目標にしない。

## fast-uri CI blocker

- root `pnpm-workspace.yaml` の既存 `overrides` へ `fast-uri@3: 3.1.7` と `fast-uri@4: 4.1.4` を追加した。
- `pnpm-lock.yaml` の解決結果は3系が3.1.7、4系が4.1.4で、3.1.5/4.1.2は残っていない。
- `pnpm audit --audit-level high` はexit 0。残存はunrelatedなmoderate 2件であり、本変更では拡張対応しない。
- pnpm 11.9.0でinstall/lockfile更新を実施した。
- validation: format、lint、typecheck、65 files/613 tests、build 11/11 packages、E2E 21/21、`git diff --check` は成功した。
- E2Eは一時PostgreSQL/Redisだけで実行し、終了後に両containerを削除した。実DB/実Redisは変更していない。

## MVP受入状態

状態は「実装」「自動テスト」「実運用確認」を分離する。ここでの実運用欄は過去の承認済みIssue報告を含む。Issue 26は完了済みとして再実行せず、Issue 15の14 walletだけを2026-09-08と2026-09-12に同期・再評価した。

| SPEC第32章対応                          | 実装                                     | 自動テスト                          | 実運用                           | 現在の判定                          |
| --------------------------------------- | ---------------------------------------- | ----------------------------------- | -------------------------------- | ----------------------------------- |
| A. 所有者限定ログイン・README起動       | あり                                     | E2E成功                             | 今回未確認                       | 継続監査                            |
| B. アドレス登録・候補収集・履歴取得     | Hyperliquidあり                          | unit/integration/E2E成功            | Issue 26 canonical state復元済み | Sui/Cetusを含む全体は未達           |
| C. 重複・欠損・順不同・再接続・API障害  | DQ/fail-closed契約あり                   | 全test成功                          | Issue 26でincident recovery済み  | source history制約が残存            |
| D. Performance・分類・Selection根拠     | performance-v3 / wallet-selection-v1あり | 全test成功                          | 14 wallet再計算・再評価済み      | completeness/metric不足でselected 0 |
| E. Selection→Behavior→signal→Web        | Phase 5.0 Behaviorまであり               | Behavior test成功                   | Behaviorはselected 0でno-op      | signal/Web連携は未達                |
| F. メール送信・抑制・配信記録           | 要追加監査                               | package build/test成功              | 未確認                           | 未達扱い                            |
| G. 正式仕様のデモ取引                   | 要追加監査                               | package build/test成功              | 未確認                           | 未達扱い                            |
| H. デモ資産曲線・benchmark比較          | 要追加監査                               | 今回の全testは成功                  | 未確認                           | 未達扱い                            |
| I. signalからsource/version/DQを追跡    | Behavior provenanceまであり              | 全test成功                          | 未確認                           | signal未実装範囲は未達              |
| J. 実売買・署名・秘密鍵なし、主要CI成功 | safety boundary維持                      | ローカル全validation・PR #27 CI成功 | 本番適用なし                     | PR #27 merge済み                    |

## Issue 15 data-readiness remediation（2026-09-08）

### 実行契約とprovenance

- 対象はSelection readiness監査で確定したwatched Hyperliquid wallet 14件だけとした。watched wallet fallback、対象外address、wrong-address identifierは使用していない。
- Worker image: `chaincopy-worker:issue15-7524a7f`、image digest `sha256:035ae76f6c12c8ac5bd7ef01b12c5ef4ca5677e58136795f46a9bcf7fc9d11af`。
- image revision labelはmain merge commit `7524a7f4e493c4a7ae42f7179774df09d553c5a0`と完全一致した。
- concurrencyは1、queue backlog上限は500、discoveryは無効。処理完了後にWorkerをgraceful stopした。
- 既存の正式scheduler/sync、`performance-v3`、`wallet-selection-v1`、Behavior control jobだけを使用した。手動cursor/DQ/quarantine変更、destructive DB操作、Redis key削除は行っていない。

### 正式sync結果

- 最初の通常scheduler実行は、14 walletについてcurrent-state / fill / funding / ledger / portfolio / historical-orders / DQ auditを各14件、合計98件成功した。
- 既存queueに残っていた同一14 wallet内のbackfill parent 10件も正常完了し、そこから生成されたfill / funding / ledger / position / portfolio / historical-orders / DQ / websocket-listener child各10件も成功した。
- 既存gap recovery 10件は各5 attempt後にすべてfail closedした。理由は、fills / funding / ledgerの全required laneで対象区間の完全なsource coverageを証明できなかったためである。対応するgap DQは解消していない。
- 最終Performance用Worker再起動時、BullMQ retention上の通常scheduler job 98件のうち、保持期間を過ぎていたcurrent-state 8件、funding 7件、ledger 7件が同一14 walletへ再生成された。22/22成功し、対象範囲逸脱はない。
- 最終job集計: current-state 22成功、DQ audit 24成功、fill 24成功、funding 31成功、ledger 31成功、portfolio 24成功、historical-orders 24成功、position 10成功、wallet backfill 10成功、websocket listener 10成功、gap recovery 10失敗。
- 14/14 walletの`lastSyncAt`は更新され、Selectionの`DATA_STALE`は14件から0件へ解消した。全SyncCursorは最終時点で`SUCCEEDED`だった。

### Data Quality before / after

| OPEN issue type                    | before            | after             | 判定                                                 |
| ---------------------------------- | ----------------- | ----------------- | ---------------------------------------------------- |
| `HYPERLIQUID_PARTIAL_API_FAILURE`  | 3件 / 3 wallet    | 0件 / 0 wallet    | 正式syncの成功によりdomain lifecycleから解消         |
| `HYPERLIQUID_FILL_HISTORY_LIMIT`   | 3件 / 3 wallet    | 3件 / 3 wallet    | 公式APIの直近10,000 Fill上限。推測でCOMPLETEにしない |
| `HYPERLIQUID_WEBSOCKET_GAP`        | 441件 / 10 wallet | 441件 / 10 wallet | gap recoveryがcoverage proof不足でfail closed        |
| `HYPERLIQUID_WEBSOCKET_ERROR`      | 177件 / 10 wallet | 177件 / 10 wallet | 既存incident evidenceを保持                          |
| `HYPERLIQUID_WEBSOCKET_USER_LIMIT` | 4件 / 4 wallet    | 4件 / 4 wallet    | 既存source制約を保持                                 |

### Performance再計算

- 通常sync後の入力を厳密に使用するため、14 walletへ正式`PerformanceJobScheduler`から`force=true`で1回ずつ再計算を要求した。requestedAtは`2026-09-08T13:39:14.301Z`。
- 結果は14/14 `SUCCEEDED`、14/14 `TRUSTED`、FAILED 0。完了時刻は13:39:55.460–13:42:54.666 UTC。
- latest trusted completenessは`GAP_DETECTED` 10件、`PARTIAL` 4件、`COMPLETE` 0件。
- required metricは`annualizedReturn` 0/14、`maxDrawdown` 0/14、`topTradeContribution` 10/14。trusted closed cycle 20件以上は3/14、未達は11/14。
- 14 incident Runは`QUARANTINED`のまま、trust transitionは14件のまま。今回のPerformance/Selection入力へincident Runをtrustedとして混入させていない。

### Selection再評価とBehavior

- current Selection Run: `cmtspzm9t0007qq0yhgfv1ej8`。
- `wallet-selection-v1`、評価日時`2026-09-08T13:43:22.823Z`、universe 14 / selected 0 / qualified 0 / review 14 / excluded 0。
- 全14件が`HISTORY_INCOMPLETE`と`REQUIRED_METRIC_MISSING`、うち11件が`TOO_FEW_COMPLETED_TRADES`。`DATA_STALE`は0件、manual overrideは14/14 `AUTO`。
- threshold由来の`RETURN_BELOW_MINIMUM` / `DRAWDOWN_TOO_HIGH` / `PROFIT_TOO_CONCENTRATED`で`EXCLUDED`になったwalletは0件である。
- 結論: 現在の`selected=0`はデータ完全性・必須metric不足によるfail-closed `REVIEW`であり、wallet-selection-v1の投資基準を本当に満たさないと確定した結果ではない。
- Worker startupの正常Behavior control jobはcurrent selected 0を読み、`no-op`（processed events 0）で完了した。Behavior event / run / scope / DQはいずれも0件である。

### 負荷と終了状態

- 観測peak: Worker約1.59 GiB、PostgreSQL約3.22 GiB、Redis約59 MiB。OOM、無制限backlog、retry stormはなかった。
- 終了時queueはhyperliquid / performance / behaviorすべてwait / active / delayed / prioritizedが0。履歴としてhyperliquid failed 10件、performance failed 14件（既存保持分）、behavior failed 0件が残る。
- 終了時PostgreSQL / Redisはhealthy、DB sizeは51 GB、WSL disk freeは796 GB。Workerは停止済み。

## Issue 15 data-readiness refresh（2026-09-12）

### Preflightと実行範囲

- 前回処理を機械的に繰り返さず、live read-only監査を先行した。14/14 walletの`lastSyncAt`が24時間閾値を超えており、current Selection Runは引き続きselected 0 / review 14だったため、Owner承認済みの定期refresh対象と判定した。
- 対象はSelection readiness監査で確定したwatched Hyperliquid wallet 14件だけである。Worker imageは`chaincopy-worker:issue15-7524a7f`、digestは`sha256:035ae76f6c12c8ac5bd7ef01b12c5ef4ca5677e58136795f46a9bcf7fc9d11af`、revision labelはmain merge commit `7524a7f4e493c4a7ae42f7179774df09d553c5a0`と一致した。
- concurrency 1、queue backlog上限500、discovery無効のまま、正式scheduler/sync、`PerformanceJobScheduler`、`wallet-selection-v1`、Behavior control jobを使用した。手動cursor変更、DQ直接更新、quarantine解除、destructive DB操作、Redis key削除は0件である。
- 開始時queueはhyperliquid / performance / behaviorのwait / active / delayed / prioritizedがすべて0、PostgreSQL / Redisはhealthy、DB sizeは51 GB、WSL disk freeは796 GBだった。

### 正式syncと環境中断からの回復

- schedulerはcurrent-state / fill / funding / ledger / portfolio / historical-orders / DQ auditを各14件、計98件の正式jobとして扱った。14/14 walletの主要laneは最終的に成功し、`lastSyncAt`の24時間超過は14件から0件へ解消した。最終sync時刻範囲は`2026-09-11T15:53:33.615Z`–`2026-09-11T16:03:59.635Z`（UTC）である。
- 初回実行中にWSL session終了に伴いPostgreSQL / Redis / Workerが同時停止し、BullMQ stalled recovery時の同一wallet lock競合によってwallet `cms39x9ni000umw0iw2zkbf1e`のhistorical-ordersとDQ auditが各1件fail closedした。heap、backlog、retry storm、アプリケーション例外を原因とする停止ではない。
- 欠けた2 laneだけをcanonical DB address `0x06438b0d1bb6f8aa4a455a4f2c1b1e744d53c760`とのidentity照合後、fresh job IDで正式queueへ再投入した。historical-ordersは`fetched=2000 / inserted=2000`、DQ auditは`missingScopes=[] / openIssues=55`で、両方attempt 1の`SUCCEEDED`となった。失敗履歴は監査証跡として削除していない。
- Worker再起動時のscheduler tickは同じ14 walletだけを再照合した。既存idempotent job identityと正式processorを維持し、対象外walletやwrong-address identifierは使用していない。

### Data Quality、Performance、Selection

- OPEN DQの最終値は`HYPERLIQUID_FILL_HISTORY_LIMIT` 3件 / 3 wallet、`HYPERLIQUID_WEBSOCKET_GAP` 441件 / 10 wallet、`HYPERLIQUID_WEBSOCKET_ERROR` 177件 / 10 wallet、`HYPERLIQUID_WEBSOCKET_USER_LIMIT` 4件 / 4 walletで、refresh前後に変化はない。`HYPERLIQUID_PARTIAL_API_FAILURE`は0件を維持した。
- 正式sync後、14 walletへ`performance-v3`を`force=true`で各1回実行し、14/14 `SUCCEEDED`、14/14 `TRUSTED`、FAILED 0だった。retryしたDQ auditは対象walletのPerformanceを正式契約からもう1回起動し、Run `cmtx5bqu80aagru0i4j9rhull`が`SUCCEEDED / TRUSTED / GAP_DETECTED`、metrics 12件で完了した。
- current Selection Runは`cmtx5bxhq0007qn0yra29e6gq`、評価時刻`2026-09-11T16:03:56.201Z`、universe 14 / selected 0 / qualified 0 / review 14 / excluded 0である。全14 walletが`HISTORY_INCOMPLETE`と`REQUIRED_METRIC_MISSING`、うち11 walletが`TOO_FEW_COMPLETED_TRADES`となった。
- latest trusted completenessは`GAP_DETECTED` 10件、`PARTIAL` 4件、`COMPLETE` 0件である。trusted closed cycle 20件以上は3/14だが、全walletで必須metricが揃っていない。`DATA_STALE`とthreshold由来のexcludeは0件である。
- 結論: selected 0はstalenessではなく、解消していない履歴完全性と必須metric不足によるfail-closed `REVIEW`である。投資基準を本当に満たさないと確定した結果ではない。

### Behavior、負荷、終了状態

- Selection結果に従うBehavior control jobはstartup時とSelection再評価後の双方で`no-op / processedEvents=0`となった。Behavior event / run / scope / DQはすべて0件で、selected wallet不在時にwatched walletへfallbackしていない。
- 観測peakは、正式sync中にWorker約1.67 GiB、PostgreSQL約3.31 GiB、Redis約55 MiB、Performance中にWorker約1.84 GiB、PostgreSQL約2.97 GiB、Redis約54 MiBだった。OOM、無制限backlog、retry stormはなかった。
- 終了時queueはhyperliquid / performance / behaviorのwait / active / delayed / prioritizedがすべて0。Workerはgraceful stop済みでexit 0、PostgreSQL / Redisはhealthy、DB sizeは52 GB、WSL disk freeは796 GBである。
- 14 incident Performance Runは`QUARANTINED` 14件、trust transition 14件のまま保持した。manual overrideは全件`AUTO`である。
- 状態文書更新後のvalidationはformat、lint、typecheck、65 files / 613 tests、build 11/11 packages、`git diff --check`が成功した。integration testはvolumeなしの一時PostgreSQL / Redisへmigrationを適用して実行し、終了時に一時containerだけを停止した。実DB / 実Redisへtest mutationは行っていない。

## 次の優先作業

1. 10 walletのWebSocket gapについて、fills / funding / ledger全laneのcoverage proofを取得できる正式なupstream history recovery契約を設計・承認する。
2. 3 walletの公式10,000 Fill上限について、追加の信頼できる履歴sourceまたは証明可能なbounded recovery方針を決める。
3. 上記が解消して`COMPLETE`となった後に`performance-v3`を再計算し、必須metricとclosed cycleが揃ったwalletだけをSelectionで再評価する。
4. effective selected walletが1件以上になった場合のみ、通常Behavior処理を継続する。

## Blockerと承認境界

- 現在のnormal syncと既存gap recoveryだけでは、10 walletのgap coverageおよび3 walletの10,000 Fill以前の履歴を証明できない。追加取得sourceまたは正式仕様を伴う別作業契約が必要である。
- DQやhistory completenessを件数合わせ・手動更新で解消済みにしない。既存のfail-closed契約を維持する。
- Issue 15 Stage 4 canary/backfillは、effective selected walletが1件以上あり、対象walletのhistory/DQ/quote条件が契約を満たし、必要なOwner承認が揃うまで実行しない。
- main merge、実DB destructive operation、実migration、本番適用、大規模index、Redis削除、quarantine解除、秘密情報変更、実注文・署名・資金移動は自動実行しない。

## 実行環境

- host: Windows PowerShell、Node.js 24.12.0、pnpm 11.9.0
- runtime: WSL2 Docker、PostgreSQL 17、Redis 8
- GitHub CLI: なし
- 稼働中process/container: PostgreSQL / Redisのみ。Workerは停止。
- この作業で行った許可済みmutation: 14 walletの正式sync、正式DQ lifecycle、Performance run作成、Selection run作成。禁止された直接DB/Redis mutationは0件。
