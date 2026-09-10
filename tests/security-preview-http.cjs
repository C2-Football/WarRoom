'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
(async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-security-'));
  const root = path.join(fixture, 'public'); fs.mkdirSync(root);
  const outside = path.join(fixture, 'private.js'); fs.writeFileSync(outside, 'synthetic-private');
  for (const dir of ['.git', 'supabase', 'reports', 'scripts', 'tests', 'js', 'content']) fs.mkdirSync(path.join(root, dir));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><p>Safe preview</p>');
  fs.writeFileSync(path.join(root, 'js/app.js'), 'window.safe = true;');
  fs.writeFileSync(path.join(root, '.env.local'), 'SYNTHETIC_SECRET=not-a-real-secret');
  fs.writeFileSync(path.join(root, '.git/config'), 'synthetic-git');
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  for (const dir of ['supabase', 'reports', 'scripts', 'tests']) fs.writeFileSync(path.join(root, dir, 'private.js'), 'synthetic-private');
  fs.symlinkSync(outside, path.join(root, 'js/outside.js'));
  fs.symlinkSync(path.join(root, '.env.local'), path.join(root, 'js/env.js'));
  fs.symlinkSync(path.join(root, 'js/app.js'), path.join(root, 'js/alias.js'));
  const child = spawn(process.execPath, [path.resolve('scripts/serve-static.cjs'), '--port=0', '--root=' + root], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Preview did not start')), 10000);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timer); reject(Error('Preview exited: ' + code)); });
      child.stdout.on('data', data => {
        const match = data.toString().match(/http:\/\/127\.0\.0\.1:(\d+)\//);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    const request = (url, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: url, method, headers }, res => {
        let body = ''; res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject); req.end();
    });
    assert.equal((await request('/')).status, 200);
    assert.equal((await request('/js/app.js')).body, 'window.safe = true;');
    assert.equal((await request('/js/alias.js')).status, 200);
    for (const url of ['/.env.local', '/%2eenv.local', '/.git/config', '/package-lock.json', '/supabase/private.js', '/reports/private.js', '/scripts/private.js', '/tests/private.js', '/js/outside.js', '/js/env.js', '/../private.js', '/%2e%2e/private.js']) {
      const res = await request(url); assert.equal(res.status, 404, url); assert(!res.body.includes('synthetic-private'), url);
    }
    assert.equal((await request('/.env.local', {}, 'HEAD')).status, 404);
    assert.equal((await request('/', { Host: 'rebind.attacker.invalid:' + port })).status, 403);
    assert.equal((await request('/api/landing-content', { Origin: 'https://attacker.invalid' }, 'PUT')).status, 403);
    assert.equal((await request('/api/dev-ai-analyze', { 'Sec-Fetch-Site': 'cross-site' }, 'POST')).status, 403);
    assert.equal((await request('/', { Origin: 'http://127.0.0.1:' + port })).status, 200);
    console.log('PASS real preview HTTP: public assets work; environment/Git/internal files, escaping symlinks, hostile Host and Origin are blocked');
  } finally {
    child.kill();
    if (child.exitCode === null) await once(child, 'exit');
    fs.rmSync(fixture, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
