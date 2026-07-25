# オンチェーン戦略分析・通知型コピートレードサイト

## AI開発指示書・要件定義・基本設計書

---

# 1. AI開発エージェントへの指示

あなたは、暗号資産・オンチェーン分析・金融リスク管理・Webアプリケーション開発に精通したリードエンジニアとして、本仕様に従ってシステムを設計・実装してください。

開発にはCodex 5.6、または利用可能な最新のGPT-5.6系コーディングモデルを使用してください。OpenAI公式では、Codexはコードの作成・レビュー・デバッグを行うソフトウェア開発エージェントであり、APIベースのコード生成ではGPT-5.6が標準候補とされています。

## 1.1 開発時の原則

1. 最初に要件定義と基本設計をMarkdownで整理する。
2. 次にデータベース、データ取得、分析エンジン、通知、画面の順で実装する。
3. 一度に全機能を実装せず、各フェーズでテスト可能な状態を作る。
4. 仕様に軽微な不足がある場合は、合理的なデフォルト値を採用し、`docs/assumptions.md`に記録する。
5. 外部APIの仕様は必ず公式ドキュメントを確認し、参照日時を`docs/external-apis.md`に記録する。
6. 秘密鍵、シードフレーズ、取引用APIキーを要求・保存しない。
7. 本システムから実際の購入・売却注文を出してはならない。
8. AIの判断だけで売買シグナルを生成してはならない。
9. 収益率・リスク・売買シグナルは決定論的な計算ロジックで生成する。
10. LLMは分析結果の文章要約と説明にのみ使用する。
11. LLMが停止しても、データ取得、ランキング、デモトレード、メール通知は稼働する構成にする。
12. 金融計算には浮動小数点数ではなく、Decimal型または高精度数値型を使用する。
13. 外部APIの重複、遅延、欠損、再接続を前提に、冪等性を確保する。
14. すべての重要な判定について、使用したデータと計算根拠を追跡できるようにする。
15. 実装完了条件を満たすまで、テストを省略しない。

---

# 2. プロダクト概要

## 2.1 仮称

**ChainCopy Observer**

## 2.2 目的

Hyperliquidおよび現物DEX上の公開オンチェーンデータを分析し、長期間にわたり良好な成績を残しているアドレスを抽出・分類・評価する。

選定したアドレスの売買行動を監視し、以下を実施する。

* 購入・売却タイミングの検知
* メール通知
* Web画面への通知表示
* 仮想資金によるデモトレード
* コピーした場合の仮想収益の検証
* アドレスランキング
* 戦略別のパフォーマンス分析

本システムは**自分専用の分析・通知サービス**とし、一般ユーザー向けサービスにはしない。

---

# 3. 確定要件

| 項目       | 内容                       |
| -------- | ------------------------ |
| 主な利用者    | システム所有者1名のみ              |
| デリバティブ市場 | Hyperliquid中心            |
| 現物市場     | Sui/Cetusを初期対象           |
| 将来追加     | Solana/Jupiter、EVM系DEXなど |
| 売買実行     | 実施しない                    |
| ウォレット接続  | 原則不要                     |
| 秘密鍵保管    | 禁止                       |
| 主な出力     | Web通知、メール通知、デモトレード       |
| DCA候補数   | 最大100アドレス                |
| レバレッジ候補数 | 最大100アドレス                |
| 基準収益率    | 5年累積80%以上を基本基準           |
| 表示言語     | 日本語                      |
| 基準タイムゾーン | Asia/Tokyo               |
| 基準通貨     | USD                      |
| 補助表示     | JPY表示を将来追加可能             |
| 初期デモ資金   | 10,000 USDC              |
| 通知先      | 環境変数に設定した1メールアドレス        |

条件を満たすアドレスが100件未満の場合、評価基準を下げて100件に水増ししてはならない。

---

# 4. 技術上の重要な制約

Hyperliquidの公式Info APIでは、アドレスごとの約定、ポートフォリオ、ポジション、証拠金状態などを取得できる。ただし、通常のユーザー約定取得には取得件数制限があり、時間指定取得でも直近1万件までという制約があるため、長期間の分析には継続保存または別の履歴データソースが必要となる。

Hyperliquidのリアルタイム監視にはWebSocketを利用できるが、サーバー切断を前提として再接続し、再接続中の欠損をHTTP APIで補完する必要がある。

Suiでは、GraphQL RPCをダッシュボードや履歴検索に利用できる。リアルタイム性が必要なバックエンドではgRPCまたは独自インデクサーを使用する。履歴保持期間はRPC提供者によって異なるため、必要に応じて独自保存を行う。

