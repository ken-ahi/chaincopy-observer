# Phase 0–1 要件定義

最終更新: 2026-07-25

## 1. 目的

ChainCopy Observer は、Hyperliquid および Sui/Cetus の公開取引データを将来分析するための、所有者1名専用の分析・通知Webアプリケーションである。

Phase 0 は仕様を実装可能な設計へ落とし込み、Phase 1 は外部チェーンデータ取得を始める前に、Web、API、常駐Worker、PostgreSQL、Redis、認証、テスト、CIをローカルで再現可能にする。

## 2. Phase 0 の成果物

- 要件、アーキテクチャ、データベース、外部API、計算、セキュリティの設計
- システム構成図、ER図、データ取得・シグナル生成・メール通知のシーケンス図
- 仮定、意思決定、技術的リスクの記録
- Phase別の実装順序と完了条件

## 3. Phase 1 の機能要件

### 3.1 モノレポ

- pnpm workspace と Turborepo を使用する。
- `apps/web`、`apps/api`、`apps/worker` を独立して起動・ビルドできる。
- 共通責務を `packages/*` に分離する。
- TypeScript strict を全ワークスペースで有効にする。

### 3.2 Web

- Next.js App Router、React、Tailwind CSS、shadcn/ui 方式のUI部品を使用する。
- Google OAuth を Auth.js で処理する。
- `ALLOWED_ADMIN_EMAIL` と完全一致する1件のメールアドレスだけを許可する。
- ダッシュボードはサーバー側でセッションと許可メールを検証する。
- ダッシュボードには次の追加予定領域をモック表示する。
  - 資産推移
  - 監視アドレス
  - DCAランキング
  - レバレッジランキング
  - 売買シグナル
  - デモトレード
  - システム状態

### 3.3 API

- Node.js上の独立REST APIとして常時起動できる。
- `/health` はAPIプロセスの生存確認を返す。
- `/ready` はPostgreSQLとRedisへの接続を検査する。
- `/api/admin/health` は内部APIシークレットを要求し、詳細な依存状態を返す。
- エラーを構造化JSONで記録し、秘密情報をログへ出さない。

### 3.4 Worker

- BullMQ Worker として常時起動できる。
- PostgreSQLとRedisへ接続する。
- 冪等なサンプルジョブを起動時に登録・処理する。
- ジョブの開始、成功、失敗を構造化ログへ出力し、DBへ実行状態を保存する。
- SIGINT/SIGTERMで新規処理を止め、接続を安全に閉じる。

### 3.5 データベース

- PostgreSQLを正本とし、Prisma ORMを使用する。
- Auth.jsに必要なユーザー、アカウント、セッション、検証トークンを定義する。
- Phase 1 の運用基盤としてデータソース、同期ジョブ、システムアラート、監査ログを定義する。
- Prisma Migrationをリポジトリで管理する。
- DB日時はUTCで保存する。

### 3.6 Redis

- BullMQのキュー、ジョブ状態、将来の短期ロック・キャッシュに使用する。
- Redisを永続的な業務データや同期カーソルの正本にしない。

### 3.7 開発・品質

- ESLint、Prettier、Vitest、Playwrightを用意する。
- Zodでプロセス別の環境変数を検証する。
- Docker ComposeでPostgreSQL、Redis、Migration、API、Worker、Webを起動できる。
- GitHub Actionsで静的解析、単体テスト、ビルド、E2E、依存脆弱性監査を実行する。
- `.env.example` とREADMEだけでセットアップできる。

## 4. 非機能要件

- 金融値はJavaScript `number` で計算せず、Prisma Decimalまたは `decimal.js` を使う。
- 外部イベントは欠損、重複、遅延、順序逆転を前提とする。
- 同一イベントの再処理で、シグナル、デモ注文、通知を重複させない。
- APIキー、OAuth Secret、内部APIシークレットをクライアントバンドルへ含めない。
- `any` を原則禁止し、エラーを握りつぶさない。
- 主要Web画面は通常3秒以内を目標とする。
- ログはJSON形式、日時はUTC、表示はAsia/Tokyoを基本とする。

## 5. Phase 1 の対象外

- Hyperliquid HTTP/WebSocketへの接続
- Sui GraphQL/gRPC、Cetus SDK/Eventへの接続
- 実売買、取引所Exchange API呼び出し
- ウォレット接続、署名、秘密鍵・シードフレーズ
- メール本送信、Resend Webhook
- 自動アドレス探索
- 金融指標・シグナル・デモ約定の本計算

## 6. 受入条件

- `pnpm install` が成功する。
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` が成功する。
- `docker compose up --build` で全サービスが起動する構成である。
- Prisma MigrationをPostgreSQLへ適用できる。
- Google OAuth設定時、許可メールだけがダッシュボードを表示できる。
- APIの生存・DB・Redisヘルスチェックが期待した状態を返す。
- Workerのサンプルジョブが1回以上成功し、再登録しても同一IDで重複しない。
- READMEにローカル起動、OAuth設定、Migration、テスト手順が記載されている。

## 7. 技術的リスク

| リスク                    | 影響               | Phase 0–1 の対策                                         |
| ------------------------- | ------------------ | -------------------------------------------------------- |
| OAuthのredirect URI誤設定 | ログイン不能       | URI例と設定手順をREADMEへ記載                            |
| 許可メール判定の漏れ      | 第三者アクセス     | sign-in callbackと保護ページの二段階でサーバー検証       |
| DB/Redis起動順            | API/Worker起動失敗 | Compose healthcheckと依存条件を設定                      |
| Redis再起動               | ジョブ遅延・再配信 | 業務正本をDBへ置き、ジョブを冪等化                       |
| Migrationの競合実行       | DDL競合            | Composeの専用migrationサービスだけがdeployを実行         |
| シークレット漏えい        | 不正アクセス       | Zod、ログredaction、`.gitignore`、サーバー専用モジュール |
| 金融精度の劣化            | 誤った評価         | Decimal境界を設計し、Phase 4でベクトルテストを必須化     |
| 外部APIの履歴上限         | 長期分析不能       | Phase 2–3で継続保存とカーソルを実装                      |
| Docker未導入環境          | Compose検証不能    | READMEで前提を明記し、CIでサービスコンテナを検証         |

## 8. MVP実装順序

1. Phase 0: 設計
2. Phase 1: 開発基盤
3. Phase 2: Hyperliquid取得
4. Phase 3: Sui/Cetus取得
5. Phase 4: 分析エンジン
6. Phase 5: シグナル
7. Phase 6: デモトレード
8. Phase 7: メール通知
9. Phase 8: 自動アドレス探索
10. Phase 9: 本番運用強化

各Phaseは「設計 → 実装 → Unit Test → Integration Test → 静的解析 → セキュリティ確認 → ドキュメント更新 → 完了報告」の順で進める。
