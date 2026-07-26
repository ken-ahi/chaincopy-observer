# Phase 1–2 運用設計

最終更新: 2026-07-26

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

PostgreSQL と Redis のホスト公開は `127.0.0.1:5432`、`127.0.0.1:6379` に限定する。長期稼働サービスは `restart: unless-stopped` とする。

## 3. 停止

- API/WorkerはSIGTERMで新規受付を停止する。
- Workerは現在のjobを閉じ、Queue、Redis、Prismaの順に接続を閉じる。
- 強制終了後のjobはBullMQから再配信される前提とし、業務キーで冪等にする。

## 4. 障害切り分け

- API `/health` 失敗: APIプロセスまたはHTTP listener
- API `/ready` 503: `components.database` / `components.redis` を確認
- Worker `/health` 503: DB、Redis、queue接続を確認
- Migration失敗: migration service logとPostgreSQL権限を確認

## Phase 2 障害復旧

- Worker 再起動: DB cursor から inclusive に再開し、同じイベントの再取得は一意制約で除く。
- WebSocket 切断: connection cursor を `GAP_DETECTED` にし、指数 backoff で再接続・再購読後、切断時刻から再接続時刻まで HTTP 補完する。
- Redis 停止: lease と queue は一時停止する。復旧後に ioredis/BullMQ が再接続し、未完 job を継続する。業務 cursor は Redis に置かない。
- PostgreSQL 停止: job attempt を失敗として記録できない場合も BullMQ retry に委ね、DB 復旧後に同じ job を再実行する。cursor は成功保存前に進めない。
- 複数 Worker: Redis lease token の比較付き renew/release により scheduler leader は1 processだけとする。lease 喪失時は WS supervisor を停止する。

## Redis `vm.overcommit_memory`

WSL 内の Redis が警告する場合:

```bash
sudo sysctl -w vm.overcommit_memory=1
printf 'vm.overcommit_memory = 1\n' | sudo tee /etc/sysctl.d/99-redis-overcommit.conf
```

WSL を再起動した後、`sysctl vm.overcommit_memory` と Redis log を再確認する。ローカルで sysctl を変更できない場合、警告、影響、将来対応をテスト記録へ残す。

## 2026-07-26 実データ検証

公開アドレス `0x831ea8a4a4d7ea2657ba48f8c074d69bdaece05c` を使用した。初回は Fill 1,144、Funding 2,102、Ledger 99、Order 2,002、現在 Position 3 を保存した。同じ HTTP 同期の二回目は各履歴の insert が0で、価格・時刻を持つ新しい snapshot だけが増えた。WS 初期 snapshot は raw event 5件を保存し、HTTP と重なる Funding の増加は0だった。

- OAuth失敗: client ID/secret、redirect URI、許可メールを確認

## 5. バックアップ

Phase 1はschema/MigrationをGitで管理する。業務データの定期backup/restoreはPhase 9で実装し、日次バックアップと復元演習を必須にする。
