# Architecture Decision Log

最終更新: 2026-07-26

## ADR-001: Web、API、Workerを分離する

- 状態: 採用
- 理由: 常時監視と再試行をNext.jsのrequest lifecycleへ依存させないため。
- 影響: 3プロセスを個別起動し、内部RESTと共有DB/Redisで連携する。

## ADR-002: APIはFastifyを採用する

- 状態: 採用
- 理由: Phase 1の小さい独立APIに対し、型付け、plugin構成、inject test、低い起動コストを得られるため。
- 仕様との差分: SPECはNestJS「または独立したWorkerアプリ」を許容しており、フレームワークを固定していない。

## ADR-003: PostgreSQLを正本、Redisを一時状態とする

- 状態: 採用
- 理由: Redis再起動やqueue再配信で業務状態・同期カーソルを失わないため。
- 影響: 業務一意制約とジョブ実行状態はDBにも保存する。

## ADR-004: Phase 1 Migrationは認証・運用基盤に限定する

- 状態: 採用
- 理由: 外部APIの実データ型を未確認のまま全取引テーブルを固定すると、Phase 2–3で破壊的変更になりやすいため。
- 影響: 全体ERは設計し、物理テーブルは対応Phaseで追加する。

## ADR-005: Auth.jsはDB sessionとPrisma adapterを使う

- 状態: 採用
- 理由: 単一ユーザーでもsessionを即時失効でき、Phase 1のPostgreSQL接続も実証できるため。
- 影響: Auth.js標準のAccount/Session/VerificationTokenをschemaに含める。

## ADR-006: 許可メールを二段階で検証する

- 状態: 採用
- 理由: OAuthログイン直後と保護画面表示時の両方でサーバー側認可を保証するため。
- 影響: sign-in callbackとdashboard guardで同じ正規化関数を使う。

## ADR-007: Phase 1のUIはモック表示に限定する

- 状態: 採用
- 理由: 外部データ取得や金融計算を先行実装しないため。
- 影響: 画面上に「モック/基盤フェーズ」であることを明示する。

## ADR-008: shadcn/uiは共有UI packageに配置する

- 状態: 採用
- 理由: 将来の複数画面で同一のButton/Card/Badge等を再利用するため。
- 構成調整: `components.json` はWebアプリ、実装部品は `packages/ui` に置く。

## ADR-009: Docker Composeに専用Migrationサービスを置く

- 状態: 採用
- 理由: APIとWorkerが同時にMigrationを実行する競合を避けるため。
- 影響: PostgreSQL healthy → migrate success → app起動の順序にする。

## ADR-010: Sites汎用starterを使用しない

- 状態: 採用
- 理由: 本リポジトリで明示されたpnpm workspace、Turborepo、Next.js、Docker Compose、Auth.jsの構成とstarterの前提が異なるため。
- 影響: Sitesのサーバー側認可、アクセシビリティ、レスポンシブ設計の原則だけを適用し、ローカル成果物として実装する。

## ADR-011: Phase番号はAGENTS.mdの10段階を正規化する

- 状態: 採用
- 理由: SPECのPhase 0–8とAGENTS.mdの開発順に粒度差があるため。
- 影響: Phase 0設計、1基盤、2 Hyperliquid、3 Sui/Cetus、4分析、5シグナル、6デモ、7通知、8探索、9本番強化とする。

## ADR-012: 依存関係を互換性セットとして完全固定する

- 状態: 採用
- 確認環境: Node.js `24.12.0`、pnpm `11.9.0`
- 確認方法: 2026-07-25時点のnpm package metadata（`engines`、`peerDependencies`、`peerDependenciesMeta`、`dependencies`、`dist-tags`）、公式ドキュメント、実インストール・lint・typecheck・test・build
- 方針: `beta`、`rc`、`canary`、`next`、`experimental` tag/versionは直接依存・lockfile解決のどちらにも採用しない。全package.jsonで外部依存を完全versionにする。

