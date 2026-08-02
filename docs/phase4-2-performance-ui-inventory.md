# Phase 4.2.0 Performance UI 現行表示インベントリ

## 1. 調査条件

- 基準ブランチ: `main`
- 基準コミット: `c091ba12d8d39f079f70808d5c3dcbc6563e410a`
- アプリバージョン: `0.3.1`
- 計算バージョン: `performance-v3`
- 調査日: 2026-08-02
- 対象: Phase 4.1.1完了後のアドレス詳細内Performance領域

本書は現行実装の事実と、Phase 4.2.0で採用する表示上の判断を分けて記載する。Phase 4.1.1で確定した`performance-v3`の金融計算を前提とし、Phase 4.2.0では金融計算、Metric値、保存データ、APIレスポンス、Worker、Analytics、DB、再計算処理を変更しない。保存済みの`performance-v2` Runは過去Runとして引き続き共存する。

### 調査した主要ファイル

- `apps/web/components/performance/performance-section.tsx`
- `apps/web/components/performance/performance-overview.tsx`
- `apps/web/components/performance/performance-metric-card.tsx`
- `apps/web/components/performance/calculation-details.tsx`
- `apps/web/components/performance/performance-formatters.ts`
- `apps/web/components/performance/performance-status-badge.tsx`
- `apps/web/components/performance/nav-section.tsx`
- `apps/web/components/performance/nav-summary.tsx`
- `apps/web/components/performance/nav-chart.tsx`
- `apps/web/components/performance/nav-table.tsx`
- `apps/web/components/performance/position-cycle-section.tsx`
- `apps/web/components/performance/position-cycle-filters.tsx`
- `apps/web/components/performance/position-cycle-table.tsx`
- `apps/web/lib/performance-api.ts`
- `apps/api/src/performance-service.ts`
- `apps/worker/src/performance/service.ts`
- `apps/web/components/performance/*.test.ts`
- `tests/e2e/performance.spec.ts`
- `tests/e2e/global-setup.ts`
- `docs/SPEC.md`
- `docs/calculations.md`
- `docs/decisions.md`

### 画面境界

`PerformanceSection`は次の3セクションを常時同じ階層へ合成しているため、すべてを現行Performance画面として棚卸しする。

1. Performance概要
2. 日次NAV
3. Position Cycles

アドレス基本情報、現在ポジション、約定履歴、Sync Cursor、Data Quality Issueなど、`PerformanceSection`外のアドレス詳細要素は対象外とする。

## 2. 分類基準

| 区分       | Phase 4.2.0での意味                                                      |
| ---------- | ------------------------------------------------------------------------ |
| P0         | 判断用サマリーへ常に配置する。ただし値が計算不能なら空カードを描画しない |
| P1         | 状態または問題がある場合だけ判断用サマリーへ表示する                     |
| P2         | 「詳細指標」などを利用者が開いた場合だけ表示する                         |
| P3         | Performance画面から削除する。別画面の同等機能は対象外                    |
| DIAGNOSTIC | 「計算の詳細」を開いた場合だけ表示する                                   |

「判断への寄与」は次の4項目で表す。

- J1: 利益を出しているか
- J2: 大きな損失リスクがあるか
- J3: 取引成績に再現性がありそうか
- J4: 結果をどの程度信頼できるか
- なし: 4項目のいずれにも直接寄与しない

## 3. データフローの事実

| 表示領域       | データソース                                                                                              | 現行条件                                           |
| -------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 概要・Metric   | `GET /api/addresses/:address/performance` の `latestRun`、`metrics`、`availability`、`calculationDetails` | 最新Runが`SUCCEEDED`の場合だけMetricグループを表示 |
| 日次NAV        | 同Overviewの`navSummary`と、`GET .../performance/nav?runId=...`                                           | `latestSuccessfulRun`が存在する場合に取得          |
| Position Cycle | `GET .../performance/cycles?runId=...`                                                                    | `latestSuccessfulRun`が存在する場合に取得          |
| 再計算         | `POST .../performance/calculate`または`recalculate`                                                       | `PENDING`、`RUNNING`、送信中、楽観的queue待ち以外  |

