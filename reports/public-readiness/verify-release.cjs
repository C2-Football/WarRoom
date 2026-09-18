'use strict';
// Read-only release proof: node reports/public-readiness/verify-release.cjs <full-sha>
// All writes are local evidence files. No account, telemetry or game mutation.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const revision = process.argv[2];
assert(/^[a-f0-9]{40}$/.test(revision || ''), 'Pass the exact intended full Git revision');
const entries = ['index.html', 'draft-warroom.html', 'free-agency.html', 'trade-calculator.html', 'draft-war-room/index.html'];
const publicPages = ['landing.html', 'login.html', 'onboarding.html', 'reset-password.html', 'ai-settings.html', 'upgrade.html', 'gift.html'];
const stamp = Date.now();
const proof = { expectedRevision: revision, startedAt: new Date().toISOString(), environments: [] };
const evidence = 'reports/public-readiness/evidence/release-' + revision.slice(0, 7) + '.json';
async function get(url) {
  const u = new URL(url); u.searchParams.set('readiness', stamp);
  const r = await fetch(u, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  assert.equal(r.status, 200, u.pathname + ' must be HTTP 200');
  return Buffer.from(await r.arrayBuffer());
}
async function verify(repo) {
  const base = 'https://c2-football.github.io/' + repo + '/';
  const record = { repo, base, checks: [], assets: [] };
  proof.environments.push(record);
  const release = JSON.parse((await get(base + 'release.json')).toString());
  assert.equal(release.revision, revision);
  assert.equal(release.environment, 'C2-Football/' + repo);
  record.release = { revision: release.revision, builtAt: release.builtAt, environment: release.environment };
  record.checks.push('Exact deployed revision and repository');
  const expected = new Map(Object.entries(release.assets || {}).map(([p, h]) => [new URL(p, base).href, h]));
  assert(expected.size > 0, 'Release manifest must contain asset hashes');
  for (const entry of entries) {
    const html = (await get(base + entry)).toString();
    assert(!/<script\b[^>]*\btype=["']text\/babel["']/i.test(html), entry + ' contains runtime Babel');
    assert(!/@babel\/standalone/i.test(html), entry + ' loads runtime Babel');
    let scripts = 0;
    for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
      const u = new URL(m[1].replace(/&amp;/g, '&'), base + entry);
      if (!u.href.startsWith(base)) continue;
      const hash = u.searchParams.get('v');
      assert(/^[a-f0-9]{10}$/.test(hash || ''), entry + ': unversioned local script ' + u.pathname);
      u.search = '';
      if (expected.has(u.href)) assert.equal(expected.get(u.href), hash, 'Conflicting manifest/entry hash');
      expected.set(u.href, hash); scripts++;
    }
    assert(scripts > 0, entry + ' must contain application scripts');
    record.checks.push(entry + ': compiled and content-hashed local scripts');
  }
  const queue = [...expected];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const [url, expectedHash] = queue.shift();
      const bytes = await get(url);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 10);
      assert.equal(hash, expectedHash, url + ' content must match deployed manifest or HTML');
      record.assets.push({ path: url.slice(base.length), bytes: bytes.length, hash });
    }
  }));
  record.assets.sort((a, b) => a.path.localeCompare(b.path));
  for (const page of publicPages) {
    const bytes = await get(base + page);
    assert(bytes.length > 100, page + ' must have usable page content');
    record.checks.push(page + ': HTTP 200');
  }
  record.status = 'passed';
  console.log('PASS ' + repo + ': revision ' + revision.slice(0, 7) + ', ' + record.assets.length + ' served asset hashes, ' + (entries.length + publicPages.length) + ' entries');
}
(async () => {
  for (const repo of ['WarRoom', 'WarRoom-sandbox']) await verify(repo);
  proof.status = 'passed';
})().catch(error => {
  proof.status = 'failed'; proof.error = error.message;
  console.error(error.message); process.exitCode = 1;
}).finally(() => {
  proof.completedAt = new Date().toISOString();
  fs.writeFileSync(evidence, JSON.stringify(proof, null, 2) + '\n');
});
