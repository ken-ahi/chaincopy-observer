# Phase 4.3 参考ウォレット選定 Test Matrix

最終更新: 2026-08-08

| ID    | 層             | シナリオ                         | 期待結果                                     |
| ----- | -------------- | -------------------------------- | -------------------------------------------- |
| WS-01 | Analytics Unit | performance-v3なし / v2のみ      | REVIEW / `NO_PERFORMANCE_V3`                 |
| WS-02 | Analytics Unit | 履歴不完全、期間不足、取引不足   | 対応するREVIEW理由を保持                     |
| WS-03 | Analytics Unit | 必須3指標の各欠損                | REVIEW / `REQUIRED_METRIC_MISSING`           |
| WS-04 | Analytics Unit | 同期時刻なし / stale             | REVIEW / `DATA_STALE`                        |
| WS-05 | Analytics Unit | 収益、下落幅、大勝ち依存が閾値外 | 対応するEXCLUDED理由を保持                   |
| WS-06 | Analytics Unit | 全条件通過                       | QUALIFIED候補になる                          |
| WS-07 | Analytics Unit | 上限N、N超過、N未満              | 上位NだけSELECTED、水増しなし                |
| WS-08 | Analytics Unit | 同率                             | 年率、下落幅、取引数、addressで安定順位      |
| WS-09 | Analytics Unit | AUTO / INCLUDE / EXCLUDE         | 有効状態だけ変更し、自動理由を保持           |
| WS-10 | Prisma / E2E   | 初回評価                         | Run、Result、Performance Run参照を保存       |
| WS-11 | Prisma / E2E   | 同一入力を再評価                 | 同一Runを再利用                              |
| WS-12 | Prisma / E2E   | 設定変更後に再評価               | 別Runを保存                                  |
| WS-13 | Prisma         | Result保存中の失敗               | transaction rollbackで部分結果なし           |
| WS-14 | API Unit       | 内部secretなし                   | 401                                          |
| WS-15 | API Unit       | settings取得・更新・validation   | 正常応答 / 不正入力400                       |
| WS-16 | API Unit       | evaluate / override              | 正常応答、未知decision 400、未知wallet 404   |
| WS-17 | API Unit       | 予期しない内部エラー             | secret・stackを含まない500                   |
| WS-18 | Web Unit       | 4状態・理由・確かさ              | 初心者向け日本語、内部enum非表示             |
| WS-19 | Web Unit       | summary / filter / empty state   | 有効状態件数、絞り込み、初回案内             |
| WS-20 | Web Unit       | settings / manual actions        | 保存後に再評価案内、3操作を提供              |
| WS-21 | Browser E2E    | ページ表示・再評価               | 参考対象 / 要確認と主要指標を表示            |
| WS-22 | Browser E2E    | INCLUDE / EXCLUDE / AUTO         | 状態反映、AUTO復帰、自動理由保持             |
| WS-23 | Browser E2E    | Discovery Candidate              | Selection一覧へ直接混入しない                |
| WS-24 | Browser E2E    | reason code                      | 内部コードを画面へ表示しない                 |
| WS-25 | Service Unit   | Run全体365日、年率Metric期間60日 | REVIEW / EVALUATION_PERIOD_TOO_SHORT         |
| WS-26 | Service Unit   | 年率Metric期間90日・期間逆転     | 90日は通過、逆転はREVIEW                     |
| WS-27 | Service Unit   | 設定A → B → A                    | Run Aを再利用しcurrent pointerもRun A        |
| WS-28 | Service Unit   | Run A再利用後のPhase 5参照       | listEffectiveSelectedWalletsはRun A由来      |
| WS-29 | Service Unit   | 新規Result保存失敗               | current pointerは以前のRunから切り替わらない |
| WS-30 | Analytics Unit | 閾値と鮮度のちょうど境界         | 0、-0.5、0.75、24時間前を通過                |
| WS-31 | Analytics Unit | maxAutoSelected = 0              | SELECTED 0件、合格walletはQUALIFIED          |
| WS-32 | Service Unit   | settings初回作成の同時upsert     | P2002後に作成済みsettingsを再取得            |

全体ゲートは`format:check`、`lint`、workspace再帰`typecheck`、`test`、workspace再帰`build`、`CI=1 test:e2e`である。
