# Strict audit process telemetry

Telemetry protocol `1.5.0` uses the deployed `1.3.0-core` 36-table `ai_security.audit_*` schema. It is mandatory for every explicit or implicit invocation of this Skill. Only `mode=remote` and `failure_policy=required` are valid. `off`, `local`, `best_effort`, `pending_sync` delivery, and silent degradation are forbidden for new sessions.

The database remains a replayable process projection, never evidence about the target and never input to a security verdict. Mandatory telemetry authorization does not authorize arbitrary database queries or mutations.

## Mandatory lifecycle

Before target inspection, tool use, Agent launch, direct database work, or answer generation:

1. Tell the user that the `ai_security` database preflight is starting.
2. Run `node <skill-dir>/scripts/telemetry/audit-session.cjs check-db [--output-dir <dir>]`.
3. Continue only when the response is `ok=true`, `stage=database_preflight`, and `status=passed`.
4. Prepare initialization with `prepare` and commit its two transactions one at a time with `commit-next`.

The preflight validates the mysql client, connection, authentication, database identity, server version, TLS state, the pinned table/column/constraint/collation contract, transaction/prepared-statement capability, and safe local telemetry storage. Failure output uses a stable code and safe reason. Never expose raw stderr, credentials, connection strings, environment values, or host paths.

New non-audit sessions default to `~/.codex/state/ai-security-v1/sessions/<date>/<run-id>/`. Full audits use their output directory. Directories are `0700`; state files are `0600`, regular, non-symlink, and single-link.

## Strict Parent interface

```sh
node <skill-dir>/scripts/telemetry/audit-session.cjs check-db [--output-dir <output-dir>]
node <skill-dir>/scripts/telemetry/audit-session.cjs prepare --output-dir <output-dir>
node <skill-dir>/scripts/telemetry/audit-session.cjs commit-next --output-dir <output-dir> --plan-id <id> --ordinal <n> --notice-token <token>
node <skill-dir>/scripts/telemetry/audit-session.cjs commit-next --output-dir <output-dir> --plan-id <id> --ordinal <n> --notice-token <token> --retry true
node <skill-dir>/scripts/telemetry/audit-session.cjs verify --output-dir <output-dir>
```

Input to `prepare` is JSON on standard input or in a regular non-symlink `--input` file. Supported kinds are `init`, `event`, `snapshot`, and `finalize`. Agent results are expanded by `agent-adapter.cjs` into an ordered transaction list. The legacy wrapper commands `init`, `event`, `snapshot`, `flush`, and `finalize` are rejected for new sessions because they cannot guarantee a user-visible notice before every transaction.

Protocol `1.4.0` sessions never become active `1.5.0` sessions. A legacy `off` or `local` session is archive-only. An already-authorized legacy `remote` Outbox may only be replayed as a standalone maintenance action with `node scripts/telemetry/cli.cjs flush-outbox --legacy-replay true --output-dir <old-run>`; it may not receive new events, finalize through the strict interface, or satisfy a `1.5.0` completion receipt.

## Prepare, announce, commit

`prepare` performs only local validation and expansion. It creates an immutable plan and separate mutable progress state. Each transaction contains its ordinal, event ID, type, phase, envelope SHA-256, estimated rows, target tables, redacted purpose/data summary, and a notice token bound to the plan and event.

For every transaction, before `commit-next`, tell the user:

```text
数据库写入准备：
位置=<phase / event>
目的=<redacted purpose>
写入数据=<categories and counts>
目标表=<allowlisted tables>
数据级别=<redaction statement>
```

After a successful commit, report position, `projected|already_applied`, event ID, committed status, and next action. Do not proceed until success.

`commit-next` accepts exactly one ordinal. It rejects a missing/mismatched token, out-of-order ordinal, unsafe plan file, changed envelope, or attempt beyond the allowed retry. MySQL commit precedes local checkpoint advancement.