APIは最新Runと最新成功Runを別々に返す。概要Metricは最新成功Runから取得されるが、現行UIは`latestRun.status !== SUCCEEDED`のときMetricを表示しない。一方、日次NAVとPosition Cycleは`latestSuccessfulRun`があれば取得する。

APIレスポンスの各値が表すRunは次のとおりである。

| 値                    | 表す対象                                                                   |
| --------------------- | -------------------------------------------------------------------------- |
| `latestRun`           | 最新の計算試行。`PENDING`、`RUNNING`、`FAILED`、`INSUFFICIENT_DATA`も含む  |
| `latestSuccessfulRun` | 最新の正常終了Run。`completedAt`と正常結果由来の`warningCodes`を取得できる |
| `metrics`             | `latestSuccessfulRun`に保存されたMetric。Metricごとの`warningCodes`を含む  |
| `availability`        | `latestSuccessfulRun`のMetricとRun情報から導出したLane可用性               |
| `calculationDetails`  | `latestSuccessfulRun`の入力・保存済みPosition Cycleから導出した診断値      |

したがって、最新Runが正常でなくても`latestSuccessfulRun`が存在すれば、API変更なしで前回正常結果を表示できる。画面は最新の計算試行状態と、表示中の正常結果のRunを明示的に分離する必要がある。

`calculationDetails.trustedClosedCycleCount`は必須の整数であり、最新成功Runがない空レスポンスでも`0`となる。`0`の存在だけでは正常なTrade評価結果と判断できないため、主要指標「評価対象取引数」は`latestSuccessfulRun`、Trade Availability、Trade Metricの存在と組み合わせて表示可否を決める必要がある。

暗黙のRun選択は`performance-v3`を優先し、v3が存在しない場合に限って`performance-v2`へfallbackする。`performance-v1`、未知Version、将来Versionは暗黙に選択しない。`runId`が明示された取得では、そのRunがWalletに属することなど既存の安全条件を満たす限り、Versionにかかわらず指定Runを尊重する。

表示中の正常結果に関するWarning入力は、`latestSuccessfulRun.warningCodes`、Metricの`warningCodes`、`availability.reasons`、`calculationDetails`の4系統である。最新試行のWarning入力は`latestRun.warningCodes`だけであり、入力と診断情報では元Run別に保持する。通常表示を作る段階だけ、次の規則で画面全体へ統合する。

- Codeをユーザー向け意味キーへ正規化し、通常画面全体を1つの重複排除範囲とする。
- 同じ意味キーが両Runにある場合は`latestRun`を優先し、`latestSuccessfulRun`側の同一意味キーを通常表示から除外する。
- 最大3件はRun別ではなく、最新試行由来を先、表示中正常結果由来を後とした結合結果全体へ適用する。
- 4件以上の残件は「ほかN件の注意事項」で日本語表示する。Nは重複排除と表示先振り分け後に先頭3件へ入らなかった意味キー数とし、展開後も「最新の計算試行」「表示中の正常結果」の区分を維持する。
- 生Warning Codeは重複削除せず、元Run別に「計算の詳細」だけへ保持する。
- 特定Laneだけの不足理由は第一階層の注意候補から除き、初期状態で閉じた「詳細指標」内だけに表示する。

`performance-v3`のMax Drawdownはraw Daily NAVではなく、TWRと同じReturn Periodから構築するCash Flow調整済みWealth Indexに由来する。外部Cash FlowはReturn Period生成時に一度だけ除外し、Max Drawdown側では再調整しない。Daily NAVはraw Portfolio Snapshot由来の表示・監査用系列として維持されるため、`maxDrawdown` Metricと日次NAVは異なる系列を利用する。Cash Flowがない履歴ではv2とv3のMax Drawdownは同値だが、Cash Flowがある履歴では値が変わり得る。

