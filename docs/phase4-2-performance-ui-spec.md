# Phase 4.2.0 Performance画面 情報設計・表示簡素化仕様

## 1. 文書の位置付け

本書は、ChainCopy Observer Phase 4.2.0におけるPerformance画面の表示仕様を定義する。`docs/SPEC.md`、`docs/calculations.md`、ADR-028、ADR-030を上位仕様とし、特にMax Drawdownの計算契約はADR-030を正本とする。矛盾する場合は上位仕様を優先する。

対象基準は次のとおりである。

- 基準コミット: `c091ba12d8d39f079f70808d5c3dcbc6563e410a`
- アプリバージョン: `0.3.1`
- 計算バージョン: `performance-v3`
- 対象画面: Phase 4.1.1完了後のアドレス詳細内Performance領域

本Phaseは、Phase 4.1.1で確定した`performance-v3`契約を前提に表示だけを再設計する。金融計算、Metric値、Position Cycle、Daily NAV、保存データ、input fingerprint、Run状態、Lane availability判定、Warning生成、APIレスポンス、再計算処理は変更しない。

## 2. 画面の目的

通常表示で利用者が判断できることを、次の4点に限定する。

1. このウォレットは利益を出しているか。
2. 大きな損失リスクがあるか。
3. 取引成績に再現性がありそうか。
4. 表示された結果をどの程度信頼できるか。

いずれにも直接寄与しない項目は初期表示しない。詳細な根拠と診断値は削除せず、利用者が明示的に開いた場合だけ表示する。

## 3. 非目標

Phase 4.2.0では次を行わない。

- 総合スコア、Confidence Score、推奨判定、戦略分類、ランキング
- AI説明、AIによる計算または判断
- 新しいチャート
- 新しい金融Metric、計算式、閾値、危険度判定
- APIレスポンスの追加・削除・変更
- Worker、Analytics、Prisma、Migration、DB、設定の変更
- 外部ライブラリの追加
- Phase 5機能

既存の日次NAVチャートは新規機能ではないため削除しないが、初期表示から第二階層へ移す。

## 4. 情報階層

### 4.1 第一階層: 判断用サマリー

ページ表示時に見えるのは次の項目だけとする。

1. 見出し「運用実績」
2. 最新計算試行の状態を示す日本語表示
3. 必要な場合だけ「前回の正常な計算結果を表示しています」と正常結果の計算日時
4. データ信頼性を説明する1～2文
5. 表示可能な主要指標（最大6件）
6. 実績の計算・再計算ボタン
7. 状況に応じた注意点（ユーザー向け意味単位で最大3件）
8. 4件以上の場合の「ほかN件の注意事項」button
9. 全体または複数Laneへ影響する場合だけ、その計算不能説明
10. 「詳細指標」と「計算の詳細」の開閉操作

`Saved analytics`、Version、Precision、History Completenessコード、Warning件数、Run ID、Fingerprint、生Codeは表示しない。

第一階層へ表示できる問題は、最新計算が失敗または実行中、前回正常結果を表示中、履歴全体の重大な欠損、表示可能な主要指標が0件、複数Laneが同じ原因で利用不能など、全体または複数Laneへ影響するものに限る。ReturnだけのCash Flow境界NAV不足または評価期間不足、Tradeだけの完了取引不足、ExposureだけのSnapshot不足など、特定Laneだけの不足理由は第一階層へ表示しない。

### 4.2 第二階層: 詳細指標

見出しは「詳細指標」とし、初期状態を閉じる。次のグループを含む。

1. 収益詳細
2. 取引詳細
3. リスク調整指標
4. レバレッジ
5. 銘柄集中度
6. 日次評価額（既存の日次NAV概要・チャート・一覧）
7. 取引サイクル（既存のPosition Cycleフィルター・一覧）

主要6件と同じ値を詳細領域へ再掲しない。利用不能なMetricは個別の`—`カードにせず、グループ単位の不足理由で示す。

「詳細指標」を一度開けば、低優先Metric、計算不能Metric名、Lane単位の不足理由、日次NAVの概要、Position Cycleの概要を確認できる。内部にAccordionや追加の開閉領域を設けず、計算不能Metric名、日次NAV、Position Cycleへ到達するための二段階目の開閉操作を要求しない。既存のページング、フィルター、表示件数制限は維持してよい。

特定Laneだけの不足理由は、この初期状態で閉じた「詳細指標」内だけに表示する。全体または複数Laneへ影響する意味を第一階層へ表示した場合は、「詳細指標」へ同じ文章や参照表現を再掲せず、その理由表示自体を抑止する。

### 4.3 第三階層: 計算の詳細

見出しは「計算の詳細」とし、初期状態を閉じる。開いた場合だけ内部Codeと追跡情報を表示する。最新Runが正常でない一方で過去成功Runを表示している場合は、「最新の計算試行」と「表示中の正常結果」を別グループにする。

詳細指標と計算の詳細は独立して開閉できる。片方を開いても、もう片方を自動的に開かない。

## 5. 状態表示

### 5.1 Run状態

| 内部値              | 通常画面               | 最新成功Runなし                                                           | 最新成功Runあり                                                                                    |
| ------------------- | ---------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `PENDING`           | 計算待ち               | 状態通知だけを`role=status`で表示し、主要指標を表示せず、計算操作を無効化 | 最新状態と前回正常結果の案内・日時・主要指標を表示し、計算操作を無効化                             |
| `RUNNING`           | 計算中                 | 状態通知だけを`role=status`で表示し、主要指標を表示せず、計算操作を無効化 | 最新状態と前回正常結果の案内・日時・主要指標を表示し、計算操作を無効化                             |
| `SUCCEEDED`         | 計算完了               | API契約上は発生しない。矛盾したresponseでは主要指標を捏造しない           | `latestRun`と`latestSuccessfulRun`が同じ正常結果として主要指標を通常表示し、前回結果案内は出さない |
| `INSUFFICIENT_DATA` | データ不足             | 不足案内と再計算操作を表示し、主要指標を表示しない                        | 最新状態と前回正常結果の案内・日時・主要指標を表示し、最新試行の不足案内と再計算操作を独立表示     |
| `FAILED`            | 計算できませんでした   | 利用者向けエラー文と再計算操作を表示し、主要指標を表示しない              | 最新状態と前回正常結果の案内・日時・主要指標を表示し、最新試行のエラーと再計算操作を独立表示       |
| Runなし             | まだ計算されていません | 自動計算の案内と「実績を計算」button                                      | 発生しない組合せとして扱う                                                                         |

通常画面に`PENDING`、`RUNNING`、`SUCCEEDED`、`FAILED`などの内部値を併記しない。「計算の詳細」では生値を確認できる。

`latestRun.status !== SUCCEEDED`かつ`latestSuccessfulRun !== null`の場合は、`metrics`、`availability`、`calculationDetails`から前回正常結果を表示する。主要指標の直前に次の2点を表示する。

1. 「前回の正常な計算結果を表示しています」
2. `latestSuccessfulRun.completedAt`を日本時間で整形した「計算日時: YYYY/MM/DD HH:mm」

前回正常結果を最新結果と呼ばず、最新Runの状態、Errorと、過去成功Run由来のMetric、Availabilityを混同しない。Warningは取得元Runを保持したまま別々に収集し、通常表示を作る段階だけ9章の決定論的規則で画面全体へ統合する。生Warning Codeと診断値はRun別に分離する。`latestSuccessfulRun`がない場合は主要指標を`0`、`—`、推定値で補完しない。

