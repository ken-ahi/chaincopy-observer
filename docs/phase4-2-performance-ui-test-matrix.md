# Phase 4.2.0 Performance UI テストマトリクス

## 1. 目的と前提

本書は、`docs/phase4-2-performance-ui-spec.md`を実装するときのテストケースを定義する。現時点では設計だけを行い、テストコード、fixture、API、DBは変更しない。

- 基準コミット: `c091ba12d8d39f079f70808d5c3dcbc6563e410a`
- アプリバージョン: `0.3.1`
- 計算バージョン: `performance-v3`
- テストケース総数: 116件
- 件数内訳: UI 15件、前回正常結果 12件、Version選択 5件、Max Drawdown 9件、Warning・重複排除 23件、Lane表示階層 6件、状態 10件、詳細 8件、アクセシビリティ・レスポンシブ 12件、回帰 9件、E2E 7件
- 件数は必要ケースを列挙した後に数えた実数であり、固定値を先に割り当てない
- 既存のWeb単体テスト、API契約テスト、Playwright E2Eを更新対象とする
- Metric値の期待値はDecimal文字列または既存formatterの出力と比較し、JavaScript `number`で期待値を再計算しない

### テストレベル

| 略称      | 意味                                          |
| --------- | --------------------------------------------- |
| UNIT      | 純粋関数、表示モデル、意味キー集約、formatter |
| COMPONENT | React DOM、状態、開閉、表示選択               |
| CONTRACT  | APIレスポンスの後方互換確認                   |
| VISUAL    | 指定viewportにおける実レイアウト              |
| E2E       | ブラウザ、認証、展開、再計算、Pollingを含む   |

同じ期待を複数レベルで反復しない。UNITは正規化規則、COMPONENTは表示分岐、E2EはAPI・Polling・操作を含む代表導線だけを担当する。

## 2. 初期表示・主要指標（15件）

| ID    | レベル    | 条件・操作                                        | 期待結果                                                                                                           |
| ----- | --------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| UI-01 | COMPONENT | `SUCCEEDED`かつ主要6指標がすべて存在              | 初期表示の主要指標カードが6件だけであり、7件目へP2指標を昇格しない                                                 |
| UI-02 | COMPONENT | 主要6指標の一部だけが存在                         | 存在する主要指標だけを表示し、欠損カード枠を確保しない                                                             |
| UI-03 | COMPONENT | 主要6指標と全P2 Metricが存在                      | P2 Metric、日次NAV、Position Cycle、技術情報を初期表示しない                                                       |
| UI-04 | COMPONENT | 評価対象取引数の4条件がすべて成立                 | `trustedClosedCycleCount`を「評価対象取引数 N件」として表示                                                        |
| UI-05 | COMPONENT | `SUCCEEDED`かつ全Metric利用不能                   | 主要カード0件、「現在表示できる主要指標はありません」、重複しないグループ理由最大1件を表示                         |
| UI-06 | COMPONENT | 欠損Metric DTO                                    | 欠損を`0`、`—`、推定値で補完せず、P2 Metricを主要指標へ代入しない                                                  |
| UI-07 | COMPONENT | 主要6指標の説明モデル                             | 仕様の1～2文と一致し、累積収益率と最大下落率は入出金調整後、1取引は完了取引として説明                              |
| UI-08 | COMPONENT | Warning、Precision、Metric metadata付き主要Metric | カード内へWarning Code、Precision、Metric Key、Metric Versionを表示しない                                          |
| UI-09 | COMPONENT | `REFERENCE_ONLY`の主要Metric                      | 通常値と同等に見せず、「参考値」の日本語補足を表示                                                                 |
| UI-10 | COMPONENT | 正常な`SUCCEEDED`                                 | 「運用実績」、最大6件、再計算button、「詳細指標」「計算の詳細」を表示し、`Saved analytics`と内部値を通常表示しない |
| UI-11 | COMPONENT | `latestSuccessfulRun`なし、件数とTrade Metricあり | 評価対象取引数を表示しない                                                                                         |
| UI-12 | COMPONENT | Trade `UNAVAILABLE`、他の3条件成立                | 評価対象取引数を表示しない                                                                                         |
| UI-13 | COMPONENT | `trustedClosedCycleCount = 0`、他の3条件成立      | 「評価対象取引数 0件」を表示しない                                                                                 |
| UI-14 | COMPONENT | Trade系Metricなし、他の3条件成立                  | 評価対象取引数を表示しない                                                                                         |
| UI-15 | COMPONENT | 評価対象取引数の複数条件が不成立                  | `0`、`—`、推定件数を表示せず、重複しないTrade Lane不足理由だけを正本箇所に表示                                     |

