# ChainCopy Observer

Hyperliquid と Sui/Cetus の公開取引データを分析・監視する、所有者1名専用の Web アプリケーションです。現在は Phase 2 まで実装済みで、Hyperliquid の公開アドレスを登録し、HTTP 履歴同期、WebSocket 購読、PostgreSQL 保存、Web 表示を行えます。

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

Phase 1 の Migration は認証と運用基盤、Phase 2 の Migration は Hyperliquid 公開データの保存に限定しています。全体の論理 ER は [docs/database.md](docs/database.md) にあります。

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
- [正本仕様](docs/SPEC.md)

次の作業は Phase 3 の Sui/Cetus 連携です。Phase 2 の範囲には含めません。