### 5.2 表示データの取得元

| 表示要素                     | 取得元                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 最新計算状態                 | `latestRun.status`                                                                                           |
| 最新計算試行のError・Warning | `latestRun.errorCode`、`errorMessage`、`warningCodes`                                                        |
| 前回正常結果の表示判定・日時 | `latestSuccessfulRun.runId`、`completedAt`                                                                   |
| 表示する主要・詳細Metric     | `metrics`                                                                                                    |
| 表示中正常結果のLane状態     | `availability`                                                                                               |
| 表示中正常結果の診断値       | `calculationDetails`                                                                                         |
| 表示中正常結果のWarning      | `latestSuccessfulRun.warningCodes`、`metrics.*.warningCodes`、`availability.*.reasons`、`calculationDetails` |

APIは`metrics`、`availability`、`calculationDetails`を最新成功Runに基づいて返す。Phase 4.2.0ではこの契約を変更しない。

### 5.3 履歴状態

`COMPLETE`、`PARTIAL`、`TRUNCATED`、`GAP_DETECTED`、`INSUFFICIENT_HISTORY`を大きなBadgeとして表示しない。第一階層では次のような日本語文へ変換する。

| 内部値                 | 信頼性文の基準                                       |
| ---------------------- | ---------------------------------------------------- |
| `COMPLETE`             | 対象期間の履歴を使って評価したことを示す             |
| `PARTIAL`              | 信頼できる期間・完了取引だけを評価したことを示す     |
| `TRUNCATED`            | 取得できた期間だけを評価したことを示す               |
| `GAP_DETECTED`         | 欠損を跨がず、利用できる範囲だけを評価したことを示す |
| `INSUFFICIENT_HISTORY` | 正式な指標を計算する履歴が不足していることを示す     |

生の履歴状態は「計算の詳細」に残す。

### 5.4 Version選択

暗黙のRun選択は、現行API契約どおり次の優先順とする。

1. `performance-v3`を優先する。
2. v3が存在しない場合に限り、`performance-v2`へ明示的にfallbackする。
3. `performance-v1`、未知Version、将来Versionは暗黙fallbackの対象にしない。
4. `runId`を明示した取得では、Wallet所属など既存の安全条件を維持したうえで指定Runを尊重する。

VersionのDB共存と暗黙fallbackは別の契約である。過去のv1/v2 Runを保持していても、v1を正常結果として暗黙選択したり、未知・将来Versionを新しいという理由だけで選択したりしない。Phase 4.2.0はこのAPI選択契約を変更せず、選択されたRunを表示する。

## 6. データ信頼性文

信頼性文はスコアや推奨判定ではない。既存のRun状態、履歴状態、Availability、`trustedClosedCycleCount`、既存Warningだけから決定論的に組み立てる。通常画面へ表示する問題は、内部Codeをそのまま描画せず、Web内部の「ユーザー向け意味キー」へ正規化する。

意味キーは表示上の重複排除にだけ使用する概念名であり、API、DTO、DB、Workerの新しい値として追加しない。代表例は次のとおりである。

| ユーザー向け意味キー        | 統合する情報の例                                                       |
| --------------------------- | ---------------------------------------------------------------------- |
| `INCOMPLETE_TRADE_HISTORY`  | `PARTIAL_HISTORY`、`TRADE_HISTORY_PREFIX_SKIPPED`、取引Laneの一部除外  |
| `NAV_HISTORY_SHORT`         | `INSUFFICIENT_HISTORY`、短いReturn対象期間                             |
| `NAV_HISTORY_GAP`           | `DATA_GAP`、`RETURN_PERIOD_TRUNCATED_AT_GAP`、`GAP_DETECTED`           |
| `UNKNOWN_TRANSFER`          | `UNKNOWN_CASH_FLOW`、Return Laneの同一理由                             |
| `UNALLOCATED_FUNDING`       | 同名Warning、Funding除外件数                                           |
| `PREVIOUS_RESULT_DISPLAYED` | 最新Runが正常でなく、`latestSuccessfulRun`由来の結果を表示している状態 |

正規化後の表示モデルは、少なくとも`meaningKey`、日本語文、影響範囲（全体、Trade、Return、Exposure）、優先度、取得元Runを持つ。取得元Runは表示上の区別に使い、APIへ追加しない。

### 6.1 表示規則

1. 最大2文とする。
2. 信頼済み完了取引数が得られる場合は件数を示す。
3. 履歴が完全でない場合は「一部を除外」または「利用できる範囲」と明示する。
4. 複数Laneまたは全体が利用不能な場合だけ、計算できない領域を第一階層の日本語文で示す。特定Laneだけの場合は第一階層へ表示せず、「詳細指標」内のLane説明だけを正本とする。
5. `confidence`、点数、高・中・低など、新しい評価語を使わない。
6. 信頼性文へ採用した意味キーは、注意事項またはLane不足理由へ再掲しない。
7. 最新Runの状態文と表示中の正常結果の信頼性文は分ける。Warningの意味キーだけは9章に従って画面全体で重複排除する。

### 6.2 通常表示の正本と重複排除

通常画面全体の表示順序と正本は次のとおりである。

1. 最新計算状態
2. `PREVIOUS_RESULT_DISPLAYED`に対応する前回正常結果の案内と日時
3. データ信頼性の要約
4. 重要な注意事項最大3件
5. 初期状態で閉じた「詳細指標」内のLane単位の計算不能説明

同じ意味キーは、この順で最初に採用された1箇所だけへ表示する。

- 全体または複数Laneに影響する問題は、データ信頼性の要約または上部の注意事項を正本とする。
- 特定Laneだけに影響する問題は第一階層へ表示せず、「詳細指標」内のLane説明だけを正本とする。
- 主要指標が0件の場合にだけ、重複しない全体理由を主要指標グループ案内へ1件添えてよい。
- Availability Badgeと内部値は通常表示の正本にしない。
- 生Warning Codeは「計算の詳細」だけに表示する。
- 上位で表示済みの意味キーは、下位領域に同じ日本語文を再掲しない。「上記のデータ不足により」のような参照表現も表示せず、理由表示自体を抑止する。計算不能Metric名は理由文とは別に列挙してよい。

### 6.3 例

- 完全: 「対象期間の履歴と、信頼できる12件の完了取引を評価しています。」
- 部分履歴: 「一部の履歴を除外し、信頼できる3件の完了取引を評価しています。」
- Return不可・Trade可: 信頼性文は「信頼できる3件の完了取引を評価しています。」とし、Return固有の不足理由は「詳細指標」内のLane説明へ1回表示する。
- データ不足: 「正式な運用実績を計算するための履歴が不足しています。」

複数Laneへ影響する共通問題を信頼性文へ採用した場合は、同じ意味を注意事項と詳細指標のLane説明へ再掲しない。`UNKNOWN_TRANSFER`や入出金境界NAV不足がReturnだけへ影響する場合は信頼性文へ採用せず、詳細指標で理由と計算不能Metric名を確認できるようにする。

## 7. 主要指標

初期表示する主要指標は次の6件を上限とする。

