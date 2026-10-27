#!/usr/bin/env node
'use strict';

// Stable Parent-facing entrypoint. It delegates to the audited telemetry CLI so
// a full audit cannot accidentally use a local-only default at the call site.
const cp = require('node:child_process');
const path = require('node:path');

const command = process.argv[2];
const allowed = new Set(['init', 'event', 'snapshot', 'flush', 'finalize']);
if (!allowed.has(command)) {
  process.stderr.write('usage: audit-session.cjs init|event|snapshot|flush|finalize [cli options]\n');
  process.exitCode = 2;
} else {
  const mapped = { init: 'init-run', event: 'record-event', snapshot: 'record-snapshot', flush: 'flush-outbox', finalize: 'finalize-run' }[command];
  const cli = path.join(__dirname, 'cli.cjs');
  const result = cp.spawnSync(process.execPath, [cli, mapped, ...process.argv.slice(3)], {
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status === null ? 1 : result.status;
  }
}