## 3. 最新Runと前回正常結果（12件）

| ID    | レベル         | 条件・操作                                         | 期待結果                                                                                                      |
| ----- | -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| PR-01 | COMPONENT      | `PENDING`＋`latestSuccessfulRun`あり               | 最新状態「計算待ち」と前回正常結果の主要指標を同時表示し、再計算buttonを無効化                                |
| PR-02 | COMPONENT      | `RUNNING`＋`latestSuccessfulRun`あり               | 最新状態「計算中」と前回正常結果の主要指標を同時表示し、再計算buttonを無効化                                  |
| PR-03 | COMPONENT      | `FAILED`＋`latestSuccessfulRun`あり                | 最新失敗案内、前回正常結果の主要指標、利用可能な再計算buttonを独立表示                                        |
| PR-04 | COMPONENT      | `INSUFFICIENT_DATA`＋`latestSuccessfulRun`あり     | 最新のデータ不足案内、前回正常結果の主要指標、利用可能な再計算buttonを独立表示                                |
| PR-05 | COMPONENT      | 最新Run非正常＋過去成功あり                        | 「前回の正常な計算結果を表示しています」を主要指標の直前に表示                                                |
| PR-06 | COMPONENT      | `latestSuccessfulRun.completedAt`あり              | 正常結果の計算日時を`YYYY/MM/DD HH:mm`で表示し、最新Runの日時へ置換しない                                     |
| PR-07 | UNIT/COMPONENT | `latestRun`と`latestSuccessfulRun`のRun IDが異なる | 状態は`latestRun`、値・Availability・`calculationDetails`は最新成功Run由来として表示モデルを構成              |
| PR-08 | UNIT/COMPONENT | 最新RunにError、過去成功MetricにWarning            | ErrorとMetricの取得元Runを維持し、Warningは通常表示だけ画面全体の意味キーへ統合、生CodeはRun別に保持          |
| PR-09 | COMPONENT      | 非正常4状態で`latestSuccessfulRun`なし             | 主要指標、0、`—`、前回結果案内を表示せず、状態別案内だけを表示                                                |
| PR-10 | COMPONENT      | `latestRun.status === SUCCEEDED`                   | 正常な主要指標を表示し、「前回の正常な計算結果」という案内を表示しない                                        |
| PR-11 | COMPONENT      | 過去成功表示中に「計算の詳細」を開く               | 「最新の計算試行」と「表示中の正常結果」が別グループで、Run ID、Warning、Error、Metric metadataを混在させない |
| PR-12 | COMPONENT      | 前回正常結果表示中に各最新状態を切り替える         | `PENDING`/`RUNNING`だけbutton無効、`FAILED`/`INSUFFICIENT_DATA`は再計算可能で、過去Metricの値は変更しない     |

## 4. Version選択（5件）

| ID    | レベル   | 条件・操作                                        | 期待結果                                                                                    |
| ----- | -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| VS-01 | CONTRACT | `performance-v3`と`performance-v2`の正常Runが存在 | 暗黙取得で`performance-v3`を選び、v3の正常結果を表示                                        |
| VS-02 | CONTRACT | v3なし、`performance-v2`の正常Runあり             | `performance-v2`へfallbackし、選択Versionが診断可能                                         |
| VS-03 | CONTRACT | `performance-v1`の正常Runだけが存在               | v1を暗黙の正常結果として選択せず、主要指標を捏造しない                                      |
| VS-04 | CONTRACT | 未知の`performance-v4`とv2の正常Runが存在         | 将来Versionのv4へ暗黙fallbackせず、`performance-v2`を選択                                   |
| VS-05 | CONTRACT | v1、v2、v3、未知Versionの`runId`を明示            | Wallet所属など既存安全条件を満たす指定RunをVersionにかかわらず尊重し、別Versionへ置換しない |

## 5. Max Drawdown（9件）