## 4. Performance概要の現行表示

| ID   | 現行表示名・要素            | データソース                                  | 表示条件       | 判断への寄与 | 重複・問題                                             | 優先度     | Phase 4.2.0の判断                                           |
| ---- | --------------------------- | --------------------------------------------- | -------------- | ------------ | ------------------------------------------------------ | ---------- | ----------------------------------------------------------- |
| O-01 | `Saved analytics`           | 固定文言                                      | 常時           | なし         | 技術的な英語見出し                                     | P3         | 削除                                                        |
| O-02 | `Performance`               | 固定文言                                      | 常時           | 間接         | 日本語中心の画面と不統一                               | P0         | `運用実績`へ変更                                            |
| O-03 | 保存済み結果である旨の説明  | 固定文言                                      | 常時           | J4           | 「画面上で再計算しない」と再計算ボタンが並び意味が曖昧 | P1         | データ信頼性の短文へ置換                                    |
| O-04 | 読み込み中                  | client state                                  | `loading`      | J4           | なし                                                   | P1         | 維持し、`role=status`                                       |
| O-05 | Overview取得エラー          | client state                                  | `error`        | J4           | なし                                                   | P1         | 維持し、`role=alert`                                        |
| O-06 | 未計算案内                  | `latestRun === null`                          | 未計算         | J4           | 英語ボタン名を案内内で使用                             | P1         | 日本語化して維持                                            |
| O-07 | 計算情報カード              | `latestRun`                                   | Runあり        | J4           | 診断値6項目を初期表示                                  | P3         | カード構造を廃止し、状態と信頼性文へ再編                    |
| O-08 | 計算期間                    | `calculationFrom/to`                          | Runあり        | J4           | 計算の詳細にも開始・終了期間あり                       | P2         | 詳細指標の評価期間へ移動                                    |
| O-09 | Calculation Version         | `calculationVersion`                          | Runあり        | なし         | Calculation Detailsと重複                              | DIAGNOSTIC | 初期表示から除外                                            |
| O-10 | Precision                   | `run.precision`                               | Runあり        | J4           | Metricカード、NAV行、Calculation Detailsと重複         | DIAGNOSTIC | 初期表示から除外                                            |
| O-11 | History Completeness        | `run.historyCompleteness`                     | Runあり        | J4           | NAV行、Calculation Details、Warning文と重複            | DIAGNOSTIC | コードは診断へ。通常画面は日本語の信頼性文だけ              |
| O-12 | Warning件数                 | `run.warningCount`                            | Runあり        | J4           | Warning Codes、各カードWarning、Lane理由と重複         | DIAGNOSTIC | 生件数を初期表示しない                                      |
| O-13 | 最終更新日時                | completed/started/requested                   | Runあり        | J4           | Calculation Detailsの各日時と一部重複                  | P2         | 詳細指標上部へ移動                                          |
| O-14 | Run状態Badge                | `latestRun.status`                            | Runあり        | J4           | Calculation Detailsと重複。内部コード併記              | P0         | 最新計算試行の日本語状態だけを一度表示                      |
| O-15 | Run Notice                  | status、precision、completeness、warningCodes | 状態に応じる   | J4           | Lane理由・Warning・Badgeと意味が重複                   | P1         | 意味キーへ正規化し、通常表示の正本1箇所へ統合               |
| O-16 | 再計算ボタン                | latestRun、client action state                | Overview取得後 | J4           | 英語混在                                               | P0         | `実績を計算` / `実績を再計算`へ変更                         |
| O-17 | 送信中・計算待ち・計算中    | client state、run status                      | action中       | J4           | `PENDING`コードが別テキストにも出る                    | P1         | ボタン文言と1つの状態通知に集約                             |
| O-18 | actionエラー                | client state                                  | POST失敗       | J4           | なし                                                   | P1         | 維持し、`role=alert`                                        |
| O-19 | Metricグループ名4件         | 固定定義                                      | `SUCCEEDED`    | J1/J2/J3     | 第一階層と第二階層が未分離                             | P2         | 主要6件を抜き、残りを詳細グループへ再編                     |
| O-20 | Availability Badge          | `availability.*.status`                       | 各グループ     | J4           | 同じ`計算済み`を繰り返す                               | P1         | 問題があるグループだけ日本語補足                            |
| O-21 | Availability理由            | `availability.*.reasons`                      | 理由あり       | J4           | Run Notice、Warning Codesと重複                        | P1         | 意味単位でWarning集約へ統合。詳細ではグループ不足理由に使用 |
| O-22 | 欠損Metricの`—`カード       | `metrics[key] === undefined`                  | `SUCCEEDED`    | なし         | 最大20枚の空カードを生成し得る                         | P3         | 描画しない。グループ単位の不足理由へ置換                    |
| O-23 | `参考値`Badge               | `metric.status === REFERENCE_ONLY`            | 該当Metricあり | J4           | 精度・Warningと近い意味                                | P1         | 詳細Metricに限り、日本語補足として維持                      |
| O-24 | MetricごとのPrecisionコード | `metric.precision`                            | Metricあり     | J4           | Run、NAV、診断と重複                                   | DIAGNOSTIC | Metricカードから削除                                        |
| O-25 | MetricごとのWarning Code    | `metric.warningCodes`                         | Warningあり    | J4           | 同じCodeを多数カードへ反復                             | DIAGNOSTIC | Metricカードから削除し、集約・診断へ移動                    |

