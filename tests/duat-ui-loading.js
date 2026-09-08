'use strict';
/* global require, setImmediate */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Babel = require('@babel/standalone');

const appSource = fs.readFileSync(require.resolve('../js/app.js'), 'utf8');
const loaderSource = fs.readFileSync(require.resolve('../js/module-loader.js'), 'utf8');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
function between(source, start, end) {
    const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, 'The actual Duat application block must be available to this behavior test.');
    assert.equal(source.indexOf(start, from + start.length), -1, 'The extracted application block must be unambiguous.');
    return source.slice(from, to);
}
const controls = between(appSource, '// The Duat is a sibling game, independent of connected leagues.', '// ── Time League invite links');
const surface = between(appSource, 'if (duatMode && !selectedLeague)', '// ── Time League surface');
// Execute the production hook handlers and JSX gate verbatim. The wrapper only
// supplies their unrelated parent dependencies and exposes handlers for clicks.
const componentSource = Babel.transform(`
    function DuatEntry() {
        ${controls}
        capture({ openDuat, closeDuat, duatMode, duatModuleState });
        ${surface}
        return null;
    }
`, { presets: ['react'] }).code;
const scriptSources = [...html.matchAll(/<script\b[^>]*data-wr-defer="duat"[^>]*src="([^"]+)"[^>]*>/g)].map(match => match[1]);
assert.ok(scriptSources.length > 1, 'The production Duat group must contain its dependent scripts.');
const scriptPaths = scriptSources.map(src => src.split('?')[0]);
const requiredDuatSources = [
    'js/duat/rules.js', 'js/duat/world.js', 'js/duat/army-generation.js',
    'js/duat/conquest.js', 'js/duat/favors.js', 'js/duat/campaign.js',
    'js/duat/session.js', 'js/duat/storage.js', 'js/duat/remote.js',
    'js/components/duat-presentation.js', 'js/tabs/duat.js',
];
const sharedHelpers = [
    'js/shared/time-league-roster.js', 'js/shared/time-league-draft-room.js',
    'js/shared/time-league-season.js', 'js/shared/time-league-player-cards.js',
];
const root = path.resolve(__dirname, '..');

test('the Duat group includes world and presentation exactly once in dependency order', () => {
    let previous = -1;
    for (const source of requiredDuatSources) {
        const matches = scriptPaths.flatMap((item, index) => item === source ? [index] : []);
        assert.equal(matches.length, 1, `The actual HTML must declare ${source} exactly once in the Duat group.`);
        assert.ok(matches[0] > previous, `${source} must follow its dependencies before any consumer captures them.`);
        assert.ok(fs.existsSync(path.join(root, source)), `${source} must exist for preview and production packaging.`);
        previous = matches[0];
    }
    const firstDuat = html.indexOf(scriptSources[0]);
    for (const source of sharedHelpers) {
        const tag = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)]
            .find(match => match[1].split('?')[0] === source);
        assert.ok(tag && tag.index < firstDuat, `${source} must be available before the deferred Duat group.`);
        assert.ok(!tag[0].includes('data-wr-defer'), `${source} cannot depend on opening an unrelated game first.`);
    }
});

