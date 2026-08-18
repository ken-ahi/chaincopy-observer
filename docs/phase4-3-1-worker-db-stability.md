# Phase 4.3.1 Worker / DB 負荷安定化

## 原因と方針

1 分ごとに全ウォレットへ全 HTTP API を実行し、HTTP raw response、同期履歴、注文履歴、snapshot を同じ優先度で永続化していたことが主因である。分析用の Fill/Funding/Ledger と Phase 4.3 の Performance/Selection 契約は維持し、監査・再解析用データには明示的な保持期限を設ける。

## 同期周期と並列数

| 処理                                                 | default | 設定                                                                               |
| ---------------------------------------------------- | ------: | ---------------------------------------------------------------------------------- |
| Fill                                                 |    1 分 | `HYPERLIQUID_FILL_SYNC_INTERVAL_MS`（未設定時は旧 `HYPERLIQUID_SYNC_INTERVAL_MS`） |
| Funding / Ledger / current positions / spot balances |   10 分 | `HYPERLIQUID_ACCOUNT_SYNC_INTERVAL_MS`                                             |
| Portfolio                                            |   30 分 | `HYPERLIQUID_PORTFOLIO_SYNC_INTERVAL_MS`                                           |
| Historical orders                                    |   60 分 | `HYPERLIQUID_ORDER_HISTORY_SYNC_INTERVAL_MS`                                       |
| Data quality audit                                   |   60 分 | `HYPERLIQUID_DATA_QUALITY_AUDIT_INTERVAL_MS`                                       |

通常同期 Worker は `HYPERLIQUID_WORKER_CONCURRENCY=2`、Discovery Worker は `HYPERLIQUID_DISCOVERY_WORKER_CONCURRENCY=4`、候補 enrichment は既存の `HYPERLIQUID_DISCOVERY_ENRICHMENT_CONCURRENCY=2` を安全な default とする。

Scheduler は再起動時に各周期の現在 bucket だけを投入し、過去 bucket の無制限 catch-up はしない。同じ wallet/job の active・waiting・delayed・prioritized job があれば投入しない。Queue backlog が `HYPERLIQUID_QUEUE_BACKLOG_LIMIT`（default 500）以上なら、その tick の新規投入を止める。

### BullMQ backlog maintenance

`hyperliquid-sync` の古い backlog は、worker と scheduler を停止してから maintenance CLI で除去する。CLI は BullMQ API のみを使用し、Redis key に対する `DEL` / `ZREM` は使用しない。最初に必ず dry-run し、JSON Lines の `inventory`（state/name 別件数）と `summary`（削除前後件数・対象数）を保存して確認する。

```bash
pnpm queue:cleanup --dry-run --queue hyperliquid-sync --before 2026-08-01T00:00:00Z
pnpm queue:cleanup --queue hyperliquid-sync --before 2026-08-01T00:00:00Z --batch-size 1000
pnpm queue:cleanup --dry-run --queue hyperliquid-discovery --before 2026-08-01T00:00:00Z
pnpm queue:cleanup --dry-run --queue hyperliquid-candidate-enrichment --before 2026-08-01T00:00:00Z
```

対象 state は `prioritized`、`waiting`、`delayed`、`failed`。`requestedAt` が cutoff と同時刻または過去の Job だけが候補になる。`active` Job、日時が不正な Job、job name と wallet ごとの最新 `requestedAt` bucket は削除しない。削除済み Job は再実行時に列挙されないため retry safe である。実行中に Job が active へ遷移した場合も再確認して保護する。負荷を抑える必要がある場合は `--batch-size` を小さくする。

`HYPERLIQUID_DISCOVERY_ENABLED=false` の場合、worker process は discovery scheduler、market discovery WebSocket、`hyperliquid-discovery` consumer、`hyperliquid-candidate-enrichment` consumer を生成・起動しない。したがって既存 backlog は設定を有効化するか maintenance CLI を明示実行するまで処理されない。

Shutdown は BullMQ の強制終了を行わず、active Job の完了を待つ。各 worker の待機開始と全 shutdown step の `durationMs` を JSON log に出すため、数十秒の停止時間が in-flight Job 由来かを component 単位で判別できる。

### Performance input memory safety