## 5. 現行Metric 20件と主要指標候補

| Metric Key                | 現行表示名                            | Lane / データソース  | 可用性の事実                     | 判断への寄与 | 現行の重複・課題                 | 優先度 | Phase 4.2.0表示名・配置                   |
| ------------------------- | ------------------------------------- | -------------------- | -------------------------------- | ------------ | -------------------------------- | ------ | ----------------------------------------- |
| `cumulativeReturn`        | 累積収益率                            | Return / `metrics`   | TWRと同じ値を保存する現行実装    | J1           | TWRと実質重複                    | P0     | `累積収益率`                              |
| `annualizedReturn`        | 年率換算収益率                        | Return / `metrics`   | 30日未満は不可。参考値になり得る | J1           | 短期履歴では空カード             | P2     | `年率換算収益率`                          |
| `twr`                     | TWR                                   | Return / `metrics`   | 適格Return期間で可               | J1/J4        | `cumulativeReturn`と現行値が同じ | P2     | `入出金の影響を除いた収益率（TWR）`       |
| `maxDrawdown`             | 最大ドローダウン                      | Return / `metrics`   | v3は適格Return Periodで可        | J2           | 用語が初心者向けでない           | P0     | `最大下落率`                              |
| `volatility`              | ボラティリティ                        | Return / `metrics`   | 30点以上の日次収益率が必要       | J2           | 短期履歴では空カード             | P2     | `値動きの大きさ（ボラティリティ）`        |
| `sharpeRatio`             | Sharpe Ratio                          | Return / `metrics`   | 30点以上かつ分散非0が必要        | J1/J2        | 英語・専門用語                   | P2     | `リスクに対する収益（Sharpe Ratio）`      |
| `sortinoRatio`            | Sortino Ratio                         | Return / `metrics`   | 30点以上かつ下方偏差非0が必要    | J1/J2        | 英語・専門用語                   | P2     | `下落リスクに対する収益（Sortino Ratio）` |
| `calmarRatio`             | Calmar Ratio                          | Return / `metrics`   | 180日以上かつ最大下落率非0が必要 | J1/J2        | 長期履歴が必要                   | P2     | `最大下落に対する収益（Calmar Ratio）`    |
| `profitFactor`            | Profit Factor                         | Trade / `metrics`    | 完了Cycleがあり総損失非0で可     | J1/J3        | 英語                             | P0     | `利益と損失の効率`                        |
| `winRate`                 | 勝率                                  | Trade / `metrics`    | 完了Cycleがあれば可              | J1/J3        | 母数がカード上で離れている       | P0     | `勝率`                                    |
| `averageWin`              | 平均利益                              | Trade / `metrics`    | 勝ちCycleがある場合だけ可        | J1/J3        | 片方だけ欠けると空カード         | P2     | `平均利益`                                |
| `averageLoss`             | 平均損失                              | Trade / `metrics`    | 負けCycleがある場合だけ可        | J2/J3        | 片方だけ欠けると空カード         | P2     | `平均損失`                                |
| `maxLosingStreak`         | 最大連敗                              | Trade / `metrics`    | 完了Cycle順序が信頼できれば可    | J2/J3        | 通常表示の優先度は6指標より低い  | P2     | `最大連敗`                                |
| `topTradeContribution`    | 単一取引利益依存度                    | Trade / `metrics`    | 正利益Cycleがある場合だけ可      | J3           | 名称が長く意味が難しい           | P0     | `利益の一発依存度`                        |
| `medianLeverage`          | 中央レバレッジ                        | Exposure / `metrics` | 有効snapshotで可                 | J2           | 4つのレバレッジ指標が並ぶ        | P2     | `通常時のレバレッジ（中央値）`            |
| `percentile95Leverage`    | 95パーセンタイルレバレッジ            | Exposure / `metrics` | snapshot分布で可                 | J2           | 専門用語                         | P2     | `高い局面のレバレッジ（95%点）`           |
| `maxLeverage`             | 最大レバレッジ                        | Exposure / `metrics` | 有効snapshotで可                 | J2           | 危険閾値が現行仕様にない         | P2     | `最大レバレッジ`                          |
| `averageLeverage`         | 平均レバレッジ                        | Exposure / `metrics` | 有効snapshotで可                 | J2           | 中央値などと近い                 | P2     | `平均レバレッジ`                          |
| `largestCoinShare`        | 最大銘柄比率                          | Exposure / `metrics` | position snapshotで可            | J2           | 危険閾値が現行仕様にない         | P2     | `最大銘柄比率`                            |
| `concentrationIndex`      | 集中度                                | Exposure / `metrics` | position snapshotで可            | J2           | 指標の意味が不明瞭               | P2     | `銘柄集中度（HHI）`                       |
| `trustedClosedCycleCount` | 信頼済み完了Cycle件数（現行は診断欄） | `calculationDetails` | APIに既存。Metricではない        | J3/J4        | 勝率などの母数なのに診断欄にある | P0     | `評価対象取引数`として主要指標へ移動      |

