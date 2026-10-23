'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/shared/dashboard-builder.js'), 'utf8');
const clean = value => JSON.parse(JSON.stringify(value));
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
async function checkAsync(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
function setup() {
    const data = new Map();
    const root = {
        localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) },
        atob: value => Buffer.from(value, 'base64').toString('binary'),
        WR: { AIContext: { decisionContext: league => ({ leagueId: league.league_id, leagueType: 'dynasty', season: 2026, canTrade: true }) } },
    };
    vm.runInNewContext(source, { window: root, console });
    return { root, data, api: root.WR.DashboardBuilder };
}
const modules = {
    'weekly-matchups': { label: 'Weekly Matchups', description: 'Current matchup', sizes: ['sm', 'md', 'lg'], metrics: [], pro: false },
    'roster-pulse': { label: 'Roster Pulse', sizes: ['sm', 'md'], metrics: [{ key: 'health-score', label: 'Health Score' }, { key: 'elite-count', label: 'Elite Players' }] },
    'trade-block': { label: 'Trade Block', sizes: ['sm', 'md'], metrics: [] },
    'market-radar': { label: 'Market Radar', sizes: ['md'], metrics: [], pro: true },
};
const league = { league_id: '1234567890123456789', season: '2026' };
const original = [{ id: 'dw_matchup', key: 'weekly-matchups', size: 'md' }, { id: 'dw_roster', key: 'roster-pulse', size: 'sm', primaryMetric: 'health-score' }];
const changed = [{ id: 'dw_roster', key: 'roster-pulse', size: 'md', primaryMetric: 'elite-count' }, { id: 'dw_matchup', key: 'weekly-matchups', size: 'sm' }];
const scope = 'owner:1234567890123456789';
const token = claims => 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';