| 順序 | 表示名           | データソース                                 | 寄与           |
| ---: | ---------------- | -------------------------------------------- | -------------- |
|    1 | 累積収益率       | `metrics.cumulativeReturn`                   | 利益           |
|    2 | 最大下落率       | `metrics.maxDrawdown`                        | 損失リスク     |
|    3 | 利益と損失の効率 | `metrics.profitFactor`                       | 利益・再現性   |
|    4 | 勝率             | `metrics.winRate`                            | 利益・再現性   |
|    5 | 評価対象取引数   | `calculationDetails.trustedClosedCycleCount` | 再現性・信頼性 |
|    6 | 利益の一発依存度 | `metrics.topTradeContribution`               | 再現性         |

### 7.1 描画規則

1. 値が存在する指標だけをカードとして描画する。
2. 欠損指標を`—`、`0`、推定値で補完しない。
3. 欠損した主要指標の代わりにP2指標を昇格させない。
4. 表示枚数は0～6件であり、常に同じ6枠を確保しない。
5. 一部欠損の場合は表示可能なカードだけを描画し、重複しないLane単位の不足理由を「詳細指標」に表示する。
6. 表示可能な主要指標が0件の場合は、カードを描画せず「現在表示できる主要指標はありません」と表示する。確認できる全体理由があり、上位で未表示の場合だけ、グループ単位の理由を1件添える。
7. 全Metric不足でも`0`または`—`でカードを作らない。
8. 各カードからPrecision、Warning Code、Metric Key、Metric Versionを除く。
9. `REFERENCE_ONLY`の主要指標が将来返る場合は通常値と同等に見せず、「参考値」の日本語補足を表示する。
10. 主要指標の値は既存`formatMetricValue`相当のDecimal文字列処理を維持し、JavaScript `number`で再計算しない。
11. 前回正常結果を表示する場合も、値、Availability、`calculationDetails`は最新成功Run由来のものだけを使用する。

「評価対象取引数」は、次をすべて満たす場合だけ表示する。

1. `latestSuccessfulRun`が存在する。
2. `availability.trade.status !== UNAVAILABLE`である。
3. `calculationDetails.trustedClosedCycleCount >= 1`である。
4. `winRate`、`profitFactor`、`averageWin`、`averageLoss`、`maxLosingStreak`、`topTradeContribution`のいずれか、Trade系の正常なMetricが存在する。

条件を満たさない場合、APIの初期値`0`を「評価対象取引数 0件」として表示しない。Trade Laneの不足説明を意味キー重複排除後の正本箇所へ表示し、`0`を正常Metricとして扱わない。

### 7.2 主要指標の説明

説明は情報buttonとキーボードで開ける補足領域から確認できる。hoverだけに依存しない。

| 表示名           | 説明                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 累積収益率       | 入出金の影響を調整したうえで、評価期間中の運用成績がどの程度増減したかを示します。                                                |
| 最大下落率       | 入出金の影響を調整した資産推移において、ピークから最大でどの程度下落したかを示します。                                            |
| 利益と損失の効率 | 評価対象となった完了取引の利益総額が、損失総額の何倍かを示します。1を超えると利益総額が損失総額を上回ります。                     |
| 勝率             | 評価対象となった完了取引のうち、利益になった取引の割合です。                                                                      |
| 評価対象取引数   | ポジションがない状態から取引を開始し、再びポジションがない状態へ戻るまでを1取引として、履歴から信頼して評価できた完了取引数です。 |
| 利益の一発依存度 | 評価対象となった完了取引の総利益のうち、最も利益が大きい1取引が占める割合です。高いほど少数の成功に利益が偏っています。           |

「1取引」はFill単位ではなく、ポジションがない状態へ戻るまでの完了取引である。内部用語`Position Cycle`は、必要な場合だけ補足または「計算の詳細」に記載する。

### 7.3 Max Drawdownの表示契約

`performance-v3`の最大下落率は、raw Daily NAVではなく、TWR Return Periodから構築したWealth Indexを使う。計算契約の正本はADR-030であり、本画面では保存済みの`metrics.maxDrawdown`を再計算せず表示する。

```text
W_0 = 1
W_i = W_(i-1) × (1 + r_i)
P_0 = 1
P_i = max(P_(i-1), W_i)
D_i = W_i / P_i - 1
Max Drawdown = min(D_0 ... D_n)
```

- Cash FlowはReturn Period生成時に一度だけ除外し、Max Drawdown側では再調整しない。
- raw Daily NAVはraw Portfolio Snapshot由来の表示・監査用系列として維持する。Max Drawdown MetricとDaily NAVは異なる系列を利用する。
- Cash Flowがない履歴ではv2とv3のMax Drawdownは同値である。
- Cash Flowがある履歴では、raw Daily NAV方式だったv2とWealth Index方式のv3で値が変わり得る。
- `accountClassTransfer`など内部振替の評価範囲はADR-030に記載された残存制約であり、Phase 4.2.0で再分類しない。

次のいずれかに該当する場合、最大下落率を`0`または`—`のカードとして通常表示しない。

1. `UNKNOWN_CASH_FLOW`
2. `MISSING_CASH_FLOW_BOUNDARY_NAV`
3. `NON_POSITIVE_NAV`
4. Return期間不足
5. Return Metricが保存されていない

最初の4条件はReturn Laneを計算不能とし、Return Metric未保存は表示可能な正式値がない状態とする。通常画面では最大下落率カードを描画せず、Returnだけへ影響する場合は初期状態で閉じた「詳細指標」でLane単位の不足理由をユーザー向け意味として1回だけ表示する。例えば、Cash Flow境界NAV不足は「入出金前後の純資産額を確認できないため、収益・リスク指標はまだ計算できません。」と表示する。第一階層へは表示せず、内部Warning Codeは「計算の詳細」だけに表示する。別の全体または複数Lane問題として同じ意味を第一階層へ表示済みなら、詳細指標の理由表示自体を抑止する。

### 7.4 指標説明の操作

主要指標の説明は次のすべてを満たす。

1. `button`要素を使用する。
2. `aria-label="<指標名>の説明"`を付ける。
3. `aria-expanded`を付け、初期値を`false`とする。
4. `aria-controls`で説明領域を参照する。
5. クリック、Enter、Space、モバイルタップで開閉できる。
6. 開閉後に`aria-expanded`を更新し、支援技術が状態を認識できる。
7. 説明は初期状態で閉じ、hoverだけに依存しない。
8. 説明は1～2文とする。

指標説明に`details` / `summary`を代替利用しない。

### 7.5 最大レバレッジと最大銘柄比率

`maxLeverage`と`largestCoinShare`は即時リスクの参考になるが、Phase 4.2.0では主要指標または独自Warningへ昇格させない。

- 現行仕様に重大と判断する閾値がない。
- 新しい閾値は新しい判定ロジックになる。
- 最大6件の主要指標を超える。

両値は詳細指標へ残す。既存Warningがある場合だけ、既存Warningの意味を注意欄へ表示する。

## 8. 日本語表示名

