'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const directory = path.resolve(__dirname, '..');
const clean = value => JSON.parse(JSON.stringify(value));
const stamp = '2026-10-23T22:00:00.000Z';
const league = { league_id: '1234567890123456789', season: '2026' };
const field = (id, type = 'number') => ({ id, label: id, type });
const fields = [field('name', 'string'), field('position', 'string'), field('teamName', 'string'), field('teamRecord', 'string'), field('teamWinPct'), field('ppg'), field('value'), field('positionRank')];
const evidence = {
    datasets: [{ id: 'targets', source: 'tradeTargets', fields, rows: [{ name: 'Real Player', position: 'WR', teamName: 'Losing Team', teamRecord: '2–5', teamWinPct: 28.57, ppg: 18.3, value: null, positionRank: 7 }], status: 'partial', note: 'Dynasty values unavailable; ranking uses reported PPG.', asOf: stamp, sourceIds: ['league_records'] }],
    sources: [{ id: 'league_records', title: 'Connected league records and scoring', url: 'https://api.sleeper.app/v1/league/1234567890123456789/rosters', asOf: stamp }], warnings: ['Dynasty values unavailable.'],
};
const plan = { version: 1, needs: [{ id: 'targets', source: 'tradeTargets', columns: fields.map(item => item.id), filters: [{ field: 'teamWinPct', op: 'lt', value: 50 }], sort: { field: 'ppg', direction: 'desc' }, limit: 60 }], researchQuestion: null, assumptions: ['Bad teams means losing fantasy teams.'], reuseEvidence: false };
const design = () => ({ version: 1, reply: 'I ranked players on losing fantasy teams using reported PPG.', composition: { version: 1, title: 'Players worth a conversation', subtitle: 'Losing fantasy teams; reported PPG ranking', theme: { accent: '#62c7b4', style: 'analytic' }, blocks: [
    { id: 'targets_chart', kind: 'chart', title: 'Production on losing fantasy teams', datasetId: 'targets', sourceIds: ['league_records'], span: 8, tabletSpan: 12, visual: { mark: 'point', encoding: { x: { field: 'teamWinPct', type: 'quantitative' }, y: { field: 'ppg', type: 'quantitative' }, color: { field: 'position', type: 'nominal' }, tooltip: [{ field: 'name', type: 'nominal' }, { field: 'ppg', type: 'quantitative' }] } }, mobileVisual: { mark: 'bar', encoding: { x: { field: 'ppg', type: 'quantitative' }, y: { field: 'name', type: 'nominal' } } } },
    { id: 'ranked_players', kind: 'table', title: 'Player evidence', datasetId: 'targets', columns: ['name', 'position', 'teamName', 'teamRecord', 'ppg', 'value'], sourceIds: ['league_records'], span: 12, tabletSpan: 12 },
    { id: 'scope_note', kind: 'text', title: 'What this means', body: 'The listed player has reported production on a losing fantasy team. Owner willingness to trade is unknown.', sourceIds: ['league_records'], span: 4, tabletSpan: 12 },
] } });
const response = value => ({ analysis: JSON.stringify(value) });
function setup() {
    const storage = new Map(), calls = [], reads = [], progress = [];
    let account = 'one';
    const window = { WR: {}, S: { currentLeague: league }, atob: value => Buffer.from(value, 'base64').toString('utf8'), localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
    const context = vm.createContext({ window, URL, console, Date });
    for (const file of ['js/shared/lens-composition.js', 'js/shared/dashboard-builder.js', 'js/shared/lens-research.js']) vm.runInContext(fs.readFileSync(path.join(directory, file), 'utf8'), context);
    window.WR.LensData = { catalog: () => [{ id: 'tradeTargets', fields }], resolve: async needs => { reads.push(clean(needs)); return clean(evidence); } };
    window.OD = { getSessionToken: () => 'header.' + Buffer.from(JSON.stringify({ sub: account, exp: Date.now() / 1000 + 60 })).toString('base64url') + '.signature', callAI: async args => { calls.push(clean({ ...args, signal: undefined })); return response(args.context.callType === 'lens-plan' ? plan : design()); } };
    const builder = window.WR.DashboardBuilder;
    const catalog = builder.catalog({ old: { label: 'Old section', sizes: ['md'], metrics: [] } });
    const options = { prompt: 'Find the best players on bad teams to trade for', layout: [], catalog, league, dataContext: { currentLeague: league, secret: 'never send this context field to AI' }, onProgress: message => progress.push(message) };
    return { window, builder, catalog, options, calls, reads, progress, storage, account: next => { account = next; } };
}
async function main() {
    let tests = 0;
    const test = async (name, run) => { await run(); tests++; console.log('PASS ' + name); };
    await test('plans and resolves actual scoped evidence before composing a unique responsive lens', async () => {
        const s = setup(), result = await s.builder.request(s.options);
        assert.deepEqual(s.calls.map(call => call.context.callType), ['lens-plan', 'lens-compose']);
        assert(s.calls.every(call => call.inlineGrounding === true && call.context.maxTokens === 4000 && call.context.useWebSearch === false));
        assert.equal(s.reads[0][0].source, 'tradeTargets');
        const comp = result.layout[0].composition;
        assert.equal(comp.datasets[0].rows[0].ppg, 18.3);
        assert.equal(comp.datasets[0].rows[0].value, null);
        assert.equal(comp.blocks[0].visual.mark, 'point');
        assert.equal(comp.blocks[0].mobileVisual.mark, 'bar');
        assert.match(comp.research.notes, /losing fantasy teams/);
        assert(!JSON.stringify(s.calls).includes('never send this context field'));
        assert(!JSON.stringify(s.calls).includes('.signature'));
        assert(s.progress.length >= 3);
        assert.equal(s.storage.size, 0, 'research only creates a preview');
    });
    await test('only verified grounding URLs become narrative evidence', async () => {
        const s = setup();
        s.window.OD.callAI = async args => {
            s.calls.push(args);
            if (args.context.callType === 'lens-plan') return response({ ...plan, researchQuestion: 'Current public reporting on Real Player' });
            if (args.context.callType === 'lens-sources') return { ...response({ facts: [{ text: 'The team reported a practice update.', sourceUrls: ['https://www.nfl.com/news/real-update'] }, { text: 'Invented claim', sourceUrls: ['https://fake.example/no-evidence'] }], note: '' }), grounding: { sources: [{ title: 'Team practice report', url: 'https://www.nfl.com/news/real-update' }, { title: 'Unsafe', url: 'javascript:alert(1)' }] } };
            const answer = design(); answer.composition.blocks.push({ id: 'reporting', kind: 'text', title: 'Reported update', body: 'The team reported a practice update.', sourceIds: ['web_1'], span: 12, tabletSpan: 12 }); return response(answer);
        };
        const result = await s.builder.request(s.options), compose = JSON.parse(s.calls.at(-1).context.messages[0].content);
        assert.equal(s.calls[1].context.useWebSearch, true);
        assert.equal(compose.verifiedWebFacts.length, 1);
        assert.equal(result.layout[0].composition.sources.length, 2);
        assert(!JSON.stringify(result).includes('fake.example'));
        assert(!JSON.stringify(compose).includes('Invented claim'));
    });
    await test('unverified web output remains unavailable while connected data still produces a useful preview', async () => {
        const s = setup();
        s.window.OD.callAI = async args => args.context.callType === 'lens-plan' ? response({ ...plan, researchQuestion: 'Current reporting' }) : args.context.callType === 'lens-sources' ? response({ facts: [{ text: 'Unsourced claim', sourceUrls: ['https://invented.example'] }] }) : response(design());
        const result = await s.builder.request(s.options);
        assert.equal(result.layout[0].composition.sources.length, 1);
        assert.match(result.layout[0].composition.research.notes, /No verifiable linked reporting/);
    });
    await test('cosmetic edit reuses evidence and preserves section IDs, old sections and save undo', async () => {
        const s = setup(), first = await s.builder.request(s.options);
        const original = [{ id: 'old_section', key: 'old', size: 'md' }, ...clean(first.layout)];
        s.window.OD.callAI = async args => {
            if (args.context.callType === 'lens-plan') return response({ version: 1, needs: [], researchQuestion: null, reuseEvidence: true, assumptions: [] });
            const answer = design(); answer.composition.theme.accent = '#d987ff'; return response(answer);
        };
        const result = await s.builder.request({ ...s.options, prompt: 'Make it purple', layout: original, focusId: first.layout[0].id });
        assert.equal(s.reads.length, 1, 'visual edits make no data reload');
        assert.equal(result.layout[1].id, first.layout[0].id);
        assert.deepEqual(clean(result.layout[0]), original[0]);
        assert.equal(result.layout[1].composition.theme.accent, '#d987ff');
        assert.match(result.layout[1].composition.research.notes, /losing fantasy teams/);
        s.builder.save('one:league', result.layout, s.catalog, original);
        assert.equal(s.builder.readSaved('one:league').layout[1].composition.theme.accent, '#d987ff');
        assert.deepEqual(clean(s.builder.undoSaved('one:league', s.catalog)), original);
    });
    await test('adding a comparison preserves old datasets and remaps conflicting source IDs', async () => {
        const s = setup(), first = await s.builder.request(s.options);
        s.window.WR.LensData.resolve = async () => {
            const next = clean(evidence); next.datasets[0].id = 'comparison'; next.sources[0].title = 'A different verified snapshot'; next.sources[0].asOf = '2026-10-24T12:00:00.000Z'; return next;
        };
        s.window.OD.callAI = async args => {
            if (args.context.callType === 'lens-plan') return response({ ...plan, needs: [{ ...plan.needs[0], id: 'comparison' }] });
            const supplied = JSON.parse(args.context.messages[0].content), answer = design();
            const added = supplied.datasets.find(dataset => dataset.id === 'comparison');
            answer.composition.blocks.push({ id: 'added_comparison', kind: 'table', title: 'Added comparison', datasetId: 'comparison', columns: ['name', 'ppg'], sourceIds: added.sourceIds, span: 12, tabletSpan: 12 });
            return response(answer);
        };
        const result = await s.builder.request({ ...s.options, layout: first.layout, prompt: 'Add another comparison' });
        assert.equal(result.layout[0].id, first.layout[0].id);
        assert.equal(result.layout[0].composition.datasets.length, 2);
        assert.equal(result.layout[0].composition.sources.length, 2);
        assert.notEqual(result.layout[0].composition.datasets[0].sourceIds[0], result.layout[0].composition.datasets[1].sourceIds[0]);
    });
    await test('model-supplied rows, unsafe visuals and invented sources fail after one bounded repair', async () => {
        for (const mutate of [answer => { answer.composition.datasets = [{ rows: [{ ppg: 999 }] }]; }, answer => { answer.composition.blocks[0].visual.data = { url: 'https://bad.example' }; }, answer => { answer.composition.blocks[2].sourceIds = ['invented_source']; }]) {
            const s = setup(); let compositions = 0;
            s.window.OD.callAI = async args => { if (args.context.callType === 'lens-plan') return response(plan); compositions++; const answer = design(); mutate(answer); return response(answer); };
            await assert.rejects(s.builder.request(s.options));
            assert.equal(compositions, 2); assert.equal(s.storage.size, 0);
        }
    });
    await test('legacy response parser cannot introduce model-authored research data', async () => {
        const s = setup(), first = await s.builder.request(s.options);
        s.window.OD.callAI = async () => response(first);
        await assert.rejects(s.builder.request({ ...s.options, dataContext: null }), /connected research tools/);
        s.window.OD.callAI = async () => response({ version: 1, reply: 'Kept the lens.', layout: first.layout });
        const unchanged = await s.builder.request({ ...s.options, layout: first.layout, dataContext: null });
        assert.deepEqual(clean(unchanged.layout), clean(first.layout));
    });
    await test('malformed bad-team plan falls back to a real typed trade-target query with explicit scope', async () => {
        const s = setup();
        s.window.WR.LensData.resolve = async needs => { s.reads.push(clean(needs)); const result = clean(evidence); result.datasets[0].id = 'trade_targets'; return result; };
        s.window.OD.callAI = async args => {
            if (args.context.callType === 'lens-plan') return { analysis: 'not JSON' };
            const answer = design(); answer.composition.blocks.forEach(block => { if (block.datasetId) block.datasetId = 'trade_targets'; }); return response(answer);
        };
        const result = await s.builder.request(s.options);
        assert.equal(s.reads[0][0].filters[0].field, 'teamWinPct');
        assert.equal(s.reads[0][0].sort.field, 'ppg');
        assert.match(result.layout[0].composition.research.notes, /losing fantasy teams/);
    });
    await test('unknown data sources and unbounded plans cannot invoke arbitrary data retrieval', async () => {
        const s = setup();
        for (const bad of [{ ...plan, needs: [{ id: 'secret', source: 'credentials' }] }, { ...plan, needs: Array(7).fill(plan.needs[0]) }]) {
            s.window.OD.callAI = async () => response(bad);
            await assert.rejects(s.builder.request({ ...s.options, prompt: 'Show my roster ages' }));
        }
        assert.equal(s.reads.length, 0);
    });
    await test('one bounded planner correction can recover a source typo before any data load', async () => {
        const s = setup(); let planning = 0;
        s.window.OD.callAI = async args => {
            if (args.context.callType === 'lens-plan') return response(++planning === 1 ? { ...plan, needs: [{ ...plan.needs[0], source: 'rosters_typo' }] } : plan);
            return response(design());
        };
        const result = await s.builder.request({ ...s.options, prompt: 'Compare player production' });
        assert.equal(planning, 2); assert.equal(s.reads.length, 1); assert.equal(result.layout[0].composition.datasets[0].rows[0].ppg, 18.3);
    });
    await test('empty plans and failed web-only research cannot manufacture an empty generic lens', async () => {
        const s = setup();
        s.window.OD.callAI = async () => response({ version: 1, needs: [], researchQuestion: null, reuseEvidence: false });
        await assert.rejects(s.builder.request({ ...s.options, prompt: 'Build something' }), /needs a data question/);
        s.window.OD.callAI = async args => args.context.callType === 'lens-plan' ? response({ version: 1, needs: [], researchQuestion: 'Latest public reporting', reuseEvidence: false }) : response({ facts: [] });
        await assert.rejects(s.builder.request({ ...s.options, prompt: 'Latest public reporting' }), /could not verify/);
    });
    await test('private details in a proposed web query never reach the web-enabled call', async () => {
        const s = setup();
        s.window.OD.callAI = async args => { s.calls.push(args); return response(args.context.callType === 'lens-plan' ? { ...plan, researchQuestion: 'Find private.owner@example.com team records' } : design()); };
        const result = await s.builder.request(s.options);
        assert(s.calls.every(call => call.context.useWebSearch === false));
        assert.match(result.layout[0].composition.research.notes, /private league details/);
    });
    await test('cancel, account switch and league switch discard pending research before composition', async () => {
        const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
        for (const change of ['cancel', 'account', 'league']) {
            const s = setup(), controller = new AbortController(); let finish;
            s.window.WR.LensData.resolve = () => new Promise(resolve => { finish = resolve; });
            const pending = s.builder.request({ ...s.options, signal: controller.signal });
            await flush(); assert.equal(typeof finish, 'function');
            if (change === 'cancel') controller.abort();
            if (change === 'account') s.account('two');
            if (change === 'league') s.window.S.currentLeague = { league_id: 'different' };
            finish(clean(evidence));
            await assert.rejects(pending, change === 'cancel' ? error => error.name === 'AbortError' : /changed/);
            assert.equal(s.calls.length, 1); assert.equal(s.storage.size, 0);
        }
    });
    console.log('PASS lens research: ' + tests + ' behavior groups');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