| ID    | レベル    | 条件・操作                                  | 期待結果                                                                                                |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| MD-01 | COMPONENT | v3の最大下落率説明を開く                    | 「入出金の影響を調整した資産推移において、ピークから最大でどの程度下落したかを示します。」と表示        |
| MD-02 | CONTRACT  | Cash Flowなしの同一履歴にv2/v3 Metricが存在 | v2とv3のMax Drawdown保存値が同値で、暗黙取得ではv3を表示                                                |
| MD-03 | CONTRACT  | Cash Flowありでv2/v3の値が異なる履歴        | raw Daily NAV由来のv2ではなく、TWR Wealth Index由来のv3 Max Drawdownを表示                              |
| MD-04 | COMPONENT | `UNKNOWN_CASH_FLOW`でReturn Lane計算不能    | 累積収益率と最大下落率カードを描画せず、Return Lane不足理由を「詳細指標」で意味単位に1回だけ表示        |
| MD-05 | COMPONENT | `MISSING_CASH_FLOW_BOUNDARY_NAV`            | 最大下落率カードを描画せず、入出金境界NAV不足の日本語理由を「詳細指標」で1回だけ表示                    |
| MD-06 | COMPONENT | `NON_POSITIVE_NAV`でReturn Lane計算不能     | 最大下落率カードを描画せず、利用不能NAVの日本語理由を重複なく表示                                       |
| MD-07 | COMPONENT | Return期間不足                              | 最大下落率を`0`または`—`で表示せず、対象Metric名とLane不足理由を「詳細指標」で確認可能                  |
| MD-08 | COMPONENT | Return Lane利用可能だが`maxDrawdown`未保存  | 欠損を`0`または`—`としてカード表示せず、原因を推測しない                                                |
| MD-09 | COMPONENT | raw Daily NAVが存在しMax Drawdownが利用不能 | 日次NAVは表示・監査用として「詳細指標」に維持するが、その系列から画面側でMax Drawdownを計算・補完しない |

## 6. Warning・意味キー・重複排除（23件）