| 内部名・現行名                     | 通常画面の表示名                  |
| ---------------------------------- | --------------------------------- |
| Performance                        | 運用実績                          |
| Calculation information / 計算情報 | データ状況                        |
| Calculation Details                | 計算の詳細                        |
| Performanceを計算                  | 実績を計算                        |
| Performanceを再計算                | 実績を再計算                      |
| `cumulativeReturn`                 | 累積収益率                        |
| `twr`                              | 入出金の影響を除いた収益率（TWR） |
| `maxDrawdown`                      | 最大下落率                        |
| `profitFactor`                     | 利益と損失の効率                  |
| `winRate`                          | 勝率                              |
| `trustedClosedCycleCount`          | 評価対象取引数                    |
| `topTradeContribution`             | 利益の一発依存度                  |
| `maxLosingStreak`                  | 最大連敗                          |
| `maxLeverage`                      | 最大レバレッジ                    |
| `largestCoinShare`                 | 最大銘柄比率                      |
| `historyCompleteness`              | データの完全性                    |
| `precision`                        | 計算精度                          |
| Position Cycles                    | 取引サイクル                      |

正式な金融用語と略語は、括弧内、説明文、または「計算の詳細」に残してよい。Metric Key自体を通常画面の主表示には使わない。

## 9. Warningの統合

### 9.1 基本規則

1. 最新計算試行のWarning入力は`latestRun.warningCodes`から取得する。
2. 表示中の正常結果のWarning入力は`latestSuccessfulRun.warningCodes`、Metricの`warningCodes`、`availability.reasons`、`calculationDetails`から取得する。
3. 2種類の入力は取得元Runを失わないよう別々に収集・正規化する。通常表示を作る段階だけ、画面全体を1つの重複排除範囲としてユーザー向け意味キー単位で統合する。
4. 同じ正常結果内でRun、Metric、Availability、`calculationDetails`に同じCodeまたは同じ事象が重複していても、Codeとユーザー向け意味キーの両段階で重複排除する。
5. 同じCodeを入力箇所に応じて異なる意味キーへ変換しない。複数の異なるCodeが同じ利用者向け意味を表す場合は、1つのユーザー向け意味キーへ統合する。
6. 同じ意味キーが最新計算試行と表示中の正常結果の両方にある場合は、`latestRun`由来を正本とし、表示中の正常結果由来の同一意味キーを通常表示から除外する。
7. Lane固有かどうかを判定してから表示先を決める。Returnだけ、Tradeだけ、Exposureだけの理由は第一階層の注意候補から除き、初期状態で閉じた「詳細指標」内だけへ表示する。全体または複数Laneへ影響する理由だけを第一階層の候補にできる。
8. データ信頼性文、注意事項、Lane不足説明を含む通常画面全体で、同じ意味キーを一度だけ表示する。第一階層で採用した意味は「詳細指標」で理由文も参照文も表示しない。
9. 第一階層の注意候補は、最新計算試行由来の意味キー、表示中の正常結果由来の意味キーの順に並べる。各グループ内は9.3の固定優先順位を正本とし、オブジェクトまたは`Map`の偶然の反復順序へ依存しない。
10. 最大3件はRun別ではなく、両Runを統合した第一階層の注意候補全体へ1回だけ適用する。
11. 4件以上は、先頭3件と「ほかN件の注意事項」buttonを表示する。Nは意味キー重複排除と表示先振り分けを終えた注意候補のうち、先頭3件に入らず非表示になっている意味キー数とする。重複して除外したCode数、Lane固有理由、別の正本箇所ですでに表示した意味キーはNへ含めない。
12. 「ほかN件」を開くと、残りの日本語注意事項を「最新の計算試行」「表示中の正常結果」の区分で表示する。同一意味キーは6の優先順位に従って片方だけに置き、件数0の区分は表示しない。生Warning Code一覧へ移動するだけの導線で代替しない。
13. 「ほかN件」buttonは`aria-expanded`、`aria-controls`を持ち、Enter、Space、モバイルタップで開閉できる。開閉状態を支援技術が認識できる。
14. 個々のMetricカードにはWarningを表示しない。生Warning Codeは「計算の詳細」にのみ表示し、最新計算試行と表示中の正常結果の両方に同じ意味があっても各Run別の生Codeを削除しない。
15. `DERIVED`、`ESTIMATED`はPrecisionであり、それだけで重大Warningにしない。生値は「計算の詳細」へ置く。
16. 未知のCodeは画面へそのまま出さず、「計算結果に追加の注意事項があります」とし、生Codeは「計算の詳細」に残す。
17. 旧データなどで`DERIVED`、`ESTIMATED`、`REFERENCE_ONLY`がWarning配列に含まれても、Metricカードへ表示せず、「計算の詳細」だけで確認できるようにする。

例えば、`latestRun.warningCodes`に`POSITION_DISCONTINUITY`、`latestSuccessfulRun.warningCodes`に`PARTIAL_HISTORY`と`POSITION_DISCONTINUITY`があり、いずれも`INCOMPLETE_TRADE_HISTORY`へ変換される場合、通常画面は最新計算試行由来の日本語注意1件だけを表示する。「計算の詳細」では両Runの生Warning Codeをそれぞれ保持する。

### 9.2 意味グループ

| ユーザー向け意味キー       | 対応する既存Codeの例                                                        | 通常画面の文                                                          |
| -------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `INCOMPLETE_TRADE_HISTORY` | `PARTIAL_HISTORY`、`TRADE_HISTORY_PREFIX_SKIPPED`、`POSITION_DISCONTINUITY` | 一部の取引履歴を評価対象から除外しています                            |
| `UNALLOCATED_FUNDING`      | `UNALLOCATED_FUNDING`                                                       | 一部のFundingを取引へ割り当てられませんでした                         |
| `NAV_HISTORY_GAP`          | `DATA_GAP`、`RETURN_PERIOD_TRUNCATED_AT_GAP`                                | 履歴の欠損を跨がず、利用できる期間だけを評価しています                |
| `NAV_HISTORY_SHORT`        | `HISTORY_TRUNCATED`、`INSUFFICIENT_HISTORY`、`CALCULATION_WINDOW_ADJUSTED`  | 取得できた履歴のうち、利用できる範囲だけを評価しています              |
| `UNKNOWN_TRANSFER`         | `UNKNOWN_CASH_FLOW`                                                         | 分類できない入出金があるため、収益率とリスク指標を表示できません      |
| `MISSING_BOUNDARY_NAV`     | `MISSING_CASH_FLOW_BOUNDARY_NAV`                                            | 入出金前後のNAVが不足しているため、収益率とリスク指標を表示できません |
| `INVALID_NAV_INPUT`        | `NON_POSITIVE_NAV`、`INVALID_INPUT`                                         | 利用できないNAVデータがあるため、一部の指標を表示できません           |

### 9.3 優先順

各Runグループ内では、次の固定優先順位で並べる。

1. 計算不能なLaneを生じさせた注意
2. 履歴Gap・不連続
3. 除外が発生した注意
4. 期間調整など、値の対象範囲に関する注意
5. 未知Codeの汎用注意

同じ優先度では9.2の意味キーテーブルの掲載順を固定tie-breakとし、未知Codeの汎用意味キーは最後とする。最新計算試行グループをこの規則で並べた後に表示中の正常結果グループを同じ規則で並べ、結合結果の先頭3件を通常表示する。入力オブジェクト、`Map`、Metric走査の偶然の順序は使用しない。

### 9.4 色とrole