test('actual browser modules initialize the country campaign and presentation without CommonJS fallbacks', () => {
    const location = new URL('https://example.test/WarRoom/dist-preview/index.html?duat=1');
    const sandbox = {
        location, URL, URLSearchParams,
        React: {
            createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
            Fragment: 'fragment',
            useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
            useEffect() {}, useMemo: compute => compute(), useRef: value => ({ current: value }),
        },
    };
    sandbox.window = sandbox;
    const context = vm.createContext(sandbox);
    assert.equal(context.module, undefined);
    assert.equal(context.require, undefined);
    for (const source of [...sharedHelpers, ...scriptPaths]) {
        const raw = fs.readFileSync(path.join(root, source), 'utf8');
        const code = source === 'js/components/duat-presentation.js' || source === 'js/tabs/duat.js'
            ? Babel.transform(raw, { filename: source, presets: ['react'], sourceType: 'script' }).code : raw;
        vm.runInContext(code, context, { filename: source, timeout: 2000 });
    }
    const App = context.App;
    assert.ok(App.DuatWorld.TERRITORIES.length > 150, 'The actual geographic board must initialize.');
    assert.equal(App.DuatPresentation.identity('persia'), App.DuatWorld.factionById('persia'));
    assert.equal(App.DuatPresentation.art('horus'), '../images/duat/horus.webp');
    assert.equal(typeof context.DuatGame, 'function');
    for (const component of ['World', 'Draft', 'Archaeology', 'Pantheon', 'Tournaments']) {
        assert.equal(typeof App.DuatPresentation[component], 'function', `${component} must be ready before the game tab mounts.`);
    }
    // Small same-realm fixture: this tests dependency capture, not archive
    // quality (covered by duat-data.js). Instantiate a real expanded campaign
    // so campaign/conquest cannot quietly retain an undefined World reference.
    vm.runInContext(`
        const years = [2021, 2022, 2023, 2024];
        const cards = Array.from({length: 126}, (_, index) => ({
            identity: 'loader-player-' + index, name: 'Loader Player ' + index,
            position: index < 14 ? 'QB' : 'WR',
            seasons: years.map(season => ({season, games: 17, points: 100})),
        }));
        const logIndex = new Map(years.flatMap(season => Array.from({length: 17}, (_, index) =>
            [season + ':' + index, {position: 'QB', season, week: index + 1}])));
        const campaign = App.DuatCampaign.createCampaign({
            id: 'browser-loader-campaign', name: 'Browser Loader', seed: 'loader-world',
            createdAt: '2026-09-08T18:00:00.000Z', seasons: years, hostFactionId: 'persia',
        }, {cards, logIndex});
        window.createdCampaign = campaign;
        window.worldTree = App.DuatPresentation.World({campaign, factionId: 'persia', onAction() {}, busy: false});
    `, context, { timeout: 2000 });
    assert.equal(context.createdCampaign.version, 2);
    assert.equal(context.createdCampaign.conquest.worldId, App.DuatWorld.WORLD_ID);
    assert.equal(context.createdCampaign.conquest.owners[App.DuatWorld.factionById('persia').homeTerritoryId], 'persia');
    const countries = nodes(context.worldTree).filter(node => node.type === 'path' && node.props.className === 'duat-country');
    assert.equal(countries.length, App.DuatWorld.TERRITORIES.length, 'The presentation renders every real country shape.');
    assert.ok(countries.every(node => typeof node.props.d === 'string' && node.props.d.startsWith('M')));
});