| ID    | レベル         | 条件・操作                                                                  | 期待結果                                                                                          |
| ----- | -------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| WR-01 | UNIT           | 同一Codeが`latestSuccessfulRun`、Lane、3 Metricに存在                       | 表示中正常結果内でCodeを重複排除し、同じ意味キーを1件だけ生成                                     |
| WR-02 | UNIT           | `DATA_GAP`と`RETURN_PERIOD_TRUNCATED_AT_GAP`                                | `NAV_HISTORY_GAP`の日本語注意1件へ統合                                                            |
| WR-03 | UNIT           | `PARTIAL_HISTORY`、`TRADE_HISTORY_PREFIX_SKIPPED`、`POSITION_DISCONTINUITY` | 必要に応じて`INCOMPLETE_TRADE_HISTORY`の日本語注意1件へ統合                                       |
| WR-04 | COMPONENT      | 同じ意味キーが信頼性文、Warning、Availability reasonに存在                  | 通常画面では正本優先順の最上位1箇所だけに表示                                                     |
| WR-05 | COMPONENT      | 3つの未表示意味キー                                                         | 通常の注意領域へ日本語注意3件だけを表示し、「ほかN件」を表示しない                                |
| WR-06 | COMPONENT      | 5つの未表示意味キー                                                         | 先頭3件と「ほか2件の注意事項」buttonを表示し、開くと同じ領域で残り2件を含む全日本語注意を確認可能 |
| WR-07 | COMPONENT      | 未知のWarning Code                                                          | 通常画面は汎用日本語文、計算の詳細は生Codeを表示                                                  |
| WR-08 | COMPONENT      | 全体問題と特定Lane問題が混在                                                | 全体問題は上部、Lane固有問題は詳細指標内を正本とし、同じ文を両方に表示しない                      |
| WR-09 | COMPONENT      | 全Lane `AVAILABLE`                                                          | Availability Badgeと内部値を通常表示せず、計算の詳細だけで内部値を確認可能                        |
| WR-10 | COMPONENT      | `DERIVED`、`ESTIMATED`、`REFERENCE_ONLY`がWarning配列に混在                 | それだけを重大Warningにせず、生値は計算の詳細、`REFERENCE_ONLY`の表示補足は対象Metricだけに表示   |
| WR-11 | UNIT           | Codeが`latestSuccessfulRun.warningCodes`だけに存在                          | 表示中正常結果のWarning入力へ取り込み、ユーザー向け意味キーへ変換                                 |
| WR-12 | UNIT/COMPONENT | 最新`FAILED` Runと過去成功Runに異なるWarning                                | 入力の取得元Runを維持し、通常表示は最新試行由来を先にした画面全体の候補列、診断はRun別に構成      |
| WR-13 | UNIT           | Run、Metric、Availability、`calculationDetails`が同じ事象を示す             | Code表現が異なってもユーザー向け意味キーへ統合し、通常画面では1回だけ表示                         |
| WR-14 | UNIT           | `latestRun`と`latestSuccessfulRun`に同じ意味キーがある                      | 両入力を元Run付きで収集し、画面全体の重複排除で同一意味キーと判定                                 |
| WR-15 | COMPONENT      | 両Runに同じ意味キーがある                                                   | 同じユーザー向け日本語注意を通常画面に1件だけ表示                                                 |
| WR-16 | UNIT           | 同一意味キーの文言または付随情報が両Runで異なる                             | `latestRun`由来を通常表示の正本とし、正常結果側を通常表示候補から除外                             |
| WR-17 | COMPONENT      | 同一意味キーの生Codeが両Runに存在し「計算の詳細」を開く                     | 「最新の計算試行」と「表示中の正常結果」の各区分で両Runの生Codeを確認可能                         |
| WR-18 | UNIT/COMPONENT | 最新試行と表示中正常結果を合わせて4件以上の異なる意味キー                   | 最大3件をRun別でなく画面全体へ1回だけ適用                                                         |
| WR-19 | COMPONENT      | `latestRun`だけで3件、表示中正常結果にも異なる2件                           | 通常表示は最新試行由来3件と「ほか2件」。展開後に正常結果由来2件を表示                             |
| WR-20 | UNIT/COMPONENT | 両Run合計6入力のうち2件が既表示キーと重複し、重複排除後4意味キー            | 先頭3件と「ほか1件の注意事項」を表示し、Nを入力Code数でなく重複排除後の未表示意味キー数とする     |
| WR-21 | COMPONENT      | 両Run由来の残件があり「ほかN件」を展開                                      | 残りの日本語注意を「最新の計算試行」「表示中の正常結果」に分け、同一意味キーを片方にだけ表示      |
| WR-22 | UNIT           | 同じWarning Codeが複数入力箇所にある                                        | 入力箇所やRunの違いを理由に異なる意味キーへ変換しない                                             |
| WR-23 | UNIT           | `PARTIAL_HISTORY`と`POSITION_DISCONTINUITY`など異なるCodeが同じ意味を表す   | 両Codeを同じ`INCOMPLETE_TRADE_HISTORY`へ統合し、通常画面では1意味キーとして扱う                   |

## 7. Lane表示階層（6件）

| ID    | レベル         | 条件・操作                                                       | 期待結果                                                                                         |
| ----- | -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| LN-01 | COMPONENT      | Return Laneだけが`UNAVAILABLE`                                   | Return不足理由を第一階層の信頼性文または注意事項へ表示しない                                     |
| LN-02 | COMPONENT      | LN-01の状態で「詳細指標」を開く                                  | Return Laneの不足理由を日本語で確認できる                                                        |
| LN-03 | UNIT/COMPONENT | 同じ問題が複数Laneまたは全体へ影響する                           | 影響範囲判定により第一階層の信頼性文または注意事項へ表示できる                                   |
| LN-04 | COMPONENT      | 複数Lane問題の意味キーを第一階層へ表示して「詳細指標」を開く     | 同じ意味の理由文も「上記のデータ不足により」などの参照文も詳細指標へ表示しない                   |
| LN-05 | COMPONENT      | Lane不足理由に対応する生Warning Codeがある                       | Lane説明はユーザー向け日本語とし、生Warning Codeは閉じた「計算の詳細」を開いた場合だけ確認できる |
| LN-06 | COMPONENT      | Return、Trade、Exposureのいずれか1つだけに不足理由がある初期状態 | 「詳細指標」が閉じている間はLane固有理由をDOMへ表示せず、開いた後だけ表示する                    |

## 8. 状態別表示（10件）