- `FAILED`や取得エラーはエラー表示とし、`role=alert`を使う。
- 計算不能Laneやデータ欠損は注意表示とし、必要に応じて`role=status`または説明リストを使う。
- 除外や期間短縮など重大度が定義されていないWarningは赤色にしない。
- 色だけで区別せず、「注意」「計算できません」などの文言とアイコン形状を併用する。

## 10. Availabilityの表示

| 内部値        | 通常画面           | 表示規則                                                                       |
| ------------- | ------------------ | ------------------------------------------------------------------------------ |
| `AVAILABLE`   | 原則表示なし       | 問題がないためBadgeを付けない                                                  |
| `PARTIAL`     | 必要な場合だけ補足 | 特定Laneだけの理由は「詳細指標」内だけ、複数Laneの共通理由は第一階層だけに表示 |
| `UNAVAILABLE` | グループ不足説明   | 空カードの代わりに、特定Laneだけの理由を「詳細指標」内だけへ日本語で表示       |

正常なLaneへ「計算済み」Badgeを表示せず、Availability Badge自体を通常画面の正本にしない。`AVAILABLE`、`PARTIAL`、`UNAVAILABLE`の内部値は「計算の詳細」でだけ確認できる。

## 11. 詳細指標

### 11.1 グループ構成

| グループ       | 表示する補助Metric・既存要素                              |
| -------------- | --------------------------------------------------------- |
| 収益詳細       | 入出金の影響を除いた収益率、年率換算収益率                |
| 取引詳細       | 平均利益、平均損失、最大連敗、既存の取引サイクル          |
| リスク調整指標 | 値動きの大きさ、Sharpe Ratio、Sortino Ratio、Calmar Ratio |
| レバレッジ     | 中央値、95%点、最大、平均                                 |
| 銘柄集中度     | 最大銘柄比率、集中度（HHI）                               |
| 日次評価額     | 既存の日次NAV概要、チャート、一覧                         |

主要指標の値は詳細グループへ重複表示しない。正式名称、対象期間、参考値である旨など、主要指標の補足は各指標の説明または「計算の詳細」から確認できる。

### 11.2 計算不能Metric

計算不能なMetricは個別カードを描画しない。グループ内に計算可能なMetricが1件以上ある場合は、存在する値だけを表示し、欠けた値は次のようにまとめる。

> 長期リスク指標
> 連続したNAV履歴が不足しているため、まだ計算できません。
> 対象指標: 年率換算収益率、値動きの大きさ、Sharpe Ratio、Sortino Ratio、Calmar Ratio

計算不能Metric名は「詳細指標」を開いた時点で確認できるようにし、Metric名を見るための追加button、Accordion、折りたたみを設けない。ReturnだけのCash Flow境界NAV不足または評価期間不足、Tradeだけの完了取引不足、ExposureだけのSnapshot不足など、特定Laneだけの理由はここで日本語表示する。「詳細指標」が閉じている間は表示しない。

全体または複数Laneへ影響するため第一階層へ表示済みの意味キーは、理由文を再掲せず、「上記のデータ不足により、この指標グループは計算できません」のような参照表現も置かない。原則として詳細指標側の理由表示自体を抑止し、対象Metric名だけを示してよい。Lane理由に生Warning Codeを使用しない。

全Metricが利用不能なグループでも、空のカードグリッドは表示しない。不足理由がAPIの`availability.reasons`にない場合は「この指標を計算できるデータがありません」とする。原因を推測しない。

### 11.3 日次NAVと取引サイクル

- 「詳細指標」を開いた後、日次NAVと取引サイクルの概要を追加操作なしで表示する。NAV表示内、Position Cycle表示内へPhase 4.2.0の新しい開閉領域を追加しない。
- データ取得を遅延する場合は「詳細指標」を開いた時点を起点とし、API URL、ページング、Run選択は変更しない。
- 大量行には既存のページング、フィルター、表示件数制限を維持できる。これらは追加の情報階層として扱わない。
- 日次NAV行で反復しているPrecisionとHistory Completenessは通常の一覧から外し、「計算の詳細」へ置く。
- 取引サイクルの表示語は日本語中心にするが、保存値とフィルター値は変更しない。

## 12. 計算の詳細

初期状態を閉じ、次の項目を表示する。

### 12.1 最新の計算試行

`latestRun`だけを取得元とし、次を表示する。

- Run ID
- Status
- Input Fingerprint
- Calculation Version
- Run Precision
- History Completeness
- Warning Codes
- Error Code
- Error Message
- 計算要求日時
- 計算開始日時
- 計算完了日時
- 最新試行の計算対象期間

最新RunのWarning、Error、日時を、表示中の正常結果のMetric metadataまたはAvailabilityへ結合しない。

### 12.2 表示中の正常結果

`latestSuccessfulRun`、`metrics`、`availability`、`calculationDetails`だけを取得元とし、次を表示する。

- 正常結果のRun ID
- 正常結果の計算完了日時
- Performance Version
- `latestSuccessfulRun.warningCodes`
- 正本となる正常結果の計算対象期間
- Trade / Return / ExposureのAvailability内部値
- LaneごとのAvailability reasons
- 除外Fill件数
- 除外Funding件数
- 信頼済み完了Cycle件数
- UNKNOWN_CASH_FLOW件数
- NAV Gap件数
- 取引履歴Prefix（銘柄、除外件数、除外期間、信頼開始時点）
- 正常結果由来の生Warning Codes

`latestRun.runId === latestSuccessfulRun.runId`の場合は同じRunの共通値を二重表示せず、最新の計算試行が表示中の正常結果でもあることを示す。

### 12.3 Metric metadata

Metric metadataは追加の折りたたみ領域にせず、「計算の詳細」を開いた状態で一覧または表として確認できるようにする。

- Metric Key
- Metric Version
- Metric Status
- Precision
- Warning Codes
- 計算対象期間（Lane期間と異なる場合だけ）

### 12.4 計算期間の正本

表示中の正常結果では、`latestSuccessfulRun.calculationFrom/to`を正本期間として1件表示する。

1. Trade、Return、ExposureのLane期間が正本期間と同じ場合は繰り返さない。
2. 正本期間と異なるLane期間だけ、Lane名とともに追加表示する。
3. Metric期間が対応Lane期間と同じ場合は繰り返さない。
4. Metric期間が対応Lane期間と異なる場合だけ、Metric名とともに追加表示する。
5. 最新の計算試行が過去成功Runと異なる場合は、最新試行の期間を「最新の計算試行」内へ分離して表示する。

APIにすでにある値だけを使用する。新しい診断値をAPIへ追加しない。

## 13. レスポンシブ設計

### 13.1 主要指標

| 表示幅             | 列数 |
| ------------------ | ---: |
| 1920pxデスクトップ |  3列 |
| 1366pxノートPC     |  3列 |
| タブレット         |  2列 |
| モバイル           |  1列 |

4列以上を許可しない。値、単位、表示名、情報buttonが切れないことを優先し、6件を1行へ詰め込まない。

### 13.2 注意点と操作

- 状態、信頼性文、注意点は横並びに固定しない。
- モバイルでは見出し、状態、再計算ボタンを縦に並べる。
- タップ対象は44px相当を目安とし、隣接操作との間隔を確保する。

### 13.3 詳細表

- 日次NAVと取引サイクルの表は既存の横スクロールを維持できる。
- 表を初期表示しないため、モバイルの初期画面を過密にしない。
- 開いたときは領域名と横スクロール可能であることを視覚的・文言的に示す。

