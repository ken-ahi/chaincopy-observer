# Issue #26 Stage 3B exact-row repair preparation

Date: 2026-08-31 (JST)  
Scope: read-only preparation and verification only  
Stage 3A evidence: `issue26-stage3a-repair-manifest.json` was read but not changed

## Verdict

`NOT READY FOR STAGE 3B EXECUTION`

The repository artifact and verifier pass their deterministic checks, but the live PostgreSQL service was not reachable from this execution environment at either `postgres:5432` or `127.0.0.1:5432`. Consequently the mandatory current-DB exact match cannot be claimed. This is an unavailable verification prerequisite, not an observed identity discrepancy. No mutation was attempted.

## Manifest validation

The repository-local preflight validates the exact bytes of the Stage 3A JSON before interpreting it.

| Check                             |                                                             Result |
| --------------------------------- | -----------------------------------------------------------------: |
| Artifact SHA-256                  | `effe5f8c8c294d3071b45422ddc463bc87fab4a3f67fa0c12613d2d63aff0329` |
| Total incident rows               |                                                                203 |
| `portfolio_snapshots` / DELETE    |                                                                161 |
| `raw_events` / KEEP               |                                                                 42 |
| Source-write SyncJobs             |                                                                 22 |
| Duplicate PKs within either table |                                                                  0 |
| Duplicate physical identities     |                                                                  0 |
| Raw rows selected for deletion    |                                                                  0 |

The 161 rows comprise 143 `portfolio-history`, 13 `portfolio`, and 5 `clearinghouseState` snapshots. The verifier also reproduces all four class checksums documented in Stage 3A, validates the positional schemas, verifies that every row maps to a represented source job with the same wallet and appropriate job type, and verifies that persistence occurred within that job's recorded interval. It does not regenerate or rewrite either Stage 3A artifact.

## Read-only exact preflight

Run from the repository root with the target database connection configured:

```bash
pnpm db:issue26-stage3b-preflight
```

The command opens a Prisma transaction, sets it `READ ONLY`, and performs bounded primary-key allowlist reads. For each DELETE candidate it compares all of:

- `id`
- `walletAddressId`
- `sourceId`
- `fingerprint`
- `snapshotType`
- `capturedAt`
- `createdAt`

For the 42 KEEP rows it separately compares `id`, wallet, source, fingerprint, `eventType`, and `receivedAt`. It also exactly compares the 22 source-job IDs, idempotency keys, names, wallets, start times, and finish times. A primary-key-only match cannot pass.

The verifier returns nonzero unless DELETE=161, exact DB matches=161, missing DELETE=0, identity mismatch=0, ambiguous match=0, KEEP selected for mutation=0, outside-manifest selected=0, all 42 KEEP rows match, and all 22 jobs match. It additionally requires exactly 14 globally quarantined runs, all `SUCCEEDED / QUARANTINED / revision 1`, 14 trust transitions, child counts 115 Metrics / 171 Cycles / 68 DailyNav, and zero Selection/Behavior references.

Current live result: **not obtained**. Both configured Docker-network and loopback endpoints refused the connection. Therefore the exact-match counts and identity mismatch list remain unverified; they are not inferred from Stage 3A.

## Owner-authorized transaction design (not implemented or executed)

The future write must use the same immutable JSON parser and the following single interactive Prisma transaction:

1. Stop Worker writers and re-run all read-only preconditions.
2. Begin one transaction with an appropriate finite transaction timeout.
3. Load the exact 161 manifest IDs using `SELECT ... WHERE id IN (...) FOR UPDATE`; select every identity field listed above.
4. Re-run the pure exact-identity verifier on the locked rows. Throw before mutation unless it returns all required zero/161 counts.
5. Execute one `portfolioSnapshot.deleteMany({ where: { id: { in: exactManifestIds } } })`. The PK predicate is safe only because those exact rows were locked and fully revalidated inside the same transaction.
6. Require `count === 161`; otherwise throw so PostgreSQL rolls the entire transaction back.
7. Before commit, verify the 161 IDs are absent and the 42 raw KEEP IDs remain exact and present. Then commit.

