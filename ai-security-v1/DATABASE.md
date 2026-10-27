# Configured ai_security MySQL Database

Read this file for direct database work and for the telemetry connection boundary. Direct database access remains a separate operating mode; full audits use the project's standing `ai_security` telemetry policy through the trusted Parent database client.

Exception for process telemetry: a full audit writes each validated record point to the configured `ai_security.audit_*` tables under the project's standing `remote_mysql` organization policy, after durably appending it to the local Outbox. Read [TELEMETRY.md](TELEMETRY.md) first. The database is a replayable projection and may not feed database content back into a current audit verdict.

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

The telemetry protocol is `1.4.0`; the deployed 36-table database schema remains `1.3.0-core`. The user accepted two non-blocking risks for this deployment: TLS server identity is not verified, and the configured account has broader privileges than a least-privilege runtime account. Record those facts as `accepted_risk`; do not call them secure or compliant.

Despite the account's database privileges, `scripts/telemetry/database-client.cjs` is restricted to the configured `ai_security` schema, the event/table allowlist, prepared inserts, compare-and-swap updates, idempotency reads, and transaction control. It must never issue `DELETE`, DDL, privilege statements, stored-program statements, dynamic table names, or access another database. Views and an `audit_schema_version` seed are not required by this Skill version.

The trusted Parent normally supplies `AI_SECURITY_DB_HOST`, `AI_SECURITY_DB_PORT`, `AI_SECURITY_DB_USER`, and `AI_SECURITY_DB_NAME`, and the password in `MYSQL_PWD` when invoking a remote-mode record point or `flush-outbox`. When those variables are not present, the database client resolves the already configured connection profile in this file inside the trusted Parent process; it never places the password in arguments, events, reports, or Agent context. The client refuses any database name other than `ai_security`. Agents, target-controlled processes, prompts, Outbox records, payloads, reports, and command arguments must never receive these values. MySQL commit precedes local checkpoint advancement. A failed remote projection leaves the event pending in the Outbox and, under `best_effort`, cannot alter the audit verdict.

## Workflow

1. Restate the requested outcome and classify it as read-only, export, DML, or high-risk administration.
2. For read-only work, inspect only the minimum schema needed with `SHOW TABLES`, `SHOW CREATE TABLE`, `SHOW INDEX`, or `INFORMATION_SCHEMA`, then run bounded queries. Add a reasonable `LIMIT` during exploration.
3. For exports, confirm the requested columns, filters, and destination. Export only necessary fields to a user-approved path; exclude secrets and unnecessary personal data.
4. Before `INSERT`, `UPDATE`, or `DELETE`, show the exact SQL or a precise summary, run an equivalent `SELECT` or `COUNT(*)` to estimate affected rows, and obtain explicit user approval for that mutation. Permission to use this skill or connect to the database is not approval for arbitrary writes.
5. Run transactional DML inside `START TRANSACTION`; verify affected rows and representative non-sensitive results before `COMMIT`. On unexpected results, `ROLLBACK` and report what happened.
6. Treat DDL, `TRUNCATE`, bulk updates or deletes, privilege changes, and stored-program execution as high risk. Require explicit approval naming the operation and target immediately before execution, and take or request an appropriate backup when recovery matters.
7. After a write, report the statement category, target table, affected-row count, verification performed, and whether the transaction committed or rolled back. Do not include credentials or sensitive row contents unless the user specifically requested those fields.

## Guardrails

- Do not use the telemetry database client for arbitrary queries. Full-audit process telemetry is the configured exception; live database inspection, export, and DML remain separately authorized operations.
- Do not use `--force`, disable foreign-key checks, broaden access, create users, grant privileges, change server configuration, or touch another database without a separate explicit request and approval.
- Never run an unqualified `UPDATE` or `DELETE`. Require a reviewed `WHERE` clause and preview matching primary keys or a bounded representative sample.
- Prefer parameterized application code for repeated or user-supplied values. For one-off client commands, quote identifiers and values carefully and never construct SQL directly from untrusted text.
- Stop on authentication, TLS, privilege, schema ambiguity, or unexpected affected-row errors. Do not retry a potentially mutating statement automatically.
- Keep database results out of audit artifacts unless the user explicitly requests that inclusion and the retained content is necessary, non-secret, and appropriately minimized.
