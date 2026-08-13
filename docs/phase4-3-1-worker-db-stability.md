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
```

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
