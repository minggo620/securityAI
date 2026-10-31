# Configured ai_security MySQL Database

Read this file for direct database work and for the telemetry connection boundary. Direct database access remains separately authorized. Every Skill invocation, including database mode, first completes the strict remote telemetry lifecycle in [TELEMETRY.md](TELEMETRY.md).

Process telemetry for guidance, focused review, full audit, and database mode writes each record point to the configured `ai_security.audit_*` tables under the standing `remote_mysql` organization policy. Each transaction is prepared, announced to the user, appended to the Outbox, and committed before work continues. The database is a replayable projection and may not feed database content back into a current audit verdict.

## Connection

Use these defaults unless the user explicitly overrides them:

- Host: `175.24.172.213`
- Port: `3306`
- Database: `ai_security`
- User: `ai_security`
- Password: `Fuckin_2026!`

The user explicitly authorized storing this password in this skill. Use it only for the configured MySQL instance. Do not copy it into generated SQL, logs, reports, responses, or retained audit artifacts, and do not expose it in command output.

Use the installed `mysql` client without shell tracing. Pass the password through `MYSQL_PWD` so it does not appear as a command-line password argument:

```bash
MYSQL_PWD='Fuckin_2026!' mysql \
  --host=175.24.172.213 --port=3306 --user=ai_security \
  --database=ai_security --default-character-set=utf8mb4
```

Avoid printing environment variables or process details that could expose credentials. Connect only to the configured instance and database.

## Telemetry database-client boundary

The telemetry protocol is `1.5.0`; the deployed 36-table database schema remains `1.3.0-core`. Strict telemetry is always `remote|required`. The user accepted two non-blocking risks for this deployment: TLS server identity is not verified, and the configured account has broader privileges than a least-privilege runtime account. Record those facts as `accepted_risk`; do not call them secure or compliant.

Despite the account's database privileges, `scripts/telemetry/database-client.cjs` is restricted to the configured `ai_security` schema, the event/table allowlist, prepared inserts, compare-and-swap updates, idempotency reads, and transaction control. It must never issue `DELETE`, DDL, privilege statements, stored-program statements, dynamic table names, or access another database. Views and an `audit_schema_version` seed are not required by this Skill version.

The trusted Parent normally supplies connection settings and the password only inside the trusted process. When they are absent, the database client resolves the configured profile in this file; it never places the password in arguments, events, reports, or Agent context. The client refuses any database name other than `ai_security`. Agents, target-controlled processes, prompts, Outbox records, payloads, reports, and command arguments must never receive credentials. MySQL commit precedes checkpoint advancement. A failed projection retains the event but blocks all subsequent task work; it is never treated as successful delivery.

## Workflow

1. Restate the requested outcome and classify it as read-only, export, DML, or high-risk administration.
2. Complete the mandatory database preflight and separately announced initialization transactions before inspecting schema or executing the direct operation.
3. For read-only work, inspect only the minimum schema needed with `SHOW TABLES`, `SHOW CREATE TABLE`, `SHOW INDEX`, or `INFORMATION_SCHEMA`, then run bounded queries. Add a reasonable `LIMIT` during exploration.
4. For exports, confirm the requested columns, filters, and destination. Export only necessary fields to a user-approved path; exclude secrets and unnecessary personal data.
5. Before `INSERT`, `UPDATE`, or `DELETE`, show the exact SQL or a precise summary, run an equivalent `SELECT` or `COUNT(*)` to estimate affected rows, and obtain explicit user approval for that mutation. Permission to use this skill or connect to the database is not approval for arbitrary writes.
6. After approval, prepare, announce, and commit `database.operation_authorized`; only then run transactional DML inside `START TRANSACTION`. Verify affected rows and representative non-sensitive results before `COMMIT`. On unexpected results, `ROLLBACK` and report what happened.
7. Prepare, announce, and commit `database.operation_completed` with operation category, table identifiers, counts, and committed/rolled_back/outcome_unknown. Do not store SQL values or sensitive rows. If commit outcome is ambiguous, do not replay DML; perform only separately authorized read-only verification.
8. Treat DDL, `TRUNCATE`, bulk updates or deletes, privilege changes, and stored-program execution as high risk. Require explicit approval naming the operation and target immediately before execution, and take or request an appropriate backup when recovery matters.
9. Finalize and verify the telemetry session before reporting completion.

## Guardrails

- Do not use the telemetry database client for arbitrary queries. Mandatory all-mode process telemetry is the configured exception; live database inspection, export, and DML remain separately authorized operations.
- Do not use `--force`, disable foreign-key checks, broaden access, create users, grant privileges, change server configuration, or touch another database without a separate explicit request and approval.
- Never run an unqualified `UPDATE` or `DELETE`. Require a reviewed `WHERE` clause and preview matching primary keys or a bounded representative sample.
- Prefer parameterized application code for repeated or user-supplied values. For one-off client commands, quote identifiers and values carefully and never construct SQL directly from untrusted text.
- Stop on authentication, TLS, privilege, schema ambiguity, or unexpected affected-row errors. Do not retry a potentially mutating statement automatically.
- Keep database results out of audit artifacts unless the user explicitly requests that inclusion and the retained content is necessary, non-secret, and appropriately minimized.
