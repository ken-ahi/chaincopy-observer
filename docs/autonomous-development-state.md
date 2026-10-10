# Autonomous Development State

最終更新: 2026-10-10 (Asia/Tokyo)

## 目的と正本

本書は、`docs/codex-autonomous-master-prompt.md` に従う作業再開用の状態記録である。プロダクト仕様は `docs/SPEC.md`、段階計画は `docs/implementation-plan.md`、確定判断は `docs/decisions.md`、AI開発手順は `docs/ai-development-workflow.md` を正とする。本書はこれらを変更しない。

## Phase 5.4 現在地（過去工程の状態より優先）

- PR #38はmainへmerge済み、base `4999b15db3fcfc761864237c77c4cd23a43d5127`。feature `codex/phase5-4-direction-change`。Phase 5.3 migration/Signal保存や上流処理は繰り返さない。
- direction-change-v1を実装。同一coin/Selection/cohort/weight、exact15分隣接、保存済みcurrent-valid Signalだけを比較。epsilonなし、confidence独立、NONEもimmutable保存。詳細はADR-046 / `docs/phase5-4-direction-change-spec.md`。
- Stage 1 READ ONLY監査: 1,332 Signalは全件current-valid、269隣接ペア、1,056 gap境界、先頭7件。net+1/0/-1は606/154/572。欠落を0で補わない。実DB変更なし。
- 新規DirectionChange 1 table / 2 RESTRICT FK / 6 index / 4 CHECKを設計。実migration/実保存/mergeは**別Owner承認待ち**。Phase 5.3承認を流用しない。通知/Phase 6へ進まない。
- Owner追加承認による限定security修正: Next/plugin16.3.6→16.3.8、sharp override0.35.4→0.35.5と必要lockfileのみ。修正commit `0a5bb551d245e05ee54551cfe999b6cd614287be`。既存braces例外/gate不変。全隔離validation PASS: format/lint、typecheck/build11/11、83 files870tests、E2E24/24。audit critical0/high1は正確な既承認bracesのみ（moderate7）。
- 正式read-only preview完了 `2026-10-10T10:38:02.216Z`。269ペア=BUY弱まり11/SELL弱まり11/強気反転82/弱気反転100/NONE65、加速0。gap1,056は未比較、欠落補完なし。保護17 table hash/queue前後一致、Signal1,332・Behavior2,012・集約1,332+1,332・weight/Selection/DQ不変。Worker停止、一時process終了。実migration13件のまま、新規tableは存在しない。
- 実行image `sha256:ff4748758278a0245c0cc6f56d54ead3be0b1a0a9d6d887096a10c80779af6b1`のrevisionは0a5bb55。正本: `docs/phase5-4-verification.md` / `docs/phase5-4-readonly-preview.json`。新規SQL SHA256 `6409a6bc6005609198fd81d46dd271358abcf679b3c06b96896936d1e88cb761`。最終head CI成功後も**READY_FOR_MIGRATION_APPROVAL**でPRをopenのまま停止。実適用/実保存/merge承認を流用しない。

## Phase 5.3 完了記録（履歴）