There is no fallback, missing-row skip, time-window predicate, partial commit, or retry that treats a changed manifest as valid. Any exception or affected-count mismatch rolls back the transaction. The execution package must have no code path that writes `raw_events`, SyncJobs, Runs or children, cursors, wallets, DQ, or Redis.

The architecture supports this atomic design: 161 bounded rows fit a single allowlist/transaction, and PostgreSQL row locks prevent identity changes between recheck and deletion. If lock acquisition or the transaction timeout fails, abort and retry only after a new complete preflight; do not weaken atomicity.

## Post-delete read-only verification

After a future authorized commit, prove both exact identity outcomes and aggregate invariants:

- all exact 161 manifest `portfolio_snapshots` IDs are absent;
- all exact 42 KEEP `raw_events` identities remain present;
- all 22 source SyncJobs remain exact and present;
- `portfolio_snapshots = 1,511,408` and `raw_events = 13,512,217`;
- trust transitions remain 14;
- the 14 incident Runs remain `SUCCEEDED / QUARANTINED / revision 1`;
- Metrics/Cycles/DailyNav remain 115/171/68;
- Selection and Behavior references remain zero.

Counts alone do not pass this gate. A count mismatch or any identity mismatch is fail-closed and blocks replay.

## Downstream quarantine

Deletion does not restore trust. Before canonical replay, an older snapshot may appear latest; 13 history wallet/type groups lack a same-timestamp replacement, all 13 affected portfolio envelopes are latest, and all 5 current-state snapshots are latest. Performance recalculation, Selection evaluation, and Behavior processing remain prohibited after deletion until separately approved canonical replay and data-quality verification complete. The 14 runs remain quarantined throughout.

## Cursor and replay analysis

`snapshotPositions()` always calls `clearinghouseState()` for the canonical job address and writes the response. It does not read `account-snapshot` cursor position or wallet `last_sync_at` to choose a start boundary. The cursor is lifecycle/progress state: `beginCursor()` marks it running, and `completeCursor()` advances it after successful current-state persistence and updates `last_sync_at`. Therefore the five incident-advanced cursor timestamps and wallet timestamps do **not** cause a later current-state fetch to be skipped.

The safe future replay is to enqueue new, separately approved `hyperliquid-current-state-snapshot` jobs for the five affected canonical `(walletAddressId, DB address)` pairs and new `hyperliquid-portfolio-snapshot` jobs for the 13 affected portfolio wallets. A new deterministic queue job ID is required: the processor suppresses a previously `SUCCEEDED` SyncJob with the same idempotency key. The processor re-reads the canonical DB address and raises an unrecoverable error before persistence if the supplied pair differs.

Normal current-state and portfolio snapshot sync are sufficient. No bounded/full current-state mode is needed because these endpoints return present state/portfolio directly and do not use history cursor boundaries. “Bounded/full” is relevant to historical endpoints, not this repair. The protections against skip are: a fresh job identity, the processor's canonical-pair check, unconditional upstream calls in both snapshot methods, and no use of `last_sync_at` or prior cursor position as a current-state fetch gate. Cursor and wallet lifecycle values must remain untouched by Stage 3B itself.

## Explicit mutation scope

The only future Stage 3B mutation eligible for separate Owner authorization is DELETE of the exact 161 `portfolio_snapshots` IDs in the unchanged JSON allowlist. This preparation performed no DB DELETE/UPDATE, DQ mutation, replay, performance calculation, Selection, Behavior, Redis operation, commit, push, or PR.

## Repository changes and validation

Added code/scripts:

- `scripts/issue26-stage3b-preflight-policy.ts` — immutable manifest and exact-match policy
- `scripts/issue26-stage3b-preflight-policy.test.ts` — checksum/count and fail-closed unit tests
- `scripts/issue26-stage3b-preflight.ts` — read-only live preflight CLI
- `package.json` — read-only command entry

Added this report. The Stage 3A Markdown and JSON remain unchanged.

Validation executed:

- targeted Vitest: 4 tests passed;
- standalone strict TypeScript check: passed;
- live preflight attempts: blocked before queries by unreachable PostgreSQL; no DB statement ran;
- full repository gates: recorded in the final task report.

To change the verdict, make the target PostgreSQL service reachable and run the preflight successfully against the unchanged evidence artifact. A passing output must be attached to the Owner review immediately before any separate Stage 3B execution authorization.