Suiのイベントには送信者、イベント型、トランザクション、タイムスタンプなどが含まれ、ページネーションを使って継続取得できる。Cetusには公式のTypeScript SDKがあり、CLMM、DCA、指値注文などのモジュールが提供されている。

---

# 5. 対象範囲

## 5.1 MVP対象

### Hyperliquid

* Perpetualsの約定履歴
* ロング・ショート
* ポジション増減
* ポジション決済
* 証拠金
* 実効レバレッジ
* Funding Fee
* 実現損益
* 含み損益
* 清算履歴
* 入出金
* 口座資産
* 取引銘柄
* 約定価格
* 売買数量

### Cetus／Sui

* スワップ履歴
* 購入トークン
* 売却トークン
* スワップ数量
* USD換算額
* プール
* 手数料
* トランザクション時刻
* ウォレットの入出金
* トークン残高推移
* DCA関連イベント
* 指値注文関連イベント

## 5.2 MVP対象外

* 実際の売買注文
* ウォレット署名
* 秘密鍵保管
* シードフレーズ保管
* 自動資金移動
* CEX内部取引の推測
* 所有者不明の複数ウォレットの統合
* 税務計算
* 一般ユーザー向け会員登録
* 有料課金
* SNS機能
* 他人への投資助言配信

---

# 6. システム構成

```text
Hyperliquid HTTP API ─┐
Hyperliquid WebSocket ├─> Data Collector
Sui GraphQL/gRPC ─────┤
Cetus SDK/Event ──────┘
                         ↓
                  Raw Event Storage
                         ↓
              Normalization / Enrichment
                         ↓
                Portfolio Reconstruction
                         ↓
          Strategy Classification / Scoring
                         ↓
                 Signal Detection Engine
                    ↓              ↓
             Demo Trading      Notification
                    ↓              ↓
                PostgreSQL     Email / Web UI
                         ↓
                    Dashboard
```

---

# 7. 推奨技術スタック

## 7.1 フロントエンド

* Next.js App Router
* TypeScript
* React
* Tailwind CSS
* shadcn/ui
* Rechartsまたは同等のチャートライブラリ
* TanStack Table
* Zod
* React Hook Form

Next.jsはApp Routerを使用し、Server Components、Route Handlers、Suspenseなどを活用する。

## 7.2 バックエンド

* Node.js
* TypeScript
* NestJSまたは独立したWorkerアプリ
* REST API
* OpenAPI
* Zodまたはclass-validator
* BullMQ
* Redis

長時間稼働するWebSocket監視とオンチェーン履歴収集は、Next.jsのサーバーレス関数に依存させず、常時起動するWorkerで処理する。

## 7.3 データベース

* PostgreSQL
* Prisma ORM
* Decimal型
* TimescaleDBは任意
* Redisはロック、キュー、短期キャッシュに利用

## 7.4 通知

* Resend
* HTMLメール
* プレーンテキストメール
* Web通知
* 通知送信履歴
* 配信結果Webhook

ResendのWebhookを使用して、送信済み、配信済み、バウンスなどの結果をDBに記録する。Webhookの署名を必ず検証する。

## 7.5 インフラ

### 推奨構成

* Web：Vercel
* Worker：Railway、Fly.io、RenderまたはAWS ECS
* PostgreSQL：Neon、SupabaseまたはAWS RDS
* Redis：UpstashまたはRedis Cloud
* メール：Resend
* エラー監視：Sentry
* ログ：構造化JSONログ

Vercel CronはUTC基準であり、重複実行または実行漏れが発生し得るベストエフォート型である。そのため、リアルタイム監視には使わず、日次集計などに限定する。Cron処理はロックと冪等性を必須とする。

---

# 8. 認証・アクセス制御

自分専用サイトのため、複雑なユーザー管理は実装しない。

## 8.1 認証方式

* Auth.js
* Google OAuth
* 許可メールアドレスを環境変数で1件設定
* 許可されていないメールアドレスはログイン後に拒否
* すべての管理画面を認証必須にする
* APIもセッション認証または内部APIトークンを必須にする

```text
ALLOWED_ADMIN_EMAIL=user@example.com
```

## 8.2 セキュリティ要件

* APIキーは環境変数またはSecret Managerに保存
* ログにAPIキーを出力しない
* ウォレット秘密鍵を入力する画面を作らない
* 外部URLの入力にはSSRF対策を行う
* Webhook署名を検証する
* CronエンドポイントはSecretで保護する
* レート制限を実装する
* CSRF、XSS、SQL Injection対策を行う
* CSPを設定する
* 依存パッケージの脆弱性チェックをCIで実行する

---

# 9. アドレス候補の収集

## 9.1 候補取得方法

以下の複数ルートを実装する。

