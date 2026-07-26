# Phase 0–3 要件定義

最終更新: 2026-07-26

## 1. 目的

ChainCopy Observer は、Hyperliquid および Sui/Cetus の公開取引データを将来分析するための、所有者1名専用の分析・通知Webアプリケーションである。

Phase 0 は仕様を実装可能な設計へ落とし込み、Phase 1 は外部チェーンデータ取得を始める前に、Web、API、常駐Worker、PostgreSQL、Redis、認証、テスト、CIをローカルで再現可能にする。

Phase 2 は公開 Hyperliquid アドレスを登録し、Info API と WebSocket から読み取り専用データを取得して、再実行可能な形で保存・表示する。実売買、署名、秘密鍵処理は対象外とする。

Phase 3 は公式Hyperliquid `trades` WebSocketからbuyer/sellerを自動発見し、短期観測統計で選別した候補だけを公式Info APIでEnrichmentする。手動ファイル取込、有料データ、スクレイピング、S3、自前ノードは使用しない。

## Phase 3 受入要件

- 公式`meta`からactive Perpetuals銘柄を取得し、主要銘柄または全銘柄を選べる。
- WsTradeのbuyer/seller、価格、数量、時刻、hash、tidを検証して保存する。
- 同一市場取引、候補参加、候補/時間範囲jobを一意キーで重複処理しない。
- 候補統計はDecimalで更新し、自己取引は候補件数・統計を1回だけ加算する。
- 軽量フィルター通過候補だけをEnrichment Queueへ登録する。
- 直近10,000 fills上限などで履歴が不足する場合は推測せず`INSUFFICIENT_HISTORY`とする。
- 通常監視同期を高優先度、候補Enrichmentを低優先度とし、weight・同時実行・頻度を制御する。
- Discovery WebSocketはheartbeat、再接続、再購読、上限付きretry、永続Cursorを持つ。
- 無料APIで補完できない市場全体の欠損はData Quality Issueとして残す。
- 認証済み所有者だけが探索画面、設定、Enrichment、除外、昇格を操作できる。
- 適格候補の昇格時だけ`wallet_addresses`へ接続し、Phase 2詳細同期Queueを再利用する。
- 実売買、Exchange endpoint、署名、秘密鍵、API Walletを含まない。

## Phase 2 受入要件

- 認証済み所有者だけがアドレス API と `/dashboard/addresses` を利用できる。
- EVM 形式のアドレスを正規化し、同じアドレスの重複登録を拒否する。
- watch ON のアドレスだけを scheduler と WebSocket supervisor の対象にする。
- 手動同期は一意な BullMQ 親 job を即時登録し、再試行時の child job は重複登録しない。
- Fill、Funding、Ledger、Position、Spot、Portfolio、Order、Raw Event、Sync Job/Cursor、Data Quality Issue を PostgreSQL に保存する。
- HTTP と WebSocket が同じイベントを返しても、transport 共通の業務キーで重複保存しない。
- cursor は成功時だけ前進し、切断区間の補完や順序逆転で過去へ戻さない。
- WS は heartbeat、指数 backoff、再購読、切断区間の HTTP 補完を行う。
- 一覧・履歴 API は件数上限と cursor pagination を持つ。
- Web は loading、error、empty、同期結果、最終成功・失敗を実データで表示する。
- PostgreSQL/Redis/Worker/WS の一時障害後に再実行できる。

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
4. Phase 3: Hyperliquidアドレス自動探索（今回の明示スコープ）
5. Phase 4: 未着手（収益計算・分類・ランキングへ進まない）
6. Phase 5: シグナル
7. Phase 6: デモトレード
8. Phase 7: メール通知
9. Phase 8: 自動アドレス探索
10. Phase 9: 本番運用強化

各Phaseは「設計 → 実装 → Unit Test → Integration Test → 静的解析 → セキュリティ確認 → ドキュメント更新 → 完了報告」の順で進める。