### 主要指標に関する設計判断

候補6件をそのまま採用する。`trustedClosedCycleCount`のみ保存Metricではないが、既存Overview APIの`calculationDetails.trustedClosedCycleCount`で表示でき、API変更は不要である。

ただし、`trustedClosedCycleCount`は空状態でも`0`を返す。主要指標として表示するのは、`latestSuccessfulRun`が存在し、Trade Laneが`UNAVAILABLE`ではなく、件数が1件以上で、Trade系の正常なMetricが1件以上存在する場合だけとする。条件を満たさない`0`は正常結果として表示しない。

`maxDrawdown`は、`UNKNOWN_CASH_FLOW`、`MISSING_CASH_FLOW_BOUNDARY_NAV`、`NON_POSITIVE_NAV`、Return期間不足、またはReturn Metric未保存のとき通常画面へ`0`や`—`のカードとして表示しない。Returnだけに影響する空カードの理由は第一階層へ出さず、初期状態で閉じた「詳細指標」でReturn Laneの不足理由を意味単位で1回だけ表示する。全体または複数Laneへ影響する共通問題を第一階層へ表示した場合は、詳細指標へ理由文や参照文を再掲しない。内部Warning Codeは「計算の詳細」にだけ残す。

`maxLeverage`と`largestCoinShare`は大きな損失リスクに寄与するが、次の理由でP0/P1へ昇格しない。

