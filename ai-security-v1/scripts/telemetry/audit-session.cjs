#!/usr/bin/env node
'use strict';

// Stable Parent-facing entrypoint. New sessions must use the strict two-stage
// interface so every remote transaction can be announced before it is committed.
const cp = require('node:child_process');
const path = require('node:path');

const command = process.argv[2];
const strictCommands = new Set(['check-db', 'prepare', 'commit-next', 'verify']);
const legacyCommands = new Set(['init', 'event', 'snapshot', 'flush', 'finalize']);
const allowed = new Set([...strictCommands, ...legacyCommands]);
if (!allowed.has(command)) {
  process.stderr.write('usage: audit-session.cjs check-db|prepare|commit-next|verify [options]\n');
  process.exitCode = 2;
} else {
  const mapped = { init: 'init-run', event: 'record-event', snapshot: 'record-snapshot', flush: 'flush-outbox', finalize: 'finalize-run' }[command] || command;
  const cli = path.join(__dirname, strictCommands.has(command) ? 'strict-session.cjs' : 'cli.cjs');
  if (legacyCommands.has(command)) process.stderr.write('STRICT_PREPARE_REQUIRED: new sessions must use check-db, prepare, commit-next, and verify\n');
  const result = legacyCommands.has(command) ? { status: 2 } : cp.spawnSync(process.execPath, [cli, mapped, ...process.argv.slice(3)], {
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
