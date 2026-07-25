# 外部API調査

確認日: 2026-07-25

Phase 1 では以下のチェーン・メールAPIへ接続しない。ここではPhase 2以降の設計制約だけを確定する。参照先は公式ドキュメントで、実装開始時に再確認する。

## 1. Hyperliquid

### 公式資料

- [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [WebSocket](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket)
- [Subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)
- [Rate limits and user limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)

### 確認事項

- Info APIは `POST https://api.hyperliquid.xyz/info`。
- `userFills` は直近最大2,000件。
- `userFillsByTime` はレスポンス最大2,000件で、利用可能なのは直近10,000約定。
- 時間範囲APIは返却上限があるため、最後のtimestampを次の `startTime` にしてページングする。
- WebSocket mainnetは `wss://api.hyperliquid.xyz/ws`。
- `userFills`、`userFundings`、`userNonFundingLedgerUpdates` 等のユーザー別購読がある。
- WebSocketは予告なく切断され得る。再接続し、snapshotまたはInfo APIで欠損を補う。
- ユーザー別WebSocket購読には同時ユーザー数などの制限があるため、Phase 2で実測とrate budgetを設計する。

### Phase 2への制約

- Exchange endpoint、署名、注文送信は実装しない。
- raw eventの外部ID候補はtransaction hash、trade id、ledger updateの複合キーから決定する。
- snapshotとstreamを区別し、snapshot再受信を一意制約で安全にする。
- 長期分析には継続保存または別の履歴ソースが必要。

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