1. 現行仕様に重大と判断する閾値がない。
2. 閾値をPhase 4.2.0で新設すると、新しい推奨判定に近づく。
3. 主要6件の最大数を超える。
4. 最大下落率が実績ベースの損失リスクをすでに示す。

値は削除せず詳細指標に置く。既存WarningがExposureだけの問題を示す場合は「詳細指標」内のExposure Lane理由へ日本語で要約し、第一階層の注意欄へは出さない。全体または複数Laneへ影響する場合だけ第一階層の候補にできる。

## 6. Calculation Detailsの現行表示

現行は常時展開されたカードである。Phase 4.2.0では第三階層「計算の詳細」へ移し、初期状態を閉じる。最新Runが正常でない一方で過去成功Runが存在する場合は、「最新の計算試行」と「表示中の正常結果」を別グループにし、値の取得元を混在させない。

| 現行表示                          | データソース              | 判断への寄与 | 重複                        | 優先度     | 判断                                         |
| --------------------------------- | ------------------------- | ------------ | --------------------------- | ---------- | -------------------------------------------- |
| Calculation Details               | 固定文言                  | なし         | 英語見出し                  | P2         | `計算の詳細`へ日本語化し、開閉操作にする     |
| Run ID                            | `run.runId`               | なし         | なし                        | DIAGNOSTIC | 維持                                         |
| Status                            | `run.status`              | J4           | サマリーと重複              | DIAGNOSTIC | コード値を維持                               |
| Input Fingerprint                 | `inputFingerprintShort`   | なし         | なし                        | DIAGNOSTIC | 維持。必要ならAPIにある完全値も利用可        |
| 計算要求・開始・完了日時          | Run各日時                 | J4           | 最終更新と重複              | DIAGNOSTIC | 維持                                         |
| 計算開始・終了期間                | Run期間                   | J4           | 計算期間と重複              | DIAGNOSTIC | 維持                                         |
| Calculation Version               | `calculationVersion`      | なし         | サマリーと重複              | DIAGNOSTIC | 維持                                         |
| Warning Codes                     | `warningCodes`            | J4           | 各Metric、概要Warningと重複 | DIAGNOSTIC | 生コードの確認場所として維持                 |
| Error Code / Message              | Run error                 | J4           | FAILED Noticeと重複         | DIAGNOSTIC | 安全化処理を維持                             |
| Precision                         | `run.precision`           | J4           | サマリー、Metric、NAVと重複 | DIAGNOSTIC | 維持                                         |
| History Completeness              | `run.historyCompleteness` | J4           | サマリー、NAVと重複         | DIAGNOSTIC | 維持                                         |
| 利用可能・不能Metricグループ      | `availability`            | J4           | 各グループBadgeと重複       | DIAGNOSTIC | 内部確認用に維持                             |
| Trade / Return / Exposure対象期間 | `availability.*.from/to`  | J4           | Run期間と一部重複           | DIAGNOSTIC | Lane差の確認用に維持                         |
| 除外Fill件数                      | `excludedFillCount`       | J4           | Warning説明と意味が重複     | DIAGNOSTIC | 維持                                         |
| 除外Funding件数                   | `excludedFundingCount`    | J4           | Warning説明と意味が重複     | DIAGNOSTIC | 維持                                         |
| 信頼済み完了Cycle件数             | `trustedClosedCycleCount` | J3/J4        | 主要指標候補                | P0         | 主要指標へ移し、診断にも値の出所として残せる |
| UNKNOWN_CASH_FLOW件数             | `unknownCashFlowCount`    | J4           | Warning説明と意味が重複     | DIAGNOSTIC | 維持                                         |
| NAV Gap件数                       | `navGapCount`             | J4           | Warning説明と意味が重複     | DIAGNOSTIC | 維持                                         |
| 取引履歴Prefix                    | `tradePrefixes`           | J4           | Warning説明と意味が重複     | DIAGNOSTIC | 維持                                         |

