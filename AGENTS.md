# AGENTS.md

## プロジェクト概要

本プロジェクトは、HyperliquidおよびSui/Cetus上の公開取引データを分析し、優秀なウォレットアドレスを評価・監視する個人専用Webアプリケーションである。

詳細仕様は `docs/SPEC.md` を正とする。

## 最重要ルール

* 実際の売買注文は実装しない。
* ウォレット署名機能は実装しない。
* 秘密鍵やシードフレーズを取得・保存しない。
* デモトレードとメール通知だけを実装する。
* AIに収益率やポジション損益を計算させない。
* 金融計算は決定論的なコードで行う。
* 金額計算にはJavaScriptのnumberを使用せず、Decimalを使用する。
* 外部APIの欠損、重複、遅延、順序逆転を考慮する。
* 同一イベントを再処理しても、通知やデモ注文が重複しないようにする。
* TypeScript strictを有効にする。
* `any`型を原則使用しない。
* エラーを握りつぶさない。
* テストを無効化して完了扱いにしない。
* APIキーをフロントエンドへ公開しない。
* 仕様を変更する場合は、理由を `docs/decisions.md` に記録する。

## 開発方式

機能を一度にすべて実装せず、以下の順番で進める。

1. 設計
2. 開発基盤
3. Hyperliquid連携
4. Sui/Cetus連携
5. 分析エンジン
6. シグナル
7. デモトレード
8. メール通知
9. 自動アドレス探索
10. 本番運用強化

各フェーズ終了時に以下を実行する。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

失敗した場合は、原因を修正してから完了報告する。

## AI開発ワークフロー

ChatGPT / Codex / GitHub Issue / Pull Request を使う作業では `docs/ai-development-workflow.md` を作業手順の正とする。

GitHub Issue が作業契約として与えられた場合は、実装開始前に Issue の `Context / SSoT`、`In scope`、`Out of scope`、`Acceptance criteria`、`Safety / prohibited operations` を確認する。

Issue と既存の正式仕様が矛盾する場合は、既存仕様を推測で変更せず作業を BLOCKED として報告する。

Owner の明示承認なしに以下を実行してはならない。

* `main` への merge または直接 push
* 実DBの DELETE / UPDATE / TRUNCATE / `VACUUM FULL`
* 大規模 CREATE INDEX / REINDEX
* migration の実DB適用
* Redis queue / key の削除
* Docker volume の削除
* production secret の変更
* 実注文、署名、資金移動に関する実装

feature branch 上での実装、テスト、commit、push、PR作成、CI failure修正は Issue の範囲内で実行してよい。

## 作業開始時

作業を始める前に、以下を簡潔に提示する。

* 今回の作業範囲
* 作成・変更する主要ファイル
* 採用する主要ライブラリ
* 技術的な仮定
* 完了条件

## 作業終了時

以下を報告する。

* 実装内容
* 変更した主要ファイル
* 実行したテスト
* テスト結果
* 残課題
* 次に実施すべきフェーズ

AI開発Issueの場合は追加で以下を報告する。

* 設計判断
* 未実施検証と理由
* destructive operation の有無
* commit / push / PR の状態

## Git運用

* 1フェーズを1つの大きな変更単位とする。
* 関係のない変更を混ぜない。
* 自動生成物を不必要にコミットしない。
* `.env`をコミットしない。
* `.env.example`を管理する。
* READMEと実装内容を一致させる。
