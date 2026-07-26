# Phase 1–3 運用設計

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

## Phase 3 探索運用

- `/dashboard/discovery`から開始/停止、主要/全銘柄、軽量filter閾値を変更する。
- Worker scheduler leaderが10秒以内に設定を反映する。停止時は市場WebSocketを閉じ、候補Queueの永続jobは削除しない。
- 市場切断時は`discovery_cursors`を`GAP_DETECTED`にし、`discovery_data_quality_issues`へ開始/復帰時刻を保存する。Worker再起動時も直近Cursorから再接続時刻までを保守的な欠損区間として記録する。無料APIで推測補完しない。
- reconnectは購読数・公式message上限を満たす下限と指数Backoffを併用し、連続12回で`DEGRADED`にする。
- Enrichmentは専用queueの同時実行数、1アドレスごとの`next_enrichment_at`、weighted limiterで制限する。
- 監視同期とGap Recoveryは候補Enrichmentより高いHTTP優先度を持つ。
- weighted limiterの1分予算はWorker process内で共有するため、公式IP単位制限を守る運用ではWorker replicaを1に固定する。水平分割する場合は、分散weight予算を実装してから行う。
- Worker停止時は最大2分のgrace periodで実行中の候補Enrichmentを完了させ、未完jobはBullMQの再配信で継続する。

30分実データ試験では、開始前後の`discovery_stats`、`discovery_trades`、`address_candidates`、Queue件数を記録する。15分前後でWorkerを再起動し、Cursorが後退せず、再購読後の重複が増えても取引・候補統計が二重加算されないことを確認する。試験終了時は`finally`相当で探索設定を元へ戻す。

`pnpm test:e2e`は専用API/Webを本番確認用Composeと衝突しない`3101`/`3100`で起動する。PostgreSQLの`chaincopy_e2e` schemaとRedis DB 15へ隔離し、成功・失敗を問わず終了時に両方を消去する。fixture walletを削除しても通常の`hyperliquid-sync` queueへ孤立jobを残さない。

PlaywrightをDocker内で再現する場合は`Dockerfile.e2e`を使用する。Node 24、固定lockfile、Chromium、Prisma Client、production buildを同じイメージ内で準備し、WSLでは`--network host`でComposeのPostgreSQL/Redisへ接続する。API/Webの起動と停止は上記E2Eランナーが管理する。

## Redis `vm.overcommit_memory`

WSL 内の Redis が警告する場合:

```bash
sudo sysctl -w vm.overcommit_memory=1
printf 'vm.overcommit_memory = 1\n' | sudo tee /etc/sysctl.d/99-redis-overcommit.conf
```

WSL を再起動した後、`sysctl vm.overcommit_memory` と Redis log を再確認する。ローカルで sysctl を変更できない場合、警告、影響、将来対応をテスト記録へ残す。

## 2026-07-26 実データ検証

公開アドレス `0x831ea8a4a4d7ea2657ba48f8c074d69bdaece05c` を使用した。初回は Fill 1,144、Funding 2,102、Ledger 99、Order 2,002、現在 Position 3 を保存した。同じ HTTP 同期の二回目は各履歴の insert が0で、価格・時刻を持つ新しい snapshot だけが増えた。WS 初期 snapshot は raw event 5件を保存し、HTTP と重なる Funding の増加は0だった。

Phase 3市場探索は主要5銘柄で2026-07-26 10:25:16–10:56:05 UTCに実施した。10:40:39 UTCにWorkerを停止し、10:40:52 UTCに再接続・再購読したため、実接続時間は前半15分23秒、後半15分13秒で合計30分36秒だった。30分時点で受信は1,247→6,055、新規候補は485→1,448、Enrichment成功は20→30となり、API weightは1分1,200以下だった。通常監視同期も停止時lockのTTL失効後にfill、funding、position、data quality各jobが成功へ復帰した。

再起動Gapは直前Cursor 2026-07-26 10:40:39.606 UTCから再接続時刻までをData Quality Issueへ保存し、その後もCursorは単調に前進した。停止操作中、`meta`待ちの古いcontrol jobが停止後に2接続を再生成する競合を検出したため、supervisor全体をsingle-flight化し、`meta`後に最新設定を再確認するよう修正した。初回Compose再構築後は`enabled=false`、`STOPPED`、受信6,966で固定された。再接続中に再受信した431件は除外され、取引外部ID、fingerprint、候補参加、候補集計の重複・不整合はいずれも0件だった。

Worker再起動時は、完了時刻のないCandidate Enrichment試行を失敗として閉じ、対応する`RUNNING`候補を`FAILED`へ戻してからQueue処理を開始する。これにより、強制停止やBullMQのstalled判定前に孤立した試行を成功扱いせず、再試行可能な状態を保持する。

最終コードでは、11:09:45–11:24:54 UTCの15分09秒と11:30:05–11:45:18 UTCの15分12秒を計測し、追加接続時間を除いても合計30分21秒の主要5銘柄探索を再試験した。受信は6,966→13,255、候補は1,536→2,417、Enrichment成功は36→60、filter通過は1→2となり、API weightは全観測点で1分1,200以下だった。停止完了時の受信は13,323で、その後も固定された。

再起動ごとに永続Cursorから無料APIで補完不能な区間をData Quality Issueへ保存し、再購読後はCursorが後退せずに前進した。最終DBは取引12,776件、候補参加25,552件、候補2,420件で、取引外部ID、fingerprint、候補参加の重複、および取引回数・金額・maker/taker・buy/sell・銘柄・活動期間集計の不一致はすべて0件だった。履歴完全性は`COMPLETE` 2件、`PARTIAL` 49件、`INSUFFICIENT` 11件で、打ち切り候補を完全履歴として扱っていない。

停止試験ではweighted limiter待ちがDiscovery shutdownを遅らせ、Phase 2 scheduler lease解放が停止猶予を超える経路を検出した。shutdown順とlease解放順を修正後、WebSocket停止待ち中でも別schedulerがleadershipを取得できる回帰テストが成功した。さらに通常同期WorkerをCandidate Workerより先に閉じる順序へ変更し、180秒猶予のgraceful停止後にscheduler/wallet lockのRedis `PTTL`がともに`-2`、未完了Enrichmentと`RUNNING`候補がともに0件であることを確認した。最終Workerは孤立試行の回収なしで即時leaderを取得し、Phase 2のfill、funding、ledger、position、data quality全jobが成功した。最終状態は`enabled=false`、WebSocket `STOPPED`、全Compose service healthyである。

- OAuth失敗: client ID/secret、redirect URI、許可メールを確認

## 5. バックアップ

Phase 1はschema/MigrationをGitで管理する。業務データの定期backup/restoreはPhase 9で実装し、日次バックアップと復元演習を必須にする。