function harness({ loaded = false, missingLoader = false } = {}) {
    const states = [], effectDependencies = [], injected = [];
    let stateCursor = 0, effectCursor = 0, queuedEffects = [], snapshot, reloads = 0, vaultMode = true;
    function Game() {}
    function ErrorBoundary() {}
    const location = new URL('https://example.test/WarRoom/index.html?duat=1&vault=1&duat_invite=private-code');
    location.reload = () => { reloads++; };
    const browser = {
        location,
        history: { state: { view: 'hub' }, replaceState(state, unused, url) { this.state = state; location.href = String(url); } },
        dispatchEvent() {},
    };
    if (loaded) browser.DuatGame = Game;
    const document = {
        querySelectorAll: () => scriptSources.map(src => ({ getAttribute: key => key === 'type' ? 'text/wr-deferred' : key === 'src' ? src : null })),
        createElement: () => ({}),
        head: { appendChild: script => injected.push(script) },
    };
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    };
    const context = vm.createContext({
        window: browser, document, React, URL, URLSearchParams, ErrorBoundary,
        selectedLeague: null,
        setTimeout: () => 1, clearTimeout() {},
        setTimeLeagueMode: value => { vaultMode = value; },
        useState(initial) {
            const index = stateCursor++;
            if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
            return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
        },
        useEffect(callback, dependencies) {
            const index = effectCursor++, previous = effectDependencies[index];
            if (!previous || dependencies.some((value, item) => value !== previous[item])) queuedEffects.push(callback);
            effectDependencies[index] = [...dependencies];
        },
        capture: value => { snapshot = value; },
    });
    if (!missingLoader) vm.runInContext(loaderSource, context);
    vm.runInContext(componentSource, context);
    function draw() {
        stateCursor = effectCursor = 0;
        queuedEffects = [];
        const tree = context.DuatEntry();
        queuedEffects.forEach(callback => callback());
        return tree;
    }
    return {
        draw, browser, injected, Game, ErrorBoundary,
        snapshot: () => snapshot, reloads: () => reloads, vaultMode: () => vaultMode,
        completeGroup() { browser.DuatGame = Game; injected.forEach(script => script.onload()); },
    };
}
function nodes(value) {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap(nodes);
    return [value, ...nodes(value.children)];
}
const text = value => value == null ? '' : Array.isArray(value) ? value.map(text).join(' ') : typeof value === 'object' ? text(value.children) : String(value);
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node) === label);
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a failed world dependency keeps the game unmounted even when presentation loaded; retry reloads', async () => {
    const page = harness();
    page.draw();
    assert.equal(page.injected.length, scriptSources.length, 'The real loader injects the complete group.');
    assert.ok(page.injected.every(script => script.async === false), 'Production dependency execution stays ordered.');
    page.browser.DuatGame = page.Game;
    let tree = page.draw();
    assert.match(text(tree), /Opening The Duat/);
    assert.ok(!nodes(tree).some(node => node.type === page.Game), 'A defined component cannot bypass the pending group.');
    const failedWorld = page.injected.find(script => script.src.split('?')[0] === 'js/duat/world.js');
    assert.ok(failedWorld, 'The geography dependency must participate in real group loading.');
    failedWorld.onerror();
    page.injected.filter(script => script !== failedWorld).forEach(script => script.onload());
    await settle();
    tree = page.draw();
    assert.equal(page.snapshot().duatModuleState, 'error');
    assert.match(text(tree), /The Duat could not load/);
    assert.ok(!nodes(tree).some(node => node.type === page.Game), 'A partially initialized game never reaches the render boundary.');
    button(tree, 'Try again').props.onClick();
    assert.equal(page.reloads(), 1, 'Retry must clear the downstream closures that captured missing dependencies.');
    assert.equal(page.injected.length, scriptSources.length, 'Retry does not selectively reload only the missing dependency.');
    assert.equal(page.browser.location.searchParams.get('duat'), '1');
    assert.equal(page.browser.location.searchParams.get('duat_invite'), 'private-code');
    assert.equal(page.browser.location.searchParams.has('vault'), false);
});

test('successful group completion mounts the game and repeat entry does not load it twice', async () => {
    const page = harness();
    page.draw();
    page.completeGroup();
    await settle();
    const tree = page.draw();
    assert.equal(page.snapshot().duatModuleState, 'ready');
    assert.equal(tree.type, page.ErrorBoundary);
    assert.equal(nodes(tree).filter(node => node.type === page.Game).length, 1);
    assert.equal(page.vaultMode(), false);
    page.snapshot().openDuat();
    assert.equal(page.injected.length, scriptSources.length);
    assert.equal(page.reloads(), 0);
});

test('missing loader and completed group without its component expose a recoverable error', async () => {
    for (const missingLoader of [true, false]) {
        const page = harness({ missingLoader });
        page.draw();
        if (!missingLoader) {
            page.injected.forEach(script => script.onload());
            await settle();
        }
        const tree = page.draw();
        assert.equal(page.snapshot().duatModuleState, 'error');
        button(tree, 'Try again').props.onClick();
        assert.equal(page.reloads(), 1);
    }
});

test('already executed raw-development game opens without a loader', () => {
    const page = harness({ loaded: true, missingLoader: true });
    const tree = page.draw();
    assert.equal(page.snapshot().duatModuleState, 'ready');
    assert.equal(nodes(tree).filter(node => node.type === page.Game).length, 1);
    page.snapshot().openDuat();
    assert.equal(page.injected.length, 0);
    assert.equal(page.reloads(), 0);
});
