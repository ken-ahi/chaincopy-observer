# 仕様上の仮定

最終更新: 2026-07-26

| ID    | 仮定                                                                                                        | 理由・影響                                                                    | 再確認時期              |
| ----- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| A-001 | Node.js 24系をローカル・Dockerの基準とする                                                                  | 現在の開発環境がNode 24であり、現行Next.jsを満たす。CIも同じmajorを使う       | 依存導入時              |
| A-002 | APIはポート3001、Worker healthは3002、Webは3000                                                             | ローカル衝突を避ける単純な既定値                                              | Phase 1運用             |
| A-003 | 単一の許可メールは大文字小文字を区別せず比較する                                                            | メールドメイン/Google返却値の表記差を吸収する                                 | OAuth検証時             |
| A-004 | Google OAuth以外のproviderはPhase 1で追加しない                                                             | 単一所有者要件を最小構成で満たす                                              | 認証要件変更時          |
| A-005 | Phase 1のダッシュボード用モック値はPhase 2で撤去済み                                                        | 現在の監視・探索画面はDB/APIの実データだけを表示する                          | 確認済み                |
| A-006 | ブラウザは認証済みWeb BFFだけを利用し、内部Secretを保持しない                                               | Phase 2以降の実APIはserver-side proxyで認証境界を維持する                     | 認証境界変更時          |
| A-007 | Prisma schemaの全取引モデルは各データ取得Phaseで追加                                                        | 外部API payloadと一意キーを検証してから固定する                               | Phase 2・3              |
| A-008 | サンプルジョブは1回の固定IDで冪等性を実証する                                                               | 定期実行の本格schedulerはデータ取得Phaseで設計する                            | Phase 2                 |
| A-009 | Docker Composeの認証用Google値はplaceholderでよい                                                           | サービス起動確認と実OAuthログインは別。実ログインには利用者のcredentialが必要 | ローカルOAuth設定時     |
| A-010 | E2EはOAuth providerそのものを自動操作せず、未認証redirectとログイン画面を検証する                           | Googleの外部UI/credentialへCIを依存させない                                   | 認証test strategy更新時 |
| A-011 | Tailwind CSSは現行major、shadcn/uiは生成コード方式を使う                                                    | runtime framework依存を小さくする                                             | UI更新時                |
| A-012 | Dockerがない実行環境ではComposeファイルの静的確認までとし、実起動はDocker導入環境で行う                     | Docker daemonはリポジトリ内から提供できない                                   | Phase 1完了時           |
| A-013 | Phase 1ではSentry SDKを導入せず、構造化ログとsystem alertsをエラー監視の基盤とする                          | DSNなしでもローカル完結させる。SPECのエラー監視はPhase 9で本番基盤に合わせる  | Phase 9                 |
| A-014 | ローカルDB名・ユーザー名は `chaincopy`                                                                      | 個人ローカル環境の再現性を優先                                                | 運用環境作成時          |
| A-015 | WsTradeではbuyer/sellerとmaker/takerだけを軽量統計化し、long/short関連件数はInfo APIの`dir`取得後に更新する | 公開WsTradeにはポジションのopen/close方向がなく、buy=longと推測しない         | 公式schema変更時        |
| A-016 | buyerとsellerが同一の自己取引はaggressor sideのtaker参加1件として数える                                     | 同一市場イベントで候補取引回数とnotionalを二重加算しない                      | 公式schema変更時        |
| A-017 | 無料公開APIで市場全体gapを完全補完できない場合は品質問題を残して継続する                                    | 欠損を推測せず、有料S3や外部indexerへ自動fallbackしない                       | API追加時               |