performance-v3 の入力は `calculationFrom` / `calculationTo` を各DB queryへ適用し、5,000行単位で取得・変換する。Position exposure は期間内の最新snapshotだけを取得し、期間内に存在しない場合のみ開始直前のboundary snapshotを使う。snapshotはHyperliquidのmarket上限に合わせて1,000行を上限とし、超過時は黙って切り捨てず失敗させる。Portfolio snapshotはDaily NAVとleverage契約を維持するため期間内全点を使うが、一括 `findMany` は行わない。

入力fingerprintは従来と同じcanonical JSON hashをincrementalに更新し、巨大なJSON文字列をheap上に生成しない。Position Cycleの保存も1,000行単位で行う。`address_performance_input_loaded` と `address_performance_lane_started` のJSON logで、walletごとの入力件数とlane開始を確認できる。

`SyncLockUnavailableError` は同じ古いBullMQ Jobを即時retryしない。schedulerの次回tickによる新しい同期機会は維持する。Position current-state保存は5秒制限のinteractive transactionではなく、Prismaのbatched transactionを使用する。

## Retention

- `sync_jobs`: `SUCCEEDED` は 7 日、`FAILED` は 30 日。`QUEUED` / `RUNNING` は削除しない。
- `raw_events`: HTTP 受信分のみ 30 日。WebSocket raw は将来の正規化監査のため今回の自動対象外。
- `order_history`: 既知の reject status のみ 7 日。`filled`、`open`、`canceled`、未知 status は削除しない。
- snapshot: 今回は取得周期を下げて増加を制御する。`portfolio_snapshots` と `perp_position_events` は performance-v3 の入力なので cleanup 対象外。将来、日次 NAV を壊さない集約・partition 設計を別フェーズで行う。

## Cleanup

最初に必ず dry-run する。

```bash
pnpm db:cleanup --dry-run
pnpm db:cleanup --dry-run --table sync_jobs
pnpm db:cleanup --dry-run --table order_history --status badAloPxRejected
pnpm db:cleanup --explain --table order_history --status badAloPxRejected
```

### 大規模 cleanup の index preflight

batch 候補は `(status, retention timestamp, id)` の順（`sync_jobs` は既存 `(status, created_at)`）で選択する。削除済みの古い index entry が先頭から消えるため、主キー先頭の scan + filter を batch ごとに繰り返さない。`id` は同一 timestamp の決定的な tie-breaker である。

既存巨大テーブルに通常の `CREATE INDEX` を行う migration は追加しない。Worker と cleanup を停止し、空き容量、replication lag、長時間 transaction を確認した maintenance window で、次を `psql` から transaction 外で明示実行する。これは今回まだ実 DB では実行しない。

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/maintenance/create-cleanup-indexes-concurrently.sql
```

別 session から `pg_stat_progress_create_index` を監視し、完了後に `pnpm db:cleanup --explain ...` で `order_history_cleanup_status_timestamp_id_idx`（raw event は対応する cleanup index）の Index Scan が選ばれることを確認する。`--dry-run` は index 作成前にも件数確認だけ実行できるが、実削除と `--explain` は必要 index が `indisready` かつ `indisvalid` でない限り fail-fast するため、未整備状態で巨大 cleanup を開始できない。失敗した concurrent build が invalid index を残した場合は、その index だけを運用者が `DROP INDEX CONCURRENTLY` してから再実行する。

実削除は運用者が dry-run 結果を確認した後だけ行う。

```bash
pnpm db:cleanup --table sync_jobs --batch-size 1000 --delay-ms 100
```

各 batch は独立した DELETE であり、失敗時は同じコマンドを再実行できる。境界条件は `< cutoff` なので cutoff と同時刻の行は保持する。処理は計画件数、batch 削除件数、累計を JSON log に出す。

## 容量回収と再起動前チェック

1. Worker を停止する。
2. dry-run の table/status/cutoff/件数を確認する。
3. 実 cleanup を小さい batch で行う。
4. `ANALYZE <table>;` を実行する。
5. 通常の `VACUUM (ANALYZE) <table>;` を必要に応じて実行する。
6. 物理容量の即時回収が必要な場合だけ、十分な空き容量と停止時間を確保して、運用者が明示的に `VACUUM FULL` または `pg_repack` を検討する。アプリからは実行しない。
7. Queue の waiting/active/failed/stalled、DB table size、Worker の設定値を確認して再起動する。

table size は `pg_total_relation_size`、retention 最終実行は cleanup log で確認する。将来のデータ量が単一 table の index/maintenance 能力を超える場合は、時刻列による range partition を検討する。
