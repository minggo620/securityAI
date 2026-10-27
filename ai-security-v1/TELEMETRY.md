# Audit process telemetry

Read this file in full audit mode before Phase 0. Telemetry is a sidecar: the canonical audit files and their existing validators remain authoritative. Never use the database as evidence about the target or as input to a current verdict.

## Protocol and database versions

- Telemetry protocol: `1.4.0`.
- Deployed database schema: `1.3.0-core`, 36 `audit_*` tables.
- The protocol may evolve without changing the table structure. Runtime schemas and the event allowlist are in `references/telemetry/`.
- Views and an `audit_schema_version` seed are not required for this version.

The configured account has broader privileges than a least-privilege Writer and TLS server identity is not verified. The user accepted both as explicit non-blocking risks. Do not represent them as secure defaults: record `broad_database_account` and `tls_identity_not_verified` in the P0 configuration payload. The Writer's application allowlist remains mandatory.

## Modes

- `off`: no telemetry directory, Outbox, `_process` requirement, or database connection.
- `local`: the full-audit default. Append validated, redacted events to the local Outbox; do not connect to MySQL.
- `remote`: requires active `remote_mysql` consent for this run or an auditable organization policy. Append locally first, then project to `ai_security`.

`best_effort` is the default failure policy. A telemetry failure marks telemetry incomplete but never changes a valid audit verdict. Under `required`, an unwritable/corrupt local Outbox stops new Agent launches and makes the run incomplete. A temporarily unavailable MySQL database does not stop the audit when the Outbox remains sound.

## Trusted Parent interface

Only the Parent invokes the CLI. Agents and target-controlled processes never see database credentials, the Outbox, checkpoint, dead-letter file, or another Agent's directory.

```sh
node <skill-dir>/scripts/telemetry/cli.cjs init-run --output-dir <output-dir> [--config <config.json>]
node <skill-dir>/scripts/telemetry/cli.cjs record-event --output-dir <output-dir>
node <skill-dir>/scripts/telemetry/cli.cjs record-snapshot --output-dir <output-dir>
node <skill-dir>/scripts/telemetry/cli.cjs flush-outbox --output-dir <output-dir>
node <skill-dir>/scripts/telemetry/cli.cjs finalize-run --output-dir <output-dir>
```

Input is a JSON object on standard input unless `--input` names a regular non-symlink file. Output is one JSON object:

```json
{"ok":true,"event_id":"...","status":"appended|projected|already_applied|pending_sync|synced|disabled","error":null}
```

Never parse human prose from CLI output. On failure, use the stable `error.code` only.

### Initialize a run

Call `init-run` after resolving full-audit setup and before launching any Recon Agent. The input contains the authoritative run metadata, scope, and optional telemetry override:

```json
{
  "repo": "stable repository identifier",
  "target": "relative or pseudonymized locator",
  "source_ref": "reviewed commit/ref",
  "worktree_dirty": false,
  "profile": "quick|standard|deep",
  "budget": null,
  "scope_paths": [{"scope_type":"path","scope_value":"packages/api","included":true}],
  "request_idempotency_key": "caller supplied retry identity",
  "telemetry": {
    "schema_version":"1.4.0",
    "mode":"local",
    "failure_policy":"best_effort",
    "outbox_relative_path":"telemetry/outbox.jsonl",
    "payload_max_bytes":5242880,
    "remote_sync":{"enabled":false,"tls_mode":"PREFERRED","tls_identity_verified":false},
    "consent":{"local_outbox":true,"remote_mysql":false,"authority_type":"explicit_user","authority_reference":"this audit request","purpose":"audit process analysis","data_classes":["run_metadata","agent_metadata","structured_claims","evidence_metadata","redacted_payload","artifacts"],"retention_policy":"long_term_configurable"},
    "accepted_risks":["tls_identity_not_verified","broad_database_account"]
  }
}
```

Retain the returned `run_id` and `phase_execution_id` in `run-metadata.json`. If local initialization fails under `best_effort`, record the exact stable error code and continue with telemetry incomplete. Under `required`, launch no Agent.

### Record an event

`record-event` has two trusted-Parent inputs. For ordinary Parent/platform events it accepts an explicit event descriptor. For an Agent return, pass the already validated core result as `agent_result` plus trusted `context`; `agent-adapter.cjs` validates `_process`, generates all ULIDs and projections, and returns the created entity map. This is the required path for Recon, Hunter, Critic, and Verifier results; do not hand-copy their sidecar fields into SQL-shaped JSON.

