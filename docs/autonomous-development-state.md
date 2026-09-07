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

状態は「実装」「自動テスト」「実運用確認」を分離する。ここでの実運用欄は過去の承認済みIssue報告を含み、2026-09-07に実DBを再照合したことを意味しない。

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

## 次の優先作業

1. OwnerによるPR #27 mergeを待つ。Codexはmainへmergeしない。
2. merge後、Issue 26を再実行せず、Issue 15の現行データreadinessを読み取り専用で再確認する。
3. history completeness / staleness / metric calculabilityをwallet別・理由別に分類し、取得可能なデータ改善とsource制約を分離する。
4. 実DB sync、Performance、Selection、Behavior canary/backfillへ進む場合は、対象Issueの承認範囲とOwner approvalを再確認する。

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