1. CSVによる手動インポート
2. 画面からのアドレス登録
3. Hyperliquidの公開データから候補抽出
4. Hyperliquid履歴インデクサーから候補抽出
5. Sui/CetusのSwapイベントから候補抽出
6. 既知の高出来高アドレスから関連候補抽出

## 9.2 候補の事前フィルター

以下を満たさないアドレスは、詳細分析の前に除外する。

* 最低取引回数：30回
* 最低活動期間：180日
* 最低活動月数：6か月
* 最終活動日：90日以内
* 最低取引額：累計10,000 USD
* コントラクトアドレスではない
* 取引所・ブリッジ・ルーターの既知アドレスではない
* 同一ブロック内だけで売買を繰り返すBotは別分類にする
* 不自然な自己送金だけのアドレスを除外する

各除外理由はDBに保存して画面表示する。

---

# 10. データ期間の扱い

基本分析期間は5年間とする。

ただし、対象プロトコルまたはアドレスに5年間のデータがない場合は、取得可能な全期間を使用する。

## 10.1 2種類の評価モード

### 厳格モード

* データ期間60か月以上
* 累積収益率80%以上
* データ完全性80点以上

### 実用モード

* データ期間24か月以上
* 年率換算収益率12.47%以上
* データ完全性70点以上

5年間で累積80%は、年率換算でおよそ12.47%に相当する。

厳格モードと実用モードの結果は、ランキング上で混在させず、バッジで区別する。

```text
STRICT_5Y
PRACTICAL_ANNUALIZED
INSUFFICIENT_HISTORY
```

---

# 11. ポートフォリオ再構築

単純な現在残高と過去残高の比較は禁止する。

以下を時系列で再構築する。

* 外部入金
* 外部出金
* ブリッジ
* スワップ
* 現物購入
* 現物売却
* ポジション開始
* ポジション追加
* 部分決済
* 全決済
* 手数料
* Funding Fee
* 清算
* 含み益・含み損
* トークン価格変化
* エアドロップ
* 報酬
* LP入出金

判別できない資金移動は`UNKNOWN_CASH_FLOW`として管理し、データ品質スコアを減点する。

---

# 12. 収益率計算

## 12.1 Time-Weighted Return

外部入出金の影響を抑えるため、Time-Weighted Returnを主要指標とする。

```text
TWR = Π(1 + periodReturn) - 1
```

## 12.2 補助指標

* 累積収益率
* 年率換算収益率
* 月次収益率
* 実現損益
* 含み損益
* 最大ドローダウン
* ボラティリティ
* Sharpe Ratio
* Sortino Ratio
* Calmar Ratio
* Profit Factor
* 勝率
* 平均利益
* 平均損失
* 最大連敗
* 月間プラス率
* 下落相場での収益率
* ベンチマーク超過収益

## 12.3 ベンチマーク

現物DCAは以下と比較する。

* BTC Buy and Hold
* ETH Buy and Hold
* SUI Buy and Hold
* 同額・同期間の単純DCA
* USDC保有

Hyperliquidは以下と比較する。

* BTC Buy and Hold
* HYPE Buy and Hold
* レバレッジなしの同方向ポジション
* 取引を行わないUSDC保有

---

# 13. DCAアドレス判定

## 13.1 DCA候補条件

* 同じ資産を継続的に購入している
* 購入期間が6か月以上
* 購入回数が12回以上
* 購入間隔が一定範囲内
* 一括購入への偏りが小さい
* 売却回数が購入回数より少ない
* 下落時にも購入を継続している
* 長期保有割合が高い

## 13.2 DCA特徴量

```text
purchaseIntervalMean
purchaseIntervalStdDev
purchaseIntervalCV
purchaseAmountMean
purchaseAmountStdDev
purchaseAmountCV
buyTransactionRatio
sellTransactionRatio
activeMonthRatio
drawdownBuyRatio
holdingDurationMedian
sameAssetPurchaseRatio
```

## 13.3 DCA分類スコア

| 項目       | 配点 |
| -------- | -: |
| 購入間隔の規則性 | 20 |
| 購入金額の規則性 | 15 |
| 継続期間     | 15 |
| 下落時の継続購入 | 15 |
| 長期保有率    | 15 |
| 売却頻度の低さ  | 10 |
| 対象資産の一貫性 | 10 |

70点以上をDCA候補とする。

機械学習による分類はMVPでは使用せず、ルールベース判定を採用する。

---

# 14. レバレッジアドレス判定

## 14.1 実効レバレッジ

```text
effectiveLeverage = grossPositionNotional / accountEquity
```

## 14.2 候補条件

* 実効レバレッジ中央値が2倍以上5倍以下
* 活動期間6か月以上
* 決済済み取引30件以上
* Funding控除後でプラス
* 最大ドローダウン60%未満
* データ品質70点以上
* 清算回数が許容範囲内

