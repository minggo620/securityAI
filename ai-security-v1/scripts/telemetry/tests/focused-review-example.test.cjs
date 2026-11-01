'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { ulid } = require('../ulid.cjs');
const { buildEvent } = require('../event-builder.cjs');
const { operationsFor } = require('../projection.cjs');

function example() {
  const document = fs.readFileSync(path.join(__dirname, '../../../references/telemetry/focused-review-phases.md'), 'utf8');
  const source = document.match(/```javascript\n([\s\S]*?)\n```/)[1];
  const runId = ulid();
  const inputs = vm.runInNewContext(`${source}\n({startInput, endInput: completedInput()})`, { ulid, runId }, { timeout: 1000 });
  return JSON.parse(JSON.stringify(inputs));
}

test('documented phase events bind start and completion to the same phase and payloads', () => {
  const { startInput, endInput } = example();
  const start = buildEvent(startInput.event, { payload_max_bytes: 1048576 }).event;
  const end = buildEvent(endInput.event, { payload_max_bytes: 1048576 }).event;
  const inserted = operationsFor(start).operations[0];
  const updated = operationsFor(end).operations[0];
  assert.equal(inserted.table, 'audit_phase_execution');
  assert.equal(inserted.action, 'insert');
  assert.equal(inserted.values.status, 'running');
  assert.equal(inserted.values.input_payload_id, start.payload.content._telemetry.payload_id);
  assert.equal(updated.action, 'update');
  assert.equal(updated.where.phase_execution_id, inserted.values.phase_execution_id);
  assert.equal(updated.where.run_id, inserted.values.run_id);
  assert.equal(updated.values.status, 'completed');
  assert.equal(updated.values.output_payload_id, end.payload.content._telemetry.payload_id);
});

test('summary-only phase events reproduce the missing-projection rejection', () => {
  const { startInput, endInput } = example();
  for (const input of [startInput, endInput]) {
    delete input.event.payload.projections;
    const built = buildEvent(input.event, { payload_max_bytes: 1048576 });
    assert.throws(() => operationsFor(built.event), /PROJECTION_FAILED: .*missing required projection\(s\): audit_phase_execution/);
  }
});
