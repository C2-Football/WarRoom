'use strict';
/* global require, setImmediate */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
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

test('a failed dependency group stays outside the game even when its component loaded; retry reloads', async () => {
    const page = harness();
    page.draw();
    assert.equal(page.injected.length, scriptSources.length, 'The real loader injects the complete group.');
    assert.ok(page.injected.every(script => script.async === false), 'Production dependency execution stays ordered.');
    page.browser.DuatGame = page.Game;
    let tree = page.draw();
    assert.match(text(tree), /Opening The Duat/);
    assert.ok(!nodes(tree).some(node => node.type === page.Game), 'A defined component cannot bypass the pending group.');
    page.injected[0].onerror();
    page.injected.slice(1).forEach(script => script.onload());
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
