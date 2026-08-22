---
name: AI implementation task
about: ChatGPT ↔ Codex の実装作業契約
title: "[AI] "
labels: []
assignees: []
---

## Goal

<!-- この Issue で達成することを1〜3文で記載 -->

## Context / SSoT

<!-- Codex が必ず読む正式仕様を列挙 -->

- `AGENTS.md`
- `docs/SPEC.md`
-

## In scope

- [ ]

## Out of scope

-

## Required design decisions

<!-- 実装前に確定が必要な事項。確定済みなら決定内容を書く -->

-

## Acceptance criteria

- [ ] 既存仕様と矛盾しない
- [ ] 冪等性 / retry safety を維持する
- [ ] 大規模データ処理は bounded である
- [ ] 必要な Unit / Integration test が追加されている
- [ ] 既存 API / calculation contract を意図せず変更していない
- [ ] ドキュメントが実装と一致している

## Required validation

コード変更時は原則すべて実行する。

- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm test:e2e`
- [ ] `pnpm audit --audit-level high`
- [ ] `git diff --check`

追加の Phase 固有検証:

- [ ]

## Safety / prohibited operations

Owner の明示承認なしに以下を実行しない。

- `main` merge / direct push
- 実DB DELETE / UPDATE / TRUNCATE / `VACUUM FULL`
- 大規模 CREATE INDEX / REINDEX
- migration の実DB適用
- Redis key / queue backlog 削除
- Docker volume 削除
- production secret変更
- 実注文 / 署名 / 資金移動

## Git contract

- feature branchのみを変更する
- 関係のない変更を混ぜない
- PRはこのIssueを参照する
- CI failureは原因を修正し、testを弱めて通さない

## Expected report

Codexは完了時に以下を報告する。

1. 実装内容
2. 変更ファイル
3. 設計判断
4. 検証結果
5. 未実施検証と理由
6. 残課題 / BLOCKER
7. destructive operationの有無
8. commit / push / PR状態