APIにはMetricごとの`metricKey`、`metricVersion`、計算期間、status、precision、warningCodesがあるが、現行Calculation DetailsはMetric Versionを表示していない。Phase 4.2.0ではAPIを変えず、「計算の詳細」を開いた場合に追加の入れ子折りたたみなしで確認できる設計とする。

## 7. 日次NAVの現行表示

現行では最新成功RunがあるとPerformance概要の直後に常時表示される。J1/J2の根拠確認には役立つが、短時間の判断に必要な第一階層ではないため、Phase 4.2.0では第二階層「収益詳細」内へ移す。

| 現行要素                                                                     | データソース             | 表示条件 | 判断への寄与 | 重複・問題                              | 優先度     | 判断                                       |
| ---------------------------------------------------------------------------- | ------------------------ | -------- | ------------ | --------------------------------------- | ---------- | ------------------------------------------ |
| 日次NAV見出し・説明                                                          | 固定文言                 | 常時     | J1/J2        | 概要より大きな領域を占有                | P2         | 収益詳細へ移動                             |
| 読込・空・取得失敗状態                                                       | client state             | 状態別   | J4           | なし                                    | P2         | 詳細を開いた場合に維持                     |
| 日次NAV概要                                                                  | `navSummary`または取得行 | 行あり   | J1/J2/J4     | 主要指標と一部意味が近い                | P2         | 詳細へ維持                                 |
| 開始日・終了日                                                               | summary                  | 行あり   | J4           | 計算期間と近い                          | P2         | 維持                                       |
| 最初・最後・最小・最大NAV                                                    | raw Portfolio Snapshot   | 行あり   | J1/J2        | 表示・監査用。v3最大下落率とは別系列    | P2         | 維持                                       |
| 表示件数                                                                     | summary                  | 行あり   | J4           | なし                                    | P2         | 維持                                       |
| 日次NAVチャート                                                              | nav rows                 | 行あり   | J1/J2        | 現存機能。Phase 4.2.0で新規追加はしない | P2         | 詳細へ移動して維持                         |
| NAV一覧の日付・NAV・現金・含み損益・実現損益・Funding・手数料・外部Cash Flow | nav rows                 | 行あり   | J1/J2/J4     | 横幅78rem、モバイルで横スクロール       | P2         | 詳細へ維持                                 |
| NAV一覧のPrecision・History Completeness                                     | nav rows                 | 行あり   | J4           | 各行で同じBadgeを反復                   | DIAGNOSTIC | 通常の詳細表から外し、「計算の詳細」へ移動 |
| さらに表示                                                                   | `nextCursor`             | 次頁あり | J4           | なし                                    | P2         | 維持                                       |
| 追加取得エラー                                                               | client state             | エラー時 | J4           | なし                                    | P2         | 維持、`role=alert`                         |

## 8. Position Cycleの現行表示

現行では最新成功Runがあると常時表示される。取引成績の根拠確認には役立つが、第一階層には過密であるため、Phase 4.2.0では第二階層「取引詳細」内へ移す。

| 現行要素                                           | データソース                 | 表示条件 | 判断への寄与 | 重複・問題            | 優先度 | 判断                                  |
| -------------------------------------------------- | ---------------------------- | -------- | ------------ | --------------------- | ------ | ------------------------------------- |
| Position Cycles見出し・説明                        | 固定文言                     | 常時     | J3           | 英語                  | P2     | `取引詳細` / `取引サイクル`へ日本語化 |
| 読込・空・取得失敗状態                             | client state                 | 状態別   | J4           | なし                  | P2     | 詳細を開いた場合に維持                |
| Coin、方向、状態、損益フィルター                   | 取得済みCycle / client state | 行あり   | J3           | `All`、`Long`等が英語 | P2     | 動作を維持し、表示語を日本語化        |
| 銘柄、方向、開始・終了日時                         | cycle rows                   | 行あり   | J3/J4        | なし                  | P2     | 維持                                  |
| 平均Entry/Exit、Entry/Exit数量                     | cycle rows                   | 行あり   | J3/J4        | 英語混在              | P2     | 日本語中心に変更して維持              |
| Gross Realized PnL、Fee、Funding、Net Realized PnL | cycle rows                   | 行あり   | J1/J3        | 英語・横幅112rem      | P2     | 日本語中心に変更して維持              |
| Fill数、状態                                       | cycle rows                   | 行あり   | J3/J4        | 英語状態              | P2     | 維持し日本語化                        |
| さらに表示                                         | `nextCursor`                 | 次頁あり | J4           | なし                  | P2     | 維持                                  |
| 追加取得エラー                                     | client state                 | エラー時 | J4           | なし                  | P2     | 維持、`role=alert`                    |

