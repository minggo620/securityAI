'use strict';

function normalize(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON rejects non-finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry) => normalize(entry, seen));
  if (typeof value !== 'object') throw new TypeError(`canonical JSON rejects ${typeof value}`);
  if (seen.has(value)) throw new TypeError('canonical JSON rejects cycles');
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry === undefined) throw new TypeError(`canonical JSON rejects undefined at ${key}`);
    output[key] = normalize(entry, seen);
  }
  seen.delete(value);
  return output;
}

function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

module.exports = { canonicalJson, normalize };