On the first `DB_UNAVAILABLE`, `commit-next` returns `status=retry_required` and retains the same Outbox event and idempotency key. Tell the user that the event is retained, then immediately retry once with `--retry true`. A second failure or any non-retryable error returns `status=blocked`; stop the task. Never create a replacement event or continue from an uncommitted tail.

Stable error codes include `MYSQL_CLIENT_UNAVAILABLE`, `NETWORK_AUTHORIZATION_REQUIRED`, `DB_UNAVAILABLE`, `AUTH_REQUIRED`, `TLS_ERROR`, `SCHEMA_INCOMPATIBLE`, `OUTBOX_UNWRITABLE`, `OUTBOX_CORRUPT`, `PROJECTION_FAILED`, `CONCURRENCY_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `NOTICE_REQUIRED`, `ORDER_VIOLATION`, and `INVALID_CONFIG`.

## Mode record points

### Guidance

Commit, in order: `run.initialized`, `run.preflight_completed`, `interaction.checkpoint_recorded`, and `run.finalized`. The interaction checkpoint stores only mode, request fingerprint, redacted target, action categories, tool/Agent metadata, evidence and conclusion counts, outcome category, and stable error categories. It never stores the complete request or answer.

### Focused review

Use the Guidance lifecycle plus phase start/end and every applicable tool or Agent task/result event. Every adapter-expanded event is separately announced and committed.

### Full audit

Use all P0-P6 record points in the projection map. Every Recon, Hunter, Critic, and Verifier result with `_process.schema_version=1.5.0` goes through `prepare`; each returned transaction is announced and committed before the next audit action. A malformed/missing required sidecar blocks the run rather than degrading telemetry.

### Database mode

After initialization, commit `database.operation_authorized` before the direct operation and `database.operation_completed` after it. Telemetry records only operation category, target table identifiers, SQL/request fingerprints, expected/actual affected-row counts, authorization state, and committed/rolled_back/outcome_unknown status. It never stores credentials, complete SQL values, or sensitive rows.

Direct DML still requires user approval and the transaction workflow in [DATABASE.md](DATABASE.md). If the DML commit outcome is ambiguous, do not replay it; record `outcome_unknown`, stop, and use a separately authorized read-only verification.

## Outbox, redaction, and database boundary

- Append to `telemetry/outbox.jsonl` before attempting the remote transaction.
- The Outbox is a length- and SHA-256-bound fsynced hash chain.
- Delivery is at least once with request-hash and database-envelope idempotency.
- The database client is limited to the configured `ai_security` schema, event/table allowlist, prepared inserts, CAS updates, idempotency reads, and transaction control.
- No delete, DDL, privilege statement, stored program, dynamic table name, or other database is allowed through telemetry.
- Payloads are redacted before Outbox append. Credentials, authorization state, private keys, connection strings, complete environments, absolute host paths, sensitive database rows, complete user messages/answers, and hidden reasoning are forbidden.
- The configured TLS identity and broad-account risks remain recorded as accepted risks, not secure defaults.

## Completion gate

Prepare and commit `run.finalized`, then run `verify`. Verification requires a valid Outbox chain with no uncommitted tail, checkpoint sequence equal to the final Outbox sequence, terminal event type `run.finalized`, the same terminal envelope SHA-256 in remote MySQL, and all prepared plans committed in order.

`verify` writes `telemetry/completion-receipt.json`. Do not deliver the final answer or report without this receipt.

## Tests

```sh
node <skill-dir>/validate-findings.test.cjs
node <skill-dir>/validate-coverage-ledger.test.cjs
node --test <skill-dir>/scripts/telemetry/tests/telemetry.test.cjs
node --test <skill-dir>/scripts/telemetry/tests/strict-session.test.cjs
```

Remote acceptance uses only synthetic identifiers and verifies Guidance, Full audit, and Database-mode event order, notice-to-transaction cardinality, idempotency, and terminal-envelope equality.
