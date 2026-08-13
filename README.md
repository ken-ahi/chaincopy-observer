# ChainCopy Observer

Phase 4.3.1 では Worker / DB 負荷安定化として同期周期の分離、設定可能な Worker concurrency、Queue backpressure、明示的な retention と batch cleanup CLI を追加した。運用方法は [docs/phase4-3-1-worker-db-stability.md](docs/phase4-3-1-worker-db-stability.md) を参照すること。実 DB の cleanup は必ず `pnpm db:cleanup --dry-run` から開始し、確認前に DELETE を実行しない。

Hyperliquid と Sui/Cetus の公開取引データを分析・監視する、所有者1名専用の Web アプリケーションです。現在はHyperliquidの監視・自動探索、`performance-v3`の個別成績計算、Phase 4.3の参考ウォレット選定まで実装しています。

実売買、注文送信、ウォレット接続、署名、秘密鍵・シードフレーズ・API Wallet の取扱いはありません。

## Phase 2 の機能

- Google OAuth と許可メール1件による認証・認可
- `/dashboard/addresses` でアドレス登録、検索、watch ON/OFF、手動同期
- `/dashboard/addresses/:address` で Position、Spot、Fill、Funding、Ledger、Order、Portfolio、Sync、Data Quality を表示
- Fastify Address API と、Next.js session を再検証する同一オリジン BFF
- Hyperliquid Info API の Zod 検証、Decimal 文字列保持、ページング、rate limit、timeout、retry
- 公式 WebSocket 購読、heartbeat、指数 backoff、再購読、切断区間の HTTP 補完
- BullMQ processor、定期 scheduler、Redis lease による単一 leader
- PostgreSQL cursor、外部ID/fingerprint、一意制約による再実行安全性
- SIGINT/SIGTERM 時の scheduler、Worker、Queue、Redis、Prisma の graceful shutdown
- Pino 構造化ログと Data Quality Issue

## Phase 3 の機能

- 公式 `meta` Info APIからPerpetuals銘柄を取得
- 主要5銘柄（BTC、ETH、SOL、HYPE、SUI）または全銘柄の公式 `trades` WebSocket購読
- `users[0]` buyer、`users[1]` sellerの抽出、EVMアドレス正規化
- `(block_time, coin, tid)` とfingerprintによる市場取引・候補統計の冪等保存
- Decimalによる推定取引額、銘柄数、maker/taker、buy/sell、活動日・時間の集計
- 軽量フィルター、低優先度Enrichment、履歴完全性・打ち切り理由、Data Quality評価
- weighted API rate limiter、通常同期優先、同時実行上限、429 `Retry-After`、指数Backoff
- heartbeat、再接続、再購読、Discovery Cursor、回収不能な市場欠損のData Quality Issue
- `/dashboard/discovery` と `/dashboard/discovery/:address`
- 手動Enrichment、候補除外、適格候補の既存Phase 2監視Queueへの昇格

候補供給にCSV/JSONインポート、スクレイピング、有料API、Requester Pays S3、自前ノードは使用しません。

## Phase 4.3 の機能

- 保存済み`performance-v3`を使った監視ウォレットの決定論的な選定
- 参考対象、候補、要確認、対象外の4状態と安定順位
- 選定条件の保存、明示的な再評価、同一入力Runの再利用
- 手動の参考対象化、対象外化、自動判定への復帰
- `/dashboard/selection`の初心者向け一覧とPhase 5向け正式取得契約

重み付き総合スコア、Performance完了後の自動再評価、実注文・署名機能は含みません。

## Phase 1 基盤として継続する機能

- pnpm workspace + Turborepo
- Next.js App Router + Tailwind CSS + shadcn/ui 方式の共有 UI
- Fastify REST API
- BullMQ 常駐 Worker と冪等なサンプルジョブ
- PostgreSQL + Prisma Migration
- Redis + BullMQ
- NextAuth.js v4 + Google OAuth
- 許可メールアドレス1件だけのサーバー側認可
- 認証必須ダッシュボード
- API、DB、Redis、Worker の health check
- Zod 環境変数検証、Pino 構造化ログ
- ESLint Flat Config、Prettier、Vitest、Playwright
- Docker Compose、GitHub Actions

## 禁止事項