## 14.3 除外条件

* レバレッジ95パーセンタイルが10倍超
* 頻繁な清算
* 1回の取引だけで利益の大半を得ている
* 特定の低流動性銘柄だけで利益を得ている
* 入金直後に大きな利益が発生しており原資が判別不能
* 取引回数が少なすぎる
* 含み損を長期間決済していない
* ナンピンによって見かけ上の勝率が高い
* コピー時に市場インパクトが大きい

---

# 15. 総合評価

## 15.1 基本スコア

```text
totalScore =
  performanceScore * 0.30 +
  riskScore * 0.25 +
  consistencyScore * 0.20 +
  reproducibilityScore * 0.15 +
  dataQualityScore * 0.10
```

## 15.2 パフォーマンス

* TWR
* 年率換算収益率
* ベンチマーク超過収益
* Funding控除後損益
* 手数料控除後損益

## 15.3 リスク

* 最大ドローダウン
* Sortino Ratio
* Calmar Ratio
* 最大連敗
* 清算
* レバレッジ上限超過
* 1銘柄集中度

## 15.4 一貫性

* 月間プラス率
* 四半期別成績
* 上昇相場・下落相場別成績
* 利益の特定取引依存度
* 直近成績と長期成績の乖離

## 15.5 再現可能性

* 対象銘柄の流動性
* 平均ポジション保有時間
* コピー検知遅延
* 約定価格乖離
* 取引頻度
* ガス代
* スリッページ
* ポジションサイズ

## 15.6 データ品質

* データ取得期間
* 欠損率
* 不明な入出金
* 価格データ欠損
* 約定復元率
* ポジション復元率
* API由来か推定値か

---

# 16. ランキング

以下のランキングを作成する。

1. DCA総合ランキング
2. レバレッジ総合ランキング
3. リスク調整後収益ランキング
4. 最大ドローダウンが低いランキング
5. 直近30日ランキング
6. 直近90日ランキング
7. 長期安定ランキング
8. コピー再現性ランキング
9. データ品質ランキング
10. ウォッチリストランキング

表示件数は最大100件とする。

各行に以下を表示する。

* 順位
* アドレス
* 任意の別名
* 戦略分類
* 総合スコア
* 累積収益率
* 年率換算収益率
* 最大ドローダウン
* Sortino Ratio
* 活動期間
* 取引回数
* 中央レバレッジ
* 直近取引
* データ品質
* ウォッチ状態

---

# 17. 売買シグナル

## 17.1 シグナル種別

```text
SPOT_BUY
SPOT_SELL
PERP_LONG_OPEN
PERP_SHORT_OPEN
PERP_POSITION_INCREASE
PERP_POSITION_REDUCE
PERP_POSITION_CLOSE
LEVERAGE_INCREASE
LEVERAGE_DECREASE
LIQUIDATION
DCA_PURCHASE
CONSENSUS_BUY
CONSENSUS_SELL
RISK_WARNING
```

## 17.2 シグナル生成条件

シグナルは以下の条件をすべて満たした場合のみ生成する。

* 対象アドレスが有効なウォッチ対象
* データ品質が基準以上
* 同一イベントが未処理
* 最低取引金額以上
* 対象銘柄が許可リスト内
* 異常価格ではない
* 取引時刻が取得できる
* 売買方向が判定できる
* リスクフィルターを通過している

## 17.3 信頼度

```text
confidence =
  addressScore * 0.35 +
  dataQualityScore * 0.25 +
  signalFreshnessScore * 0.20 +
  liquidityScore * 0.10 +
  consensusScore * 0.10
```

信頼度70点未満はメール通知せず、Web画面だけに表示する。

## 17.4 コンセンサスシグナル

一定期間内に複数の上位アドレスが同じ銘柄を同じ方向に取引した場合、コンセンサスシグナルを生成する。

デフォルト条件：

* 対象期間：30分
* 必要アドレス数：3
* 平均総合スコア：75点以上
* 相互相関が高すぎるアドレス群は1件として扱う
* 同一所有者と推定されるアドレス群も1件として扱う

---

# 18. デモトレード

## 18.1 基本仕様

* 初期資金：10,000 USDC
* 実際の資金は使用しない
* 売買シグナルから仮想注文を生成
* 現物とPerpetualsを別ポートフォリオとして管理
* 初期化、停止、再開が可能
* 任意の日付からバックテスト可能
* すべての仮想約定根拠を保存

## 18.2 デモモード

### Mirror Mode

コピー元アドレスのポジション比率に近い形で仮想売買する。

### Risk Adjusted Mode

コピー元の方向とタイミングを参考にするが、自分のリスク設定に合わせてサイズを調整する。

デフォルトはRisk Adjusted Modeとする。

