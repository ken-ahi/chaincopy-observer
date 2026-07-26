# Phase別実装計画

> 2026-07-26の所有者指示により、Phase 1/2の直後にHyperliquid自動探索を「Phase 3」として実施した。Phase 4は監査・仕様確定（4A）と純粋計算実装（4B）に分ける。

最終更新: 2026-07-26

## 共通完了ゲート

各Phaseで次をすべて行う。

1. 設計更新
2. 実装
3. Unit Test
4. Integration Test
5. `pnpm lint`
6. `pnpm typecheck`
7. `pnpm test`
8. `pnpm build`
9. セキュリティ確認
10. ドキュメントと残課題の更新

## Phase 0: 設計

- 要件・対象外・受入条件
- アーキテクチャと責務分離
- 論理ER、物理Migration方針
- 外部APIの公式資料調査
- Decimal計算規則
- 認証、秘密管理、監査
- 仮定、ADR、リスク

完了条件: `docs/` のPhase 0成果物が揃い、仕様との差分が記録されている。

## Phase 1: 開発基盤

- pnpm/Turbo workspace
- Next.js Web、Fastify API、BullMQ Worker
- PostgreSQL/Prisma、Redis
- Auth.js/Google OAuth/単一メールallowlist
- 認証必須dashboard
- health/readiness、構造化ログ
- Docker Compose、Migration
- ESLint/Prettier/Vitest/Playwright
- GitHub Actions、README

完了条件: 指定コマンドが成功し、Composeで全サービスを起動できる。

## Phase 2: Hyperliquid連携

- 読み取り専用Info API client
- user fills/portfolio/position/fundingのschema validation
- WebSocket購読、heartbeat、再接続
- snapshotとincremental eventの冪等保存
- HTTPによる欠損補完
- sync cursor、rate budget、data quality issue
- adapter unit/integration test

禁止: Exchange endpoint、署名、注文送信。

## Phase 3: Hyperliquidアドレス自動探索

- 公式`meta` APIから購読対象Perpetualsを決定
- 公式`trades` WebSocketからbuyer/sellerを抽出
- 取引・候補・CursorをPostgreSQLへ冪等保存
- 軽量フィルター、低優先度Enrichment、履歴完全性判定
- 候補一覧・詳細・設定・昇格Web UI
- Weighted limiter、429/Retry-After、再接続・再購読・Data Quality Issue

禁止: 手動ファイルimport、有料データ、scraping、Requester Pays S3、自前node、Exchange endpoint、署名、注文。

## 将来候補: Sui/Cetus連携

- Sui GraphQL履歴pagination
- Sui gRPC低遅延取得
- Cetus package/pool allowlist
- Swap/DCA/limit event正規化
- token metadata/price provenance
- provider保持期間と欠損検知
- pagination/reorg/重複test

禁止: transaction構築・実行、wallet/keypair。

## Phase 4: 分析エンジン

### Phase 4A: データ監査と計算仕様確定

- 保存済みHyperliquidデータの充足性と精度区分
- closed PnL、Position Cycle、cash flow、NAV、TWR、risk指標の規則
- 履歴完全性とfail-closed条件
- 分析model案と固定Decimal test vector

完了条件: `docs/calculations.md`、DB案、ADRが整合し、コード、schema、Migrationを変更していない。

### Phase 4B: 決定論的な純粋計算

- cash flow分類とPosition Cycle構築
- Perp NAV、TWR、年率、drawdown、risk・trade・leverage指標
- 型付き計算エラー、precision、data completeness
- Phase 4Aの固定Decimal test vector

Phase 4BではDCA/Leverage分類、score、ranking、シグナルへ進まない。全口座NAV、清算回数など入力不足の指標は、必要データの保存が実装されるまで値を作らない。

### Phase 4C: 計算結果永続化とWorker集計

- `MetricCalculationRun`、`DailyNav`、`PositionCycle`、`AddressPerformanceMetric`
- `performance-v1`と入力fingerprintによる成功Run再利用
- transactionによる結果保存と`SUCCEEDED`遷移
- `calculate-address-performance`、`recalculate-address-performance`
- 既存同期・Gap Recovery・候補Enrichmentより低優先度、同時実行数1
- fixture 2件と既存公開テストアドレス1件だけで連携検証

Phase 4CではAPI、Web、分類、score、ranking、シグナルへ進まない。全口座NAV、清算回数、payoff ratioなど入力または純粋関数が不足する指標は値を作らない。

## Phase 5: シグナル

- deterministic signal rule
- confidence、consensus、risk filter
- signal fingerprint
- fail closedと抑止理由
- Web signal UI

## Phase 6: デモトレード

- demo portfolio/order/fill/position/ledger
- Risk Adjusted/Mirror mode
- fee、funding、slippage、copy delay
- benchmark
- reset/pause/resume

禁止: 実注文interfaceとの共通化。

## Phase 7: メール通知

- Resend send API
- 即時/集約/digest
- notification idempotency
- Webhook署名と配信状態
- rate limit、suppression
- test email

## 旧Phase 8案: 自動アドレス探索（Phase 3へ前倒し済み）

- 公開データからの候補抽出
- 除外リスト、bot/contract分類
- candidate enrichment queue
- 条件未達を水増ししない
- 手動CSV/JSON経路は採用しない

## Phase 9: 本番運用強化

- 本番デプロイ
- Sentry等のエラー監視
- rate limit/WAF/CSP強化
- backup/restore試験
- load test、障害注入、DR
- ログ90日保持
- 運用runbookとsecret rotation
