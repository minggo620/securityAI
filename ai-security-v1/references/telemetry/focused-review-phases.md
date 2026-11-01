# Focused-review phase events

Use this example after initialization and preflight events have both committed. It supplies the phase-table operations required by `projection-map.json`; a descriptive payload alone is insufficient.

The code below constructs inputs only. It does not prepare or commit transactions. Use the strict `prepare` → user-visible notice → `commit-next` workflow for each event separately, and do not prepare completion until the review and its interaction checkpoint have committed.

```javascript
// runId: current run_id returned by initialization.
// ulid: exported by scripts/telemetry/ulid.cjs in this skill.
const phaseId = ulid(); // New phase identity; keep it for completion.
const mysqlDate = () => new Date().toISOString().replace('T', ' ').replace('Z', '');

const startInput = {
  kind: 'event',
  event: {
    run_id: runId,
    phase_code: 'P1',
    event_type: 'phase.started',
    actor_type: 'parent',
    source_class: 'P',
    payload_type: 'phase.started',
    idempotency_key: `run/${runId}/phase/${phaseId}/start`,
    payload: {
      _telemetry: { phase_execution_id: phaseId },
      projections: [{
        table: 'audit_phase_execution',
        action: 'insert',
        values: {
          phase_execution_id: phaseId,
          run_id: runId,
          phase_code: 'P1',
          attempt_no: 1,
          status: 'running',
          input_payload_id: '$payload_id',
          output_payload_id: null,
          failure_reason: null,
          started_at: mysqlDate(),
          ended_at: null,
          schema_version: '1.5.0',
          source_class: 'P'
        }
      }]
    },
    source_refs: []
  }
};

// Call only after the phase's actual work and checkpoint have completed.
function completedInput() {
  return {
    kind: 'event',
    event: {
      run_id: runId,
      phase_code: 'P1',
      event_type: 'phase.completed',
      actor_type: 'parent',
      source_class: 'P',
      payload_type: 'phase.completed',
      idempotency_key: `run/${runId}/phase/${phaseId}/completed`,
      payload: {
        _telemetry: { phase_execution_id: phaseId },
        projections: [{
          table: 'audit_phase_execution',
          action: 'update',
          values: {
            status: 'completed',
            output_payload_id: '$payload_id',
            ended_at: mysqlDate()
          },
          where: { phase_execution_id: phaseId, run_id: runId }
        }]
      },
      source_refs: []
    }
  };
}
```

`$payload_id` is a literal reference resolved by the coordinator, not a shell variable. Preserve it by passing JSON through a structured process input or a quoted heredoc. Do not reuse example IDs, mark unfinished work completed, or bypass the phase-table requirement to make a prepare call pass.

## Diagnosing a rejected prepare

First distinguish local preparation from remote commit. A `PROJECTION_FAILED` during `prepare` does not establish a database connection failure. Compare the submitted operations with the event's required tables and allowed fields. The stable public reason intentionally omits internal diagnostics; do not expose credentials or raw database stderr. Preserve the existing stop and recovery rules in `TELEMETRY.md`.
