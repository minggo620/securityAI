'use strict';

const crypto = require('node:crypto');
const { canonicalJson } = require('./canonical-json.cjs');

const DENY_KEYS = /(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|private[_-]?key|credential|connection[_-]?string|chain[_-]?of[_-]?thought|hidden[_-]?reasoning|private[_-]?reasoning|environment|env_vars)/i;
const CREDENTIAL_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:authorization|cookie)\s*:\s*[^\s,;]+/i,
  /\b(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[=:]\s*[^\s,;]+/i,
  /\b(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s]+/i,
  /\bAKIA[0-9A-Z]{16}\b/
];

function redactString(value) {
  let output = value;
  for (const pattern of CREDENTIAL_PATTERNS) output = output.replace(new RegExp(pattern.source, `${pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`}`), '[REDACTED]');
  output = output.replace(/(?:^|[\s"'(])\/(?:Users|home|var|private|opt|etc)\/[A-Za-z0-9._/ -]+/g, (match) => `${match[0] === '/' ? '' : match[0]}[ABSOLUTE_PATH_REDACTED]`);
  return output;
}

function walk(value, state, depth = 0) {
  if (depth > 64) throw new Error('payload exceeds redaction depth');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const redacted = redactString(value);
    if (redacted !== value) state.changed = true;
    return redacted;
  }
  if (Array.isArray(value)) return value.map((entry) => walk(entry, state, depth + 1));
  if (!value || typeof value !== 'object') throw new Error('unsupported payload value');
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (DENY_KEYS.test(key)) {
      output[key] = '[REDACTED]';
      state.changed = true;
    } else {
      output[key] = walk(entry, state, depth + 1);
    }
  }
  return output;
}

function redactPayload(payload, options = {}) {
  const maxBytes = options.maxBytes || 5242880;
  let originalBytes = null;
  try {
    originalBytes = Buffer.byteLength(canonicalJson(payload));
  } catch {
    return { redaction_status: 'blocked', content: null, content_sha256: null, original_bytes: null, stored_bytes: 0, is_truncated: false, error_code: 'REDACTION_BLOCKED' };
  }
  const state = { changed: false };
  let redacted;
  try {
    redacted = walk(payload, state);
  } catch (error) {
    return { redaction_status: 'blocked', content: null, content_sha256: null, original_bytes: originalBytes, stored_bytes: 0, is_truncated: false, error_code: 'REDACTION_BLOCKED' };
  }
  const text = canonicalJson(redacted);
  const stored = Buffer.byteLength(text);
  if (stored > maxBytes) {
    const summary = { truncated: true, original_bytes: originalBytes, redacted_bytes: stored, top_level_keys: Object.keys(redacted).slice(0, 128) };
    const summaryText = canonicalJson(summary);
    return {
      redaction_status: state.changed ? 'redacted' : 'passed',
      content: summary,
      content_sha256: crypto.createHash('sha256').update(summaryText).digest('hex'),
      original_bytes: originalBytes,
      stored_bytes: Buffer.byteLength(summaryText),
      is_truncated: true,
      error_code: null
    };
  }
  return {
    redaction_status: state.changed ? 'redacted' : 'passed',
    content: redacted,
    content_sha256: crypto.createHash('sha256').update(text).digest('hex'),
    original_bytes: originalBytes,
    stored_bytes: stored,
    is_truncated: false,
    error_code: null
  };
}

module.exports = { redactPayload };