## 18.3 デフォルトリスク設定

| 項目          |     初期値 |
| ----------- | ------: |
| 1アドレス最大配分   |     10% |
| 1銘柄最大配分     |     20% |
| 1回最大投入額     |      5% |
| 現物最低取引額     | 50 USDC |
| Perp最大レバレッジ |      3倍 |
| 1日最大損失      |      3% |
| 最大ドローダウン    |     15% |
| 同時保有銘柄      |      10 |
| シグナル価格乖離上限  |      1% |
| シグナル有効期限    |     15分 |

設定値は画面から変更可能にする。ただし最大レバレッジは5倍を上限とする。

## 18.4 仮想約定価格

```text
demoExecutionPrice =
  detectedMarketPrice
  + simulatedSpread
  + simulatedSlippage
  + copyDelayAdjustment
```

## 18.5 コスト

現物：

* DEX手数料
* ガス代
* スリッページ
* Price Impact

Perpetuals：

* Taker/Maker Fee
* Funding Fee
* スリッページ
* 清算損失
* コピー遅延

## 18.6 比較ポートフォリオ

同時に以下を計算する。

* コピー戦略
* BTC Buy and Hold
* ETH Buy and Hold
* SUI Buy and Hold
* 単純DCA
* 現金保有

---

# 19. メール通知

## 19.1 通知タイミング

### 即時通知

* 新規ロング
* 新規ショート
* ポジション全決済
* 大口現物購入
* 大口現物売却
* コンセンサスシグナル
* 清算
* リスク警告

### まとめ通知

* 5分以内の同一アドレスの連続売買
* 同一銘柄の複数部分約定
* 小額取引
* ポジション調整

### 定期通知

* 毎朝8時：前日サマリー
* 毎週月曜8時：週間成績
* 毎月1日8時：月次成績

時刻はAsia/Tokyoで表示する。

## 19.2 通知抑制

* 同じ取引の重複通知を禁止
* イベントIDで冪等性を保証
* 同一アドレス・同一銘柄・同一方向は5分間集約
* 1時間の通知上限を設定
* 通知過多時はダイジェストへ切り替える
* 重要度LOWはメール送信しない設定を可能にする

## 19.3 メール内容

件名例：

```text
【BUY通知】SUI / 上位DCAアドレス3件が購入
【LONG通知】BTC / 総合スコア87のアドレスが新規ロング
【決済通知】ETH SHORT / コピー元が全決済
【リスク警告】監視アドレスで清算を検知
```

本文に以下を含める。

* 検知日時
* シグナル種別
* 銘柄
* 売買方向
* コピー元アドレス
* アドレス総合スコア
* 検知価格
* 推定取引額
* 推定レバレッジ
* コピー元口座に対する比率
* 信頼度
* データ品質
* 簡潔な検知理由
* 想定リスク
* デモトレード結果
* サイト詳細画面へのリンク
* 投資判断を保証しない旨

---

# 20. Web画面

## 20.1 ダッシュボード

表示内容：

* デモ資産残高
* 累積損益
* 当日損益
* 最大ドローダウン
* 現在ポジション
* 直近シグナル
* 上位監視アドレス
* DCAランキング
* レバレッジランキング
* コンセンサス状況
* データ取得状態
* 外部APIエラー状態

## 20.2 アドレス一覧

フィルター：

* DCA
* レバレッジ
* Hyperliquid
* Cetus
* 総合スコア
* 累積収益率
* 最大ドローダウン
* 活動期間
* データ品質
* ウォッチ有無
* 保有銘柄
* ロング／ショート

## 20.3 アドレス詳細

* 基本情報
* 戦略分類
* 総合評価
* スコア内訳
* 資産推移
* 月次収益
* ドローダウン
* 銘柄別損益
* ロング／ショート比率
* レバレッジ推移
* 売買履歴
* 入出金履歴
* データ欠損
* デモコピー結果
* ベンチマーク比較
* ウォッチON／OFF
* メール通知ON／OFF

## 20.4 シグナル画面

* シグナル時刻
* 銘柄
* 売買方向
* 価格
* 推定金額
* コピー元
* 信頼度
* 状態
* 通知送信結果
* デモ注文結果
* 根拠
* 関連トランザクション

## 20.5 デモトレード画面

* 仮想残高
* 仮想ポジション
* 注文履歴
* 約定履歴
* Funding履歴
* 手数料
* 資産曲線
* ベンチマーク比較
* 戦略別損益
* コピー元別損益
* リセット
* 一時停止
* CSV出力

## 20.6 設定画面

* 通知先メール
* 通知レベル
* 監視間隔
* シグナル最低金額
* シグナル最低信頼度
* 最大レバレッジ
* 最大配分
* 最大ドローダウン
* 許可銘柄
* 除外銘柄
* デモ初期資金
* ダイジェスト時刻
* API接続状態