本リポジトリでは次を実装しません。

- 実際の売買注文
- ウォレット接続・署名
- 秘密鍵・シードフレーズの取得または保存
- AI による金融計算・自由な売買判断

金融値には JavaScript `number` を使わず、Decimal を使用します。

## 必要環境

- Node.js 24.x
- pnpm 11.9.0
- Docker Engine / Docker Desktop と Compose v2
- 実ログイン時のみ Google OAuth Client

```powershell
node --version
pnpm --version
docker --version
docker compose version
```

## セットアップ

```powershell
Copy-Item .env.example .env
pnpm install
pnpm db:generate
docker compose up --build -d
```

`.env` では最低限、次を置き換えます。

```dotenv
AUTH_SECRET=<32文字以上のランダム値>
INTERNAL_API_SECRET=<別の32文字以上のランダム値>
GOOGLE_CLIENT_ID=<Google OAuth Client ID>
GOOGLE_CLIENT_SECRET=<Google OAuth Client Secret>
ALLOWED_ADMIN_EMAIL=<許可する所有者メール>
```

OAuth redirect URI:

```text
http://localhost:3000/api/auth/callback/google
```

サービス:

| サービス      | URL                          |
| ------------- | ---------------------------- |
| Web           | http://localhost:3000        |
| API liveness  | http://localhost:3001/health |
| API readiness | http://localhost:3001/ready  |
| Worker health | http://localhost:3002/health |

PostgreSQL `5432` と Redis `6379` は Compose で `127.0.0.1` にだけ公開します。

停止:

```powershell
docker compose down
```

DB/Redis の volume も削除して初期化する場合だけ、対象を確認してから次を実行します。

```powershell
docker compose down --volumes
```

## ホスト上での開発

Compose の PostgreSQL/Redis を起動した状態で、依存、Prisma Client、Migration、seed を用意します。