`COMPLETE`、`PARTIAL`、`GAP_DETECTED`はRun statusではなくHistory Completenessとしてfixtureへ設定する。

| ID    | レベル    | 条件・操作                                           | 期待結果                                                                                       |
| ----- | --------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| ST-01 | COMPONENT | `SUCCEEDED`＋`COMPLETE`＋全主要Metric                | 「計算完了」、完全履歴向け信頼性文、最大6件、前回結果案内なし                                  |
| ST-02 | COMPONENT | `SUCCEEDED`＋`PARTIAL`＋一部主要Metric               | 部分履歴向け信頼性文、存在する主要指標だけを表示し、同じ不完全履歴説明を注意・Laneへ再掲しない |
| ST-03 | COMPONENT | `SUCCEEDED`＋`GAP_DETECTED`＋Gap Warning             | Gapを跨がない信頼性文と、別の意味キーだけを注意表示し、生状態Codeを通常表示しない              |
| ST-04 | COMPONENT | `SUCCEEDED`＋Trade `UNAVAILABLE`＋Return `AVAILABLE` | Return由来だけを表示し、評価対象取引数・勝率・Profit Factorを`0`で補完しない                   |
| ST-05 | COMPONENT | `SUCCEEDED`＋全Lane/全Metric `UNAVAILABLE`           | 主要カード0件、グループ案内、再計算button、計算の詳細への到達を提供                            |
| ST-06 | COMPONENT | `PENDING`＋過去成功なし                              | 「計算待ち」、`role=status`、無効button、主要指標なし                                          |
| ST-07 | COMPONENT | `RUNNING`＋過去成功なし                              | 「計算中」、`role=status`、無効button、主要指標なし                                            |
| ST-08 | COMPONENT | `FAILED`＋過去成功なし                               | 利用者向け失敗文、`role=alert`、再計算button、生Errorは閉じた計算の詳細だけ                    |
| ST-09 | COMPONENT | `INSUFFICIENT_DATA`＋過去成功なし                    | データ不足案内、再計算button、主要指標なし、0補完なし                                          |
| ST-10 | COMPONENT | Runなし / Overview loading / Overview error          | 未計算、読込中、取得失敗の日本語案内と適切なroleを表示し、技術payloadを表示しない              |

## 9. 詳細指標・計算の詳細（8件）

| ID    | レベル    | 条件・操作                                            | 期待結果                                                                                                           |
| ----- | --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| DT-01 | COMPONENT | 初期表示                                              | 「詳細指標」と「計算の詳細」が独立したbuttonで閉じ、`aria-expanded=false`                                          |
| DT-02 | COMPONENT | 「詳細指標」を1回開く                                 | P2 Metric、計算不能Metric名、Lane不足理由、日次NAV概要、Position Cycle概要を追加の開閉なしで確認可能               |
| DT-03 | COMPONENT | 詳細指標のDOMを検査                                   | Metricグループ、計算不能Metric、NAV、Position Cycleの新しいAccordionまたは入れ子buttonが存在しない                 |
| DT-04 | COMPONENT | 過去成功表示中に「計算の詳細」を開く                  | 最新試行のStatus/Error/Warning/日時と、表示中正常結果のVersion/Availability/`calculationDetails`を別グループで表示 |
| DT-05 | COMPONENT | 最新Runと最新成功Runが同一                            | 共通するRun ID、Fingerprint、期間、Versionを二重表示せず、同じRunであることを示す                                  |
| DT-06 | COMPONENT | Run期間と全Lane期間が同一                             | 正本となる正常結果の期間を1件だけ表示                                                                              |
| DT-07 | COMPONENT | Return Lane期間だけ異なり、1 Metric期間もLaneと異なる | 正本期間に加えReturn Lane差分と、そのLane期間とも異なるMetric期間だけを表示                                        |
| DT-08 | COMPONENT | Metric metadataあり                                   | 追加折りたたみなしでKey、Version、status、precision、warningCodesを確認し、期間はLaneと異なる場合だけ表示          |

## 10. アクセシビリティ・レスポンシブ（12件）