| 領域    | 採用version                                            | 互換性根拠                                                                  |
| ------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| Runtime | Node `24.x` / pnpm `11.9.0`                            | ローカルNode `24.12.0`。Next/Vitest/Prismaのengine範囲内                    |
| Web     | Next.js `16.2.11`, React/React DOM `19.2.8`            | Next peerはReact/DOM `^19.0.0`、React DOM peerはReact `^19.2.8`             |
| Auth    | `next-auth 4.24.15`, `@next-auth/prisma-adapter 1.0.7` | どちらも安定latest。adapter peerは`next-auth ^4`で世代が一致                |
| ORM     | Prisma/Client `6.19.3`                                 | Prisma 6の安定patch、Node `>=18.18`、adapterのPrisma `>=3`範囲              |
| CSS     | Tailwind `4.3.3`, `@tailwindcss/postcss 4.3.3`         | PostCSS pluginがTailwind `4.3.3`をexact dependencyとして要求                |
| Test    | Vitest `4.1.10`, TypeScript `5.9.3`                    | Vitest engineはNode `>=24`を許可。typescript-eslintはTS `<6.1`を要求        |
| API     | Fastify `5.10.0`, Helmet `13.1.0`, Rate Limit `11.1.0` | Fastify v5はNode 20+。両pluginの公式package test metadataはFastify `^5.0.0` |
| Queue   | BullMQ `5.81.2`, ioredis `5.11.1`                      | BullMQ `5.81.2`がioredis `5.11.1`を直接dependencyに持つ                     |
| Lint    | ESLint `10.8.0`, Next plugin `16.2.11`                 | Next公式pluginとtypescript-eslint `8.65.0`をFlat Configへ直接組み込む       |

### 見送った構成

- `next-auth 5.0.0-beta.*`: betaのため不採用。
- `@auth/prisma-adapter 2.11.3`: `@auth/core 0.41.3`世代であり、安定版NextAuth.js v4と混在させないため不採用。
- Prisma `7.9.0`: 安定版だがgenerator/config/runtimeのmajor変更をPhase 1へ持ち込まず、v4 adapterで実績のあるPrisma 6を採用。
- TypeScript `7.0.2`: typescript-eslint `8.65.0`のpeer上限 `<6.1.0`を外れるため不採用。
- `eslint-config-next 16.2.11`: 同梱pluginのpeer上限がESLint 9であり、ESLint 10では`pnpm peers check`が失敗する。また安定版React Hooks pluginからBabelのprerelease依存へ到達するため、Next公式pluginをFlat Configへ直接組み込む構成を採用。
- Vitest `4.0.18`: 当初候補だったが、4.0系にcritical advisoryが公開されたため見送り。`4.1.10`の`std-env` rangeはprereleaseを下限に含むが、lockfileが解決する実体は安定版だけであることを確認する。

### 監査による再評価

2026-07-25の`pnpm audit --audit-level high`結果を受け、最初の選定から次を変更した。

- Vitestを`4.1.10`へ更新し、`GHSA-5xrq-8626-4rwp`を解消する。
- Prismaを`6.19.3`へ更新する。内包する`@prisma/config 6.19.3`は修正版`effect 3.21.0`を使用する。
- ESLintを`10.8.0`へ更新し、Next公式plugin `16.2.11`とtypescript-eslint `8.65.0`をFlat Configへ直接組み込む。これによりpeer違反なく修正版`brace-expansion 5.0.8`へ到達する。
- Next.js `16.2.11`は安定latestだが、metadataが脆弱な`postcss 8.4.31`と`sharp ^0.34.5`を参照する。このためpnpm overrideで安定版`postcss 8.5.23`と`sharp 0.35.3`へ固定し、Next buildとE2Eで実互換性を検証する。
- Vitestの`std-env ^4.0.0-rc.1`はrange表記であり、lockfile上は安定版`4.2.0`へ解決する。
- tsup `8.5.1`のesbuild rangeは修正前`^0.27.0`のため、安定修正版`esbuild 0.28.1`へoverrideし、API/Workerのbundle buildで互換性を検証する。
- 直接依存、override、lockfileの解決結果にprerelease versionがないことを機械検査する。CIは全依存を`pnpm audit --audit-level high`で検査する。

