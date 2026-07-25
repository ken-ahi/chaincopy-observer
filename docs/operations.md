# Phase 1 運用設計

最終更新: 2026-07-25

## 1. ローカルサービス

| サービス   | ポート | ヘルス              |
| ---------- | -----: | ------------------- |
| Web        |   3000 | `/login`            |
| API        |   3001 | `/health`, `/ready` |
| Worker     |   3002 | `/health`           |
| PostgreSQL |   5432 | `pg_isready`        |
| Redis      |   6379 | `redis-cli ping`    |

## 2. 起動順

1. PostgreSQL/Redis
2. Prisma Migration
3. API/Worker
4. Web

Composeはhealthcheckと`depends_on.condition`でこの順序を保証する。

## 3. 停止

- API/WorkerはSIGTERMで新規受付を停止する。
- Workerは現在のjobを閉じ、Queue、Redis、Prismaの順に接続を閉じる。
- 強制終了後のjobはBullMQから再配信される前提とし、業務キーで冪等にする。

## 4. 障害切り分け

- API `/health` 失敗: APIプロセスまたはHTTP listener
- API `/ready` 503: `components.database` / `components.redis` を確認
- Worker `/health` 503: DB、Redis、queue接続を確認
- Migration失敗: migration service logとPostgreSQL権限を確認
- OAuth失敗: client ID/secret、redirect URI、許可メールを確認

## 5. バックアップ

Phase 1はschema/MigrationをGitで管理する。業務データの定期backup/restoreはPhase 9で実装し、日次バックアップと復元演習を必須にする。