| ID    | レベル    | 条件・操作                                | 期待結果                                                                              |
| ----- | --------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| AX-01 | COMPONENT | Metric説明buttonの初期DOM                 | `button`、指標名を含む`aria-label`、`aria-expanded=false`、有効な`aria-controls`      |
| AX-02 | COMPONENT | Metric説明buttonをクリックし、再クリック  | 1回目で説明表示と`aria-expanded=true`、2回目で非表示と`false`                         |
| AX-03 | COMPONENT | Metric説明buttonへTab移動しEnter          | 説明を開閉でき、`aria-expanded`が状態と一致                                           |
| AX-04 | COMPONENT | Metric説明buttonへTab移動しSpace          | 説明を開閉でき、ページスクロールだけが発生しない                                      |
| AX-05 | COMPONENT | hoverしないmobile条件でMetric説明をタップ | 1～2文の説明を確認でき、44px相当のタップ対象が利用可能                                |
| AX-06 | COMPONENT | 「ほか2件の注意事項」buttonの初期DOM      | `aria-expanded=false`、`aria-controls`、未表示件数を含むbutton名                      |
| AX-07 | COMPONENT | 「ほかN件」をクリック、Enter、Spaceで開閉 | 同じ注意領域で全日本語注意を表示し、`aria-expanded`を更新                             |
| AX-08 | COMPONENT | mobile条件で「ほかN件」をタップ           | 生Code画面へ移動せず、残りの日本語注意を同じ領域で確認可能                            |
| AX-09 | VISUAL    | viewport 1920px                           | 実際の主要指標グリッドが3列                                                           |
| AX-10 | VISUAL    | viewport 1366px                           | 実際の主要指標グリッドが3列                                                           |
| AX-11 | VISUAL    | tablet viewport                           | 実際の主要指標グリッドが2列                                                           |
| AX-12 | VISUAL    | mobile viewport                           | 実際の主要指標グリッドが1列で、CSS class名ではなく要素位置またはvisual snapshotで検証 |

3 / 3 / 2 / 1列の正本はAX-09～AX-12のVisualテストとし、E2Eでは全viewportを反復しない。buttonのモバイルタップ契約はAX-05とAX-08、Warning展開はAX-06～AX-08を正本とする。E2Eは代表viewport 1つで主要指標説明を1件開く導線だけを確認し、Warning展開と同じ操作契約を重複確認しない。

## 11. 回帰・非変更（9件）

| ID    | レベル         | 条件・操作                                    | 期待結果                                                                                           |
| ----- | -------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| RG-01 | UNIT/COMPONENT | performance-v3の保存済みMetric DTO            | すべての表示値が既存formatterと一致し、勝率`0.3333...`は`33.33%`相当                               |
| RG-02 | CONTRACT       | Overview、NAV、CycleのPhase 4.1.1基準response | top-level、nested field、型、nullable、URL、HTTP methodを含む構造が完全一致し、新fieldを追加しない |
| RG-03 | CONTRACT       | calculate / recalculate response              | `calculationVersion`が`performance-v3`のまま                                                       |
| RG-04 | COMPONENT      | 再計算buttonを押す                            | 既存endpointを1回呼び、楽観的「計算待ち」へ移り、二重送信しない                                    |
| RG-05 | UNIT/COMPONENT | `PENDING`、`RUNNING`、poll上限、address変更   | 既存Polling判定、上限、古いresponse破棄を変更しない                                                |
| RG-06 | COMPONENT      | 成功画面または前回正常結果表示を再読み込み    | 同じ`latestSuccessfulRun`の主要指標、詳細NAV、Cycleを再表示                                        |
| RG-07 | COMPONENT      | Web/API version表示                           | version表示と不一致WarningがPhase 4.1.1どおり動作                                                  |
| RG-08 | UNIT/COMPONENT | Error payloadにsecret、内部URL、stackを含める | HTMLとPerformance responseへ秘密情報を表示せず、安全化済み文だけを表示                             |
| RG-09 | CONTRACT       | packageとWeb/APIのアプリVersion               | app version `0.3.1`を維持し、Web/API version表示へ退行がない                                       |

## 12. E2Eシナリオ（7件）

E2Eは代表viewportとして1366pxを1つだけ使用し、3 / 3 / 2 / 1列を反復検証しない。役割を実画面到達、主要指標の初期表示、2つの詳細領域、代表的な説明button、前回正常結果、再計算・Polling、Version表示に限定する。

