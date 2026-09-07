# Autonomous Development State

最終更新: 2026-09-07 (Asia/Tokyo)

## 目的と正本

本書は、`docs/codex-autonomous-master-prompt.md` に従う作業再開用の状態記録である。プロダクト仕様は `docs/SPEC.md`、段階計画は `docs/implementation-plan.md`、確定判断は `docs/decisions.md`、AI開発手順は `docs/ai-development-workflow.md` を正とする。本書はこれらを変更しない。

## 現在のGitHub状態

- branch: `codex/issue-26-incident-repair`
- `origin/main`: `8aca1f9` (`Merge pull request #25 from ken-ahi/codex/issue-24-trusted-run-lookup`)
- Issue 26 evidence commit: `571a0ec`
- fast-uri security commit: `5ebc650`
- PR: #27 `fix(issue26): preserve incident repair evidence and preflight`（open）
- CI: commit `5ebc650` のrun #64は成功（2分35秒）。ローカル相当validationも全て成功済み。

## 完了済みで再実行しない作業

- Issue 26 Stage 3Bでmanifest許可済みの `portfolio_snapshots` 161件を削除した。
- Issue 26 Stage 3Cでcanonical replay 18/18を完了し、対象latest/current group 31/31を復元した。
- 14 incident performance runは `QUARANTINED` のまま保持した。
- Stage 3Cで解消された8件のDQは監査済みで、8/8 `RESOLVED_IS_CANONICAL` と判定した。
- downstream Performance rebuild、Selection evaluation、Behavior no-opを完了した。Behaviorはeffective selected walletが0件だったため正常no-opである。
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

状態は「実装」「自動テスト」「実運用確認」を分離する。ここでの実運用欄は過去の承認済みIssue報告を含む。Issue 15の入力状態は下記の範囲で2026-09-07にread-only再照合したが、Issue 26の全integrity auditを再実行したものではない。

| SPEC第32章対応                          | 実装                                     | 自動テスト                          | 実運用                           | 現在の判定                         |
| --------------------------------------- | ---------------------------------------- | ----------------------------------- | -------------------------------- | ---------------------------------- |
| A. 所有者限定ログイン・README起動       | あり                                     | E2E成功                             | 今回未確認                       | 継続監査                           |
| B. アドレス登録・候補収集・履歴取得     | Hyperliquidあり                          | unit/integration/E2E成功            | Issue 26 canonical state復元済み | Sui/Cetusを含む全体は未達          |
| C. 重複・欠損・順不同・再接続・API障害  | DQ/fail-closed契約あり                   | 全test成功                          | Issue 26でincident recovery済み  | source history制約が残存           |
| D. Performance・分類・Selection根拠     | performance-v3 / wallet-selection-v1あり | 全test成功                          | Issue 26 downstream rebuild済み  | completeness/stalenessでselected 0 |
| E. Selection→Behavior→signal→Web        | Phase 5.0 Behaviorまであり               | Behavior test成功                   | Behaviorはselected 0でno-op      | signal/Web連携は未達               |
| F. メール送信・抑制・配信記録           | 要追加監査                               | package build/test成功              | 未確認                           | 未達扱い                           |
| G. 正式仕様のデモ取引                   | 要追加監査                               | package build/test成功              | 未確認                           | 未達扱い                           |
| H. デモ資産曲線・benchmark比較          | 要追加監査                               | 今回の全testは成功                  | 未確認                           | 未達扱い                           |
| I. signalからsource/version/DQを追跡    | Behavior provenanceまであり              | 全test成功                          | 未確認                           | signal未実装範囲は未達             |
| J. 実売買・署名・秘密鍵なし、主要CI成功 | safety boundary維持                      | ローカル全validation・PR #27 CI成功 | 本番適用なし                     | merge承認待ち                      |

## Issue 15 data-readiness read-only snapshot

2026-09-07に、PostgreSQLへ `default_transaction_read_only=on` と30秒のstatement timeoutを強制して確認した。Workerは停止中であり、recalculate、Selection evaluate、Behavior、enqueue、DB/Redis mutationは実行していない。

- watched Hyperliquid wallet: 14件。
- current Selection Run: `cmtpiv9u10004pi0yx37tjy4h`、`wallet-selection-v1`、2026-09-06 08:00:44 UTC評価。universe 14 / selected 0 / qualified 0 / review 14 / excluded 0。
- latest trusted `performance-v3`: 14/14 walletにSUCCEEDED/TRUSTED Runあり。history completenessは `GAP_DETECTED` 10件、`PARTIAL` 4件、`COMPLETE` 0件。
- staleness: policy上限は24時間。14/14 walletの `lastSyncAt` が上限超過（約122時間が5件、約361時間が9件）。実装上は正式syncの `completeCursor()` 成功時に `lastSyncAt` が更新されるため、更新処理の欠落ではなくsync未実行状態である。
- required metric: `annualizedReturn` と `maxDrawdown` は14/14 Runで未生成、`topTradeContribution` は10/14 RunのみAVAILABLE。current Selectionは14/14件を `REQUIRED_METRIC_MISSING` と判定している。
- trusted closed cycle: policy下限20件を満たすのは2/14 wallet。12/14件は `TOO_FEW_COMPLETED_TRADES`。
- OPEN DQ: `HYPERLIQUID_WEBSOCKET_GAP` 441件/10 wallet、`HYPERLIQUID_WEBSOCKET_ERROR` 177件/10 wallet、`HYPERLIQUID_FILL_HISTORY_LIMIT` 3件/3 wallet、`HYPERLIQUID_PARTIAL_API_FAILURE` 3件/3 wallet、`HYPERLIQUID_WEBSOCKET_USER_LIMIT` 4件/4 wallet。
- したがってStage 4 canaryは引き続きBLOCKED。通常syncはstalenessを改善できるが、coverage proofのないWebSocket gapやsource history limitを解消済みとして扱うことはできない。

## 次の優先作業

1. OwnerによるPR #27 mergeを待つ。Codexはmainへmergeしない。
2. merge後、Issue 26を再実行せず、Ownerが許可する場合に限り14 walletの正式syncでstalenessと再評価可能なDQを更新する。
3. sync後もcoverage proofを満たせないgap/source limitはBLOCKED_SOURCE_DATAとして維持し、取得可能な入力だけでPerformanceを再計算する。
4. Selection evaluate、Behavior canary/backfillへ進む場合は、Issue 15の最新契約とOwner approvalを再確認する。

## Blockerと承認境界

- PR #27 mergeはOwner承認が必要。
- Issue 15 Stage 4 Behavior canary/backfillは、effective selected walletが1件以上あり、対象walletのhistory/DQ/quote条件がfail-closed契約を満たし、Ownerが明示承認するまで実行しない。
- source APIで客観的なcoverage proofを得られないWebSocket gapは、件数合わせで解消済みにしない。
- main merge、実DB mutation、実migration、本番適用、大規模index、Redis削除、秘密情報変更、実注文・署名・資金移動は自動実行しない。

## 実行環境

- host: Windows PowerShell、Node.js 24.12.0、pnpm 11.9.0
- isolated validation: WSL2 Docker
- GitHub確認: public read-only browser（`gh` CLIなし）
- 稼働中の検証process/container: なし
- この更新で実DB/実Redisへ加えた変更: なし