`PositionCycleDto.inputFingerprint`はAPIに存在するが現行表には表示されない。通常の取引詳細には追加せず、必要なら「計算の詳細」だけで扱う。

## 9. 重複の集約

| 同じ意味の情報       | 現行の表示箇所                                                        | Phase 4.2.0の正本表示                                                                     |
| -------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Run状態              | 計算情報、Calculation Details、action状態                             | 第一階層に最新計算試行を日本語で1回。生コードは診断                                       |
| Precision            | 計算情報、各Metric、Calculation Details、各NAV行                      | 通常画面から除外。診断に集約                                                              |
| History Completeness | 計算情報、Run Notice、Calculation Details、各NAV行                    | 第一階層は日本語の信頼性文。生コードは診断                                                |
| Warning              | Warning件数、Run Notice、Lane理由、各Metric Code、Calculation Details | 両Runを画面全体で意味キー統合し、重複時は最新試行を優先。上限3件は全体、生CodeはRun別診断 |
| 計算期間             | 計算情報、Calculation Details、Lane期間、NAV概要                      | 診断の正本期間1件と、異なるLane/Metric期間だけ表示                                        |
| 取引履歴除外         | Run Notice、Lane理由、Warning Code、除外件数、Prefix                  | 複数Lane以上なら第一階層、Trade固有なら詳細指標に日本語で1回。件数・銘柄・Codeは診断      |
| Return値             | `twr`と`cumulativeReturn`                                             | 累積収益率をP0、TWRをP2                                                                   |

## 10. 現行画面の主な問題（事実）

1. `SUCCEEDED`時に20種類のMetricカード枠を描画し、値がないMetricも`—`で表示する。
2. 主要指標と補助指標の視覚的優先順位がほぼ同じである。
3. Precision、History Completeness、Warningが概要、Metric、NAV、診断で繰り返される。
4. `Run ID`、`Input Fingerprint`、Version、内部Codeが常時表示される。
5. `Performance`、`Saved analytics`、`Profit Factor`など、内部または英語用語が通常表示に残る。
6. 日次NAVとPosition Cycleが常時展開され、判断用サマリーと根拠確認の境界がない。
7. Availabilityが各グループで反復され、問題のない`計算済み`までBadge表示する。
8. Warning件数とWarning Codeは示すが、利用者が理解できる意味単位への一貫した集約がない。
9. 最大5列のMetricグリッドと幅広い明細表が、狭い画面で情報密度を高める。
10. 4つの判断目的に直接寄与しない技術文字列が、判断に必要な値より先に表示される。

## 11. 維持・移動・削除の集計

- P0: 最新Run状態、再計算操作、表示可能な主要指標最大6件
- P1: 前回正常結果表示、データ信頼性文、画面全体で意味単位の注意点最大3件、各状態メッセージ、詳細指標内のLane固有不足説明
- P2: 補助Metric、日次NAV、Position Cycle、評価期間、最終更新
- P3: `Saved analytics`、空Metricカード、正常時のAvailability Badge、常時表示の技術ラベル
- DIAGNOSTIC: Run ID、Fingerprint、Version、Precision、生Warning Code、生Error、除外件数、Lane期間、Metric metadata

削除は表示要素に限る。Metric、日次NAV、Position Cycle、診断値の保存やAPI返却は削除しない。