## 14. アクセシビリティ

1. 「詳細指標」「計算の詳細」、Metric説明、「ほかN件の注意事項」は`button` + `aria-expanded` + `aria-controls`で実装する。
2. すべての開閉操作をキーボードで操作できる。
3. 初期状態が閉じていること、開閉後の状態を支援技術が認識できる。
4. 見出し階層を、画面見出し→詳細領域→グループの順で維持する。
5. 情報アイコンのbuttonに、例として`aria-label="累積収益率の説明"`を付ける。
6. 説明をhoverだけで提供しない。フォーカス、クリック、Enter、Spaceでも到達可能にする。
7. Metric説明の`aria-expanded`は初期値`false`、開いた後は`true`、再度閉じた後は`false`へ戻す。
8. モバイルタップの対象は44px相当を目安とし、hoverできない環境でも全説明と全注意事項を確認できる。
9. 色だけで状態を表さず、状態名または説明文を併記する。
10. 読み込み・計算待ち・計算中は`role=status`、取得失敗・計算失敗・操作失敗は`role=alert`を使う。
11. 通常の注意リスト全体に不用意な`role=alert`を付け、初期表示時に読み上げを割り込ませない。
12. 展開後にフォーカスを強制移動しない。エラー後に再計算が必要な場合は、エラーとbuttonの関係を文言で明確にする。
13. 既存NAVチャートは`role=img`、明確な`aria-label`、`title`を維持し、同じデータを表でも確認可能にする。

## 15. テキストワイヤーフレーム

`[閉]`は初期状態で閉じた操作、`[開]`は現行の常時展開を表す。変更前は構造上の代表要素だけを記載する。

### 15.0 状態別の取得元と操作

| 表示状態                          | 最新Run状態の取得元 | Metricの取得元          | 表示中結果日時の取得元            | 通常Warningの取得元                              | 診断情報の取得元                         | 再計算button状態     |
| --------------------------------- | ------------------- | ----------------------- | --------------------------------- | ------------------------------------------------ | ---------------------------------------- | -------------------- |
| Runなし                           | `latestRun=null`    | なし                    | なし                              | なし                                             | 空response                               | 実績を計算button有効 |
| `SUCCEEDED`                       | `latestRun.status`  | `metrics`               | `latestSuccessfulRun.completedAt` | 正常結果の4入力                                  | 最新試行と表示中正常結果。共通値は1回    | 有効                 |
| `SUCCEEDED`・Return不能           | `latestRun.status`  | 利用可能Laneの`metrics` | `latestSuccessfulRun.completedAt` | 正常結果の4入力。Return固有理由は詳細指標だけ    | 同上                                     | 有効                 |
| `SUCCEEDED`・Trade不能            | `latestRun.status`  | 利用可能Laneの`metrics` | `latestSuccessfulRun.completedAt` | 正常結果の4入力。Trade固有理由は詳細指標だけ     | 同上                                     | 有効                 |
| `SUCCEEDED`・全Metric不能         | `latestRun.status`  | なし                    | `latestSuccessfulRun.completedAt` | 正常結果の4入力。グループ不足理由は1回           | 同上                                     | 有効                 |
| `PENDING`・過去成功なし           | `latestRun.status`  | なし                    | なし                              | なし。`latestRun.warningCodes`は最新状態領域だけ | `latestRun`                              | 無効                 |
| `RUNNING`・過去成功なし           | `latestRun.status`  | なし                    | なし                              | なし。`latestRun.warningCodes`は最新状態領域だけ | `latestRun`                              | 無効                 |
| `FAILED`・過去成功なし            | `latestRun.status`  | なし                    | なし                              | なし。`latestRun.warningCodes`は最新状態領域だけ | `latestRun`                              | 有効                 |
| `INSUFFICIENT_DATA`・過去成功なし | `latestRun.status`  | なし                    | なし                              | なし。`latestRun.warningCodes`は最新状態領域だけ | `latestRun`                              | 有効                 |
| `PENDING`・過去成功あり           | `latestRun.status`  | `metrics`               | `latestSuccessfulRun.completedAt` | 両Runを意味キー統合。重複時は最新試行を優先      | `latestRun`と正常結果の4入力を別グループ | 無効                 |
| `RUNNING`・過去成功あり           | `latestRun.status`  | `metrics`               | `latestSuccessfulRun.completedAt` | 両Runを意味キー統合。重複時は最新試行を優先      | 同上                                     | 無効                 |
| `FAILED`・過去成功あり            | `latestRun.status`  | `metrics`               | `latestSuccessfulRun.completedAt` | 両Runを意味キー統合。重複時は最新試行を優先      | 同上                                     | 有効                 |
| `INSUFFICIENT_DATA`・過去成功あり | `latestRun.status`  | `metrics`               | `latestSuccessfulRun.completedAt` | 両Runを意味キー統合。重複時は最新試行を優先      | 同上                                     | 有効                 |

表中の「正常結果の4入力」は、`latestSuccessfulRun.warningCodes`、Metricの`warningCodes`、`availability.reasons`、`calculationDetails`を指す。これらと`latestRun.warningCodes`は入力・診断ではRun別に保持し、通常表示だけ9章の画面全体ルールで統合する。History Completenessの`PARTIAL`、`GAP_DETECTED`はRun Statusではない。最新試行の履歴完全性は`latestRun.historyCompleteness`、表示中の正常結果の履歴完全性は`latestSuccessfulRun.historyCompleteness`から取得し、状態表のRun Status行として扱わない。過去成功Runを表示する4状態では、主要指標の直前に前回正常結果の案内と`latestSuccessfulRun.completedAt`を必ず表示する。

### 15.1 COMPLETEですべて計算可能

変更前:

```text
Performance / Saved analytics
[計算情報: SUCCEEDED | Version | Precision | Completeness | Warning件数 | 日時]
[収益指標: 5カード]
[リスク調整指標: 3カード]
[取引指標: 6カード]
[レバレッジ・集中度: 6カード]
[Calculation Details: 常時表示]
[日次NAV: 概要 + chart + table]
[Position Cycles: filters + table]
```

変更後:

```text
運用実績                         計算完了
対象期間の履歴と、信頼できる12件の完了取引を評価しています。

主要指標
[累積収益率] [最大下落率] [利益と損失の効率]
[勝率]       [評価対象取引数] [利益の一発依存度]

[実績を再計算]
[閉] 詳細指標
[閉] 計算の詳細
```

### 15.2 GAP_DETECTEDで一部計算可能

使用する実データ相当:

- 勝率: 33.33%
- 利益と損失の効率: 約2.19
- 最大下落率: 約-34.12%
- 累積収益率: 約0.62%
- 評価対象取引数: 3件
- 利益の一発依存度: 100%
- 履歴Gap、先頭Fill除外、Funding除外あり

変更前:

```text
Performance
[計算情報: SUCCEEDED | GAP_DETECTED | Warning 3]
[収益指標 AVAILABLE/PARTIAL: 値カード + —カード + Code反復]
[取引指標 PARTIAL: 値カード + —カード + Code反復]
[Exposure: 値/—カード]
[Calculation Details: Run ID、Code、除外件数を常時表示]
```

変更後:

```text
運用実績                         計算完了
履歴の欠損を跨がず、利用できる期間と、
信頼できる3件の完了取引を評価しています。

注意
! 履歴開始時点で保有中だったポジションを除外しています
! 一部のFundingを取引へ割り当てられませんでした

※ NAV履歴の欠損は信頼性文を正本とし、注意へ重複表示しない

主要指標
[累積収益率 約0.62%]       [最大下落率 約-34.12%]
[利益と損失の効率 約2.19]  [勝率 33.33%]
[評価対象取引数 3件]       [利益の一発依存度 100%]

[実績を再計算]
[閉] 詳細指標
[閉] 計算の詳細
```

### 15.3 Returnだけ計算不能

変更前:

```text
[収益指標 計算不可: —カード5枚 + 理由]
[リスク調整指標 計算不可: —カード3枚 + 同じ理由]
[取引指標: 値カード6枚]
[警告を概要・Lane・カード・詳細で反復]
```

変更後:

```text
運用実績                         計算完了
信頼できるN件の完了取引を評価しています。

主要指標
[利益と損失の効率] [勝率] [評価対象取引数] [利益の一発依存度]
※ 累積収益率と最大下落率の空カードは表示しない

[閉] 詳細指標
  開いた場合: Return Laneの不足理由1件と計算不能Metric名を表示
[閉] 計算の詳細
```

Returnだけの不足理由は第一階層へ表示せず、「詳細指標」が閉じている間も表示しない。

### 15.4 Tradeだけ計算可能

変更前:

```text
[Return/Risk: —カード8枚]
[Trade: 値カードと—カード6枚]
[Exposure: —カード6枚]
[技術的なAvailabilityを各所に表示]
```

変更後:

```text
運用実績                         計算完了
信頼できるN件の完了取引だけを評価しています。
収益・リスクとレバレッジ・集中度はデータ不足です。

主要指標
[利益と損失の効率※存在時] [勝率]
[評価対象取引数]           [利益の一発依存度※存在時]

[閉] 詳細指標
  開いた場合:
  - 取引詳細: 利用可能な値
  - 収益・リスク: 計算不能Metric名
  - レバレッジ・集中度: 計算不能Metric名
  - 上部で表示済みの不足理由は再掲しない
[閉] 計算の詳細
```

### 15.5 INSUFFICIENT_DATA・過去成功なし

変更前:

```text
Performance
[INSUFFICIENT_DATA | UNAVAILABLE | INSUFFICIENT_HISTORY | Warning件数]
正式評価に必要な履歴が不足 / Warning Codes: ...
[Calculation Details: 常時表示]
[空の日次NAV]
[空のPosition Cycle]
```

変更後:

```text
運用実績                         データ不足
正式な運用実績を計算するための履歴が不足しています。
主要指標カードは表示しません。

[実績を再計算]
[閉] 計算の詳細
```

### 15.6 FAILED・過去成功なし

変更前:

```text
Performance
[FAILED | Version | Precision | Completeness | Warning件数]
Performance計算に失敗 / Error Code: ...
[Calculation DetailsにError Messageを常時表示]
```

変更後:

```text
運用実績                         計算できませんでした
運用実績の計算に失敗しました。時間をおいて再計算してください。
主要指標カードは表示しません。

[実績を再計算]
[閉] 計算の詳細
  開いた場合だけError Code / 安全化済みError Message
```

### 15.7 PENDING・過去成功なし

変更前:

```text
Performance
[PENDING · 計算待ち + 技術情報]
計算待ちです。保存済みMetricは結果として表示しません。
[計算待ち disabled]
```

変更後:

```text
運用実績                         計算待ち
計算の開始を待っています。完了すると表示が更新されます。
主要指標カードは表示しません。

[計算待ち disabled]
[閉] 計算の詳細
```

### 15.8 RUNNING・過去成功なし

変更前:

```text
Performance
[RUNNING · 計算中 + 技術情報]
計算中です。完了するまでMetricは結果として表示しません。
[計算中 disabled]
```

変更後:

```text
運用実績                         計算中
運用実績を計算しています。完了すると表示が更新されます。
主要指標カードは表示しません。

[計算中 disabled]
[閉] 計算の詳細
```

### 15.9 PENDING・過去成功あり

```text
運用実績                         計算待ち
実績の再計算開始を待っています。

前回の正常な計算結果を表示しています
計算日時: 2026/07/29 01:38

主要指標
[累積収益率] [最大下落率] [利益と損失の効率]
[勝率]       [評価対象取引数] [利益の一発依存度]

[計算待ち disabled]
[閉] 詳細指標
[閉] 計算の詳細
  最新の計算試行: PENDINGのRun情報
  表示中の正常結果: 過去成功RunのMetric・Availability・calculationDetails
```

### 15.10 RUNNING・過去成功あり

```text
運用実績                         計算中
実績を再計算しています。完了すると表示が更新されます。

前回の正常な計算結果を表示しています
計算日時: 2026/07/29 01:38

主要指標
[表示可能な過去成功Run由来の主要指標 最大6件]

[計算中 disabled]
[閉] 詳細指標
[閉] 計算の詳細
  最新の計算試行: RUNNINGのRun情報
  表示中の正常結果: 過去成功RunのMetric・Availability・calculationDetails
```

### 15.11 FAILED・過去成功あり

```text
運用実績                         計算できませんでした
最新の再計算に失敗しました。時間をおいて再計算してください。

前回の正常な計算結果を表示しています
計算日時: 2026/07/29 01:38

主要指標
[表示可能な過去成功Run由来の主要指標 最大6件]

[実績を再計算]
[閉] 詳細指標
[閉] 計算の詳細
  最新の計算試行: FAILEDのError・Warning・Run情報
  表示中の正常結果: 過去成功RunのMetric Warning・Availability・calculationDetails
  ※ 生Warning Codeと診断値はRun別に保持する
```

通常画面の日本語注意だけは両Runを画面全体で意味キー統合し、同一意味キーでは最新の計算試行を正本とする。

### 15.12 INSUFFICIENT_DATA・過去成功あり

```text
運用実績                         データ不足
最新の再計算では正式な指標に必要な履歴が不足していました。

前回の正常な計算結果を表示しています
計算日時: 2026/07/29 01:38

主要指標
[表示可能な過去成功Run由来の主要指標 最大6件]

[実績を再計算]
[閉] 詳細指標
[閉] 計算の詳細
  最新の計算試行: INSUFFICIENT_DATAのRun情報
  表示中の正常結果: 過去成功RunのMetric・Availability・calculationDetails
```

### 15.13 SUCCEEDED・全Metric利用不能

```text
運用実績                         計算完了
現在表示できる主要指標はありません。
<上位で未表示の場合だけ、グループ単位の利用不能理由を1件>

主要指標カードは0件
0または「—」で補完しない

[実績を再計算]
[閉] 詳細指標
  開いた場合: Lane単位の不足理由と計算不能Metric名、日次NAV概要、Position Cycle概要
[閉] 計算の詳細
```

最新成功Runが存在していても、存在しないMetricを作らない。`trustedClosedCycleCount`の表示条件を満たさない`0`も主要指標にしない。

### 15.14 SUCCEEDED・Trade不能・Return利用可能

