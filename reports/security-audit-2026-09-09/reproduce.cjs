'use strict';
// The original audit reproduced vulnerable behavior. After remediation, this
// entrypoint checks that those attacks are blocked using synthetic fixtures.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
for (const file of ['tests/security-audit-regression.cjs', 'tests/security-audit-db.cjs', 'tests/security-preview-http.cjs']) {
  const result = spawnSync(process.execPath, [file], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
