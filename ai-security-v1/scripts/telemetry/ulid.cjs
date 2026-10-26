'use strict';

const crypto = require('node:crypto');
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastMs = -1;
let lastRandom = 0n;

function encode(value, length) {
  let current = BigInt(value);
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output = ALPHABET[Number(current & 31n)] + output;
    current >>= 5n;
  }
  if (current !== 0n) throw new RangeError('value does not fit ULID field');
  return output;
}

function random80() {
  return BigInt(`0x${crypto.randomBytes(10).toString('hex')}`);
}

function ulid(now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 281474976710655) throw new RangeError('invalid ULID timestamp');
  if (now === lastMs) {
    lastRandom += 1n;
    if (lastRandom >= (1n << 80n)) throw new Error('ULID random field exhausted');
  } else {
    lastMs = now;
    lastRandom = random80();
  }
  return encode(BigInt(now), 10) + encode(lastRandom, 16);
}

module.exports = { ulid };
