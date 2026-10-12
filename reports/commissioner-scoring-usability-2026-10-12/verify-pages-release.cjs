#!/usr/bin/env node
'use strict';
// Read-only release proof. Run after both Pages deployments finish:
// node reports/commissioner-scoring-usability-2026-10-12/verify-pages-release.cjs FULL_SHA
// Build dist-deploy from the final source first; its script bindings are the
// local expectation. Outputs served-assets.json and served-assets.log here.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const EXPECTED_SHA = process.argv[2] || process.env.EXPECTED_SHA;
const ENTRIES = ['index.html', 'draft-warroom.html', 'free-agency.html', 'trade-calculator.html', 'draft-war-room/index.html'];
const PUBLIC_PAGES = ['landing.html', 'login.html', 'onboarding.html', 'reset-password.html', 'ai-settings.html', 'upgrade.html', 'gift.html'];
const COMMISSIONER = ['js/shared/commish-rulelab.js', 'js/components/commish-rulelab-panel.js', 'js/tabs/commissioner-office.js'];
const SITES = ['WarRoom', 'WarRoom-sandbox'].map(repo => ({ repo, base: 'https://c2-football.github.io/' + repo + '/' }));
const nonce = Date.now().toString(36);
const logLines = [];
const report = { expectedRevision: EXPECTED_SHA, startedAt: new Date().toISOString(), environments: [] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
function log(message) { logLines.push(message); console.log(message); }
function scripts(html, entry) {
    assert(!/<script\b[^>]*\btype=["']text\/babel["']/i.test(html), entry + ': browser Babel remains');
    assert(!/<script\b[^>]*\bsrc=["'][^"']*babel(?:\.min)?\.js/i.test(html), entry + ': Babel runtime remains');
    const bindings = {};
    for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
        const src = match[1].replace(/&amp;/g, '&');
        if (/^(https?:)?\/\//i.test(src)) continue;
        const url = new URL(src, 'https://compile.local/' + entry);
        const name = decodeURIComponent(url.pathname.slice(1));
        const version = url.searchParams.get('v');
        assert(/^[a-f0-9]{10}$/.test(version || ''), entry + ': local script lacks a compiled content hash: ' + src);
        assert(!bindings[name] || bindings[name] === version, entry + ': conflicting script versions for ' + name);
        bindings[name] = version;
    }
    assert(Object.keys(bindings).length, entry + ': no compiled local scripts');
    return sorted(bindings);
}
async function get(base, relative) {
    const url = new URL(relative, base); url.searchParams.set('__release_proof', nonce);
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, url.pathname + ': HTTP ' + response.status);
    return Buffer.from(await response.arrayBuffer());
}
async function limited(items, fn) {
    let cursor = 0, failure;
    await Promise.all(Array.from({ length: Math.min(8, items.length) }, async () => {
        while (cursor < items.length && !failure) {
            const item = items[cursor++];
            try { await fn(item); } catch (error) { failure ||= error; }
        }
    }));
    if (failure) throw failure;
}
async function verify(site, local) {
    const result = { ...site, status: 'running', checks: [], assets: [] };
    report.environments.push(result);
    try {
        const release = JSON.parse((await get(site.base, 'release.json')).toString('utf8'));
        assert.equal(release.revision, EXPECTED_SHA, site.repo + ': served revision is not the requested release');
        assert.equal(release.environment, 'C2-Football/' + site.repo, site.repo + ': repository identity differs');
        assert(release.assets && typeof release.assets === 'object' && !Array.isArray(release.assets), 'release.assets missing');
        assert.deepEqual(sorted(release.assets), sorted(local.releaseAssets), site.repo + ': advertised assets differ from the final local build');
        result.release = { revision: release.revision, builtAt: release.builtAt, environment: release.environment };
        result.checks.push('Exact deployed revision, repository, and final local release asset bindings');
        log(site.repo + ': exact revision ' + release.revision);
        const advertised = new Map(Object.entries(release.assets));
        result.entries = [];
        await Promise.all(ENTRIES.map(async entry => {
            const html = (await get(site.base, entry)).toString('utf8');
            const bindings = scripts(html, entry);
            assert.deepEqual(bindings, local.entries[entry], site.repo + '/' + entry + ': compiled script bindings differ from the final local build');
            for (const [name, version] of Object.entries(bindings)) {
                assert(!advertised.has(name) || advertised.get(name) === version, entry + ': conflicting asset hash for ' + name);
                advertised.set(name, version);
            }
            if (entry === 'index.html') {
                for (const name of COMMISSIONER) assert(bindings[name], 'Commissioner module missing: ' + name);
                assert.equal(html.match(/<link\b[^>]*\bhref=["'](suite-management\.css(?:\?[^"']*)?)["']/i)?.[1], local.stylesheetHref, 'Commissioner stylesheet cache binding differs from final build');
            }
            result.entries.push({ path: entry, scriptCount: Object.keys(bindings).length, bindings });
            result.checks.push(entry + ': compiled script bindings match the final local build');
        }));
        await Promise.all(PUBLIC_PAGES.map(async entry => {
            await get(site.base, entry); result.checks.push(entry + ': HTTP 200');
        }));
        await limited([...advertised.entries()], async ([name, expected]) => {
            assert(/^[a-f0-9]{10}$/.test(expected), 'Invalid advertised hash for ' + name);
            assert(!name.startsWith('/') && !name.split('/').includes('..'), 'Unsafe asset path: ' + name);
            const bytes = await get(site.base, name + '?v=' + expected);
            const actual = hash(bytes).slice(0, 10);
            assert.equal(actual, expected, site.repo + '/' + name + ': served bytes do not match their content hash');
            result.assets.push({ path: name, bytes: bytes.length, hash: actual });
        });
        const css = await get(site.base, local.stylesheetHref);
        assert.equal(hash(css), local.cssHash, site.repo + ': Commissioner stylesheet bytes differ from final source');
        result.stylesheet = { path: 'suite-management.css', bytes: css.length, sha256: hash(css), localMatch: true };
        result.commissioner = Object.fromEntries(COMMISSIONER.map(name => [name, advertised.get(name)]));
        result.assets.sort((a, b) => a.path.localeCompare(b.path));
        result.entries.sort((a, b) => a.path.localeCompare(b.path));
        result.status = 'passed';
        log(site.repo + ': PASS ' + result.assets.length + ' content hashes, 12 pages, 3 Commissioner modules, final stylesheet bytes');
    } catch (error) {
        result.status = 'failed'; result.error = error.message; log(site.repo + ': FAIL ' + error.message);
    }
}
async function main() {
    assert(/^[a-f0-9]{40}$/i.test(EXPECTED_SHA || ''), 'Usage: node verify-pages-release.cjs FULL_40_CHARACTER_SHA');
    const build = path.join(ROOT, 'dist-deploy');
    const local = { entries: {}, cssHash: hash(fs.readFileSync(path.join(ROOT, 'suite-management.css'))),
        stylesheetHref: fs.readFileSync(path.join(build, 'index.html'), 'utf8').match(/<link\b[^>]*\bhref=["'](suite-management\.css(?:\?[^"']*)?)["']/i)?.[1],
        releaseAssets: JSON.parse(fs.readFileSync(path.join(build, 'release.json'), 'utf8')).assets };
    for (const entry of ENTRIES) {
        const bindings = scripts(fs.readFileSync(path.join(build, entry), 'utf8'), entry);
        for (const [name, version] of Object.entries(bindings)) {
            assert.equal(hash(fs.readFileSync(path.join(build, name))).slice(0, 10), version, 'Local compiled asset binding is stale: ' + name);
        }
        local.entries[entry] = bindings;
    }
    report.localExpectation = { compiledFrom: 'dist-deploy', stylesheetSha256: local.cssHash };
    await Promise.all(SITES.map(site => verify(site, local)));
    report.status = report.environments.every(site => site.status === 'passed') ? 'passed' : 'failed';
}
main().catch(error => { report.status = 'failed'; report.error = error.message; log('FAIL ' + error.message); }).finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(__dirname, 'served-assets.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(__dirname, 'served-assets.log'), logLines.join('\n') + '\n');
    if (report.status !== 'passed') process.exitCode = 1;
});
