# Architecture Decision Log

最終更新: 2026-07-25

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