---

# 21. データベース設計

最低限、以下のテーブルを作成する。

```text
users
data_sources
wallet_addresses
wallet_labels
address_candidates
address_classifications
address_metrics
address_scores
address_rankings
raw_events
normalized_trades
cash_flows
token_balances
portfolio_snapshots
perp_positions
perp_position_events
funding_payments
liquidations
market_prices
token_metadata
strategy_signals
signal_sources
watchlists
demo_portfolios
demo_orders
demo_fills
demo_positions
demo_cash_ledger
demo_funding_ledger
notification_rules
notification_events
email_deliveries
sync_jobs
sync_cursors
data_quality_issues
system_alerts
audit_logs
```

## 21.1 重要な一意制約

```text
raw_events(source, external_event_id)
normalized_trades(source, external_trade_id)
strategy_signals(signal_fingerprint)
notification_events(signal_id, channel, recipient)
email_deliveries(provider_message_id)
sync_cursors(source, cursor_type, scope)
```

重複イベントを受信しても、売買シグナル、デモ注文、メールが重複しない設計にする。

---

# 22. API設計

## 22.1 アドレス

```text
GET    /api/addresses
POST   /api/addresses
GET    /api/addresses/:address
PATCH  /api/addresses/:address
POST   /api/addresses/import
POST   /api/addresses/:address/analyze
POST   /api/addresses/:address/watch
DELETE /api/addresses/:address/watch
```

## 22.2 ランキング

```text
GET /api/rankings/dca
GET /api/rankings/leverage
GET /api/rankings/risk-adjusted
GET /api/rankings/reproducibility
```

## 22.3 シグナル

```text
GET   /api/signals
GET   /api/signals/:id
POST  /api/signals/:id/reprocess
POST  /api/signals/:id/send-test-email
```

## 22.4 デモトレード

```text
GET   /api/demo/portfolio
GET   /api/demo/positions
GET   /api/demo/orders
GET   /api/demo/performance
POST  /api/demo/reset
POST  /api/demo/pause
POST  /api/demo/resume
PATCH /api/demo/settings
```

## 22.5 管理

```text
GET  /api/admin/data-sources
GET  /api/admin/jobs
POST /api/admin/jobs/:job/run
GET  /api/admin/health
GET  /api/admin/data-quality
```

---

# 23. バックグラウンドジョブ

```text
hyperliquid-websocket-listener
hyperliquid-fill-backfill
hyperliquid-position-snapshot
hyperliquid-funding-sync
sui-event-sync
cetus-swap-normalizer
wallet-candidate-discovery
wallet-history-enrichment
portfolio-reconstruction
daily-address-metrics
address-classification
address-ranking
signal-detection
demo-order-execution
email-notification
email-delivery-reconciliation
daily-digest
weekly-report
monthly-report
data-quality-audit
price-reconciliation
```

## 23.1 実行頻度

| ジョブ                   | 頻度        |
| --------------------- | --------- |
| Hyperliquid WebSocket | 常時        |
| Hyperliquid欠損補完       | 1分        |
| Sui/Cetusイベント取得       | 30秒～1分    |
| 価格同期                  | 1分        |
| シグナル判定                | イベント駆動    |
| デモ約定                  | シグナル生成直後  |
| アドレス指標再計算             | 1日1回      |
| ランキング再計算              | 1日1回      |
| データ品質監査               | 1日1回      |
| 日次メール                 | 毎日8時JST   |
| 週間メール                 | 月曜8時JST   |
| 月次メール                 | 毎月1日8時JST |

---

# 24. AI機能

AIは以下に限定して使用する。

* アドレスの特徴の文章要約
* シグナル理由の自然言語化
* 期間別成績の説明
* リスク要因の説明
* 複数アドレスの共通点の説明
* 日次・週次・月次レポートの文章生成

AIに渡す入力は、計算済みの構造化データのみとする。

AIからの出力はJSON Schemaで制限する。

```json
{
  "summary": "string",
  "positiveFactors": ["string"],
  "riskFactors": ["string"],
  "dataLimitations": ["string"],
  "confidenceComment": "string"
}
```

AIに以下を許可しない。

* 自由な売買判定
* 数値の再計算
* 存在しない取引の補完
* 欠損データの推測
* 収益保証
* 実際の注文送信
* メール送信の最終判断

---

# 25. データ品質管理

各アドレスに0～100点のデータ品質スコアを付ける。

## 減点例