async function main() {
    const { root, data, api } = setup();
    const catalog = api.catalog(modules);
    check('catalog exposes only serializable supported options', () => {
        assert.equal(catalog.length, 4);
        assert.deepEqual(Object.keys(catalog[0]), ['key', 'label', 'description', 'sizes', 'metrics']);
        assert.deepEqual(clean(api.catalog(modules, { canTrade: false })).map(x => x.key), ['weekly-matchups', 'roster-pulse']);
        assert.equal(api.catalog(modules, { isPro: false }).some(x => x.key === 'market-radar'), false);
    });
    check('validated layout preserves order and supports explicit empty Home', () => {
        assert.deepEqual(clean(api.validateLayout(original, catalog)), original);
        assert.deepEqual(clean(api.validateLayout([], catalog)), []);
        const nullable = [{ ...original[0], primaryMetric: null }];
        assert.deepEqual(clean(api.validateLayout(nullable, catalog)), [original[0]]);
    });
    check('reject unknown code, modules, detail levels, metrics and duplicate IDs', () => {
        for (const layout of [
            [{ ...original[0], html: '<img onerror=alert(1)>' }],
            [{ ...original[0], key: 'constructor' }],
            [{ ...original[0], size: 'xxl' }],
            [{ ...original[0], primaryMetric: 'salary' }],
            [{ ...original[0], id: '<script>' }],
            [original[0], original[0]],
            Array.from({ length: 25 }, (_, i) => ({ ...original[0], id: 'id_' + i })),
            JSON.parse('[{"id":"x","key":"weekly-matchups","size":"sm","__proto__":{"polluted":true}}]'),
        ]) assert.throws(() => api.validateLayout(layout, catalog));
        assert.equal({}.polluted, undefined);
    });
    check('account and league namespaces retain long IDs and zero', () => {
        assert.equal(api.scopeFor(league.league_id, 'owner'), scope);
        assert.equal(api.scopeFor('0', 'owner'), 'owner:0');
        assert.equal(api.scopeFor(0, 'owner'), 'owner:0');
        assert.equal(api.scopeFor(null, 'owner'), '');
        assert.equal(api.scopeFor(league.league_id, null), '');
        assert.notEqual(api.scopeFor('a:b', 'c'), api.scopeFor('b', 'c:a'));
        root.OD = { getSessionToken: () => token({ sub: 'account-one', exp: Date.now() / 1000 + 60 }) };
        assert.equal(api.scopeFor(league.league_id, 'ignored'), 'account-one:' + league.league_id);
        root.OD.getSessionToken = () => token({ sub: 'account-two', exp: Date.now() / 1000 + 60 });
        assert.equal(api.scopeFor(league.league_id, 'ignored'), 'account-two:' + league.league_id);
        root.OD.getSessionToken = () => token({ sub: 'expired', exp: 1 });
        assert.equal(api.scopeFor(league.league_id, 'owner'), scope);
        delete root.OD;
    });
    check('first save retains prior layout for undo across reload and isolates leagues/accounts', () => {
        assert.equal(api.readSaved(scope), null);
        const saved = api.save(scope, changed, catalog, original);
        assert.deepEqual(clean(saved), { version: 1, layout: changed, history: [original] });
        assert.deepEqual(clean(api.readSaved(scope)), clean(saved));
        assert.equal(api.readSaved('other:' + league.league_id), null);
        assert.equal(api.readSaved('owner:another-league'), null);
        assert.deepEqual(clean(api.undoSaved(scope, catalog)), original);
        assert.equal(api.undoSaved(scope, catalog), null);
        assert.deepEqual(clean(api.readSaved(scope).layout), original);
        assert.deepEqual(Object.keys(JSON.parse(data.get('wr_alex_dashboard_v1:' + scope))), ['version', 'layout', 'history']);
    });
    check('no-op saves do not consume undo and history stays bounded', () => {
        api.save(scope, original, catalog, original);
        assert.equal(api.readSaved(scope).history.length, 0);
        for (let i = 0; i < 14; i++) api.save(scope, i % 2 ? original : changed, catalog);
        assert.equal(api.readSaved(scope).history.length, 10);
    });
    check('stale tab save and undo cannot overwrite another tab\'s dashboard', () => {
        const tabScope = 'owner:two-tabs';
        api.save(tabScope, original, catalog, original);
        const tabA = clean(api.readSaved(tabScope).layout);
        const tabB = clean(api.readSaved(tabScope).layout);
        api.save(tabScope, changed, catalog, tabB);
        const current = clean(api.readSaved(tabScope));
        assert.throws(() => api.save(tabScope, [], catalog, tabA), /changed in another tab/);
        assert.throws(() => api.undoSaved(tabScope, catalog, tabA), /changed in another tab/);
        assert.deepEqual(clean(api.readSaved(tabScope)), current);
        assert.deepEqual(clean(api.undoSaved(tabScope, catalog, changed)), original);
    });
    check('corrupted storage cannot become executable layout', () => {
        const key = 'wr_alex_dashboard_v1:corrupt';
        data.set(key, '{unfinished');
        assert.equal(api.readSaved('corrupt'), null);
        data.set(key, JSON.stringify({ version: 1, layout: [{ ...original[0], onClick: 'run()' }], history: [] }));
        assert.equal(api.readSaved('corrupt'), null);
    });
    check('storage errors and lost writes do not report successful saves', () => {
        const setItem = root.localStorage.setItem;
        const before = clean(api.readSaved(scope));
        root.localStorage.setItem = () => { throw new Error('quota'); };
        assert.throws(() => api.save(scope, changed, catalog, original), /could not be saved/);
        assert.deepEqual(clean(api.readSaved(scope)), before);
        assert.throws(() => api.undoSaved(scope, catalog), /could not be saved/);
        root.localStorage.setItem = () => {};
        assert.throws(() => api.save('never-written', changed, catalog, original), /could not be saved/);
        root.localStorage.setItem = setItem;
        assert.throws(() => api.save('', changed, catalog, original), /Choose an account/);
    });

    let captured;
    const response = layout => ({ analysis: JSON.stringify({ version: 1, reply: 'Moved roster first.', layout }) });
    root.OD = { callAI: async args => { captured = args; return response(changed); } };
    const options = { prompt: 'Move my roster first and show elite players', layout: original, catalog, league, focusId: 'dw_roster', messages: [{ role: 'user', content: 'Build my weekly dashboard' }, { role: 'assistant', content: 'Here is the preview.' }] };
    await checkAsync('real adapter contract carries current layout, selected section and conversation', async () => {
        const result = await api.request(options);
        assert.deepEqual(clean(result.layout), changed);
        assert.equal(captured.type, 'recon-chat');
        assert.equal(captured.context.callType, 'dashboard-builder');
        assert.equal(captured.context.leagueId, league.league_id);
        assert.equal(captured.context.useWebSearch, false);
        assert.equal(captured.context.maxTokens, 6000);
        assert.equal(captured.context.decisionContext.leagueType, 'dynasty');
        assert.equal(captured.context.messages.length, 3);
        const envelope = JSON.parse(captured.context.messages.at(-1).content);
        assert.deepEqual(envelope.currentLayout, original);
        assert.equal(envelope.selectedSectionId, 'dw_roster');
        assert(captured.context.system.includes('you are not limited to existing sections'));
        assert.deepEqual(envelope.dataCatalog, []);
        assert(!JSON.stringify(captured).includes('signature'));
    });
    await checkAsync('full JSON fences work; mixed prose and invalid schemas are rejected', async () => {
        root.OD.callAI = async () => ({ analysis: '```json\n' + response(changed).analysis + '\n```' });
        assert.deepEqual(clean((await api.request(options)).layout), changed);
        for (const analysis of [
            'Here you go: ' + response(changed).analysis,
            response(changed).analysis + ' trailing text',
            JSON.stringify({ version: 2, reply: 'x', layout: changed }),
            JSON.stringify({ version: 1, reply: 'x', layout: changed, execute: 'alert(1)' }),
            response([{ ...original[0], key: 'trade-block' }]).analysis,
            response([{ ...original[0], id: 'new_unprefixed' }]).analysis,
            response([{ ...original[0], key: 'not-available' }]).analysis,
        ]) {
            root.OD.callAI = async () => ({ analysis });
            await assert.rejects(api.request(options));
        }
        assert.deepEqual(clean(api.readSaved(scope).layout), original, 'requests never mutate saved definitions');
    });
    await checkAsync('new allowlisted sections and clarification responses remain valid', async () => {
        const next = [...original, { id: 'alex_trade_1', key: 'trade-block', size: 'md' }];
        root.OD.callAI = async () => response(next);
        assert.deepEqual(clean((await api.request(options)).layout), next);
        root.OD.callAI = async () => ({ analysis: JSON.stringify({ version: 1, reply: 'Which section should I move?', layout: original }) });
        assert.deepEqual(clean((await api.request(options)).layout), original);
    });
    await checkAsync('unavailable AI, provider failures and invalid prompts do not invent previews', async () => {
        delete root.OD;
        await assert.rejects(api.request(options), /unavailable/);
        root.OD = { callAI: async () => { throw new Error('Shared Gemini capacity is used up.'); } };
        await assert.rejects(api.request(options), /capacity/);
        await assert.rejects(api.request({ ...options, prompt: '' }), /Describe/);
        await assert.rejects(api.request({ ...options, prompt: 'x'.repeat(2001) }), /2,000/);
        await assert.rejects(api.request({ ...options, league: {} }), /Open a league/);
    });
    await checkAsync('cancel discards delayed responses and pre-cancel avoids a model call', async () => {
        let finish, calls = 0;
        root.OD.callAI = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
        const controller = new AbortController();
        const pending = api.request({ ...options, signal: controller.signal });
        await Promise.resolve();
        controller.abort();
        await assert.rejects(pending, error => error.name === 'AbortError');
        finish(response(changed));
        assert.equal(calls, 1);
        await assert.rejects(api.request({ ...options, signal: controller.signal }), error => error.name === 'AbortError');
        assert.equal(calls, 1);
    });
    await checkAsync('account changes discard a pending AI response even before React rerenders', async () => {
        let finish;
        let account = 'account-one';
        root.OD.getSessionToken = () => token({ sub: account, exp: Date.now() / 1000 + 60 });
        root.OD.callAI = () => new Promise(resolve => { finish = resolve; });
        const pending = api.request(options);
        await Promise.resolve();
        account = 'account-two';
        finish(response(changed));
        await assert.rejects(pending, /account changed/);
    });
    console.log('PASS dashboard builder: ' + checks + ' behavior groups');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