| ID    | 前提データ                                                   | 操作                                  | 期待結果                                                                                        |
| ----- | ------------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| E2-01 | `COMPLETE`、主要6件とP2 Metricあり                           | ログインし、address詳細の実画面へ到達 | 初期表示に主要6件だけを表示し、P2 Metric、詳細指標、計算の詳細の内容を初期表示しない            |
| E2-02 | 成功Run、P2 Metric、NAV、Position Cycleあり                  | 「詳細指標」を開き、閉じる            | P2 Metric、NAV、Position Cycleへ到達でき、閉じると詳細領域を非表示に戻せる                      |
| E2-03 | 最新Runと最新成功Runの診断情報あり                           | 「計算の詳細」を開き、閉じる          | Run情報と生Codeを確認でき、閉じると診断領域を非表示に戻せる                                     |
| E2-04 | 主要指標説明あり                                             | 代表的な主要指標説明buttonを1件開く   | 対応する1～2文の説明を確認できる。Warning展開または全入力方式を同じE2Eで反復しない              |
| E2-05 | 最新`FAILED`、過去成功Run、主要Metricあり                    | 画面を開く                            | 最新失敗、前回正常結果の案内と計算日時、過去成功Run由来の主要指標を表示する                     |
| E2-06 | 過去成功Runあり、手動再計算で`PENDING`→`RUNNING`→`SUCCEEDED` | 再計算button押下後にPolling           | 待機・実行中は前回正常結果と日時を維持してbuttonを無効化し、成功後は最新正常結果へ置換する      |
| E2-07 | app version `0.3.1`、calculation version `performance-v3`    | Web/API version表示を確認             | app version表示と不一致Warningが退行せず、選択されたPerformance Versionを計算の詳細で確認できる |

## 13. E2E fixture要件

E2-01では次の保存済み値を用意し、画面側で値を作らない。

E2-01のRunとMetric Versionは`performance-v3`とし、`maxDrawdown`はTWR Wealth Index由来の保存済み値を使用する。

| 項目                      | fixture値                                | 期待表示  |
| ------------------------- | ---------------------------------------- | --------- |
| `winRate`                 | 既存formatterで33.33%になるDecimal文字列 | 33.33%    |
| `profitFactor`            | 約`2.19`相当                             | 約2.19    |
| `maxDrawdown`             | 約`-0.3412`相当                          | 約-34.12% |
| `cumulativeReturn`        | 約`0.0062`相当                           | 約0.62%   |
| `trustedClosedCycleCount` | `3`                                      | 3件       |
| `topTradeContribution`    | `1`                                      | 100%      |

E2-05では`latestRun.runId !== latestSuccessfulRun.runId`とし、`latestSuccessfulRun.completedAt`を固定する。Overviewの`metrics`、`availability`、`calculationDetails`は過去成功Run由来、最新Errorは`latestRun`由来とする。Warning統合の組合せ検証はWR-14～WR-23を正本とし、E2Eで反復しない。

E2-07ではapp version `0.3.1`と計算version `performance-v3`を固定し、v3優先・v2限定fallbackの選択規則自体はVS-01～VS-05を正本とする。

「約」は設計資料上の表現であり、実テストはfixtureへ保存したDecimal文字列に対する既存formatterの厳密な出力と比較する。

## 14. API非変更の確認方法

1. Phase 4.1.1基準のOverview、Run、NAV、Cycle responseを、field名、入れ子、型、nullableまで含む厳密な契約fixtureとして比較する。
2. `latestRun`と`latestSuccessfulRun`が別Runのfixtureで、`metrics`、`availability`、`calculationDetails`が最新成功Run由来である既存契約を確認する。
3. 既存`apps/api/src/app.test.ts`のOverview、Run、NAV、Cycle契約テストを変更せず通す。
4. Web側の`performance-api.ts`を差分対象に含めない。
5. UIだけで日本語化、意味キー集約、表示選択を行う。
6. 新しいfieldが必要になった設計案は実装せず、Phase 4.2.0の対象外として報告する。

## 15. 実装完了時の必須コマンド

Phase 4.2.0のコード実装完了時は、プロジェクトルールに従い次をすべて実行する。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

本設計タスクではコードとテストを変更しないため、文書のPrettier確認と既存のlint、typecheckを実行記録へ分けて報告する。PostgreSQL、Redis、Dockerを必要とする全体テストとE2Eは、本設計文書修正の必須条件にしない。