```json
{
  "run_id":"01...",
  "phase_code":"P2",
  "event_type":"hypothesis.created",
  "actor_type":"parent",
  "actor_id":"parent",
  "agent_task_id":"01...",
  "idempotency_key":"run/01.../P2/hypothesis/h1/version/1",
  "source_class":"P",
  "payload_type":"hypothesis.version",
  "payload":{
    "_telemetry":{"phase_execution_id":"01..."},
    "data":{},
    "projections":[
      {"table":"audit_hypothesis","action":"insert","values":{}},
      {"table":"audit_hypothesis_version","action":"insert","values":{}},
      {"table":"audit_hypothesis_coverage","action":"insert","values":{}},
      {"table":"audit_hypothesis_score","action":"insert","values":{}}
    ]
  },
  "source_refs":[]
}
```

Projection operations are an internal Parent-to-Writer contract. Each event may touch only the tables listed for its event type in `projection-map.json`, and every table in that event's `required_tables` must be present. The runtime rejects a valid-looking event with zero business rows. It also enforces the declared phase and causal predecessor before Outbox append. Values may use `$run_id`, `$event_id`, `$payload_id`, and `$agent_task_id`; the trusted Writer resolves them. Binary values use `{"$hex":"..."}` and JSON values use `{"$json":{...}}`. Updates require a nonempty `where`; tables with `row_version` require compare-and-swap values in both `values` and `where`.

Do not let an Agent construct `projections`, ULIDs, idempotency keys, SQL, or database column names. For Agent returns, the Parent supplies only trusted context mappings (phase/task IDs, accepted fact IDs, coverage/entity IDs and row versions); the adapter translates the valid core result and valid `_process` sidecar. Adapter-owned IDs are deterministically derived from run, task, request idempotency key, and a typed logical entity key, so a partial retry recreates the same IDs and causal links. The CLI response's `entities` map is the only generated ID map that may be carried into the next checkpoint.

An Agent-result input has this outer form:

```json
{
  "run_id":"01...", "phase_code":"P1", "actor_type":"recon",
  "agent_task_id":"01...", "idempotency_key":"run/01.../P1/recon/r1",
  "agent_result":{"...core result":"...", "_process":{"schema_version":"1.4.0","result_type":"recon","agent_id":"recon-1","explicit_rationale":"...","evidence_refs":[],"observations":[],"recon_facts":[]}},
  "context":{"phase_execution_id":"01...","task_row_version":0,"accepted_fact_ids":[],"architecture_fact_ids":[]}
}
```

### Record snapshots

Call `record-snapshot` only after the Parent has written the authoritative file and, where applicable, its existing validator passed. Supply `run_id`, phase identifiers, artifact kind, version, output-relative path, MIME type, and source class. The command hashes the actual regular non-symlink file. The database receives metadata plus a redacted payload snapshot; the retained file remains authoritative.

### Flush and finalize

`flush-outbox` is legal only in remote mode with active consent. The trusted Parent passes `AI_SECURITY_DB_HOST`, `AI_SECURITY_DB_PORT`, `AI_SECURITY_DB_USER`, and `AI_SECURITY_DB_NAME`; it supplies the password only in `MYSQL_PWD`. Never put any of them in arguments or retained files. The Writer rejects a database name other than `ai_security`. A checkpoint advances only after a MySQL commit and must match the exact Outbox chain record before replay resumes.

`finalize-run` records run and telemetry statuses separately. `run_status=complete` may coexist with `telemetry_remote_status=pending_sync`; disclose that state in `REPORT.md`.

## Agent `_process` sidecar

The original core result remains authoritative. The optional top-level `_process` member contains only observable structured claims:

```json
{
  "schema_version":"1.4.0",
  "result_type":"recon|hunter_plan|hunter_result|critic|candidate_validation|final_review",
  "agent_id":"canonical-lowercase-id",
  "explicit_rationale":"short evidence-based rationale, not hidden reasoning",
  "evidence_refs":[],
  "observations":[]
}
```

The Parent first validates and processes the existing core result, then gives the complete result to `record-event`; the adapter separates and validates `_process`. In `best_effort`, a missing or malformed sidecar causes `process_missing`/`discarded` telemetry but cannot invalidate an otherwise valid core result. In `required`, retry within the budget or finish incomplete. A valid sidecar must never remain only inside an Agent payload: successful adapter output must include the corresponding normalized events and an `agent.task_completed` event.

Never request or retain hidden chain-of-thought. `explicit_rationale` means a concise, reviewable explanation tied to evidence, alternatives, controls, and observations.

## P0–P6 record points

