'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { FILES, DIRECTORIES, stageNative, inspectNativeArtifact, assertNativeReleaseReady } = require('../scripts/native-artifact.cjs');
const root = path.resolve(__dirname, '..');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warroom-native-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), value);
  };
  for (const name of FILES) write(name, name.endsWith('.html') ? '<html><head></head><body>Fixture</body></html>' : 'fixture');
  for (const name of DIRECTORIES) fs.mkdirSync(path.join(dir, name), { recursive: true });
  write('capacitor.config.json', JSON.stringify({ webDir: 'dist-native' }));
  write('dist-deploy/index.html', '<html><head><script src="js/app.js?v=1"></script></head><body>Compiled</body></html>');
  write('dist-deploy/js/app.js', 'window.compiled=true;');
  write('js/app.js', 'window.source=true;');
  write('dist-deploy/release.json', JSON.stringify({ revision: 'fixture-revision' }));
  return { dir, write };
}

test('staging copies compiled app and game assets without repository contents or restricted archive', t => {
  const { dir, write } = fixture(t);
  for (const name of ['.env', 'package.json', 'reports/private.json', 'supabase/config.json', 'data/time-league/player-cards.json', 'js/.env', 'js/tests/private.js']) write(name, 'DO_NOT_PACKAGE');
  write('data/duat/manifest.json', '{"source":"nflverse"}');
  const result = stageNative(dir);
  assert.ok(result.files > 10);
  const manifest = inspectNativeArtifact(dir);
  assert.equal(fs.readFileSync(path.join(result.output, 'js/app.js'), 'utf8'), 'window.compiled=true;');
  assert.ok(manifest.assets['data/duat/manifest.json']);
  assert.ok(Object.keys(manifest.assets).every(name => !fs.readFileSync(path.join(result.output, name), 'utf8').includes('DO_NOT_PACKAGE')));
  assert.equal(manifest.readyForNativeCopy, false);
  assert.throws(() => assertNativeReleaseReady(dir), /Vault requires a distribution-cleared/);
});

test('repository-root webDir and live-reload endpoints are rejected', t => {
  const { dir, write } = fixture(t);
  stageNative(dir);
  write('capacitor.config.json', JSON.stringify({ webDir: '.' }));
  assert.throws(() => inspectNativeArtifact(dir), /repository-root packaging is unsafe/);
  write('capacitor.config.json', JSON.stringify({ webDir: 'dist-native', server: { url: 'https://example.com' } }));
  assert.throws(() => inspectNativeArtifact(dir), /server.url/);
});

test('an injected restricted archive or secret fails inspection, even with the old override', t => {
  const { dir, write } = fixture(t);
  stageNative(dir);
  write('dist-native/data/time-league/player-cards.json', '{}');
  assert.throws(() => inspectNativeArtifact(dir), /restricted native asset/);
  const result = spawnSync(process.execPath, ['scripts/cap-sync-guard.cjs', '--include-time-league'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cap-sync-guard:/);
});

test('native output and source symlinks cannot copy secrets', t => {
  const { dir, write } = fixture(t);
  write('.env', 'secret');
  fs.symlinkSync(path.join(dir, '.env'), path.join(dir, 'js/leak.js'));
  assert.throws(() => stageNative(dir), /Symbolic link/);
  fs.unlinkSync(path.join(dir, 'js/leak.js'));
  fs.symlinkSync(path.join(dir, 'js'), path.join(dir, 'dist-native'));
  assert.throws(() => stageNative(dir), /symbolic link/);
  assert.ok(fs.existsSync(path.join(dir, 'js/app.js')));
});

test('changed or removed artifacts and new source files require a rebuild', t => {
  const { dir, write } = fixture(t);
  stageNative(dir);
  write('dist-native/js/app.js', 'modified');
  assert.throws(() => inspectNativeArtifact(dir), /asset missing or changed/);
  stageNative(dir);
  write('js/app.js', 'changed source');
  assert.throws(() => inspectNativeArtifact(dir), /source changed after staging/);
  stageNative(dir);
  write('js/new.js', 'new source');
  assert.throws(() => inspectNativeArtifact(dir), /source inventory changed/);
});

test('missing deferred modules and raw browser compilation fail staging', t => {
  const { dir, write } = fixture(t);
  write('dist-deploy/index.html', '<script type="text/wr-deferred" data-wr-defer="duat" src="js/missing.js"></script>');
  assert.throws(() => stageNative(dir), /Missing native dependency/);
  write('dist-deploy/index.html', '<script type="text/babel">const App=()=> <div/>;</script>');
  assert.throws(() => stageNative(dir), /Uncompiled browser Babel/);
});

test('release blocker cannot be bypassed by marking the generated manifest ready', t => {
  const { dir, write } = fixture(t);
  stageNative(dir);
  const manifest = inspectNativeArtifact(dir);
  manifest.readyForNativeCopy = true;
  manifest.blockers = [];
  write('dist-native/native-artifact.json', JSON.stringify(manifest));
  assert.throws(() => assertNativeReleaseReady(dir), /Vault requires a distribution-cleared/);
});

test('Capacitor direct copy and sync hooks invoke the guard', async () => {
  const pkg = require('../package.json');
  const { runPlatformHook } = require('@capacitor/cli/dist/common.js');
  for (const name of ['capacitor:copy:before', 'capacitor:sync:before']) {
    assert.equal(pkg.scripts[name], 'node scripts/cap-sync-guard.cjs');
    await assert.rejects(runPlatformHook({ app: { rootDir: root } }, 'android', root, name));
  }
});

if (process.env.NATIVE_ARTIFACT_CHECK === '1') {
  test('actual staged artifact passes full inventory and dependency inspection', () => {
    const artifact = inspectNativeArtifact(root);
    assert.ok(Object.keys(artifact.assets).length > 400);
    assert.ok(artifact.assets['draft-war-room/index.html']);
    assert.ok(artifact.assets['js/tabs/time-league.js']);
    assert.ok(artifact.assets['data/duat/manifest.json']);
    assert.equal(Object.keys(artifact.assets).filter(name => name.startsWith('data/time-league/')).length, 0);
    for (const name of Object.keys(artifact.assets).filter(name => name.endsWith('.js'))) {
      execFileSync(process.execPath, ['--check', path.join(root, 'dist-native', name)], { stdio: 'pipe' });
    }
  });
}
