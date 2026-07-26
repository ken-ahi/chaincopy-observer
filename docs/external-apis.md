# 外部API調査

確認日: 2026-07-26

Phase 2–3 では Hyperliquid の読み取り専用 API だけへ接続する。Sui/Cetus とメールは後続 Phase のままである。

## 1. Hyperliquid

### 公式資料

- [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [WebSocket](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket)
- [Subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)
- [Timeouts and heartbeats](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats)
- [Rate limits and user limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)

### 確認事項

- Info APIは `POST https://api.hyperliquid.xyz/info`。
- `userFills` は直近最大2,000件。
- `userFillsByTime` はレスポンス最大2,000件で、利用可能なのは直近10,000約定。
- 時間範囲APIは返却上限があるため、最後のtimestampを次の `startTime` にしてページングする。
- WebSocket mainnetは `wss://api.hyperliquid.xyz/ws`。
- 実装する HTTP type は `userFills`、`userFillsByTime`、`clearinghouseState`、`spotClearinghouseState`、`portfolio`、`userFunding`、`userNonFundingLedgerUpdates`、`openOrders`、`frontendOpenOrders`、`historicalOrders`、`userRateLimit`。
- 実装する WS type は `userEvents`、`userFills`、`userFundings`、`userNonFundingLedgerUpdates`、`orderUpdates`、`clearinghouseState`、`openOrders`。公式一覧にない推測購読名は作らない。
- WebSocketは予告なく切断され得る。再接続し、snapshotまたはInfo APIで欠損を補う。
- ユーザー別WebSocket購読には同時ユーザー数などの制限があるため、Phase 2で実測とrate budgetを設計する。

### Phase 2への制約

- Exchange endpoint、署名、注文送信は実装しない。
- raw eventの外部ID候補はtransaction hash、trade id、ledger updateの複合キーから決定する。
- snapshotとstreamを区別し、snapshot再受信を一意制約で安全にする。
- 長期分析には継続保存または別の履歴ソースが必要。
- `userFillsByTime` は1レスポンス2,000件、利用可能履歴10,000件、その他の時間範囲レスポンスは原則500件である。候補Enrichmentはfills、funding、ledgerを各10,000件で保守的に打ち切り、上限到達や同一 timestamp だけでページが埋まる場合は履歴を不完全としてData Quality Issueにする。
- server は client から60秒間 message がない接続を閉じ得るため、30秒 heartbeat を送る。
- HTTP は timeout 10秒、最大3回の内部 retry、BullMQ は最大5 attempt の指数 backoff を既定とする。

### Phase 3探索で確認した公式仕様

- `meta`の`universe`をPerpetuals銘柄一覧の正本とし、`isDelisted=true`は購読しない。
- `trades`購読はcoin単位。`WsTrade.users`は`[buyer, seller]`。
- `tid`はbuyer/seller order id由来の50-bit hashであり、グローバル一意キーは`(block_time, coin, tid)`。
- IP単位REST aggregate weightは1分1,200。`clearinghouseState`はweight 2、その他の本Phase Info requestは原則weight 20で、履歴endpointは返却20件ごとの追加weightを持つ。
- 返却件数で追加weightが決まる履歴endpointは、送信前に公式最大件数分を保守的に予約する。画面のAPI weightはこの安全側の予約使用量を表示する。
- WebSocketは最大10接続、1分30新規接続、1,000購読、1分2,000送信message、同時inflight post 100。
- 実装は1市場探索接続、最大1,000購読、30秒heartbeat、購読数に応じた再接続下限、最大12回の連続再接続を採用する。
- 429は`Retry-After`を優先し、ない場合は指数Backoffを使う。
- 市場全体の欠損区間を無料Info APIで完全再構成できるとは扱わず、Data Quality Issueへ記録する。
- Exchange endpoint、S3、外部indexer、scrapingは呼び出さない。

## 2. Sui

### 公式資料

- [Sui TypeScript SDK](https://sdk.mystenlabs.com/sui)
- [Sui Clients](https://sdk.mystenlabs.com/sui/clients)
- [Sui gRPC client](https://sdk.mystenlabs.com/sui/clients/grpc)
- [Sui GraphQL client](https://sdk.mystenlabs.com/sui/clients/graphql)

### 確認事項

- 公式SDKは `@mysten/sui` で、ESM only。
- 公式クライアントはgRPCを一般用途の推奨、GraphQLを複雑な履歴・イベント検索向けとしている。
- JSON-RPC clientはdeprecatedで、廃止予定。
- mainnet public full nodeはrate limitがあり、高トラフィック本番用途では専用providerが推奨される。
- gRPCはNode.js向けnative transportとgRPC-web transportを選択できる。
- GraphQLは型付きcustom queryとcursor paginationを使用できる。

### Phase 3への制約

- 履歴探索はGraphQL、低遅延バックエンドはgRPCを第一候補とする。
- JSON-RPCを新規の主要経路にしない。
- Providerごとの履歴保持期間、rate limit、finalityを実装開始時に確認する。
- 署名、transaction execution、keypairモジュールは使用しない。

## 3. Cetus

### 公式資料

- [Cetus Developer Docs](https://cetus-1.gitbook.io/cetus-developer-docs/)
- [SDK features](https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk/features-available)
- [Swap](https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk/features-available/swap)

### 確認事項

- Cetus SDKはPool、Swap等を提供する。
- Swap資料にはtransaction構築・送信例も含まれるが、本システムは読み取りとイベント正規化だけに限定する。
- Package IDやPool allowlistは環境変数で管理し、コードへ固定しない。
- SDK/APIの世代交代があるため、Phase 3開始時に現行package名、version、mainnet package IDを再確認する。

## 4. Google OAuth / Auth.js

### 公式資料

- [Auth.js](https://authjs.dev/)
- [Google provider](https://authjs.dev/getting-started/providers/google)
- [Prisma adapter](https://authjs.dev/getting-started/adapters/prisma)

### Phase 1方針

- Google OAuthの検証済みメールをAuth.jsが受け取る。
- サーバー側で `ALLOWED_ADMIN_EMAIL` と完全一致を確認する。
- redirect URIはローカルでは `http://localhost:3000/api/auth/callback/google`。
- OAuth Secretはサーバー環境変数だけに置く。

## 5. Resend

Phase 7で公式のSend API、idempotency、Webhook署名、event replay、rate limitを再調査する。Phase 1では依存追加も送信も行わない。

## 6. 再確認チェックリスト

- 公式URL、version、廃止予定
- rate limit、ページサイズ、最大履歴
- timestamp単位、timezone、inclusive/exclusive
- cursor安定性と再取得挙動
- event/fill IDの一意性
- snapshotとincremental update
- retry可能なstatus/error
- WebSocket heartbeat、切断、再接続
- provider障害時のfail-closed条件