| Phase | Required record points | Event families |
|---|---|---|
| P0 | run, scope, configuration, budget/isolation preflight | `run.*`, `phase.*` |
| P1 | Recon task start/end, facts, evidence, architecture, ledger, validator | `agent.*`, `recon.*`, `architecture.*`, `coverage.*`, `validator.*` |
| P2 | assignment, pre-validation hypothesis/score, attack plan, actual steps, candidate observations, Critic/reopen | `hunter.*`, `hypothesis.*`, `attack.*`, `candidate.*`, `critic.*`, `coverage.reopened` |
| P3 | immutable validation input, counterevidence/reproduction observations, decision | `validation.*` |
| P4 | finding revision and both validator executions | `finding.*`, `validator.*` |
| P5 | final review, replacement revision, fresh independent validation | `validation.*`, `finding.*` |
| P6 | report/core artifact snapshots, frozen research input boundary, final states | `artifact.*`, `research.input_frozen`, `run.finalized` |

Every current-state update and its event are one MySQL transaction. Events and versions are append-only. Do not overwrite a hypothesis version, coverage attempt, validation decision, or finding revision.

## Pre-validation hypothesis checkpoint

A Hunter assignment has two model checkpoints:

1. `hunter_plan`: source review only. Return hypotheses, evidence cutoff, score, and attack plan. Run no targeted local test.
2. After the Parent validates and records `hypothesis.created`/`attack.plan_created`, continue as `hunter_result` and return actual source/local observations plus the existing structured hunter result.

The version-1 priority calculation is observational and does not reorder the current deterministic coverage plan:

```text
(predicted_probability × potential_impact + coverage_value + information_gain)
÷ (1 + normalized_validation_cost)
```

All components and normalized cost are in `[0,1]`. Store `formula_name=hypothesis-research-baseline` and `formula_version=1.0`. Freeze the score before targeted validation and never backfill it from a later verdict.

The runtime recomputes this formula with a `1e-6` tolerance. It rejects a non-normalized cost, another formula identifier, or a mismatched `priority_score`. `attack.plan_created` must causally reference the recorded hypothesis event; `attack.step_observed` must causally reference the recorded plan event. Therefore the second checkpoint cannot be appended before the first.

The execution checkpoint distinguishes `source_only`, `local`, and `not_executed`, and uses `succeeded`, `failed`, `blocked`, or `skipped`. A planned step is never evidence that an attack ran.

## Delivery, redaction, and failure invariants

- The Outbox is `telemetry/outbox.jsonl`; checkpoint, dead-letter, and exclusive lock are in the same Parent-owned directory.
- Every record binds its canonical envelope byte length, envelope SHA-256, previous-record SHA-256, and record SHA-256, and is fsynced after complete append. An incomplete final line may be removed to the last verified boundary; an envelope/hash/length mismatch or middle corruption blocks replay.
- Delivery is at least once. The Outbox first deduplicates a retry by stable request hash; MySQL then deduplicates `(run_id,idempotency_hash)` plus `envelope_sha256`. A same-key/different-request conflict is rejected and a non-retryable remote conflict is dead-lettered. Remote inline sync always advances from the verified checkpoint in sequence; it never skips an older pending record.
- Payloads are redacted before Outbox append. Passwords, credentials, authorization state, complete environments, private keys, connection strings, absolute host paths, and hidden reasoning are forbidden.
- The per-payload limit is 5 MiB. Oversized data stores bounded metadata/summary, original length, and truncation state while preserving the small trusted `_telemetry` and `projections` control section. If that control section itself exceeds the limit, redaction blocks the payload rather than silently dropping database work.
- Redaction failure stores metadata only with `redaction_status=blocked`.
- Remote Writer SQL is restricted to the 36-table/event allowlist, prepared statements, inserts, compare-and-swap updates, and transaction control. No delete, DDL, privilege statement, dynamic table name, stored program, or other database is allowed. Connections use a bounded connect/operation timeout; preflight pins MySQL version, table/column hash, foreign-key count, check-constraint count and `utf8mb4_general_ci`/`utf8mb4` counts.
- MySQL/Writer/Outbox failures are telemetry facts, never target vulnerabilities.

## Completion checks

Before declaring the Skill implementation healthy, run:

```sh
node <skill-dir>/validate-findings.test.cjs
node <skill-dir>/validate-coverage-ledger.test.cjs
node --test <skill-dir>/scripts/telemetry/tests/telemetry.test.cjs
```

Also validate the Skill package and the external design/DB alignment contract. In remote acceptance, use only clearly synthetic run identities and verify the complete project → model → hypothesis → attack → validation → finding lineage.
