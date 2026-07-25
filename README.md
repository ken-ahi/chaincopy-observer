# ChainCopy Observer

HyperliquidおよびSui/Cetusの公開取引データを将来分析・監視するための、単一ユーザー専用Webアプリケーションです。

現在は **Phase 0（設計）とPhase 1（開発基盤）** までを実装しています。外部チェーンデータ取得、実売買、ウォレット接続、メール本送信、自動アドレス探索は含みません。

## 実装済み

- pnpm workspace + Turborepo
- Next.js App Router + Tailwind CSS + shadcn/ui方式の共有UI
- Fastify REST API
- BullMQ常駐Workerと冪等なサンプルジョブ
- PostgreSQL + Prisma Migration
- Redis + BullMQ
- NextAuth.js v4 + Google OAuth
- 許可メールアドレス1件だけのサーバー側認可
- 認証必須ダッシュボード
- API/DB/Redis/Workerのhealth check
- Zod環境変数検証、Pino構造化ログ
- ESLint Flat Config、Prettier、Vitest、Playwright
- Docker Compose、GitHub Actions

## 禁止事項

本リポジトリでは次を実装しません。

- 実際の売買注文
- ウォレット接続・署名
- 秘密鍵・シードフレーズの取得または保存
- AIによる金融計算・自由な売買判断

金融値を実装するPhaseではJavaScript `number` を使わず、Decimalを使用します。

## 必要環境

- Node.js `24.x`（検証版: `24.12.0`）
- pnpm `11.9.0`
- Docker DesktopまたはDocker Engine + Compose v2
- Google OAuth 2.0 Client（実際にログインする場合）

```powershell
node --version
pnpm --version
docker --version
docker compose version
```

## 最短セットアップ（Docker Compose）

1. 環境変数ファイルを作成します。

```powershell
Copy-Item .env.example .env
```

2. `.env` の最低限の値を変更します。

```dotenv
AUTH_SECRET=<32文字以上のランダム値>
GOOGLE_CLIENT_ID=<Google OAuth Client ID>
GOOGLE_CLIENT_SECRET=<Google OAuth Client Secret>
ALLOWED_ADMIN_EMAIL=<ログインを許可する自分のメール>
INTERNAL_API_SECRET=<32文字以上の別のランダム値>
```

3. Google Cloud ConsoleのOAuth Clientにredirect URIを登録します。

```text
http://localhost:3000/api/auth/callback/google
```

4. 全サービスを起動します。

```powershell
docker compose up --build
```

初回はPostgreSQL/Redisのhealth check後にMigrationを適用し、API、Worker、Webの順で起動します。

- Web: <http://localhost:3000>
- API liveness: <http://localhost:3001/health>
- API readiness: <http://localhost:3001/ready>
- Worker health: <http://localhost:3002/health>

停止:

```powershell
docker compose down
```

DB/Redisのvolumeも削除して初期化する場合だけ、対象を確認してから次を実行します。

```powershell
docker compose down --volumes
```

## ホスト上での開発

1. `.env` を作成し、PostgreSQLとRedisを起動します。
2. 依存とPrisma Clientを用意します。

```powershell
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

3. Web/API/Workerをまとめて起動します。

```powershell
pnpm dev
```

個別起動:

```powershell
pnpm --filter @chaincopy/web dev
pnpm --filter @chaincopy/api dev
pnpm --filter @chaincopy/worker dev
```

## 認証

- 認証providerはGoogleだけです。
- NextAuth.jsが返したメールを正規化し、`ALLOWED_ADMIN_EMAIL` と完全一致する場合だけsign-inを許可します。
- ダッシュボード表示時にもセッションメールを再検証します。
- 複数ユーザー登録画面はありません。
- Docker Composeの既定Google値は起動確認用placeholderです。実ログインには実credentialが必要です。

## API

### `GET /health`

APIプロセスのliveness。依存サービス情報は返しません。

### `GET /ready`

PostgreSQLとRedisを確認します。どちらかがdownならHTTP 503です。

### `GET /api/admin/health`

詳細health。次のheaderが必要です。

```text
x-internal-api-secret: <INTERNAL_API_SECRET>
```

比較にはSHA-256 digestとtiming-safe comparisonを使用します。

## Workerサンプルジョブ

Worker起動時に `system-jobs` queueへ `sample.health-check` を登録します。

- 固定業務ID: `phase1-sample-health-check-v1`
- retry: 最大3回、指数backoff
- PostgreSQLとRedisを確認
- `sync_jobs.idempotency_key` とBullMQ `jobId`で重複副作用を防止
- 成功済みジョブの再配信はskip

## 品質確認

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm format:check
```

Playwrightの初回だけbrowserを導入します。

```powershell
pnpm exec playwright install chromium
```

CIはPostgreSQL/Redis service containerを使い、Migration、lint、typecheck、Vitest、build、Playwright、依存監査を実行します。

## Prisma

```powershell
pnpm db:generate
pnpm db:migrate
pnpm db:migrate:deploy
pnpm db:seed
```

Phase 1のMigrationは認証と運用基盤に限定しています。取引・シグナル・デモ・通知の物理テーブルは、公式API payloadと一意キーを確定する各Phaseで追加します。全体の論理ERは [docs/database.md](docs/database.md) にあります。

## リポジトリ構成

```text
apps/
  web/                      Next.js UI / Auth.js
  api/                      Fastify REST API
  worker/                   BullMQ Worker
packages/
  database/                 Prisma Client
  domain/                   共通ドメイン型
  analytics/                Decimal境界（本計算はPhase 4）
  blockchain-adapters/      読み取り専用adapter境界
  demo-trading/             デモ専用境界
  notification/             通知境界
  config/                   Env / logger / TypeScript設定
  ui/                       shadcn/ui方式の共有部品
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
- [セキュリティ](docs/security.md)
- [意思決定](docs/decisions.md)
- [仮定](docs/assumptions.md)
- [Phase別計画](docs/implementation-plan.md)
- [運用](docs/operations.md)

## 次のPhase

Phase 2ではHyperliquidの読み取り専用Info APIとWebSocketを実装します。Exchange endpoint、署名、注文送信は対象外です。