参照した公式資料: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)、[NextAuth.js v4 options](https://next-auth.js.org/configuration/options)、[Tailwind CSS PostCSS installation](https://tailwindcss.com/docs/installation/using-postcss)、[Vitest guide](https://vitest.dev/guide/)、[Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/)、[BullMQ connections](https://docs.bullmq.io/guide/connections)、[ESLint configuration files](https://eslint.org/docs/latest/use/configure/configuration-files)。

## ADR-013: 共有packageはtype sourceとruntime buildを分離する

- 状態: 採用
- 理由: TypeScript NodeNextの明示的 `.js` importとNext.js 16 Turbopackのsource解決規則が異なるため。
- 影響: package export mapの `types` は `src`、`import/default` はtsup生成の `dist` を指す。TurboがWeb/API/Workerより先に共有packageをbuildする。

## ADR-014: APIとWorkerのNode packageをESM bundleからexternal化する

- 状態: 採用
- 理由: CommonJS packageの `dotenv` がESM出力へ内包され、esbuildのdynamic require互換コードがNode ESM上で失敗していたため。
- 方針: APIとWorkerはESM、Node.js 24、application bundleを維持する。tsupの `packages = "external"` でnpm runtime依存と `@chaincopy/*` workspace packageをexternal化し、shim、browser polyfill、CommonJS化は行わない。
- runtime解決: Dockerのworkspace stageにpnpmの `node_modules` とbuild済みworkspace packageを保持し、Node.jsがpackage export map経由で解決する。
- 検証: API/Workerのbuild後に `dotenv/lib/main`、`Dynamic require of`、`function __require` がdistへ含まれないことを確認した。DockerでAPI、Workerをno-cache buildし、PostgreSQL、Redis、API、Worker、WebがHealthy、Migrationが正常終了、API `/ready` とWorker `/health` が成功した。

## ADR-015: WebコンテナはNext.js standalone serverを直接起動する

- 状態: 採用
- 理由: `output: "standalone"` に対して `next start` を実行しており、Next.jsが非対応構成の警告を出していたため。
- 出力確認: Monorepo build後のserver実体は `apps/web/.next/standalone/apps/web/server.js`。
- 方針: Web専用builderからstandalone出力をruntime imageへコピーし、`.next/static` を `apps/web/.next/static`、`public` を `apps/web/public` へ配置する。runtime imageには全workspaceの依存を含めず、`HOSTNAME=0.0.0.0`、`PORT=3000` を設定して `node apps/web/server.js` を実行する。
- 検証: `format:check`、`lint`、`typecheck`、`test`（10件）、`build` が成功した。Webをno-cache buildしてComposeを再起動し、全サービスHealthy、Migration正常終了を確認した。Webログからstandalone警告が消え、`/login`、Google認証provider API、CSS asset、React Server Components responseがすべてHTTP 200で応答した。runtimeコンテナ内のstandalone server、`.next/static`、`public` の配置も確認した。

## ADR-016: Phase 2 scheduler と WebSocket は Redis lease の単一 leader が所有する

- 状態: 採用
- 理由: Worker を複数起動しても、定期 job と同一アドレス購読を多重化しないため。
- 方式: source 単位の token 付き Redis lease を `NX/PX` で取得し、Lua で所有者一致時だけ renew/release する。
- 障害時: lease renew 失敗または所有権喪失時は active tick を待ち、WebSocket supervisor を停止する。次の process は TTL 後に取得できる。

## ADR-017: timestamp cursor は inclusive とし、DB uniqueness で重複を除く

- 状態: 採用
- 理由: Hyperliquid の時間範囲 API は最後の timestamp を次の `startTime` にする仕様であり、`+1ms` すると同一 timestamp のページ境界イベントを欠落させるため。
- 影響: 次回同期は最後の timestamp を再取得する。cursor は成功時だけ単調増加し、古い gap recovery では後退させない。
- 上限: 同一 timestamp だけで最大ページが埋まり進行不能な場合は推測せず Data Quality Issue を記録する。

## ADR-018: HTTP/WS Funding は transport 共通の正規化IDを使う

- 状態: 採用
- 理由: WS payload には HTTP の hash がなく、小数も `-40` と `-40.0` のように表現差があるため。
- 方式: wallet、timestamp、coin、amount、position size、funding rate を Decimal で正規化し external ID と fingerprint を作る。
- 検証: 公開アドレスの HTTP 履歴2,102件に対し WS 初期 snapshot を受信しても Funding 件数が増えないことを確認した。

## ADR-019: 今回の明示スコープをPhase 3自動探索として扱う

- 状態: 採用
- 背景: `AGENTS.md`とSPECの既存順序では自動探索は後段だが、所有者からPhase 1/2完了後の次作業としてHyperliquid自動探索が明示された。
- 影響: 今回の変更名をPhase 3とし、Sui/Cetus、収益計算、分類、ランキング、シグナル、デモトレードへ進まない。既存ADR-011の一般順序との差異を本ADRで明示する。

## ADR-020: 市場探索は公式無料APIだけを使う

- 状態: 採用
- 方式: `meta` Info APIとcoin別`trades` WebSocketだけで候補を供給し、候補履歴は既存Info API adapterを再利用する。
- 不採用: ファイルimport、scraping、有料indexer/API、Requester Pays S3、自前node、Exchange endpoint。

## ADR-021: 市場取引と候補参加を分離して冪等集計する

- 状態: 採用
- 方式: 公式推奨の`(block_time, coin, tid)`を外部取引IDとし、source/fingerprintでも一意化する。候補参加は`(candidate, discovery_trade)`で一意化する。
- 自己取引: buyerとsellerが同一なら1参加だけを作り、aggressor sideのtaker取引として数える。
- 方向: buyerをbuy、sellerをsellとする。WsTrade sideが`B`ならbuyer、`A`ならsellerをtakerとする。WsTradeだけではlong/shortを確定できないため推測せず、Enrichmentで取得した`userFillsByTime.dir`からlong/short関連件数を更新する。

## ADR-022: 候補Enrichmentを通常監視より低優先度にする

- 状態: 採用
- 方式: 共有weighted limiterで通常監視をpriority 0、候補をpriority 10とする。候補は専用BullMQ queueへ分離し、同時実行数2と24時間の既定再取得間隔を置く。
- weight: レスポンス件数で追加weightが決まるendpointは、送信前に最大レスポンス分を予約して同時応答による上限超過を防ぐ。
- pagination: 高頻度候補がqueueを占有し続けないよう、fills、funding、ledgerは各10,000件で保守的に打ち切る。打ち切り理由を保存し、完全履歴や5年評価済みとして扱わない。
- retry: 429の`Retry-After`、HTTP内部最大3回、BullMQ最大5回の指数Backoffを組み合わせる。

## ADR-023: 市場WebSocketの設定反映をsingle-flight化する

- 状態: 採用
- 背景: `meta`取得がrate limiter待ちになった間に探索を停止すると、古い設定を読んだ複数control jobが停止後に接続を再生成できた。
- 方式: supervisorの`ensureRunning`全体を1つのPromiseとして共有し、`meta`取得後に最新設定を再取得する。停止済みなら接続せず、同時control jobは同じ結果を待つ。
- 検証: 停止への変更中は接続0件、同時control jobは接続1件となる回帰テストを追加した。

## ADR-024: Worker停止時はscheduler leaseを外部接続停止より先に解放する

- 状態: 採用
- 背景: Candidate Enrichmentでweighted limiterが埋まっていると、Discovery supervisorの`meta`待ちによりshutdownが長引き、後段のPhase 2 scheduler lease解放がコンテナ停止猶予を超えることがあった。
- 方式: WorkerはPhase 2 schedulerをDiscovery schedulerより先に停止し、Phase 2 schedulerはactive tick完了後、WebSocket停止を待つ前に所有token一致のleaseを解放する。BullMQ Workerも通常監視、Discovery、Candidate Enrichmentの順に閉じ、低優先度候補の長時間処理で通常監視lockの解放が妨げられないようにする。
- 検証: WebSocket停止Promiseが未完了でも別schedulerがleadershipを取得できる回帰テストを追加した。実コンテナ停止後のRedis `PTTL`は`-2`となり、次のWorkerは起動時に即時leaderを取得した。

## ADR-025: Phase 4の計算は公式値を正本とし、品質不足時は停止する

- 状態: 採用
- 実現損益: Fillの公式`closedPnl`を正本とし、平均取得価格方式による再計算値は検算だけに使う。集計単位はFillではなく、positionが0からopenされ0へ戻るまでのcoin・方向別Position Cycleとする。部分決済は同一cycle、反転は旧cycleの終了と新cycleの開始に分割する。
- NAV: `PortfolioSnapshot.accountValue`はPerpetuals口座snapshotとして扱う。spot時価、cash、liabilityが同時点で保存されていないため、全口座純資産へ読み替えない。
- return: TWRは外部cash flow時刻で分割し、直前・直後NAVがない場合は日初・日末へ寄せて推定しない。非正NAV、未知cash flow、gap、API打切りを跨ぐ計算はfail closedにする。
- risk: UTC日次return、risk-free rate 0、年率係数365をv1規則とする。30日未満は年率換算せず、30～179日は参考値、180日以上を通常評価とする。
- 影響: Phase 4Bは純粋関数と固定Decimal test vectorから開始する。DB modelとMigrationは計算出力・version・完全性の永続化設計を確定してから別変更で追加する。

## ADR-026: Phase 4Cは入力fingerprint単位で結果をtransaction保存する

- 状態: 採用
- 冪等性: `walletAddressId + calculationVersion + inputFingerprint`が同じ成功Runを再利用する。入力fingerprintは対象期間、Fill・Funding・Cash Flow・NAV/Position snapshotの外部ID、履歴完全性、計算versionを安定順でhash化する。
- 再計算: `force=true`は依頼時刻をdeduplication keyへ加えて新しいRunを作る。同じBullMQ再配信では同一Runを再開し、FAILEDまたはINSUFFICIENT_DATAのdeduplication keyは終端時に解放して再試行可能にする。
- 整合性: Daily NAV、Position Cycle、Metricの作成とRunの`RUNNING`から`SUCCEEDED`への遷移を1 DB transactionに置く。子行の一部保存、履歴不足、未知cash flow、gapでは`SUCCEEDED`にしない。
- version: Phase 4Bの式を変えず、Worker側の単一定数`performance-v1`をRunとMetricへ保存する。式変更時は新versionで別Runを生成する。
- 運用: 計算は専用BullMQ queue、同時実行数1、priority 15、最大3回の指数backoffとし、既存監視、Gap Recovery、手動同期、候補Enrichmentを圧迫しない。

## ADR-027: 日本語論理名をPrisma・Migration・DB定義書で同期する

- 状態: 採用
- 対象: `public`スキーマのPrisma管理対象アプリケーションテーブルと物理カラムを対象とし、`_prisma_migrations`、Prismaのリレーション専用仮想フィールド、存在しないViewは対象外とする。
- 方式: `@map`、`@@map`と既存Migrationで物理名を確定し、Prismaの`///`を開発時の参照、`COMMENT ON TABLE`と`COMMENT ON COLUMN`をPostgreSQL上の正本、`docs/database.md`を一覧定義として同じ日本語論理名へ揃える。
- 影響: コメント専用Migrationはテーブル、カラム、型、NULL、Default、Index、Unique、外部キー、リレーションを変更しない。今後の物理テーブル・カラム追加時は、同じMigrationで日本語コメントも追加する。

## ADR-028: Phase 4.1はPerformanceを指標Lane単位でfail closedにする

- 状態: 採用
- 背景: ADR-026のRun全体を単一成功単位とする方式では、未知Cash Flowや履歴開始前ポジションがあると、独立して検証可能な取引・Exposure指標まで破棄されていた。
- 方式: Trade、Return/Risk、Exposureを独立Laneとして計算する。各Laneは不明入力を推測せず停止する一方、他Laneの信頼済みMetricは同一transactionで保存する。Metricが1件以上あればRunを`SUCCEEDED`、全LaneでMetricが0件なら`INSUFFICIENT_DATA`とする。
- Trade: coinごとに最初の`startPosition=0`より前の不明prefixを除外し、以後の0→非0→0の完了Cycleだけを統計へ使う。割当不能Fundingは除外して警告し、取引Lane全体は停止しない。
- Return: 最初の正のNAVから最初のUTC日付gap直前までを決定論的なeffective期間とする。未知Cash FlowまたはCash Flow境界NAV不足はReturn/Riskだけを停止する。
- Cash Flow: `deposit`、`withdraw`、raw payloadで当事者と方向を確定できる`send`、`toPerp`を持つ`accountClassTransfer`だけを明示分類する。曖昧なTransfer/BridgeはUNKNOWNのままとする。Ledger feeはFill feeとの二重計上を避けるためPerformanceでは使わない。
- version: 計算versionを`performance-v2`、アプリversionを`0.3.0`とする。v1 Runは削除せず共存させ、現行Overviewはv2を優先する。
- 永続化: 既存のRun、Daily NAV、Position Cycle、Metric列で表現できるためPrisma Migrationは追加しない。Lane可用性と診断件数は保存済みMetric・子行・対象期間の生データからAPIで導出する。

## ADR-029: Phase 4.2はPerformanceの判断情報を最大6指標へ絞る

- 状態: 設計採用（実装前）
- 背景: Phase 4.1.1完了後の`performance-v3` Performance画面は、計算可能な20種類のMetric枠、Availability、Precision、Warning Code、Run診断値、日次NAV、Position Cycleを同じ初期表示へ並べるため、収益性・損失リスク・再現性・データ信頼性を短時間で判断しにくい。
- 方式: 初期表示を最新計算状態、必要な場合の前回正常結果表示、データ信頼性文、累積収益率、最大下落率、利益と損失の効率、勝率、評価対象取引数、利益の一発依存度、意味単位で最大3件の注意、再計算操作に限定する。値がないMetricの空カードは描画せず、補助Metric、日次NAV、Position Cycleは閉じた「詳細指標」、内部Codeと追跡値は閉じた「計算の詳細」へ移す。
- Run選択: `latestRun`は最新の計算試行状態、`latestSuccessfulRun`と`metrics`、`availability`、`calculationDetails`は表示中の正常結果として分離する。最新Runが`PENDING`、`RUNNING`、`FAILED`、`INSUFFICIENT_DATA`でも最新成功RunがあればAPI変更なしで主要指標を表示し、「前回の正常な計算結果を表示しています」とその`completedAt`を明示する。状態、Error、Metric、診断値の取得元を混同せず、Warningは入力と生CodeをRun別に保持したまま通常表示だけ意味キー単位で統合する。
- Version選択: 暗黙取得では`performance-v3`を優先し、v3が存在しない場合だけ`performance-v2`へfallbackする。`performance-v1`、未知Version、将来Versionは暗黙fallbackせず、明示`runId`では既存の安全条件を満たす指定Runを尊重する。
- Max Drawdown: 計算契約はADR-030を正本とし、v3ではTWR Return Periodから構築したWealth Index由来の保存Metricを表示する。`UNKNOWN_CASH_FLOW`、`MISSING_CASH_FLOW_BOUNDARY_NAV`、`NON_POSITIVE_NAV`などでReturn Laneが計算不能な場合は最大下落率を`0`や`—`で補完せず、特にCash Flow境界NAV不足では最大下落率カードを表示しない。raw Daily NAVは表示・監査用として維持する。
- Lane理由: ReturnだけのCash Flow境界NAV不足または評価期間不足、Tradeだけの完了取引不足、ExposureだけのSnapshot不足など、Lane固有理由は初期状態で閉じた「詳細指標」だけに日本語表示する。全体または複数Laneへ影響する問題だけを第一階層へ表示できる。第一階層へ表示した意味は詳細指標で理由文も参照文も重複表示せず、生Warning Codeは「計算の詳細」だけに残す。
- Warning: 最新試行は`latestRun.warningCodes`、表示中の正常結果は`latestSuccessfulRun.warningCodes`、Metric warningCodes、`availability.reasons`、`calculationDetails`を別入力とする。生成規則は変えず、Webの通常表示時だけ画面全体を1つの重複排除範囲としてユーザー向け意味キーへ統合する。同一意味キーが両Runにある場合は最新試行を優先し、表示中正常結果側の同一意味キーを通常表示から除く。最大3件はRun別でなく両Runを合わせた画面全体へ適用し、残件の展開後も「最新の計算試行」「表示中の正常結果」の区分を維持する。生Warning Codeは重複削除せず各Run別に「計算の詳細」へ残す。
- 取引数: `trustedClosedCycleCount`は空状態でも`0`になり得るため、最新成功Runが存在し、Trade Laneが利用不能でなく、件数が1件以上で、Trade系の正常なMetricが存在する場合だけ主要指標へ表示する。条件を満たさない`0`は正常結果として扱わない。
- 説明操作: 主要指標の1～2文の説明は、`aria-label`、`aria-expanded`、`aria-controls`を持つbuttonで開閉する。クリック、Enter、Space、モバイルタップで操作でき、hoverだけに依存させない。
- 階層: 「詳細指標」と「計算の詳細」は同じ階層の独立した開閉領域とし、どちらも初期状態を閉じる。「詳細指標」の内部にMetricグループ、日次NAV、Position Cycleの新しい多段折りたたみを追加しない。
- レイアウト: 主要指標は1920pxと1366pxで3列、タブレットで2列、モバイルで1列とし、4列以上にしない。
- リスク指標: 最大レバレッジと最大銘柄比率は既存仕様に重大閾値がないため新しい危険判定へ使わず、詳細指標に保持する。
- 非変更: 金融計算と`performance-v3`への更新はPhase 4.1.1で修正済みであり、Phase 4.2は表示変更だけとする。v3の金融計算、Metric値、Daily NAV、Position Cycle、input fingerprint、Run状態、Lane availability、Warning生成、DB保存、APIレスポンス、再計算処理を変更しない。Phase 5のスコア、Confidence Score、推奨、分類、ランキング、AI説明、新規金融Metric、新規リスク閾値を追加しない。
- 詳細: `docs/phase4-2-performance-ui-inventory.md`、`docs/phase4-2-performance-ui-spec.md`、`docs/phase4-2-performance-ui-test-matrix.md`を参照する。

## ADR-030: Max Drawdown uses TWR wealth index

- 状態: 採用
- 背景: `performance-v2`ではTWRと累積収益率を外部Cash Flow境界で分割したReturn Periodから計算する一方、Max Drawdownはraw Daily NAVを直接使用していた。このため、入出金が運用損益ではないにもかかわらず、raw NAVのPeak/Troughへ混入する計算契約の不整合があった。
- 採用案A: `splitReturnPeriodsAtCashFlows()`が返す順序確定済みReturn Periodを再ソートせず、`W_0 = 1`、`W_i = W_(i-1) × (1 + r_i)`でTWR Wealth Indexを構築する。Max Drawdownは`P_i = max(P_(i-1), W_i)`、`D_i = W_i / P_i - 1`、`min(D_i)`とする。同一timestampは配列sequenceを正本とし、同率Peak/Troughは最初の地点を保持する。終端wealthは`1 + TWR`と一致させる。
- Cash Flow、Fee、Funding: 外部Cash FlowはReturn Period生成時に一度だけ除外し、Max Drawdown側では金額を再調整しない。FeeとFundingはNAVに反映済みの運用損益としてReturn Periodのreturnだけから伝播させ、別途控除・加算しない。境界NAV不足、未知Cash Flow、非正NAVは推測や近似をせずReturn Laneを停止する。
- 不採用案B: raw Daily NAV方式の継続は、Cash FlowをDrawdownとして誤認し、TWRとMax Drawdownが異なる収益系列を見るため不採用とした。
- 不採用案C: Max Drawdown側でCash Flow額を直接加減算する方式、日初・日末への丸め込み、Modified Dietzなどの近似は、二重調整または推測を生み、保存済みの正確な境界NAVがない履歴を正式値に見せるため不採用とした。
- versionと互換性: 計算versionを`performance-v3`、アプリversionを`0.3.1`とする。v1/v2/v3 RunのDB共存を許可し、v1/v2 RunおよびMetricは更新・削除せず、v3は別Runとして作成する。同じv3入力fingerprintは通常計算で再利用し、`force=true`または結果に影響する入力追加では新規v3 Runを作る。Cash Flowがない履歴はv2と同値になる。
- API Version選択: `performance-v3`を優先し、v3が存在しない場合に限り`performance-v2`へ明示的にfallbackする。`performance-v1`、未知Version、将来Versionは暗黙fallback対象にしない。fallback選択は暗黙の最新Run取得契約、履歴保持はDB共存契約であり、別の概念とする。明示`runId`取得はWallet所属などの既存安全条件を維持したうえで指定Runを尊重する。現行Versionを更新するときはfallback Versionも明示的に変更する。
- 永続化/API: Wealth Index中間値はDBへ保存せず、既存`address_performance_metrics`へMax Drawdownを保存する。Prisma schema、Migration、API DTOおよびURLは変更しない。`calculationVersion`と`metricVersion`で診断可能な既存契約を維持する。
- 残存制約: `accountClassTransfer`など現行分類で内部振替とされたイベントをMax Drawdownだけで再分類しない。Perpetuals評価範囲をまたぐ内部振替を全履歴で確定できない問題は残るため、分類契約を拡張する別フェーズで扱う。

## ADR-031: Phase 4.2.3は通常画面から技術状態と重複説明を除く

- 状態: 採用
- 背景: Phase 4.2.2のアドレス詳細は、計算不能理由を主要指標カード、確かさ、データ状態へ重複表示していた。自動探索は通信・Queue・API利用量と処理工程を中心に表示し、有望なアドレスを調べる目的が伝わりにくかった。
- Performance表示: 主要6指標は短い名称で常に固定表示し、計算不能値は`-`と「履歴不足」または「取引不足」だけを表示する。内部Warning、Reason、AvailabilityはWebの純粋関数で初心者向け理由へ変換・重複除去し、初期状態が閉じた「詳しい理由」へ集約する。計算中の確かさは「確認中」とし、正常完了の専用メッセージは表示しない。この表示契約はADR-029の空カード非表示と通常Warning表示を置き換える。
- 自動探索表示: 通常画面はタイトル、利用者向け状態、見つかった候補・調査済み・監視候補、候補一覧、設定の順にする。通信方式、接続状態、受信件数、重複除外、Queue、API利用量、内部Status、工程説明は表示しない。候補は成績計算前に高収益と断定せず「成績確認前」と表示する。
- 取得: 候補検索・絞り込み・追加読み込みでは候補APIだけを再取得し、設定と探索サマリーは初回表示または明示的な再読み込み時だけ取得する。探索処理、既存APIレスポンス、監査データは変更しない。
- 非変更: DB schema、Worker、探索・同期・分析処理、`performance-v3`の金融計算、API契約は変更しない。技術情報はDB、API、ログに保持する。
