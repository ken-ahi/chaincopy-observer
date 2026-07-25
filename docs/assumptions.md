# 仕様上の仮定

最終更新: 2026-07-25

| ID    | 仮定                                                                                    | 理由・影響                                                                    | 再確認時期              |
| ----- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| A-001 | Node.js 24系をローカル・Dockerの基準とする                                              | 現在の開発環境がNode 24であり、現行Next.jsを満たす。CIも同じmajorを使う       | 依存導入時              |
| A-002 | APIはポート3001、Worker healthは3002、Webは3000                                         | ローカル衝突を避ける単純な既定値                                              | Phase 1運用             |
| A-003 | 単一の許可メールは大文字小文字を区別せず比較する                                        | メールドメイン/Google返却値の表記差を吸収する                                 | OAuth検証時             |
| A-004 | Google OAuth以外のproviderはPhase 1で追加しない                                         | 単一所有者要件を最小構成で満たす                                              | 認証要件変更時          |
| A-005 | Phase 1のダッシュボード値は明示的なモック                                               | 実データ・金融計算を先行させない                                              | Phase 2以降             |
| A-006 | APIのブラウザ向けsession共有はPhase 1で不要                                             | Webは表示モック、管理healthは内部Secretで十分                                 | 実API追加時             |
| A-007 | Prisma schemaの全取引モデルは各データ取得Phaseで追加                                    | 外部API payloadと一意キーを検証してから固定する                               | Phase 2・3              |
| A-008 | サンプルジョブは1回の固定IDで冪等性を実証する                                           | 定期実行の本格schedulerはデータ取得Phaseで設計する                            | Phase 2                 |
| A-009 | Docker Composeの認証用Google値はplaceholderでよい                                       | サービス起動確認と実OAuthログインは別。実ログインには利用者のcredentialが必要 | ローカルOAuth設定時     |
| A-010 | E2EはOAuth providerそのものを自動操作せず、未認証redirectとログイン画面を検証する       | Googleの外部UI/credentialへCIを依存させない                                   | 認証test strategy更新時 |
| A-011 | Tailwind CSSは現行major、shadcn/uiは生成コード方式を使う                                | runtime framework依存を小さくする                                             | UI更新時                |
| A-012 | Dockerがない実行環境ではComposeファイルの静的確認までとし、実起動はDocker導入環境で行う | Docker daemonはリポジトリ内から提供できない                                   | Phase 1完了時           |
| A-013 | Phase 1ではSentry SDKを導入せず、構造化ログとsystem alertsをエラー監視の基盤とする      | DSNなしでもローカル完結させる。SPECのエラー監視はPhase 9で本番基盤に合わせる  | Phase 9                 |
| A-014 | ローカルDB名・ユーザー名は `chaincopy`                                                  | 個人ローカル環境の再現性を優先                                                | 運用環境作成時          |