```text
運用実績                         計算完了
入出金の影響を調整した運用成績を表示しています。

主要指標
[累積収益率※存在時] [最大下落率※存在時]
※ 評価対象取引数0件、勝率0%、利益と損失の効率0を補完しない

[実績を再計算]
[閉] 詳細指標
  開いた場合:
  - Return系の利用可能な低優先Metric
  - Trade Lane固有の不足理由（第一階層には表示しない）
  - 計算不能なTrade Metric名
[閉] 計算の詳細
```

### 15.15 PARTIAL

```text
運用実績                         計算完了
一部の履歴を評価対象から除外し、信頼できるN件の完了取引を評価しています。

主要指標
[表示可能な主要指標 最大6件]

注意
<両Runを統合し、最新試行由来を先に並べた意味キー最大3件>
[ほかN件の注意事項※重複排除後の未表示意味キーがある場合]
  開いた場合:
  - 最新の計算試行: 残りの日本語注意事項
  - 表示中の正常結果: 残りの日本語注意事項

[実績を再計算]
[閉] 詳細指標
[閉] 計算の詳細
```

`PARTIAL`の説明を信頼性文へ採用した場合、同じ`INCOMPLETE_TRADE_HISTORY`を注意事項、Availability Badge、Lane不足説明へ再掲しない。

## 16. 回帰要件

1. `performance-v3`で保存されたMetric値をWebで再計算せず、表示上のDecimal整形結果を維持する。Max DrawdownはCash Flowがないケースではv2と同値だが、Cash Flowがあるケースではv2と異なり得る。
2. 勝率`0.3333...`の既存入力は`33.33%`相当として表示できる。
3. 現行計算Version `performance-v3`を維持し、v3がない場合だけ`performance-v2`へfallbackする。v1、未知Version、将来Versionへ暗黙fallbackしない。
4. APIレスポンス、DTO、URL、HTTP methodを変更しない。
5. 再計算ボタンの送信、二重送信防止、PENDING/RUNNING中の無効化を維持する。
6. Polling間隔、最大回数、アドレス変更時の競合防止を維持する。
7. 再読み込み後も保存済み結果を表示する。
8. Web/API version表示を変更しない。
9. API・画面のエラーへ秘密情報、内部URL、stack traceを表示しない。
10. 日次NAVとPosition Cycleのページング、フィルター、データ値を維持する。
11. `latestRun`、`latestSuccessfulRun`、`metrics`、`availability`、`calculationDetails`のレスポンス構造と、v3優先・v2限定fallback・明示`runId`尊重のRun選択を変更しない。
12. 最新Run非正常時の前回正常結果表示はWebの表示選択だけで実現し、APIへfieldを追加しない。
13. Warning入力と生CodeはRun別に保持し、通常表示だけ画面全体で意味キー統合する。同一意味キーは最新Runを優先する。

## 17. 実装時に変更する候補ファイル

本タスクでは変更しない。Phase 4.2.0の実装時は、原則として次のWeb表示とテストだけを変更する。

- `apps/web/components/performance/performance-overview.tsx`
- `apps/web/components/performance/performance-metric-card.tsx`
- `apps/web/components/performance/calculation-details.tsx`
- `apps/web/components/performance/performance-status-badge.tsx`
- `apps/web/components/performance/nav-section.tsx`
- `apps/web/components/performance/nav-table.tsx`
- `apps/web/components/performance/position-cycle-section.tsx`
- `apps/web/components/performance/position-cycle-filters.tsx`
- `apps/web/components/performance/position-cycle-table.tsx`
- 関連Web単体テスト
- `tests/e2e/performance.spec.ts`

`apps/web/lib/performance-api.ts`は参照だけとし、型・関数・レスポンスを変更しない。

## 18. 非変更確認

| 対象                  | Phase 4.2.0            |
| --------------------- | ---------------------- |
| Metric値・計算式      | 変更しない             |
| Position Cycle        | 変更しない             |
| Daily NAV             | 変更しない             |
| `calculationVersion`  | `performance-v3`のまま |
| `inputFingerprint`    | 変更しない             |
| Run Status            | 変更しない             |
| Lane availability判定 | 変更しない             |
| Warning生成           | 変更しない             |
| DB保存                | 変更しない             |
| APIレスポンス         | 変更しない             |
| 再計算処理・Polling   | 変更しない             |

## 19. 未決事項

Phase 4.2.0の実装を妨げる表示仕様上の未決事項はない。

- 指標説明は`aria-expanded`付きbuttonへ固定した。
- 「詳細指標」内へ多段折りたたみを追加しない。
- 主要指標の列数は3 / 3 / 2 / 1へ固定した。
- 最新Run非正常時は、API変更なしで前回正常結果と計算日時を明示する。
- Lane固有理由は初期状態で閉じた「詳細指標」だけに表示し、全体または複数Laneの問題だけを第一階層へ表示する。
- Warningは通常画面全体で意味キーを重複排除し、同一意味キーでは最新試行を優先、最大3件は両Run合計へ適用する。
- 最大レバレッジと最大銘柄比率の新しい閾値はPhase 4.2.0で設定しない。これは未決の実装事項ではなく、Phase 5より前には導入しない非目標である。

## 20. 設計レビュー結果

2026-08-02に次を自己レビューした。

| 確認事項                             | 結果                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| Blocker B-01                         | 解消。非正常最新Runでも過去成功Runがあれば前回正常結果と日時を表示 |
| High H-01                            | 解消。意味キーと通常表示の正本順序で重複排除                       |
| High H-02                            | 解消。主要指標は3 / 3 / 2 / 1列、4列以上を禁止                     |
| High H-03                            | 解消。指標説明は`aria-expanded`付きbuttonへ固定                    |
| High H-04                            | 解消。評価対象取引数の4条件を定義し、空状態の`0`を表示しない       |
| Medium M-01                          | 解消。6指標の説明を現行計算と完了取引の定義に合わせた              |
| Medium M-02                          | 解消。「詳細指標」内の新しい多段折りたたみを禁止                   |
| Medium M-03                          | 解消。「ほかN件」は同じ注意領域で全日本語注意事項を展開            |
| Medium M-04                          | 解消。全Metric利用不能のワイヤーフレームと状態規則を追加           |
| 最終レビュー Medium: Lane表示階層    | 解消。Lane固有理由は詳細指標だけ、複数Lane以上だけ第一階層         |
| 最終レビュー Medium: 2 Run Warning   | 解消。通常画面全体で統合し、同一意味キーは最新試行を優先           |
| 最終レビュー Low: E2E重複            | 解消。レイアウトとモバイル操作の正本をAX/VISUAL/COMPONENTへ限定    |
| 主要指標が6件を超えていない          | 適合。固定候補は6件で、欠損時は減る                                |
| 技術用語が通常画面に残っていない     | 適合。生Code、Version、Key、Fingerprintは「計算の詳細」だけ        |
| 前回正常結果の取得元を混同していない | 適合。最新試行と表示中正常結果を「計算の詳細」でも分離             |
| 全Metric利用不能を0で補完していない  | 適合。主要カード0件とグループ案内を定義                            |
| Phase 5機能が混入していない          | 適合。スコア、推奨、分類、ランキング、新規リスク閾値を追加しない   |
| APIや計算変更を前提としていない      | 適合。現行Overview、NAV、Cycle APIと`performance-v3`を維持         |

テスト項目数は固定値を先に決めず、修正後のテストマトリクスに記載した実項目を数えて正本とする。
