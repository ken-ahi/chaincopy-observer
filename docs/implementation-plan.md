# Phase別実装計画

最終更新: 2026-07-25

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

## Phase 3: Sui/Cetus連携

- Sui GraphQL履歴pagination
- Sui gRPC低遅延取得
- Cetus package/pool allowlist
- Swap/DCA/limit event正規化
- token metadata/price provenance
- provider保持期間と欠損検知
- pagination/reorg/重複test

禁止: transaction構築・実行、wallet/keypair。

## Phase 4: 分析エンジン

- cash flow分類とportfolio再構築
- TWR、年率、drawdown、risk指標
- DCA/Leverage分類
- score、ranking、data quality
- 計算根拠、version、provenance
- Decimal test vector

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

## Phase 8: 自動アドレス探索

- 公開データからの候補抽出
- 除外リスト、bot/contract分類
- candidate enrichment queue
- 条件未達を水増ししない
- 手動CSV経路との統合

## Phase 9: 本番運用強化

- 本番デプロイ
- Sentry等のエラー監視
- rate limit/WAF/CSP強化
- backup/restore試験
- load test、障害注入、DR
- ログ90日保持
- 運用runbookとsecret rotation