- PR #37はmainへmerge済み。base `0cde866ece640abef318c137fe5ae9df031c87d2`、feature `codex/phase5-3-signal`。Phase 5.2 migration/weight保存は繰り返していない。
- `signal-v1`実装、仕様/ADR-045、immutable Signal 1 table、read API、明示fingerprint付きCLIを追加。wallet/bucket方向集合の1票制限、混在は各0.5、weightによる影響度とnotional diagnosticsを分離。confidenceは単一walletを広範consensus扱いしない。
- READ ONLY監査で既存Phase 5.1 receiptはwallet別寄与に十分。実preview完了: 1,332 buckets / 7 coins、BUY優勢606、SELL優勢572、mixed/balanced154、NO_SIGNAL0。全結果同一Selection/weight provenance、保護16 table hashとqueue件数は前後一致。Behavior2,012/aggregation1,332/weight1+1/OPEN Behavior DQ0不変、通常Worker停止。
- Ownerが限定security repairと正確なSignal SQL SHAを明示承認。`source-map-js`だけをworkspace overrideで1.2.2へ更新し、全旧1.2.1経路を解消。例外拡張・無関係依存更新なし。修正commit `752e3a833d0c78520724845799aa800f1080f08a`、CI #99成功。
- 全隔離validation再実行: format/lint、typecheck/build11/11、81 files825tests、E2E23/23 PASS。`security:audit` PASS（critical0/high1は既承認の正確なbraces3.0.3 advisoryのみ、moderate7）。明示隔離55433/56380だけでtestし、実DBをtest接続先にしていない。
- 実migration完了 `2026-10-06T13:37:24.545898Z`: 承認済み `20261006000000_behavior_signal`だけ、SHA256 `e32b7973dd002e83fb2127cf86cb2a7862ba37aa38826cad811898173de72c0e`一致。全preflightを確認、13 applied / 0 pending、catalogで1 table / 7 index / 3 RESTRICT FK / 2 CHECK確認。exact image `sha256:eaefe48d0202b4d827e282713586b47a6546cc6af6090fdc68f50a71f2e20090`、revisionは752e3a8。
- migration後fresh previewのfingerprintで正式Signal serviceにより1,332件だけ保存。同一全件再実行は追加0・全列不変、7 coin保存API確認。最終 `LIVE_VERIFICATION_PASS` は `2026-10-06T13:45:01.965Z`。BUY606 / SELL572 / mixed-balanced154。保護16 table hash・queue不変、Behavior2,012 / aggregation1,332+1,332 / weight1+1 / Selection不変、OPEN Behavior DQ0。通常Worker停止・一時process終了。完了済みmigration/保存/上流処理を繰り返さない。
- 実運用blockerは解消。文書追補の最終head CI成功・PR mergeable・scope不変を確認後、今回Owner standing authorizationによりPR #38を自動mergeする。Phase 5.4は未実装・今回対象外。
- 正本・preview・SQL SHA・検証・次の安全な手順: `docs/phase5-3-signal-spec.md`、`docs/phase5-3-verification.md`、`docs/phase5-3-readonly-preview.json`。
- PR: [#38](https://github.com/ken-ahi/chaincopy-observer/pull/38)。実装commit `129dd48`、security修正 `752e3a8`をpush済み。文書追補の最終head CI/merge結果はPR checks・merge recordを正とする。新規High/Critical（正確な既承認braces例外以外）なら停止する。

## 前工程のGitHub状態（履歴）

- branch: `codex/phase5-2-wallet-weight`
- branch base: `db8ac2cc5160948db8b9c4a970c6d1656cb6bb3b`（PR #36 merge）
- Issue 26: PR #27のmain mergeにより完了。Stage 3B/3Cやdownstream rebuildは再実行しない。
- PR #29〜#36はmainへmerge済み。46 wallet refresh、BTC/xyz:CL recovery、Phase 5.1集約は完了済みで繰り返さない。現在はPhase 5.2 deterministic wallet weight工程。
- AWS Requester PaysのLIST / HEAD / inventory / download、その他の有料データソースは使用しない。過去の有料archive設計は参考資料として保持するが、現行の実行計画ではない。
- 下記の過去工程のPR open表記・承認境界は当時の記録。Phase 5.2の新規weight 2 table migrationは正確なSQL SHA256に対してOwner承認済みで、10月2日に限定適用・実検証を完了した。Phase 5.1承認の流用ではない。PR #37は最終head CI成功・mergeable・scope不変を条件にOwnerが自動mergeを承認。Selection閾値、Discovery拡大、destructive DB/Redis、手動DQ/cursor変更は引き続き許可しない。

## Phase 5.2 wallet-weight-v1

- 同日Owner追加承認: 公開修正版のない `braces@3.0.3` / `GHSA-vfj7-8cjw-p6xm`だけをtemporary security debtとして例外化する。`pnpm security:audit`は元のhigh-level audit JSONを出力し、厳密なidentity/version/dev path/count/exit照合とresolved inventory確認を行う。他High/Critical、取得失敗、版変更やbraces不在はfail closed。公開patched経路が出たら直ちに撤去。ADR-044 / `docs/security-audit-exception.md`。過去のBLOCKED記録はこの限定承認でのみ更新され、通常runtime操作の許可にはならない。
- 例外gate実装・隔離検証完了: focused 39件、全79 files / 795 tests、E2E 22/22、format/lint、typecheck/build 11/11 + script strict typecheck、diff check PASS。plain auditはHigh 1を引き続き報告し、gateはその承認済み一致だけでPASS。新規依存変更なし。実DB/Redisへ接続せず、migration/保存/通常運用を再実行していない。検証containerは停止、一時runner除去。最終head CIとmergeabilityを確認後、今回Owner承認の限定条件を満たした場合のみPR #37をmergeする。
- 10月3日限定dependency-security追補: CI #93はlint/typecheck/tests/build/E2Eを通過したがauditでcritical 1 / high 6を検出し停止。Owner承認によりNext / plugin `16.3.5 → 16.3.6`、Fastify `5.10.0 → 5.12.2`、workspace brace-expansion override `5.0.9 → 5.0.11`だけを更新。必須Next内部依存・peer参照とFastifyが要求するprocess-warning `5.1.0`以外のlockfile upgradeなし。release-age例外追加・アプリコード変更なし。
- 承認対象の脆弱性は解消したが、再auditで別package `braces@3.0.3`のhigh `GHSA-vfj7-8cjw-p6xm`を検出。critical 0 / high 1 / moderate 7。auditはpatched `>=3.0.4`を表示する一方、registryは3.0.4未公開、公式advisoryはpatched None。3.0.4更新の提案は確認後撤回し、未公開版/override/fork/ignoreは導入しない。公開・検証済み修正とscope承認が得られるまでmergeはBLOCKED。
- この追補では実DB/Redisに接続しなかった。既に成功済みのmigration・weight保存を再実行せず、通常Workerも起動していない。隔離55433/56380でformat/lint、typecheck/build 11/11、78 files / 756 tests、API auth/routing 44/44、E2E 22/22がPASS。Next 16.3.6のclean production buildと実standalone serverの `/login` 200も確認。auditだけは上記braces highでFAIL。schema/SQL差分0、承認済みSQL SHA不変。検証containerを停止し、一時runnerを除去した。詳細は `docs/phase5-2-verification.md`。
- 正式契約: `docs/phase5-2-wallet-weight-spec.md` / ADR-043。
- Read-only監査: automatic 46、trusted Performance 44、trade-history evaluable 36、SELECTED 1 / QUALIFIED 0。PF/cycle外れ値を踏まえbounded transformを採用。selected 1件に係数をfitしない。
- Selection SSoT admissionを再利用。quality × sample confidence × concentration、Decimal precision 80、cohort合計正確に1。NAV指標・追加threshold・Signalは導入しない。
- 新規immutable snapshot/entry 2 table、4 Restrict FK、既存tableへのDDL/書換えなし。SQL: `prisma/migrations/20260928000000_wallet_weight/migration.sql`。
- PreviewはREAD ONLY、APIはmatching current receiptのみ返す。過去snapshotは新Performance/EXCLUDE/cohort変更でも不変。
- 10月1日のpreflightは保存previewのtimestamp `.45Z` / canonical `.450Z`不一致で実変更前に停止。原因はPowerShell JSONの自動日時変換による末尾0除去。Owner承認により10月2日にJSONの2文字列だけを訂正し、SHA256(JSON.stringify(inputSnapshot))が宣言値と完全一致することを確認。金融入力・式・コード・schema・SQLに変更なし。全preflightを初めから再実行した。
- 実行provenance: HEAD `12253b2c8350d44b10947ded1ee64a22ca3ca9d8`、image `sha256:b1abab1d53ce6793d85974d9596b755f9a6e6cb027902530f13d1eb522312f7d`。PostgreSQL/Redis healthy、pendingは承認済み1件だけ、disk・current cohort・保護hash・queueを再確認してから適用。SQL SHA256 `566d4ac9e246a6a072c56fbe308aabb5dc77940ed19bacbc1d562a6362ec9c67`一致、migration完了 `2026-10-02T13:30:06.498Z`、12 applied / 0 pending。2 table / 7 index / 4 RESTRICT FK / bounds CHECKをcatalog確認済み。
- migration後の**fresh live preview**を正として正式CLIで1 snapshot / 1 entryだけ保存。raw `0.339174742605900594492010777724425848` / normalized `1`、input fingerprint / snapshot ID `df5787c523f18a541b8fe127bbfa651ce13b1beaf2601ac9638218bfc602c9cd`、calculatedAt `2026-10-02T13:31:01.653Z`。同じCLIの再実行は追加0行、全列・時刻不変。SQL合計は正確に1。現在APIは401/200/no-store/CURRENTとreceipt全項目一致を確認。
- 最終read-only監査 `2026-10-02T13:36:06.324Z`: Behavior 2,012 / bucket 1,332 / revision 1,332の全列hash不変、OPEN Behavior DQ 0。Selection `cmujbqjbu2af4nq01zg56l0vc`、Performance `cmujbpj6527jdnq01t6zuxi9u`とtrusted evidence、全wallet/cursor/DQ/quarantine/queueも不変。8,427 backlogと既存unlocked active 1は未操作。通常Worker停止、一時処理終了。sync/downstream再計算なし。
- 実装時隔離Validation: format/lint PASS、typecheck/build 11/11、78 files / 756 tests、隔離E2E 22/22、audit high+ 0（既存moderate 4）、diff check PASS。全DB/Redisテストは明示した隔離55433/56380のみ。今回の追補は3文書のみでlocal format/lint/fingerprint/diff checkと最終head CIを確認し、実DBへtestを接続しない。
- 詳細証拠・SQL SHA・catalog・実コマンド・保護hash・disk: `docs/phase5-2-verification.md`。実migration/保存/API検証は完了済みで再実行しない。Phase 5.3は未着手・対象外。
- PR: [#37](https://github.com/ken-ahi/chaincopy-observer/pull/37)。運用追補 `d6088c2`のCI #93はaudit失敗、dependency修正 `554f6d8`のCI #94はbracesのみで失敗した歴史的記録。現在は同日Ownerが厳密な一時例外gateを承認しており、最終head CI/gate成功・mergeable・scope不変をmerge条件とする。他High/Criticalは依然停止条件。次のdependency maintenanceで公開patched経路を確認したら例外を即撤去する。実DB操作再開の許可ではない。最終GitHub状態はPR checks/comment/merge recordを正とする。

## Phase 5.1 aggregation（実装・限定運用検証完了）

- 正式契約: `docs/phase5-1-behavior-aggregation-spec.md` / ADR-042。
- 15分UTC、8 semantic cells、unique wallet participationとevent/notional分離。SSoTから現在cohortを取り、生成時provenance・DQ・cursor・保存Fillとの整合を確認する。weight/Signalなし。
- 新規bucket/revision 2 table、immutable snapshot/fingerprint、late bucket再計算、STALE read抑止。常駐consumer/schedulerは追加しない。
- 明示TEST/E2E専用接続先を必須化。通常runtime URLからのfallback禁止。隔離55433/56380でmigration、76 files/730 tests、E2E 22/22、typecheck/build 11/11、format/lint、audit high以上0（unrelated moderate 4）、diff checkを確認。
- Owner承認済みの新規2 table migrationを実DBへ適用、status up to date。実行commit `a14777d6e6c6fb071470d3899779ee2d23872178`の正式CLIでselected 1 wallet、既存2,012 events → 7 coin / 1,332 VALID buckets / 1,332 immutable revisions。合計notional `593728.292566`は元イベントと厳密一致。各bucketのuniqueWalletCountは1。
- SHORTの負のゼロをflipと誤認した新規照合バグはdry-runで停止・回帰修正し、永続集約前に解消。既存Behavior変更なし。再実行2bucketは追加0行、全bucket/revision hash不変。
- 全2,012 Behavior row SHA-256 `f8a450777e4a64d085edd13634150d1328f8b9e5b8ce239550910dc7db20739a`前後一致。Behavior OPEN DQ 0→0、source DQ/Selection/override/全wallet/cursor/既存Run/scope/selected Fill/quarantine 14のhashも一致。queue state不変、8,427 enrichment backlogと既存unlocked activeは未操作。常駐Worker停止のまま、隔離test containersも停止。
- 詳細: `docs/phase5-1-operational-verification.md`。PR作成・final-head CI確認後、今回のOwner standing authorizationに従い安全境界内でmergeする。完了済みのsync/Behavior/限定集約を繰り返さない。
- 次Phase 5.2はwallet-selection-v2のtrusted closed-cycle metricsに合わせた再設計が先。NAV metricを必須化する古いweight候補をそのまま実装しない。

## xyz:CL canonical quote provenance（2026-09-27）

- 正式契約/証拠/運用結果: `docs/hyperliquid-xyz-cl-quote-provenance.md`、ADR-041。公式無料Info APIのDEX、market index、canonical USDC token ID、USD/barrel annotationをexact joinする。symbolやfeeToken単独から推測しない。未知/競合/欠損customは引き続きfail closed。
- 実装commit `2f5a33c63a6ea30f4cdcb57efda2ea378a328af6`のexact Worker imageで、selected wallet `0x34112cf6672cbad0f44b5a77857099417dc686af`のxyz:CLだけを処理。33 Fill → 33 event追加、最終FLAT。合計1,979 → 2,012、既存1,979行は全列SHA-256完全一致。
- Run `cmujv08ku000dl401j8yurrcb`、証拠RawEvent `cmujv08me000gl401kw4uvk0k`。完全な公式response/hash/取得時刻を保存し、通常HTTP retentionからこの証拠種別を除外する。schema/migration不要。event identity/金融式は不変。
- OPEN Behavior DQ 2 → 0。UNSUPPORTED_QUOTEと同一groupの旧MISSING_BOUNDARYは既存successful-group lifecycleで自然解消し、旧診断の行・内容・Run linkを保持した。手動DQ変更なし。BTCや他coinは未処理。
- Selection Run `cmujbqjbu2af4nq01zg56l0vc`、policy v2、selected 1/rank 1、Performance Run、全wallet/override/source DQ/cursor、quarantine 14は不変。latestActivity `2026-09-24T13:21:27.107Z`も不変。再実行は0 eventのno-op。
- queue counts/active identityは前後不変。enrichment prioritized 8,427 + 既存stale/unlocked active 1を消費・削除しない。常駐Worker停止のまま、実PostgreSQL/Redis healthy。sync、Performance/Selection再評価、Discoveryは実行しない。
- validation: format/lint、typecheck 11/11、tests 73 files/694、build 11/11、isolated E2E 22/22、audit high以上0、diff check PASS。integration/E2Eは明示した隔離55433/56380へ接続し、終了後に隔離containerだけ停止した。
- PR #35: feature branch push済み。運用文書追加後のfinal-head CI/mergeabilityを確認し、今回のOwner承認条件を満たした場合のみmergeする。結果が既に保存済みなのでcanary/syncを繰り返さない。
- 次工程: このselected walletについて既知Behavior blockerは解消。未知custom marketへの一般化、Discovery拡張、過去データ書換えや実取引には進まない。将来のcollateral migration/market定義変更は別途再監査する。

## Selected-wallet Behavior correctness（2026-09-27）

- 対象: `0x34112cf6672cbad0f44b5a77857099417dc686af`だけ。詳細証拠: `docs/selected-wallet-behavior-correctness.md`、判断: ADR-040。
- BTC: 不連続検出は正しいが、欠けたOPEN 2件はcanonical rawに存在。walletを含まないexternal ID uniqueに別walletのparticipantが衝突していた。新規wallet-scoped external IDと既存fingerprint維持でmigration/既存行更新なしに修正。
- xyz:CL: 先頭startPosition=0。quote未証明のエラーをMISSING_BOUNDARYに隠す診断不備を修正。unsupported quoteは引き続きfail closed。後続FLATへのskipを導入しない。
- latestActivityAt: Performance計算日時からcanonical保存済み最終Fill時刻へ修正。UIは「最終約定（取得済み）」、未取得はnull。
- Validation: format/lint/typecheck PASS（11/11）、71 files / 671 tests PASS、build 11/11、E2E 22/22、audit high+ 0、diff check PASS。専用ports 55433 / 56380の新規PostgreSQL/Redisだけをtest対象に指定した。
- 限定運用検証完了: exact image `chaincopy-worker:behavior-4f73756`から選定済み1 walletの4日間の正式Fill sync 1回（取得9 / 追加2）。BTCはcursorから正常継続し91 events追加、最新Fillまで到達。Behavior合計1,888→1,979。既存全1,888 eventsと2,009 fillsの同一性hash一致。
- xyz:CLはquote provenance未証明のため0 events / UNSUPPORTED_QUOTEを維持。BTC DQは正常処理でRESOLVED、xyz旧誤診断MISSING_BOUNDARYは手動変更せず残し、新しい正確なissueを記録。OPENは2→2だが、両方xyzの同一groupであり独立した2欠損ではない。
- API projectionのlatestActivityAtは`2026-09-24T13:21:27.107Z`を確認。Selection Run `cmujbqjbu2af4nq01zg56l0vc`、selected 1、rank 1、Performance Runとpolicyは不変。syncによるlastSyncAt更新は正式契約の副作用であり、手動変更なし。
- 運用runnerのwallet全体不変assertionはこの正常lastSyncAt更新で停止したが、処理を繰り返さずread-only postcheckで残確認を完了した。queue count/active identity、他participant row、source DQ、quarantine 14は不変。常駐Worker/consumerは停止のまま。
- PR #34: implementation commit `4f73756fca8ef560145276a44fc7f6461ee67b50`のCI PASS。運用文書追加後のfinal CI/mergeabilityを確認して、今回のOwner明示承認に基づきmergeする。
- 次のblocker: xyz:CLのcanonical quote provenance。閾値緩和、manual INCLUDE、後続FLATへのskip、手動DQ解消、Discovery拡大は行わない。他walletのcollision recoveryへ自動拡張しない。

## 完了済みで再実行しない作業

- Issue 26 Stage 3Bでmanifest許可済みの `portfolio_snapshots` 161件を削除した。
- Issue 26 Stage 3Cでcanonical replay 18/18を完了し、対象latest/current group 31/31を復元した。
- 14 incident performance runは `QUARANTINED` のまま保持した。
- Stage 3Cで解消された8件のDQは監査済みで、8/8 `RESOLVED_IS_CANONICAL` と判定した。
- Issue 26 downstream Performance rebuild、Selection evaluation、Behavior no-opを完了した。後述の2026-09-08 data-readiness remediationとは別の完了済み処理である。
- 一時的なStage 3B destructive runnerとStage 3C replay/postcheck runnerは削除済みである。
- Stage 3B/3C、downstream rebuild、32件のnon-gap recoveryを再実行しない。
- 削除前判定用Stage 3B preflightを、復旧後に `ready: true` に戻すことを目標にしない。

## fast-uri CI blocker

- root `pnpm-workspace.yaml` の既存 `overrides` へ `fast-uri@3: 3.1.7` と `fast-uri@4: 4.1.4` を追加した。
- `pnpm-lock.yaml` の解決結果は3系が3.1.7、4系が4.1.4で、3.1.5/4.1.2は残っていない。
- `pnpm audit --audit-level high` はexit 0。残存はunrelatedなmoderate 4件であり、本変更では拡張対応しない。
- pnpm 11.9.0でinstall/lockfile更新を実施した。
- validation: format、lint、typecheck、66 files/620 tests、build 11/11 packages、E2E 21/21、`git diff --check` は成功した。
- E2Eは一時PostgreSQL/Redisだけで実行し、終了後に両containerを削除した。実DB/実Redisは変更していない。

## MVP受入状態

状態は「実装」「自動テスト」「実運用確認」を分離する。ここでの実運用欄は過去の承認済みIssue報告を含む。Issue 26は完了済みとして再実行せず、Issue 15の14 walletだけを2026-09-08と2026-09-12に同期・再評価した。

| SPEC第32章対応                          | 実装                                     | 自動テスト                          | 実運用                           | 現在の判定                          |
| --------------------------------------- | ---------------------------------------- | ----------------------------------- | -------------------------------- | ----------------------------------- |
| A. 所有者限定ログイン・README起動       | あり                                     | E2E成功                             | 今回未確認                       | 継続監査                            |
| B. アドレス登録・候補収集・履歴取得     | Hyperliquidあり                          | unit/integration/E2E成功            | Issue 26 canonical state復元済み | Sui/Cetusを含む全体は未達           |
| C. 重複・欠損・順不同・再接続・API障害  | DQ/fail-closed契約あり                   | 全test成功                          | Issue 26でincident recovery済み  | source history制約が残存            |
| D. Performance・分類・Selection根拠     | performance-v3 / wallet-selection-v1あり | 全test成功                          | 14 wallet再計算・再評価済み      | completeness/metric不足でselected 0 |
| E. Selection→Behavior→signal→Web        | Phase 5.0 Behaviorまであり               | Behavior test成功                   | Behaviorはselected 0でno-op      | signal/Web連携は未達                |
| F. メール送信・抑制・配信記録           | 要追加監査                               | package build/test成功              | 未確認                           | 未達扱い                            |
| G. 正式仕様のデモ取引                   | 要追加監査                               | package build/test成功              | 未確認                           | 未達扱い                            |
| H. デモ資産曲線・benchmark比較          | 要追加監査                               | 今回の全testは成功                  | 未確認                           | 未達扱い                            |
| I. signalからsource/version/DQを追跡    | Behavior provenanceまであり              | 全test成功                          | 未確認                           | signal未実装範囲は未達              |
| J. 実売買・署名・秘密鍵なし、主要CI成功 | safety boundary維持                      | ローカル全validation・PR #27 CI成功 | 本番適用なし                     | PR #27 merge済み                    |

## Issue 15 data-readiness remediation（2026-09-08）

### 実行契約とprovenance

- 対象はSelection readiness監査で確定したwatched Hyperliquid wallet 14件だけとした。watched wallet fallback、対象外address、wrong-address identifierは使用していない。
- Worker image: `chaincopy-worker:issue15-7524a7f`、image digest `sha256:035ae76f6c12c8ac5bd7ef01b12c5ef4ca5677e58136795f46a9bcf7fc9d11af`。
- image revision labelはmain merge commit `7524a7f4e493c4a7ae42f7179774df09d553c5a0`と完全一致した。
- concurrencyは1、queue backlog上限は500、discoveryは無効。処理完了後にWorkerをgraceful stopした。
- 既存の正式scheduler/sync、`performance-v3`、`wallet-selection-v1`、Behavior control jobだけを使用した。手動cursor/DQ/quarantine変更、destructive DB操作、Redis key削除は行っていない。

### 正式sync結果

- 最初の通常scheduler実行は、14 walletについてcurrent-state / fill / funding / ledger / portfolio / historical-orders / DQ auditを各14件、合計98件成功した。
- 既存queueに残っていた同一14 wallet内のbackfill parent 10件も正常完了し、そこから生成されたfill / funding / ledger / position / portfolio / historical-orders / DQ / websocket-listener child各10件も成功した。
- 既存gap recovery 10件は各5 attempt後にすべてfail closedした。理由は、fills / funding / ledgerの全required laneで対象区間の完全なsource coverageを証明できなかったためである。対応するgap DQは解消していない。
- 最終Performance用Worker再起動時、BullMQ retention上の通常scheduler job 98件のうち、保持期間を過ぎていたcurrent-state 8件、funding 7件、ledger 7件が同一14 walletへ再生成された。22/22成功し、対象範囲逸脱はない。
- 最終job集計: current-state 22成功、DQ audit 24成功、fill 24成功、funding 31成功、ledger 31成功、portfolio 24成功、historical-orders 24成功、position 10成功、wallet backfill 10成功、websocket listener 10成功、gap recovery 10失敗。
- 14/14 walletの`lastSyncAt`は更新され、Selectionの`DATA_STALE`は14件から0件へ解消した。全SyncCursorは最終時点で`SUCCEEDED`だった。

### Data Quality before / after

| OPEN issue type                    | before            | after             | 判定                                                 |
| ---------------------------------- | ----------------- | ----------------- | ---------------------------------------------------- |
| `HYPERLIQUID_PARTIAL_API_FAILURE`  | 3件 / 3 wallet    | 0件 / 0 wallet    | 正式syncの成功によりdomain lifecycleから解消         |
| `HYPERLIQUID_FILL_HISTORY_LIMIT`   | 3件 / 3 wallet    | 3件 / 3 wallet    | 公式APIの直近10,000 Fill上限。推測でCOMPLETEにしない |
| `HYPERLIQUID_WEBSOCKET_GAP`        | 441件 / 10 wallet | 441件 / 10 wallet | gap recoveryがcoverage proof不足でfail closed        |
| `HYPERLIQUID_WEBSOCKET_ERROR`      | 177件 / 10 wallet | 177件 / 10 wallet | 既存incident evidenceを保持                          |
| `HYPERLIQUID_WEBSOCKET_USER_LIMIT` | 4件 / 4 wallet    | 4件 / 4 wallet    | 既存source制約を保持                                 |

### Performance再計算

- 通常sync後の入力を厳密に使用するため、14 walletへ正式`PerformanceJobScheduler`から`force=true`で1回ずつ再計算を要求した。requestedAtは`2026-09-08T13:39:14.301Z`。
- 結果は14/14 `SUCCEEDED`、14/14 `TRUSTED`、FAILED 0。完了時刻は13:39:55.460–13:42:54.666 UTC。
- latest trusted completenessは`GAP_DETECTED` 10件、`PARTIAL` 4件、`COMPLETE` 0件。
- required metricは`annualizedReturn` 0/14、`maxDrawdown` 0/14、`topTradeContribution` 10/14。trusted closed cycle 20件以上は3/14、未達は11/14。
- 14 incident Runは`QUARANTINED`のまま、trust transitionは14件のまま。今回のPerformance/Selection入力へincident Runをtrustedとして混入させていない。

### Selection再評価とBehavior

- current Selection Run: `cmtspzm9t0007qq0yhgfv1ej8`。
- `wallet-selection-v1`、評価日時`2026-09-08T13:43:22.823Z`、universe 14 / selected 0 / qualified 0 / review 14 / excluded 0。
- 全14件が`HISTORY_INCOMPLETE`と`REQUIRED_METRIC_MISSING`、うち11件が`TOO_FEW_COMPLETED_TRADES`。`DATA_STALE`は0件、manual overrideは14/14 `AUTO`。
- threshold由来の`RETURN_BELOW_MINIMUM` / `DRAWDOWN_TOO_HIGH` / `PROFIT_TOO_CONCENTRATED`で`EXCLUDED`になったwalletは0件である。
- 結論: 現在の`selected=0`はデータ完全性・必須metric不足によるfail-closed `REVIEW`であり、wallet-selection-v1の投資基準を本当に満たさないと確定した結果ではない。
- Worker startupの正常Behavior control jobはcurrent selected 0を読み、`no-op`（processed events 0）で完了した。Behavior event / run / scope / DQはいずれも0件である。

### 負荷と終了状態

- 観測peak: Worker約1.59 GiB、PostgreSQL約3.22 GiB、Redis約59 MiB。OOM、無制限backlog、retry stormはなかった。
- 終了時queueはhyperliquid / performance / behaviorすべてwait / active / delayed / prioritizedが0。履歴としてhyperliquid failed 10件、performance failed 14件（既存保持分）、behavior failed 0件が残る。
- 終了時PostgreSQL / Redisはhealthy、DB sizeは51 GB、WSL disk freeは796 GB。Workerは停止済み。

## Issue 15 data-readiness refresh（2026-09-12）

### Preflightと実行範囲

- 前回処理を機械的に繰り返さず、live read-only監査を先行した。14/14 walletの`lastSyncAt`が24時間閾値を超えており、current Selection Runは引き続きselected 0 / review 14だったため、Owner承認済みの定期refresh対象と判定した。
- 対象はSelection readiness監査で確定したwatched Hyperliquid wallet 14件だけである。Worker imageは`chaincopy-worker:issue15-7524a7f`、digestは`sha256:035ae76f6c12c8ac5bd7ef01b12c5ef4ca5677e58136795f46a9bcf7fc9d11af`、revision labelはmain merge commit `7524a7f4e493c4a7ae42f7179774df09d553c5a0`と一致した。
- concurrency 1、queue backlog上限500、discovery無効のまま、正式scheduler/sync、`PerformanceJobScheduler`、`wallet-selection-v1`、Behavior control jobを使用した。手動cursor変更、DQ直接更新、quarantine解除、destructive DB操作、Redis key削除は0件である。
- 開始時queueはhyperliquid / performance / behaviorのwait / active / delayed / prioritizedがすべて0、PostgreSQL / Redisはhealthy、DB sizeは51 GB、WSL disk freeは796 GBだった。

### 正式syncと環境中断からの回復

- schedulerはcurrent-state / fill / funding / ledger / portfolio / historical-orders / DQ auditを各14件、計98件の正式jobとして扱った。14/14 walletの主要laneは最終的に成功し、`lastSyncAt`の24時間超過は14件から0件へ解消した。最終sync時刻範囲は`2026-09-11T15:53:33.615Z`–`2026-09-11T16:03:59.635Z`（UTC）である。
- 初回実行中にWSL session終了に伴いPostgreSQL / Redis / Workerが同時停止し、BullMQ stalled recovery時の同一wallet lock競合によってwallet `cms39x9ni000umw0iw2zkbf1e`のhistorical-ordersとDQ auditが各1件fail closedした。heap、backlog、retry storm、アプリケーション例外を原因とする停止ではない。
- 欠けた2 laneだけをcanonical DB address `0x06438b0d1bb6f8aa4a455a4f2c1b1e744d53c760`とのidentity照合後、fresh job IDで正式queueへ再投入した。historical-ordersは`fetched=2000 / inserted=2000`、DQ auditは`missingScopes=[] / openIssues=55`で、両方attempt 1の`SUCCEEDED`となった。失敗履歴は監査証跡として削除していない。
- Worker再起動時のscheduler tickは同じ14 walletだけを再照合した。既存idempotent job identityと正式processorを維持し、対象外walletやwrong-address identifierは使用していない。

### Data Quality、Performance、Selection

- OPEN DQの最終値は`HYPERLIQUID_FILL_HISTORY_LIMIT` 3件 / 3 wallet、`HYPERLIQUID_WEBSOCKET_GAP` 441件 / 10 wallet、`HYPERLIQUID_WEBSOCKET_ERROR` 177件 / 10 wallet、`HYPERLIQUID_WEBSOCKET_USER_LIMIT` 4件 / 4 walletで、refresh前後に変化はない。`HYPERLIQUID_PARTIAL_API_FAILURE`は0件を維持した。
- 正式sync後、14 walletへ`performance-v3`を`force=true`で各1回実行し、14/14 `SUCCEEDED`、14/14 `TRUSTED`、FAILED 0だった。retryしたDQ auditは対象walletのPerformanceを正式契約からもう1回起動し、Run `cmtx5bqu80aagru0i4j9rhull`が`SUCCEEDED / TRUSTED / GAP_DETECTED`、metrics 12件で完了した。
- current Selection Runは`cmtx5bxhq0007qn0yra29e6gq`、評価時刻`2026-09-11T16:03:56.201Z`、universe 14 / selected 0 / qualified 0 / review 14 / excluded 0である。全14 walletが`HISTORY_INCOMPLETE`と`REQUIRED_METRIC_MISSING`、うち11 walletが`TOO_FEW_COMPLETED_TRADES`となった。
- latest trusted completenessは`GAP_DETECTED` 10件、`PARTIAL` 4件、`COMPLETE` 0件である。trusted closed cycle 20件以上は3/14だが、全walletで必須metricが揃っていない。`DATA_STALE`とthreshold由来のexcludeは0件である。
- 結論: selected 0はstalenessではなく、解消していない履歴完全性と必須metric不足によるfail-closed `REVIEW`である。投資基準を本当に満たさないと確定した結果ではない。

### Behavior、負荷、終了状態

- Selection結果に従うBehavior control jobはstartup時とSelection再評価後の双方で`no-op / processedEvents=0`となった。Behavior event / run / scope / DQはすべて0件で、selected wallet不在時にwatched walletへfallbackしていない。
- 観測peakは、正式sync中にWorker約1.67 GiB、PostgreSQL約3.31 GiB、Redis約55 MiB、Performance中にWorker約1.84 GiB、PostgreSQL約2.97 GiB、Redis約54 MiBだった。OOM、無制限backlog、retry stormはなかった。
- 終了時queueはhyperliquid / performance / behaviorのwait / active / delayed / prioritizedがすべて0。Workerはgraceful stop済みでexit 0、PostgreSQL / Redisはhealthy、DB sizeは52 GB、WSL disk freeは796 GBである。
- 14 incident Performance Runは`QUARANTINED` 14件、trust transition 14件のまま保持した。manual overrideは全件`AUTO`である。
- 状態文書更新後のvalidationはformat、lint、typecheck、65 files / 613 tests、build 11/11 packages、`git diff --check`が成功した。integration testはvolumeなしの一時PostgreSQL / Redisへmigrationを適用して実行し、終了時に一時containerだけを停止した。実DB / 実Redisへtest mutationは行っていない。

## 無料データ限定recovery / Discovery（2026-09-17）

### Owner境界と実行provenance

- Owner決定により、有料データソースとAWS Requester Paysを現時点では不採用とした。LIST / HEAD / inventory / downloadを含むAWS API callは0件である。
- bounded gap recovery、candidate監査、正式sync、Performance、Selection、Behaviorは、無料のHyperliquid Info APIと既存正式契約だけを使用した。Selection閾値、`performance-v3`計算式、manual overrideは変更していない。
- 実行用Worker imageは各実装commitのclean worktreeから構築した。最終read-only candidate監査はcommit `ccac591b2d1647a1f35083ee60656ff35ce00586`、image `chaincopy-worker:free-data-ccac591`、image ID `sha256:48d2af46dcb1f0b7107d6b8a72e404f9201740434823760040dd04bbe5878fb6`を使用した。
- destructive DB操作、手動cursor変更、DQ直接更新、quarantine解除、Redis key / queue削除、実注文・署名・資金移動は0件である。

### 10 walletのbounded gap recovery

- OPEN `HYPERLIQUID_WEBSOCKET_GAP` 441件 / 10 walletを正式allowlistへ固定し、無料Info APIのbounded recoveryを全件実行した。
- fills / funding / ledgerのrequired laneについて対象区間のcoverageを証明できたgapは0件だった。transient lock競合5件だけを正式retryし、最終的に全441件が決定論的なcoverage不足としてfail closedした。
- gap DQは441件 / 10 walletのOPENを維持した。10,000 Fill上限に到達した3 walletの`HYPERLIQUID_FILL_HISTORY_LIMIT`もOPENのままで、推測による`HISTORY_COMPLETE`への遷移はない。
- deterministic coverage不足をBullMQで繰り返さないよう、retryableなtransient failureとnon-retryableな`GapCoverageNotProvenError`を分離した。

### 無料Discovery候補

- Discoveryで既に収集・enrichment済みの候補を対象に、Info APIだけでpromotion前の完全性を再証明するmanifest CLIを追加した。
- gateは、10,000未満のexhaustive fills、coinごとの最初の一意なFillが`startPosition = 0`、funding / ledgerのexhaustive coverage、最古source日以前から現在日までの連続UTC日次NAV、既存DQなしをすべて要求する。
- 段階監査で6 candidateを正式promotionした。1件は`PARTIAL`、5件は最新`performance-v3`が`COMPLETE / TRUSTED / SUCCEEDED`となったが、5件とも日次NAV欠損により`annualizedReturn` / `maxDrawdown`が生成されなかった。この実データを受け、promotion前gateをPerformanceと同じ日次NAV連続性まで強化した。
- 最終manifest v7 read-only監査は未promotion候補100件をscanし、accepted 0件、manifest hash `cbdd1732825a95cbe5feaebaa98ea78b675b274443eba9fabb07e95e5f3a8315`だった。0件のためenqueue / DB mutationは行っていない。
- `hyperliquid-candidate-enrichment`には今回以前からpriority backlog 8,425件とactive 1件が残る。今回のpromotionは別の`hyperliquid-discovery` queueを使用し、同queueはwait / active / delayed / prioritizedが0である。既存backlogは削除・一括処理せず、consumerを停止したまま監査証跡として報告する。

### Performance / Selection / Behaviorの最終状態

- watched Hyperliquid walletは30件。最新trusted `performance-v3`は`COMPLETE` 5件、`PARTIAL` 15件、`GAP_DETECTED` 10件で、30/30 `SUCCEEDED / TRUSTED`である。
- current Selection Runは`cmu5m49um0004u1o0p02fa3jq`、評価時刻`2026-09-17T14:16:01.858Z`、universe 30 / selected 0 / qualified 0 / review 30 / excluded 0である。manual overrideは30/30 `AUTO`。
- reasonは`REQUIRED_METRIC_MISSING` 30件、`HISTORY_INCOMPLETE` 25件、`TOO_FEW_COMPLETED_TRADES` 22件。`RETURN_BELOW_MINIMUM`、`DRAWDOWN_TOO_HIGH`、`PROFIT_TOO_CONCENTRATED`は0件である。
- current Selection入力では`annualizedReturn` 0/30、`maxDrawdown` 0/30、`topTradeContribution` 23/30である。したがってselected 0は投資閾値不合格ではなく、無料sourceだけでは解消できていない履歴 / required metric不足によるfail-closed `REVIEW`である。
- Selection後のBehavior control job `behavior-9902c4c3e51a6086386b0c3944d20d34bcc76402b599e7b769ef7d4aee86699b`は`no-op / processedEvents 0`で完了した。Behavior run / event / scope / DQはすべて0件で、watched wallet fallbackはない。
- OPEN DQは`HYPERLIQUID_FILL_HISTORY_LIMIT` 3件 / 3 wallet、`HYPERLIQUID_INCOMPLETE_INITIAL_SYNC` 4件 / 4 wallet、`HYPERLIQUID_WEBSOCKET_GAP` 441件 / 10 wallet、`HYPERLIQUID_WEBSOCKET_ERROR` 177件 / 10 wallet、`HYPERLIQUID_WEBSOCKET_USER_LIMIT` 15件 / 15 walletである。
- 14 incident Performance Runは`QUARANTINED`、trust transitionは14件のまま。Selection / Behaviorへtrusted inputとして混入していない。
- 終了時PostgreSQL / Redisはhealthy、DB size 54 GB、disk free 712 GB。Workerは停止済み。`hyperliquid-sync`、`hyperliquid-discovery`、Performance、Behaviorのwait / active / delayed / prioritizedはすべて0である。

## Automatic ranking / reference-wallet flow（2026-09-23）

- 実装前監査で、Candidate作成・enrichment、正式sync / DQ、`performance-v3`、`wallet-selection-v1`、Selection Run snapshot、`listEffectiveSelectedWallets()`、Behaviorの0件no-opは再利用可能と確認した。
- 手動依存は、(1) `ELIGIBLE` Candidateのpromotion、(2) `isWatched=true`によるSelection universe制限、(3) Selection evaluate、(4) 通常画面のsettings / INCLUDE / reason表示だった。
- full enrichmentが`ELIGIBLE`を確定した時点でidempotent promotionを自動enqueueする。promotion後は既存backfill / scheduler / DQ / Performance契約だけを使う。
- automatic universeを、同じHyperliquid DataSourceのDiscovery Candidateからpromotionされたwalletへ限定した。`isWatched`はsync購読状態として残るがSelection条件ではなく、手動watch登録だけのwalletは混入しない。
- `performance-v3`成功後に`wallet-selection-v1`を自動評価し、Selection Run確定後にBehavior control jobをenqueueする。Behavior backlog抑制を成功扱いにせず、selected 0はwatched fallbackなしの正常no-opとする。
- ranking policyとthresholdは変更していない。overall rankはannualized return、absolute drawdown、trusted closed cycle count、addressの既存順序を使用する。新しいweighted scoreや欠損値補完はない。
- 通常画面専用`GET /api/wallet-selection/ranking`はautomatic `SELECTED / QUALIFIED`かつ非EXCLUDEのwalletだけを返す。UIはrank、完了取引、勝率、年率 / 累積収益率、Profit Factor、最大drawdown、最終活動だけを表示し、REVIEW / EXCLUDED / reason / manual INCLUDE操作を表示しない。
- full Selection API、結果、理由、settings、overrideは監査・管理用に保持する。`EXCLUDE`はdenylistとしてranking / effective setへ反映し、`INCLUDE`は後方互換の管理機能だが通常rankingを迂回できない。
- DB schema / migration、実DB、実Redis、threshold、Performance式、DQ / quarantine、paid data、注文・署名は変更していない。
- 正式設計は`docs/automatic-wallet-ranking-design.md`、更新したSelection正本は`docs/phase4-3-wallet-selection-spec.md`、判断はADR-037である。
- feature branch検証はformat / lint PASS、typecheck 11/11 PASS、test 70 files / 639 PASS、build 11/11 PASS、E2E 22/22 PASS、`pnpm audit --audit-level high`はhigh以上0、`git diff --check` PASSである。PR #30のGitHub Actions `verify`も全step PASSした。
- integration / E2Eは永続volumeなしの隔離PostgreSQL 16 / Redis 7コンテナだけで実行し、完了後に停止・自動破棄した。実DB / 実Redisへのmutationは0件である。

## PR #30 post-merge automatic flow canary（2026-09-25）

### Stage 1 read-only preflight

- `codex/post-merge-ranking-canary`は`origin/main`のPR #30 merge commit `940b638e27f6f6b2f5b5b691bde8b04fd97a83ec`から開始した。PR #30にはPrisma schema / migration変更がなく、実DBは10 migration適用済み、未完了0件、最新は`20260824120000_performance_run_quarantine`だったため、追加migrationは不要と確認した。
- PostgreSQL / Redisはいずれもhealthyで、Worker / consumerは停止していた。開始時DB sizeは58,291,730,099 bytes。Redisは`noeviction`で、異常なmemory pressureはなかった。
- Hyperliquid Mainnet Candidateは`PENDING 68,801 / LIGHT_ELIGIBLE 8,831 / INSUFFICIENT_HISTORY 12,623 / ELIGIBLE 2,915 / EXCLUDED 214 / PROMOTED 26`。automatic universeは26 walletだった。
- automatic universeの最新trusted `performance-v3`は`COMPLETE 5 / PARTIAL 15 / GAP_DETECTED 6`。current Selection Runは`cmue526af006bu1ckq8xpvbzr`、universe 29 / selected 0 / qualified 0 / review 29 / excluded 0、ranking entry 0だった。Behavior run / event / scope / OPEN DQはすべて0件だった。
- production Redisには`hyperliquid-candidate-enrichment`のprioritized 8,427件とactive 1件、計8,428件のbacklogがあった。`hyperliquid-discovery`と`address-performance`にもprioritized各1件が残っていた。DBには30分超の歴史的`RUNNING` SyncJobがcandidate enrichment 894件、candidate upsert 3件、DQ audit 168件、fill 168件、funding 118件、ledger 89件、position snapshot 334件、wallet backfill 1件残っており、live consumer不在のためactive/stale stateとして扱った。

### Stage 2 bounded canary

- 既存の`ELIGIBLE / enrichment SUCCEEDED / history COMPLETE / dataQualityScore 100 / not truncated`から、90日以上のevaluation期間、recent activity、2,500 fills以下を満たす固定20 Candidateを決定論的manifestとして選んだ。candidate IDは`cms1oc02y0guqlg0i0xl9b1l2`, `cms2036bb411lms0iam457nn0`, `cms8t2jvdfqa0n90ilq6qg2vp`, `cms4qlludns8ar40i4ucwoois`, `cms4umawgdezgp70i6r9q1een`, `cms1wbhogkmjqla0i2xpp13d0`, `cms7zi9v40lq5n90i6imy8vyd`, `cms2fjz3qn0q0ms0i5ymvaszh`, `cms38up3g3shimx0i7joti2c1`, `cms9syyjjg5qan90ijwvkwfuq`, `cms1q1n540jceqn0ia23crhq1`, `cms2lnyxbpg3oms0i99ktivql`, `cms4rvk5pchagp70immz2r54e`, `cms1vj76sg0fzla0inpwbx1pv`, `cms4631r9n3cvqo0ihnob6x6o`, `cms2cecarroodms0i1o1b99n5`, `cms2cgi4esvfyms0ix3jsq9rt`, `cms2bc00ul6cums0ibmiubq7q`, `cms2693wuzju0ms0i8z4a672b`, `cms2oc6or146xms0i44ivgpf5`である。
- PR #30 merge commitからbuildしたWorker imageと、既存processor / repository / serviceだけを使った。BullMQ prefixを`post-merge-ranking-canary`へ分離し、concurrency 1、schedulerなし、WebSocket discovery startupなしで実行したため、production backlogは消費していない。無料のHyperliquid Info API以外は使用していない。
- inspected 20 / filter gate通過20 / auto-promoted 20。最終状態は20/20 `PROMOTED / enrichment SUCCEEDED`で、automatic universeは26から46へ増えた。`isWatched`手動設定、manual INCLUDE、threshold変更は行っていない。
- 最新の正式syncは20/20 walletで成功した。監査履歴には各主要laneの成功20件と、最初のwalletで一時的なformal lock残存により失敗した6 laneが残るが、lock expiry後に同じ正式backfill契約をfresh job IDで1回再実行し、6 laneすべて成功へ回復した。失敗履歴やDQを直接変更・削除していない。
- canary 20 walletの最新trusted Performanceは`SUCCEEDED / PARTIAL 17`、`INSUFFICIENT_DATA / PARTIAL 2`、`INSUFFICIENT_DATA / INSUFFICIENT_HISTORY 1`で、`COMPLETE 0 / GAP_DETECTED 0`。必須metricは`annualizedReturn 0/20 / maxDrawdown 0/20 / topTradeContribution 16/20`、3 metric完備は0/20だった。
- 最終current Selection Runは`cmuh2mdhf03z4le0y8nuyvfzy`、評価時刻`2026-09-25T14:43:28.001Z`、universe 46 / selected 0 / qualified 0 / review 46 / excluded 0、ranking entry 0。canary分は`HISTORY_INCOMPLETE + TOO_FEW_COMPLETED_TRADES + REQUIRED_METRIC_MISSING` 11件、`HISTORY_INCOMPLETE + REQUIRED_METRIC_MISSING` 6件、`NO_PERFORMANCE_V3` 3件だった。
- Selection後のBehavior control jobはすべて正常`no-op / processedEvents 0`。Behavior run / event / scope / OPEN DQは0件を維持し、watched wallet fallbackは発生していない。
- canary中に検出された`HYPERLIQUID_PARTIAL_API_FAILURE` 10件は正式sync成功によりすべて`RESOLVED`となった。`HYPERLIQUID_INCOMPLETE_INITIAL_SYNC`は1件解消、1件がwallet `0xd55c64116bd7ca822ced2f95ec20768574ef54e4`でOPENのまま残り、未完了scopeはfills / funding / ledger / account-snapshotである。

### 判定と終了状態

- canaryだけを見ると20/20がPerformance `COMPLETE`を証明できず、case 1（無料sourceでhistory completenessを証明できない）が支配的だった。同時にautomatic universe全46 walletでは最新trusted Performanceが`SUCCEEDED COMPLETE 5 / SUCCEEDED PARTIAL 32 / SUCCEEDED GAP_DETECTED 6 / INSUFFICIENT_DATA 3`だが、`COMPLETE` 5 walletを含め必須3 metric完備は0/46だった。したがってdecision ruleのcase 2（COMPLETEでもrequired Performance metricが生成されない）が存在し、Discovery量拡大前の次engineering blockerと確定した。
- `selected 0`は投資gate不合格と確定した結果ではない。metric生成経路を直す前に候補数を増やしたり、閾値を緩和したり、manual INCLUDEしたりしない。
- production backlogは開始時と終了時で`hyperliquid-candidate-enrichment prioritized 8,427 + active 1`、`hyperliquid-discovery prioritized 1`、`address-performance prioritized 1`のままで、canary隔離queueはwait / active / delayed / prioritizedがすべて0になった。全canary Workerを停止し、稼働containerはPostgreSQL / Redisだけに戻した。
- 観測peakはcanary Worker約291 MiB / 35% CPU、PostgreSQL約192 MiB / 19% CPU、Redis約44 MiB / 1%未満CPU。OOM、retry storm、無制限backlogはなかった。終了時Redisはused memory約24 MiB、RSS約53 MiB、`noeviction`である。
- destructive DB操作、Redis key / queue削除、手動cursor / DQ変更、quarantine解除、有料source、Requester Pays、実注文・署名・資金移動は0件。最終判定は`CANARY COMPLETE — NEXT BLOCKER IDENTIFIED`である。

## Daily NAV / required metric root-cause repair（2026-09-26）

### Read-only root-cause audit

- `PortfolioSnapshot → PerformanceRepository → calculateDailyNav → DailyNav → Return Lane → annualizedReturn / maxDrawdown`を実コード・実DB・公式responseで追跡した。従来repositoryは公式`portfolio` responseのうち疎な`perpAllTime`だけを保存し、`perpDay / perpWeek / perpMonth`の正式pointを破棄していた。
- 旧`COMPLETE` 5 walletの評価窓は233–247日だったが、保存済みNAVのdistinct UTC日は42–53日、内部欠損は180–203日、DailyNavは全Run 0件だった。`assessHistoryCompleteness()`は開始日のprefixだけを確認し、内部gapとsuffixを確認していなかったため`COMPLETE`が事実と矛盾していた。
- 公式Info APIをread-onlyで再確認したところ、5/5 walletの`perpMonth`は直近32 UTC日を連続して提供した一方、`perpAllTime`は2026年1月から9月に43–55 UTC日しかなく疎だった。公式4 Perp periodをunionしても、評価期間全体の日次coverageは証明できない。denseな短期区間を過去へ補間したり、最初のgap後からReturn Laneを再開したりしない。
- 5 walletのうち2件はvault cash flowを含み、現行classifierでは別途UNKNOWN cash flowとなる。これはReturn Laneをfail closedにする独立理由であり、日次coverage不足を解消したものとして扱わない。

### 契約修正

- portfolio正規化は`perpDay / perpWeek / perpMonth / perpAllTime`をtimestampでunionし、同時刻のDecimal値が一致するときだけ1点として保存する。競合はsource inconsistencyとして保存を停止し、spot/vaultを含み得る非Perp periodは混在させない。
- UTC日ごとに最後の正のNAVを決定論的に選ぶ。同日に正のpointがなければ`NON_POSITIVE_NAV`、日次gapはそのまま保持し、forward-fill / zero-fill / interpolationは行わない。
- `calculationFrom`より後から始まるprefix不足と`calculationTo`より前で終わるsuffix不足は`PARTIAL`、範囲内部のUTC日次欠損は`GAP_DETECTED`とする。NAV固有gapはReturn Laneを停止するが、ADR-028に従い独立して検証可能なTrade / Exposure Laneは継続する。source全体のgap DQ / cursorは従来どおり関連Laneをfail closedにする。
- 金融式、metric定義、Selection policy / thresholdを変更していないため`performance-v3`を維持する。入力pointとcompletenessはfingerprintを変え、新規Runへappend-onlyで保存し、旧Runを更新・削除しない。判断はADR-038へ記録した。
- E2E runnerへ既定値を変えない`E2E_DATABASE_URL / E2E_REDIS_URL` overrideを追加し、永続ローカルDB/Redisをflushせずvolumeなし隔離containerでE2Eを実行可能にした。

### Bounded real-data verification

- 実装commit `01aaf5933a0b61ac8ba8a19112018ec7f5a6bee7`のGit archiveだけからWorker image `chaincopy-worker:daily-nav-01aaf59`をbuildした。image digestは`sha256:2a394bb55c5e5eeca576c45621dfa3c8abe1bce447132d65e845020e21b55d2f`である。
- 対象は旧`COMPLETE` 5 walletと前回canaryの固定3 wallet、合計8件だけとした。専用BullMQ prefix、concurrency 1、scheduler / discovery consumerなしで、正式portfolio syncを8/8成功させた。production backlogは消費・削除していない。
- `portfolio-history`は各walletで72–88点増え、最終件数は124–183点となった。しかし長期日次coverageは成立せず、force再計算した`performance-v3`は7 `SUCCEEDED` / 1 `INSUFFICIENT_DATA`、8/8 `GAP_DETECTED`だった。旧`COMPLETE` 5件も全件`GAP_DETECTED`へ正しく置き換わった。
- 対象8件の新Runでは`annualizedReturn` 0/8、`maxDrawdown` 0/8、`topTradeContribution` 5/8、DailyNav 0/8だった。Trade / Exposureの独立metricは7件で保存され、Return Laneだけがfail closedした。
- current Selection Runは`cmuhtckgd00y6my1o09dvalza`、評価時刻`2026-09-26T03:11:40.081Z`、universe 46 / selected 0 / qualified 0 / review 46 / excluded 0である。current trusted completenessは`GAP_DETECTED 13 / PARTIAL 31 / trusted runなし 2 / COMPLETE 0`、required metricは`annualizedReturn 0/46 / maxDrawdown 0/46 / topTradeContribution 36/46`である。
- Behavior controlは`no-op / processedEvents 0`、新規Behavior run / eventは0件だった。新規OPEN DQは0件。Selection threshold変更、manual INCLUDE、DQ / cursor直接変更、quarantine解除、destructive DB/Redis操作、有料source、Requester Paysは0件である。
- 実行は約6秒で完了し、終了確認時PostgreSQLはCPU 0.84% / 151.8 MiB、RedisはCPU 0.27% / 47.46 MiBだった。検証containerと隔離test containerは停止・削除し、常設Workerは停止状態、PostgreSQL / Redisのみhealthyである。

### 判定

- 旧case 2「`COMPLETE`なのにrequired metricが生成されない」は、内部gapを見落としていたcompleteness分類不具合であり修正済みである。修正後は実データに`COMPLETE` walletがなく、required Return metricを生成しないことがformal contractと一致する。
- 現在のselected 0は投資gateの不合格を示さず、無料Hyperliquid Info APIだけでは評価窓全体の連続Daily NAVを証明できないことによるfail-closed `REVIEW`である。Discovery volumeや閾値では解消せず、最終状態は`SOURCE_DATA_INSUFFICIENT_FOR_REQUIRED_NAV_METRICS`とする。

## NAV-based v1の残課題（v2採用前の記録）

1. Ownerの無料source限定方針を維持する限り、連続90日以上の公式Daily NAV coverageを実測で証明できるwallet/sourceが現れるまで`HISTORY_INCOMPLETE / REVIEW`を維持する。欠損補間や短期segmentへの評価窓切替は行わない。
2. 既存`hyperliquid-candidate-enrichment` backlog 8,428件を拡大・無制限drainしない。候補量を増やしてもInfo APIのNAV coverage契約は変わらない。
3. 無料かつ信頼できる別sourceを採用する場合は、provenance、wallet identity、UTC日次coverage、cash flow分類、dedupを先に正式設計し、実DB ingestion前のOwner境界を維持する。
4. 10,000 Fill以前やInfo APIでcoverageを証明できないgapは`HISTORY_INCOMPLETE / REVIEW`のまま維持し、Selection thresholdやmanual INCLUDEで代替しない。

## Hyperliquid history recovery設計・実装（2026-09-14）

- 正本を`docs/hyperliquid-history-recovery-spec.md`、設計判断をADR-036へ記録した。
- Info API bounded recoveryは空responseを明示的なcoverage evidenceとして区別し、funding / ledgerでは受理、fillsでは直近10,000件cutoffとの識別不能を理由に引き続きfail closedとした。
- official historical fills向けに旧1-event lineと新block envelopeのstrict parser、wallet抽出、large `tid`保持、identity/payload conflict検出、hour inventory coverage判定、Decimal cost estimatorを追加した。
- 対象3 walletの最小hour unionは2025-04-24T00:00:00Zから2026-07-27T11:59:59.999Zまでの11,028 object-hour候補である。公式資料にarchive開始・cutover・sizeがないため、課金inventoryなしに推測で確定していない。
- Requester Pays API call、download、実DB mutation、DQ更新、Performance / Selection / Behaviorは0件。次のOwner gateは課金LIST / HEAD inventory取得である。
- validation中に公開された新規advisoryへ対応し、Next.jsをpatched `16.3.5`、transitive sharp overrideを`0.35.4`へdependency-only更新した。`16.3.3`はWindows production E2Eでruntime regressionを再現したため採用せず、`16.3.5`で21/21 E2E成功を確認した。auditはhigh以上0件、moderate 4件でexit 0である。
- 最終validationはformat、lint、typecheck 11/11、66 files / 620 tests、build 11/11、E2E 21/21、audit high以上0件、`git diff --check`の全項目に成功した。integration / E2Eはvolumeなしの一時PostgreSQL / Redisで実行し、終了後に一時containerだけを削除して既存PostgreSQL / Redisをhealthyへ復元した。Workerは起動していない。

## Blockerと承認境界

- Info APIでcoverageを証明できなかった441 gapと3 walletの10,000 Fill以前は、現行の無料source限定方針では証明できない。これらのwalletは`HISTORY_INCOMPLETE / REVIEW`を維持し、救済自体を目的化しない。
- 無料Discovery候補100件の最終監査ではmanifest v7通過が0件だった。Daily NAV修正後のautomatic universe 46 walletは`COMPLETE` 0件であり、selected 0の直接原因は投資閾値ではなく、全件のrequired metric不足である。
- AWS Requester Pays、有料API、有料データ契約は不採用であり、Ownerの新たな明示判断なしに調査実行・download・ingestionへ進まない。
- DQやhistory completenessを件数合わせ・手動更新で解消済みにしない。既存のfail-closed契約を維持する。
- Issue 15 Stage 4 canary/backfillは、effective selected walletが1件以上あり、対象walletのhistory/DQ/quote条件が契約を満たし、必要なOwner承認が揃うまで実行しない。
- main merge、実DB destructive operation、実migration、本番適用、大規模index、Redis削除、quarantine解除、秘密情報変更、実注文・署名・資金移動は自動実行しない。

## 実行環境

- host: Windows PowerShell、Node.js 24.12.0、pnpm 11.9.0
- runtime: WSL2 Docker、PostgreSQL 17、Redis 8
- PR #32までmainへmerge済み。現在の文書用feature branchは`codex/v2-operational-refresh`で、起点は`06d3c26b2f964b584a0f68a681a8f97b635ca91d`である。今回の限定運用結果は末尾を正とし、過去のv1/NAV不足によるselected 0判定と混同しない。
- 稼働中process/container: PostgreSQL / Redisのみ。Workerは停止。
- 過去工程の許可済みmutation: 441 gapの正式bounded recovery試行、6 candidateと20-wallet canaryの正式promotion / sync、限定8 walletのportfolio sync / Performance計算、Selection run作成、Behavior control no-op。今回の46-wallet refreshとvalidation時の安全境界例外は末尾に分離して記録する。

## Free-data Wallet Selection v2（2026-09-27）

### Read-only auditと設計

- automatic universe 46 walletを実DBで監査した。current trusted `performance-v3`は44件、Runなし2件、completenessは`COMPLETE 0 / PARTIAL 31 / GAP_DETECTED 13`だった。
- closed cycleはmin 0 / median 8.5 / max 251、20件以上13 wallet、30件以上12、50件以上7、100件以上1だった。取引Metricはwin rate / Profit Factor / max losing streakが各40、average win / top trade contributionが各36、average lossが40 walletで存在した。
- 6必須trade metricが同一Run・同一coverageで`AVAILABLE`の`TRADE_HISTORY_EVALUABLE`は36 wallet。30 cycles、win rate 0.55、Profit Factor 1、top contribution 0.50を順に適用すると12 -> 3 -> 2 -> 2 walletだった。監査時点で24時間freshな通過walletは0件だった。
- 同一wallet + coin + timestamp groupは16,343 group / 83,306 fills、最大146 fills。同一startPosition分岐は0 groupだった。既存cycle builderが未知prefixをFLATまで除外し、不連続時に進行中cycleと後続coin履歴を除外するため、保存closed cycleはgap / unknown boundaryを跨がない。source全履歴をCOMPLETEへ変更していない。
- 正式仕様は`docs/free-data-wallet-selection-v2.md`、判断はADR-039。v1はNAV-based policyとして保持し、v2を別versionで通常自動flowへ採用した。schema / migration追加はない。

### 実装とbounded live validation

- v2 hard gateは30 closed cycles、win rate 0.55以上、Profit Factor 1以上、top trade contribution 0.50以下、freshness 24時間、6必須trade metricとした。rankingはwin rate、cycle数、Profit Factor、低い集中度、canonical addressの辞書式順である。
- API Selection serviceの通常policyをv2へ切り替え、v1 settings / evaluatorを後方互換で保持した。Selection Runの既存`policyVersion / policySnapshot / inputFingerprint`を再利用し、v2 evaluability boolもfingerprintへ含める。通常ranking UIはNAV列を外し、平均勝ち / 平均負け / 最大利益依存を表示する。
- current 46だけへv2を1回評価した。Selection Runは`cmuj9uvxn0004o30yorz192hl`、評価時刻`2026-09-27T03:41:34.790Z`、universe 46 / selected 0 / qualified 0 / review 46 / excluded 0。reasonは`DATA_STALE 44 / TOO_FEW_COMPLETED_TRADES 32 / TRADE_HISTORY_NOT_EVALUABLE 8 / REQUIRED_METRIC_MISSING 8 / NO_PERFORMANCE_V3 2`だった。
- Behavior通常control処理は`no-op / processedEvents 0`。wallet job enqueueとRedis mutationは0件。既存backlogはcandidate enrichment prioritized 8,427 + active 1、discovery prioritized 1、Performance prioritized 1、Behavior 0のまま維持した。
- v2は投資gateを評価できるデータ経路を確立したが、live selected 0の直接理由は44 walletのstalenessと、残る2 walletのPerformance欠損である。閾値を下げず、次のbounded工程はautomatic universe 46だけを正式syncし、trusted `performance-v3`を更新後にv2を再評価することである。
- 実DB変更はappend-onlyなv2 Selection Run / Resultとcurrent pointer更新だけ。sync、DQ、Performance、Behavior event、manual override、cursor、quarantine、Discovery backlog、Redisを変更していない。destructive operationは0件である。
- 最終validationはformat、lint、typecheck 11/11、71 files / 661 tests、build 11/11、E2E 22/22、audit high以上0件（既知のmoderate 4件）、`git diff --check`を実施した。integration / E2Eはvolumeなしの一時PostgreSQL / Redisで実行し、常設DB / Redisのtest mutationは0件である。
- 実装commitは`17834bae6c02d85247738b94c9cc059e05e3048e`。PR #32（`codex/free-data-wallet-selection-v2` -> `main`）を作成し、実装commitに対するGitHub Actions CI run #78 / `verify`は全step PASSした。PRはopenであり、main mergeはOwner承認境界として未実施である。

## PR #32 post-merge: bounded v2 operational refresh（2026-09-27）

### Preflight / 実行契約

- main HEADは`06d3c26b2f964b584a0f68a681a8f97b635ca91d`。このcommitのGit archiveからWorker image `chaincopy-worker:v2-refresh-06d3c26`をbuildし、revision label一致を確認した。image IDは`sha256:f3b8f8280be1a49f25cf57f031d49c5a72fee9cd36dcb496f994828a73c32be4`。
- `2026-09-27T04:13:17.932Z`のread-only preflightでPostgreSQL / Redis healthy、Redis PONG、applied migration 10 / pending 0を確認。PR #32の実DB migrationは不要であり適用していない。
- automatic universeは46 walletで固定。canonical DB address順の`[{id,address}]`に対するSHA-256は`17641ef8a36eb0b6c52a7c1774ac6296792809ead8663e18b2311f595fdfd632`。対象はDiscovery promotion relationのみで、watched fallbackや追加promotionは行わない。
- preflightのstaleは46/46、current trusted Performanceは44、trade history evaluableは36。current Selectionは`cmuj9uvxn0004o30yorz192hl`、v2、selected 0 / qualified 0 / review 46 / excluded 0。Behavior run / event / DQは各0、quarantined Runは14。
- 既存enrichment queueはprioritized 8,427 + stale active 1（lock TTL -2）。既存discovery / Performanceにもprioritized各1が残る。過去のRUNNING SyncJobはfill 168 / funding 118 / ledger 89 / position 334 / DQ 168 / backfill 1 / candidate enrichment 894 / candidate upsert 3。これらを修復・再投入・削除せず隔離する。
- 常設Workerを起動するとDiscovery orphan maintenanceや通常schedulerが対象外jobを扱い得るため、専用BullMQ prefix `v2-refresh-06d3c26-20260927`に既存の正式processor / scheduler / serviceを接続した。各consumer concurrency 1、Worker上限2 CPU / 4 GiB、通常schedulerとDiscovery consumerとWebSocket listenerは起動しない。
- 46件のallowlist/hashを実行直前に再確認。fill → funding → ledger → current-state → portfolio → historical-orders → DQの各laneを全46件で完了してから、DQが正式enqueueした46件のPerformanceを処理する。成功Performanceの既存AutomaticSelectionCoordinatorからv2評価とBehavior controlが自動enqueueされる。BehaviorはPerformance全件完了後に通常SSoTから処理する。
- 無料Info APIのみ。金融式、threshold、manual override、quarantine、source identity契約を変更しない。直接DB/DQ/cursor編集、destructive DB/Redis操作、Discovery backlog drain、有料sourceは行わない。

### 運用結果

- 実行時刻は`04:15:47.746–04:34:49.633 UTC`。正式sync/DQは7 lane × 46 = **322/322 SUCCEEDED**、全件attempt 1、failed / partial API failure 0。同期完了は`04:32:58.820 UTC`。
- fresh <=24hは**46/46**、staleは46 → 0。DQがenqueueしたPerformanceは46件を新規計算（reused 0）し、**SUCCEEDED 44 / INSUFFICIENT_DATA 2 / FAILED 0**、新規metric 352件。全46 RunはTRUSTEDだが、current trusted lookupの対象となるSUCCEEDEDは44件である。既存Runの上書き・quarantine解除はない。
- 新46 Runのcompletenessはすべて`GAP_DETECTED`。current trusted分布は`COMPLETE 0 / PARTIAL 0 / GAP_DETECTED 44 / trusted SUCCEEDED Runなし 2`。これはNAVを含むRun全体のcoverageであり、v2の証明済みclosed-cycle subsetのevaluabilityとは別である。無料履歴を完全化したとは主張しない。
- `TRADE_HISTORY_EVALUABLE`は**36/46**。metric availabilityはwinRate 40 / Profit Factor 40 / averageWin 36 / averageLoss 40 / maxLosingStreak 40 / topTradeContribution 36。欠損を0補完していない。
- trusted closed cyclesはmin 0 / median 9 / max 928。分布は0件: 6 wallet、1–29件: 28、30–99件: 11、100–999件: 1。Runなし2 walletはSelection DTO上のcycle count 0に含まれ、評価可能とは扱わない。

| gate（各walletを独立に評価、欠損は通過扱いしない）        | 通過数 / 46 |
| --------------------------------------------------------- | ----------: |
| closed cycles >=30                                        |          12 |
| winRate >=0.55                                            |          11 |
| Profit Factor >=1                                         |          15 |
| topTradeContribution <=0.50                               |          20 |
| freshness、evaluability、全必須metricを含む全v2 hard gate |           1 |

- cycle → win rate → Profit Factor → top contributionの累積通過は**12 → 2 → 1 → 1**。freshnessを除去した後、評価可能な大標本walletの主要不通過gateはwin rateである。ただし現在はselected 0ではなく1件が自然に通過した。
- 最終current Selection Runは**`cmujbqjbu2af4nq01zg56l0vc`**、`wallet-selection-v2`、`2026-09-27T04:34:11.287Z`。**SELECTED 1 / QUALIFIED 0 / REVIEW 34 / EXCLUDED 11**、ranking 1件、effective selected 1件。44回の成功Performance completionが通常の自動評価/control enqueueを行い、最終pointerは全46件の処理後の状態を参照する。
- reason件数（重複あり）はTOO_FEW_COMPLETED_TRADES 32、TRADE_HISTORY_NOT_EVALUABLE 8、REQUIRED_METRIC_MISSING 8、NO_PERFORMANCE_V3 2、WIN_RATE_BELOW_MINIMUM 10、PROFIT_FACTOR_BELOW_MINIMUM 7、PROFIT_TOO_CONCENTRATED 2。DATA_STALE 0。全46 walletのoverrideはAUTOであり、manual INCLUDE / threshold変更はない。

### Ranking / 通常API

| rank / status | canonical address                            | closed cycles | win rate               | Profit Factor          | average win            | average loss            | top trade contribution |
| ------------- | -------------------------------------------- | ------------: | ---------------------- | ---------------------- | ---------------------- | ----------------------- | ---------------------- |
| 1 / SELECTED  | `0x34112cf6672cbad0f44b5a77857099417dc686af` |            57 | `0.684210526315789474` | `1.011095793418617382` | `0.538291941475826972` | `-1.153500206530958439` | `0.127714892493861886` |

- Performance Run: `cmujbpj6527jdnq01t6zuxi9u`。lastSyncAtは`2026-09-27T04:24:54.176Z`。通常APIの`latestActivityAt`は現行契約上`performanceCalculationTo`であり、`2026-09-27T04:26:55.552Z`。実際の最新Fill日時は`2026-09-24T13:21:27.107Z`である。この2つを同一視しない。
- win rate降順 → trusted cycles降順 → Profit Factor降順 → top contribution昇順 → canonical address昇順で、Decimalによる独立sortと保存rankを照合し一致した。実rankingは1件のため複数walletのtie-breakの実データ実証はできないが、既存policy testで全tie-breakを検証している。
- exact main imageの正式`registerWalletSelectionRoutes` + `PrismaWalletSelectionService`を実DBへ接続し、Fastify HTTP injectionによる`GET /api/wallet-selection/ranking`が200、service結果と完全一致、SELECTED 1件のみであることを確認した。REVIEW / EXCLUDEDの露出は0、quarantined Run参照は0。

### Behavior / DQ

- 通常Behavior consumerは**1 wallet / 7 coin**を処理。44自動control + 308 wallet/coin job = **352 job**、BullMQ failed 0。outcomeはcontrol continued 44 / coin completed 220 / coin blocked 88 / no-op 0。44回のcontrolが同じ最終selected setを参照したため各coinを44回評価したが、event identityによって重複保存していない。無制限schedulerやbacklog drainではない。
- 新規Behavior eventは**1,888**（ASTER 16 / BTC 688 / ETH 385 / HYPE 2 / SOL 670 / XPL 127）、runは8件（SUCCEEDED 5 / BLOCKED 3）。BTCは初回の処理済みprefixを含むRunと未処理suffixのRunが別に存在するため、blocked coin 2に対してblocked Runは3である。
- 新規Behavior OPEN DQは2件。BTC: `IMPOSSIBLE_TRANSITION`、source group `2026-08-04T19:16:40.471Z`、ID `cmujbqpi82c31nq01w9uvy3j4`。trusted boundaryから完全chainを作れず、cursorは直前の`2026-08-03T00:38:33.720Z`で停止した。`xyz:CL`: `MISSING_BOUNDARY`、source group `2026-03-02T11:14:24.461Z`、ID `cmujbqvnn2elbnq01tjgsjrh5`。custom marketのeventは0件。現行初期境界解決でこのreasonに集約されており、quoteがUSDとして証明されたとは扱わない。
- 同一source groupの再評価はDQ fingerprintで2件に集約され、各reevaluationCount 43。危険区間をスキップして後続eventを生成する変更はしていない。**Behavior全coinがcurrentになったとの判定ではなく、正常な部分処理とfail-closed動作を確認した結果である。**
- source側の新規OPEN DQは1件: `HYPERLIQUID_FUNDING_PAGINATION_LIMIT`、wallet `0x815d735c7e52c9ccb5fd14cb52f42fd2f862b58d`、ID `cmujban4a0e8inq011jwixbxw`。Funding 9,107 unique item取得時に既存pagination上限でcoverageがUNPROVENとなった。解消を強制していない。
- 対象46 walletの既存OPENはWebSocket gap 256 / error 73 / user limit 15を維持。INCOMPLETE_INITIAL_SYNC 4件だけが正式DQ auditにより解消され、source OPEN合計348 → 345（新規Funding 1を含む）。直接DQ更新・reopenは0。quarantined Runは14のまま、Behavior scopeからのquarantined Performance参照は0。

### Queue / 負荷 / 終了状態

既存`bull` queueのbefore / afterは全countとactive ID/lock状態が完全一致した。wait / delayed / paused / waiting-children / stalled setはいずれも0である。

| 既存queue                        | prioritized before → after | active before → after | completed / failed（不変） |
| -------------------------------- | -------------------------: | --------------------: | -------------------------- |
| hyperliquid-sync                 |                      0 → 0 |                 0 → 0 | 318 / 444                  |
| hyperliquid-discovery            |                      1 → 1 |                 0 → 0 | 17 / 609                   |
| hyperliquid-candidate-enrichment |              8,427 → 8,427 |                 1 → 1 | 20 / 5                     |
| address-performance              |                      1 → 1 |                 0 → 0 | 66 / 14                    |
| behavior-normalization           |                      0 → 0 |                 0 → 0 | 24 / 0                     |

- enrichmentの既存active 1件はlock不在のstale jobのまま保持した。修復・削除も消費もしていない。
- 専用prefixは開始時empty、終了時completed sync 322 / Performance 46 / Behavior 352。wait / active / delayed / prioritized / paused / failedはいずれも0。queue削除は行わず履歴を保持した。
- sampled peakはWorker CPU 76.48% / 588.5 MiB、PostgreSQL CPU 78.06% / 2.394 GiB、Redis CPU 2.30% / 47.54 MiB。連続profilingの絶対peakではない。PostgreSQL累積block I/Oの最終観測はread 6.25 GB / write 538 MB。OOM / retry storm / stalled eventは0。
- 限定Workerはgraceful close後に終了。常設Workerは停止したままで、PostgreSQL / Redisのみ稼働。runtime runnerは削除し、再実行可能なone-off mutation toolを変更差分へ残さない。
- ローカル監査証跡はgitignoredの`v2-refresh-preflight.log / v2-refresh-progress.log / v2-refresh-postflight.log / v2-refresh-results.log`。文書以外のtracked変更はない。main merge / deploy / 実DB migration / 有料sourceは0件。正式refresh自体にdestructive操作はないが、下記のtest誤接続によるfixture作成・削除を例外として明記する。

### Validation / 次の工程

- 運用後の最終validation: `pnpm format:check` PASS、`pnpm lint` PASS、`pnpm typecheck` 11/11 PASS、`pnpm test` 71 files / 661 tests PASS、`pnpm build` 11/11 PASS、`pnpm test:e2e` 22/22 PASS、`pnpm audit --audit-level high` exit 0（high以上0、既知moderate 4）、`git diff --check` PASS。コード/schema/migrationの変更、commit / push / PR作成はない。
- 初回pnpm commandで非TTY installエラーが出たため`CI=true pnpm install --frozen-lockfile`で確認した（lockfile変更なし）。文書を整形後にformatを再確認した。WSL終了によるDB接続断で運用後のtest/E2Eが一度失敗したが、非表示WSL keepaliveの下で下記の隔離環境を明示し、全testを再実行してPASSした。失敗やskipを成功扱いしていない。
- 最終testは`DATABASE_URL=postgresql://…@127.0.0.1:55433/chaincopy?schema=public`、`REDIS_URL=redis://127.0.0.1:56380/0`。E2Eは`E2E_DATABASE_URL=postgresql://…@127.0.0.1:55433/chaincopy?schema=chaincopy_e2e`、`E2E_REDIS_URL=redis://127.0.0.1:56380/15`。専用一時container上でのみtest migration/cleanupを行い、終了後にそのcontainerを停止した。

### Validation時の安全境界例外（ACCEPTED AS CONTAINED）

- 先行する`pnpm test`（04:18 UTC頃）で接続先を明示せず、Phase 2 / Phase 3 integration testが`.env`の実PostgreSQL/Redisへ接続した。testはランダムUUIDの専用source/address/queueにfixtureを作成し、終了処理でfixtureをDELETEし、専用queueを`obliterate`した。Phase 2は同じUUID addressのmainnet fixtureに対してwatch/cursor等もtestした。これは本依頼の実DB/Redisに対するmutation禁止境界を満たさず、隔離確認の不備である。
- testコードの変更やDB repairで隠蔽・巻戻しをせず、以後のtest接続を隔離環境へ明示した。read-only確認で、今回のUUID契約/suffixに一致する新規fixture source / wallet残存は0、`bull:phase2-integration-*` queue key残存は0。既存phase3 fixture source 9件はすべて2026-08-02〜08-16作成分であり、削除していない。
- 対象automatic universeは46のまま、固定allowlist hashは一致、quarantine 14、実5 queueのcount/active情報はpreflightと一致した。対象walletや本番backlogをtestが削除した証拠は見つかっていない。ただし誤接続でfixtureの実サービス内作成・削除が行われた事実を「mutation 0」とは報告しない。
- Owner判定: **ACCEPTED AS CONTAINED**。上記の誤接続の事実は監査記録として保持し、Owner確認待ちのBLOCKED状態を解除する。

| 項目                             | Owner確認済みの結論                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| root cause                       | integration testが初回に実サービスの`DATABASE_URL / REDIS_URL`を継承した。明示的な隔離接続先を指定していなかった。 |
| affected objects                 | UUID-only test fixturesのみ。                                                                                      |
| residual fixtures                | 0                                                                                                                  |
| automatic-universe wallet impact | 0（46 wallet不変）                                                                                                 |
| quarantine impact                | 0（14 Run不変）                                                                                                    |
| existing queue impact            | 0（既存queue/backlog不変）                                                                                         |
| recovery action                  | none required。追加cleanup、DB/Redis mutation、46-wallet sync再実行はしない。                                      |
| verification                     | 明示的に隔離した環境で全validationを再実行しPASS。結果は上記Validation参照。                                       |

- 再発防止要件: integration / E2Eは**明示的な隔離DB/Redis接続先を必須**とし、接続先が未指定・未検証の場合は実行前にfail closedする。通常runtimeの`DATABASE_URL / REDIS_URL`や`.env`を暗黙継承・fallbackしてはならない。隔離対象を検証できなければfixture作成・cleanup・queue操作を開始しない。
- この文書PRは再発防止要件を記録するものであり、接続先拒否ガードのコード実装完了を意味しない。将来のguard実装は別の限定engineering作業とする。今回の文書確定ではローカルformat / diff checkだけを再確認し、文書のみのためコード系ローカルtestを再実行しない（workflow第8節）。GitHub CIはその専用service環境で実行する。

### 次の工程 / 最終判定

- 次はselected walletのBTC boundary不連続とcustom-market source/quote契約をread-onlyで調べ、必要なら別の限定engineering契約とする。DQ条件を緩めたり、cursorを飛ばしたりしてBehaviorを通さない。
- Discovery拡大や8k+ backlog drainは今回の対象外。selected数最大化や新しい運用の常時起動へ拡張しない。
- 最終運用判定: **V2 OPERATIONAL FLOW VERIFIED — SELECTED WALLETS FOUND**。自然なSELECTED 1件とBehaviorの正常な部分処理/fail-closed経路を確認し、validation incidentはOwnerによりcontainedとして受け入れ済み。未証明の2 coinのBehavior完全性は宣言しない。追加cleanup、DB/Redis mutation、同期やrecoveryの再実行はせず、Workerを停止したまま文書のみを確定する。
