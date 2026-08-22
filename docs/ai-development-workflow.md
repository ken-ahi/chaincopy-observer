# ChatGPT ↔ Codex 開発ワークフロー

最終更新: 2026-08-22

## 1. 目的

ChainCopy Observer の開発で、GitHub Issue / Pull Request を ChatGPT と Codex の共通作業台として使い、仕様化、実装、検証、レビュー、修正の受け渡しを標準化する。

このワークフローは人間のコピペ作業を減らすことを目的とするが、破壊的操作や本番相当データへの変更を無人化しない。

## 2. 基本フロー

```text
Owner
  ↓ 目的・承認
ChatGPT
  ↓ Issue（仕様、範囲、受入条件、禁止事項）
GitHub Issue
  ↓ Codex が作業契約として読む
Codex
  ↓ branch / implementation / tests / self-review
Pull Request
  ↓ GitHub Actions
ChatGPT review
  ├─ PASS → Owner に merge 可否を提示
  └─ BLOCKER → PR comment / Issue に修正要求
Codex
  ↓ fix / retest
Pull Request
```

## 3. Single Source of Truth

優先順位は次の通りとする。

1. `docs/SPEC.md` と明示された確定仕様
2. Phase 固有の正式仕様書
3. `docs/decisions.md` の ADR
4. `docs/implementation-plan.md`
5. GitHub Issue の作業契約
6. PR 内の実装説明

Issue が既存正式仕様と矛盾する場合、Codex は既存仕様を勝手に変更せず BLOCKED として報告する。

## 4. Issue の役割

実装 Issue は最低限以下を含む。

- Goal
- Context / SSoT
- In scope
- Out of scope
- Required design decisions
- Acceptance criteria
- Required validation
- Safety / prohibited operations
- Expected report

Issue は「実装して」だけの曖昧な依頼にしない。

## 5. Codex の作業規則

Codex は作業開始時に以下を確認する。

- `AGENTS.md`
- Issue に列挙された SSoT
- 関連 Phase 仕様
- 既存 schema / code / tests

作業中は以下を守る。

- 関係のないリファクタを混ぜない
- 既存契約を推測で変更しない
- 金融計算は Decimal / 決定論的コードを使う
- fail closed を維持する
- 大規模データを無制限に heap へロードしない
- retry / queue / DB 処理は Phase 4.3.1 の安定化方針を維持する
- テストを skip / weaken して成功扱いにしない

## 6. 自動実行してよい操作

通常の feature branch 内では以下を自動化可能とする。

- ドキュメント作成・更新
- source / test code の実装
- Prisma schema / migration の作成（適用は別ルール）
- format / lint / typecheck / unit / integration / build / E2E
- dependency security audit
- `git diff --check`
- feature branch commit / push
- Pull Request 作成・更新
- CI failure の原因調査と feature branch 上での修正

## 7. 人間承認を必須とする操作

以下は Owner の明示承認なしに実行しない。

- `main` への merge
- `main` への直接 push
- 実DBの DELETE / UPDATE / TRUNCATE
- `VACUUM FULL`
- 大規模 `CREATE INDEX` / `REINDEX`
- migration の実DB適用
- Redis queue / key の削除
- Docker volume 削除
- destructive `git reset --hard`（使い捨て検証 worktree を除く）
- production secrets / credentials の変更
- 外部サービスへの課金を伴う操作
- 実注文、署名、資金移動に関する機能追加

## 8. PR 完了ゲート

コード変更を含む PR は原則として以下を満たす。

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm audit --audit-level high
git diff --check
```

Phase 固有の integration / real-data validation がある場合は追加する。

文書のみの PR はコード系テストを省略できるが、省略理由を PR に明記する。

## 9. Codex 完了報告フォーマット

Codex は終了時に以下を報告する。

1. 実装内容
2. 変更ファイル
3. 設計判断
4. 実行した検証と結果
5. 実行していない検証と理由
6. 残課題 / BLOCKER
7. destructive operation を実施していないこと
8. commit / push / PR の状態

## 10. ChatGPT レビュー規則

ChatGPT は PR / CI を確認し、次のいずれかで判定する。

- `PASS`: 受入条件を満たし、merge 候補
- `PASS_WITH_FOLLOWUP`: merge 可能だが別 Issue に送る改善あり
- `BLOCKED`: 仕様決定や実データ確認が必要
- `CHANGES_REQUIRED`: 現 PR 内で修正必須

レビューでは最低限以下を確認する。

- Issue の acceptance criteria
- SSoT との整合
- diff の scope
- migration / FK / index / retention
- idempotency / retry safety
- bounded query / heap / queue backpressure
- security boundary
- CI

## 11. Phase 5 での適用

Phase 5 では各 sub-phase を原則として次の単位に分ける。

```text
Design Issue
  ↓
Design / Audit document
  ↓ Owner/ChatGPT review
Implementation Issue
  ↓
Codex implementation
  ↓
PR + CI
  ↓
ChatGPT review
  ↓
Owner merge
  ↓
Operational verification（必要な場合）
```

Phase 5.0 では `docs/phase5-0-behavior-event-spec.md` と実装監査結果を実装 Issue の SSoT とする。

## 12. 完全自動化しない理由

ChainCopy Observer は大規模 PostgreSQL / Redis と金融分析ロジックを扱うため、コード生成と CI 修正は自動化しても、データ破壊・本番 migration・merge の最終判断は人間の承認境界として残す。

この境界は開発速度より優先する。
