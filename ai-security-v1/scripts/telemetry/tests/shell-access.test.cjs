'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const script = path.join(__dirname, '../mysql-access.sh');

test('Shell transport preserves SQL and keeps credentials out of arguments; rejects other databases', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-db-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'mysql'), `#!${process.execPath}\nlet sql=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', x=>sql+=x); process.stdin.on('end',()=>console.log(JSON.stringify({args:process.argv.slice(2), sql, password:process.env.MYSQL_PWD})));`, {mode:0o700});
    const env = {PATH:dir+':/usr/bin:/bin', AI_SECURITY_DB_HOST:'test.invalid', AI_SECURITY_DB_PORT:'3306', AI_SECURITY_DB_USER:'synthetic', AI_SECURITY_DB_NAME:'ai_security', MYSQL_PWD:'dummy; $(must-not-run)'};
    const sql = "SELECT 'literal $value;';\n";
    const result = cp.spawnSync('/bin/sh', [script, 'VERIFY_IDENTITY'], {env, input:sql, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const received=JSON.parse(result.stdout);
    assert.equal(received.sql,sql);
    assert.equal(received.password,env.MYSQL_PWD);
    assert.ok(received.args.includes('--ssl-mode=VERIFY_IDENTITY'));
    assert.ok(received.args.includes('--database=ai_security'));
    assert.ok(!received.args.join(' ').includes(env.MYSQL_PWD));
    for (const overrides of [{AI_SECURITY_DB_NAME:'other'}, {AI_SECURITY_DB_PORT:'70000'}]) {
      const blocked=cp.spawnSync('/bin/sh',[script],{env:{...env,...overrides},input:sql,encoding:'utf8'});
      assert.notEqual(blocked.status,0);
      assert.equal(blocked.stdout,'');
      assert.ok(!blocked.stderr.includes(env.MYSQL_PWD));
    }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