| 問題              |      減点 |
| --------------- | ------: |
| 価格データ欠損         |  -5～-20 |
| 不明な入出金          |  -5～-25 |
| 約定履歴の途中欠損       | -10～-30 |
| ポジション復元不能       | -10～-30 |
| Funding欠損       |  -5～-15 |
| 分析期間6か月未満       |     -30 |
| 外部アドレスとの資金移動が多い |  -5～-20 |
| API取得上限に到達      |     -10 |

70点未満はランキングのメイン一覧から除外する。

すべての推定値に以下を付与する。

```text
EXACT
DERIVED
ESTIMATED
UNKNOWN
```

---

# 26. 障害時の動作

## 26.1 Fail Closed

以下の場合、新規シグナルとメールを停止する。

* 市場価格が取得できない
* イベントの時系列が逆転している
* WebSocket切断後の欠損補完が終わっていない
* ポートフォリオ復元に失敗
* DB整合性エラー
* 同一イベントの競合処理
* 価格乖離が異常
* 外部APIから不正なレスポンス
* データ品質が基準未満

停止理由をWeb画面に表示する。

## 26.2 復旧

* 最後に成功したカーソルから再取得
* 重複イベントは無視
* 欠損期間を再照会
* 再計算対象をキューに登録
* 復旧完了後にシグナル生成を再開
* 復旧前の古いシグナルはメール送信しない

---

# 27. テスト要件

## 27.1 Unit Test

* TWR計算
* 最大ドローダウン
* レバレッジ計算
* Funding計算
* DCA分類
* 総合スコア
* データ品質スコア
* シグナル生成
* 通知抑制
* デモ約定
* スリッページ
* ポジション損益
* 重複防止

## 27.2 Integration Test

* Hyperliquid APIモック
* Hyperliquid WebSocket再接続
* Suiイベントページネーション
* Cetus Swap正規化
* PostgreSQL
* Redis Queue
* Resend送信
* Resend Webhook
* Cron認証
* ジョブの再実行

## 27.3 E2E Test

Playwrightを使用し、以下を検証する。

* ログイン
* ダッシュボード
* アドレス登録
* CSVインポート
* ランキング表示
* ウォッチ登録
* シグナル表示
* デモポートフォリオ
* 設定変更
* テストメール
* CSV出力

## 27.4 障害試験

* WebSocket切断
* APIタイムアウト
* APIレート制限
* DB一時停止
* Redis一時停止
* 重複イベント
* 順不同イベント
* 価格欠損
* メール送信失敗
* Worker多重起動

---

# 28. 非機能要件

| 項目            | 基準                 |
| ------------- | ------------------ |
| Web表示         | 主要画面3秒以内           |
| シグナル検知        | 通常1分以内             |
| Hyperliquid通知 | 目標30秒以内            |
| 現物DEX通知       | 目標2分以内             |
| 稼働率           | 個人利用として99%以上を目標    |
| データ保持         | Raw Eventは原則無期限    |
| ログ保持          | 最低90日              |
| タイムゾーン        | DBはUTC、表示はJST      |
| 数値精度          | Decimal使用          |
| 監査性           | 全シグナルの根拠追跡可能       |
| 冪等性           | 同一イベントの再処理が安全      |
| バックアップ        | PostgreSQL日次バックアップ |

---

# 29. 環境変数

```text
DATABASE_URL=
REDIS_URL=

AUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_ADMIN_EMAIL=

HYPERLIQUID_API_URL=
HYPERLIQUID_WS_URL=
HYPERLIQUID_NETWORK=mainnet

SUI_GRAPHQL_URL=
SUI_GRPC_URL=
SUI_NETWORK=mainnet
CETUS_PACKAGE_IDS=
CETUS_POOL_ALLOWLIST=

RESEND_API_KEY=
RESEND_FROM_EMAIL=
RESEND_TO_EMAIL=
RESEND_WEBHOOK_SECRET=

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6

CRON_SECRET=
INTERNAL_API_SECRET=

SENTRY_DSN=
APP_BASE_URL=
TZ=Asia/Tokyo
```

`.env.example`を作成し、実際の秘密情報をGitにコミットしない。

---

# 30. リポジトリ構成

```text
/
├─ apps/
│  ├─ web/
│  ├─ worker/
│  └─ api/
├─ packages/
│  ├─ database/
│  ├─ domain/
│  ├─ analytics/
│  ├─ blockchain-adapters/
│  │  ├─ hyperliquid/
│  │  ├─ sui/
│  │  └─ cetus/
│  ├─ notification/
│  ├─ demo-trading/
│  ├─ ui/
│  └─ config/
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed.ts
├─ docs/
│  ├─ requirements.md
│  ├─ architecture.md
│  ├─ database.md
│  ├─ external-apis.md
│  ├─ calculations.md
│  ├─ assumptions.md
│  ├─ operations.md
│  └─ security.md
├─ tests/
├─ docker-compose.yml
├─ pnpm-workspace.yaml
├─ turbo.json
├─ .env.example
└─ README.md
```