```powershell
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

ホスト用 URL を設定して Web/API/Worker をまとめて起動します。

```powershell
$env:DATABASE_URL="postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy?schema=public"
$env:REDIS_URL="redis://127.0.0.1:6379"
pnpm dev
```

個別起動:

```powershell
pnpm --filter @chaincopy/web dev
pnpm --filter @chaincopy/api dev
pnpm --filter @chaincopy/worker dev
```

## 認証

- 認証 provider は Google だけです。
- NextAuth.js が返したメールを正規化し、`ALLOWED_ADMIN_EMAIL` と完全一致する場合だけ sign-in を許可します。
- ダッシュボードと同一オリジン BFF の各リクエストでセッションメールを再検証します。
- 複数ユーザー登録画面はありません。
- Docker Compose の既定 Google 値は起動確認用 placeholder です。実ログインには実 credential が必要です。

## Health API

- `GET /health`: API process の liveness。依存サービス情報は返しません。
- `GET /ready`: PostgreSQL と Redis を確認し、どちらかが down なら HTTP 503 を返します。
- `GET /api/admin/health`: 詳細 health。`x-internal-api-secret` header が必要です。

internal secret の比較には SHA-256 digest と timing-safe comparison を使用します。

## Worker サンプルジョブ

Worker 起動時に `system-jobs` queue へ `sample.health-check` を登録します。

- 固定業務 ID: `phase1-sample-health-check-v1`
- retry: 最大3回、指数 backoff
- PostgreSQL と Redis を確認
- `sync_jobs.idempotency_key` と BullMQ `jobId` で重複副作用を防止
- 成功済みジョブの再配信は skip

## Address API

`/api/*` は `x-internal-api-secret` が必須です。ブラウザはこの secret を保持せず、認証済み Next.js BFF を経由します。

```text
GET    /api/addresses
POST   /api/addresses
GET    /api/addresses/:address
PATCH  /api/addresses/:address
POST   /api/addresses/:address/watch
DELETE /api/addresses/:address/watch
POST   /api/addresses/:address/sync
GET    /api/addresses/:address/sync-status
GET    /api/addresses/:address/fills
GET    /api/addresses/:address/funding
GET    /api/addresses/:address/ledger
GET    /api/addresses/:address/positions
GET    /api/addresses/:address/orders
GET    /api/addresses/:address/data-quality
GET    /api/admin/hyperliquid/health
```

一覧・履歴 API は `limit`（最大200）と opaque な `cursor` を受け付けます。アドレス一覧は `search`、`isWatched`、`syncStatus` でも絞り込めます。

## Discovery API

全エンドポイントはAddress APIと同じ内部認証境界で保護されます。

```text
GET   /api/discovery/candidates
GET   /api/discovery/candidates/:address
GET   /api/discovery/settings
PATCH /api/discovery/settings
POST  /api/discovery/start
POST  /api/discovery/stop
GET   /api/discovery/stats
POST  /api/discovery/candidates/:address/enrich
POST  /api/discovery/candidates/:address/exclude
POST  /api/discovery/candidates/:address/promote
```

## 実データ検証

公開アドレスだけを使い、0件からの初回同期、同一同期の再実行、WebSocket 初期 snapshot を検証できます。

```powershell
$env:RESET_PHASE2_VERIFICATION="true"
pnpm --filter @chaincopy/worker verify:phase2
```

既定の検証用公開アドレスは `0x831ea8a4a4d7ea2657ba48f8c074d69bdaece05c` です。秘密鍵、署名、注文 API は不要です。別アドレスは `HYPERLIQUID_VERIFICATION_ADDRESS` で指定できます。

## Redis の WSL 警告

Redis が `vm.overcommit_memory=0` を警告する場合、WSL 内で次を実行し、WSL または Redis を再起動します。

```bash
sudo sysctl -w vm.overcommit_memory=1
printf 'vm.overcommit_memory = 1\n' | sudo tee /etc/sysctl.d/99-redis-overcommit.conf
```

本番相当環境ではホスト OS 側でも永続化してください。ローカル Phase 2 検証では警告が残っても Redis の永続化・再起動試験結果を記録し、未対応理由を明示します。

## 品質確認

```powershell
pnpm install --frozen-lockfile
pnpm peers check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm audit
pnpm exec prisma validate
```

Playwright の初回だけ browser を導入します。

```powershell
pnpm exec playwright install chromium
```

CI は PostgreSQL/Redis service container を使い、Migration、lint、typecheck、Vitest、build、Playwright、依存監査を実行します。

実データ取得には公式 API へのネットワーク接続が必要ですが、通常の unit/integration test は外部本番 API に依存しません。Playwright は PostgreSQL/Redis を使用します。

## Prisma

```powershell
pnpm db:generate
pnpm db:migrate
pnpm db:migrate:deploy
pnpm db:seed
```

Phase 1 のMigrationは認証と運用基盤、Phase 2は監視アドレスの公開データ、Phase 3は市場探索・候補・Enrichment状態を保存します。全体の論理 ER は [docs/database.md](docs/database.md) にあります。

## リポジトリ構成

```text
apps/
  web/                      Next.js UI / Auth.js
  api/                      Fastify REST API
  worker/                   BullMQ Worker
packages/
  database/                 Prisma Client
  domain/                   共通ドメイン型
  analytics/                Decimal 境界
  blockchain-adapters/      読み取り専用 adapter
  demo-trading/             デモ専用境界
  notification/             通知境界
  config/                   Env / logger / TypeScript 設定
  ui/                       shadcn/ui 方式の共有部品
prisma/
  schema.prisma
  migrations/
docs/
tests/e2e/
```

## 設計資料

- [要件](docs/requirements.md)
- [アーキテクチャ](docs/architecture.md)
- [データベース](docs/database.md)
- [外部API](docs/external-apis.md)
- [計算](docs/calculations.md)
- [運用](docs/operations.md)
- [セキュリティ](docs/security.md)
- [意思決定](docs/decisions.md)
- [仮定](docs/assumptions.md)
- [Phase別計画](docs/implementation-plan.md)
- [Phase 4.3 参考ウォレット選定仕様](docs/phase4-3-wallet-selection-spec.md)
- [Phase 4.3 Test Matrix](docs/phase4-3-wallet-selection-test-matrix.md)
- [正本仕様](docs/SPEC.md)

現在はHyperliquid自動探索、`performance-v3`の個別成績計算、Phase 4.3の参考ウォレット選定までです。売買行動の集約、重み付きスコア、シグナル、通知、デモトレード、実取引、およびSui/Cetus連携には進んでいません。
