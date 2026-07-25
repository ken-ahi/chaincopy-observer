# セキュリティ設計

最終更新: 2026-07-25

## 1. セキュリティ境界

- ブラウザは信頼しない。
- Web、API、Workerはシークレットを持つサーバー側境界である。
- PostgreSQLは業務データの正本、Redisは一時的な処理基盤である。
- 外部チェーン/APIレスポンスは公開データでも未検証入力として扱う。

## 2. 禁止事項

- 秘密鍵、シードフレーズ、取引所の売買APIキーを取得・保存しない。
- ウォレット接続、署名要求、実注文送信を実装しない。
- クライアントへOAuth Secret、内部API Secret、外部API keyを公開しない。
- LLMへ秘密情報や未加工の個人情報を送らない。

## 3. 認証・認可

- Auth.js + Google OAuthを使用する。
- Auth.jsが取得したメールを小文字化・trimして、同様に正規化した `ALLOWED_ADMIN_EMAIL` と一致確認する。
- sign-in callbackで不許可メールのセッション作成を拒否する。
- ダッシュボードのServer Componentでセッションと許可メールを再検証する。
- 認可はUIの表示/非表示だけに依存しない。
- 管理APIは `x-internal-api-secret` を要求し、timing-safe comparisonを用いる。
- 将来のcron/webhookには個別Secretと署名検証を使い、同じSecretを使い回さない。

## 4. セッション

- セッションCookieはHttpOnly、Secure（本番）、SameSite=Laxを基本とする。
- Auth.jsのCSRF/state/nonce検証を無効化しない。
- セッションはDBに保存し、失効・削除可能にする。
- `AUTH_SECRET` は32文字以上のランダム値とする。

## 5. 環境変数・秘密管理

- `.env` と `.env.local` はGit管理外。
- `.env.example` には動作例だけを置き、実秘密を置かない。
- Zodで起動時に型、形式、最小長、相互条件を検証する。
- `NEXT_PUBLIC_` へ秘密値を置かない。
- 本番はホスティング環境のSecret Managerを使用する。

## 6. ログ

- Pinoのredaction対象にauthorization、cookie、OAuth/内部Secret、API keyを含める。
- raw request bodyを既定で記録しない。
- addressやemailは運用に必要な最小範囲だけ記録する。
- 認証拒否、管理操作、設定変更を監査ログへ残す。
- 例外はstackをサーバーログへ記録するが、HTTPレスポンスへ内部詳細を返さない。

## 7. Web防御

- CSP、`frame-ancestors 'none'`、`object-src 'none'`、MIME sniffing防止を設定する。
- 外部画像は許可hostを固定する。
- Reactの既定escapeを利用し、未検証HTMLを挿入しない。
- URL入力を将来追加する場合はprotocol/host allowlistとDNS再解決対策を行う。
- 状態変更はPOST/PATCH/DELETEに限定し、Origin/CSRFを検証する。

## 8. API防御

- Zodでparams、query、body、env、外部レスポンスを検証する。
- Prismaのparameterized queryを使用し、文字列連結SQLを禁止する。
- rate limitをAPI gatewayまたはFastify pluginでPhase 2までに導入する。
- request size、timeout、pagination上限を設定する。
- `/health` は秘密や接続文字列を返さない。詳細ヘルスは内部認証必須。

## 9. Supply chain / CI

- lockfileをコミットし、CIは `--frozen-lockfile` を使用する。
- CIで `pnpm audit --audit-level high` を実行する。
- GitHub Actionsの権限は `contents: read` を既定とする。
- 外部Actionはmajor tagではなく可能な範囲で固定versionを使う。
- 依存更新時はMigration、Auth、Queueのbreaking changeを重点確認する。

## 10. インシデント時

- OAuth Secretまたは内部Secret漏えい時は即時rotateし、全sessionを失効する。
- 不正アクセスの疑いがあれば監査ログを保全し、外部ジョブと通知を停止する。
- DB整合性またはdata quality異常時はシグナル・メールをfail closedにする。