---

# 31. 実装フェーズ

## Phase 0：設計

* 要件定義
* アーキテクチャ
* ER図
* 画面一覧
* API一覧
* 外部API調査
* リスク整理
* 開発タスク分割

## Phase 1：基盤

* Monorepo
* Next.js
* Worker
* PostgreSQL
* Prisma
* Redis
* 認証
* CI
* Docker
* ログ
* エラー監視

## Phase 2：Hyperliquid取得

* HTTP API
* WebSocket
* 約定保存
* ポジション保存
* Funding保存
* 再接続
* 欠損補完
* アドレス詳細画面

## Phase 3：Sui/Cetus取得

* Sui GraphQL/gRPC
* Cetusイベント
* Swap正規化
* トークン価格
* アドレス履歴
* DCAイベント
* データ品質管理

## Phase 4：分析

* ポートフォリオ再構築
* TWR
* ドローダウン
* リスク指標
* DCA分類
* レバレッジ分類
* 総合スコア
* ランキング

## Phase 5：シグナル

* 売買イベント判定
* 信頼度
* コンセンサス
* 重複防止
* リスクフィルター
* シグナル画面

## Phase 6：デモトレード

* 仮想口座
* 仮想注文
* 仮想約定
* 手数料
* Funding
* 資産推移
* ベンチマーク

## Phase 7：通知

* Resend
* 即時通知
* ダイジェスト
* 配信結果Webhook
* 通知設定
* 通知抑制

## Phase 8：品質向上

* E2Eテスト
* 障害試験
* セキュリティ
* パフォーマンス
* 運用手順
* バックアップ
* 本番デプロイ

各Phase終了時に、テスト結果と未完了事項をMarkdownで報告すること。

---

# 32. MVP受入条件

以下をすべて満たした場合にMVP完成とする。

1. 自分の許可メールアドレスだけでログインできる。
2. Hyperliquidアドレスを登録できる。
3. Cetus/Suiアドレスを登録できる。
4. 約定・スワップ履歴を取得できる。
5. 同一イベントが重複保存されない。
6. アドレスの収益率と最大ドローダウンを表示できる。
7. DCAまたはレバレッジ型に分類できる。
8. 総合スコアとデータ品質を表示できる。
9. ランキングを表示できる。
10. ウォッチ対象の売買を検知できる。
11. 検知結果をWeb画面に表示できる。
12. メール通知を送信できる。
13. メールの重複送信が発生しない。
14. 仮想資金でデモ売買できる。
15. 手数料とスリッページを反映できる。
16. デモ資産曲線を表示できる。
17. WebSocket切断後に再接続できる。
18. 欠損データを補完できる。
19. 秘密鍵を一切使用していない。
20. 本番コードに実売買処理が存在しない。
21. Unit Test、Integration Test、E2E Testが成功する。
22. READMEだけでローカル環境を起動できる。
23. 外部API障害時に誤通知を行わない。
24. 全シグナルについて計算根拠を確認できる。

---

# 33. 実装禁止事項

以下は明示的に禁止する。

* 秘密鍵の保存
* シードフレーズの入力
* 実売買APIの呼び出し
* ウォレットへの署名要求
* AIによる自由な売買判断
* 収益率の捏造
* 欠損データの自動補完
* テストを無効化しての完了扱い
* `any`型の多用
* エラーの握りつぶし
* 同期カーソルをメモリだけで管理
* 金額計算でJavaScriptのnumberを使用
* APIキーをフロントエンドへ公開
* 本番環境でテスト用データを使用
* 条件未達アドレスを件数合わせで採用
* データ期間の異なるアドレスを説明なしに比較

---

# 34. 最初に実行するタスク

実装開始前に、以下の成果物を作成してください。

1. `docs/requirements.md`
2. `docs/architecture.md`
3. `docs/database.md`
4. `docs/external-apis.md`
5. `docs/calculations.md`
6. `docs/security.md`
7. ER図
8. システム構成図
9. データ取得シーケンス図
10. シグナル生成シーケンス図
11. メール通知シーケンス図
12. Phase別Issue一覧
13. MVP実装順序
14. 技術的リスク一覧
15. 仕様上の仮定一覧

その後、Phase 1の基盤実装を開始してください。

各Phaseで以下を実施してください。

```text
設計
→ 実装
→ Unit Test
→ Integration Test
→ 静的解析
→ セキュリティ確認
→ ドキュメント更新
→ 完了報告
```

本仕様と実装が矛盾する場合は、黙って仕様を変更せず、`docs/assumptions.md`または`docs/decisions.md`に理由と影響を記録してください。
