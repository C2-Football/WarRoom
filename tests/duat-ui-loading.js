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
    'js/duat/rules.js', 'js/duat/world.js', 'js/duat/provinces.js', 'js/duat/army-generation.js',
    'js/duat/conquest.js', 'js/duat/favors.js', 'js/duat/lore.js', 'js/duat/rituals.js', 'js/duat/heptad.js', 'js/duat/campaign.js', 'js/duat/dynasty.js',
    'js/duat/session.js', 'js/duat/vendor/lz-string-1.5.0.js', 'js/duat/storage.js', 'js/duat/remote.js',
    'js/components/duat-presentation.js', 'js/components/duat-library.js', 'js/components/duat-rituals.js', 'js/components/duat-heptad.js', 'js/tabs/duat.js',
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
        const code = source.startsWith('js/components/') || source === 'js/tabs/duat.js'
            ? Babel.transform(raw, { filename: source, presets: ['react'], sourceType: 'script' }).code : raw;
        vm.runInContext(code, context, { filename: source, timeout: 2000 });
    }
    const App = context.App;
    assert.ok(App.DuatWorld.TERRITORIES.length > 150, 'The actual geographic board must initialize.');
    assert.equal(App.DuatPresentation.identity('persia'), App.DuatWorld.factionById('persia'));
    assert.equal(App.DuatPresentation.art('horus'), '../images/duat/horus.webp');
    assert.equal(typeof context.DuatGame, 'function');
    assert.equal(typeof App.DuatLibrary,'function');
    assert.equal(typeof App.DuatRitualsView,'function');
    assert.equal(typeof App.DuatHeptadUI.Games,'function');
    assert.equal(App.DuatLore.FACTIONS.length,28);
    assert.equal(App.DuatRituals.DEITIES.length,12);
    assert.ok(App.DuatProvinces.TERRITORIES.length>4000);
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
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node).replace(/\s+/g,' ').trim() === label);
const settle = () => new Promise(resolve => setImmediate(resolve));

function storyHarness({version=4,host=true,canAdvance=true,autoReveal=true}={}) {
    const states=[],deps=[],images=[],actions=[];let cursor=0,effectCursor=0,effects=[],changed=false,continued=0;
    const campaign={id:'story-test',version,dynastySeason:1,phase:'reveal',dynasty:{journal:[]},archaeology:{order:['egypt','rome'],revealedFactionIds:[],latest:null},factions:['egypt','rome'].map(id=>({
        id,activeArmyId:null,rulerRoll:null,armies:[{id:id+':2025',rulerName:id==='egypt'?'The Test Pharaoh':'The Test Consul',season:2025,players:[{id:id+'-q:2025',name:id+' Hidden Quarterback',position:'QB'},{id:id+'-w:2025',name:id+' Hidden Receiver',position:'WR'}]}]
    }))};
    const browser={location:new URL('https://example.test/WarRoom/'),Image:class{set src(value){images.push(value);}},App:{DuatCampaign:require('../js/duat/dynasty.js'),DuatRules:require('../js/duat/rules.js'),DuatWorld:require('../js/duat/world.js'),DuatConquest:require('../js/duat/conquest.js'),DuatLore:require('../js/duat/lore.js')}};
    const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'fragment',useMemo:fn=>fn(),useRef(initial){const i=cursor++;if(!(i in states))states[i]={current:initial};return states[i];},useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{const next=typeof value==='function'?value(states[i]):value;if(next!==states[i]){states[i]=next;changed=true;}}];},useEffect(callback,dependencies){const i=effectCursor++;if(!deps[i]||dependencies.some((v,n)=>v!==deps[i][n]))effects.push(callback);deps[i]=dependencies;}};
    vm.runInNewContext(Babel.transform(fs.readFileSync(path.join(root,'js/components/duat-presentation.js'),'utf8'),{presets:['react']}).code,{window:browser,location:browser.location,React});
    function reveal(id) {const f=campaign.factions.find(f=>f.id===id),army=f.armies[0];f.activeArmyId=army.id;f.rulerRoll=7;if(!campaign.archaeology.revealedFactionIds.includes(id))campaign.archaeology.revealedFactionIds.push(id);campaign.archaeology.latest={factionId:id,armyId:army.id,season:army.season,players:army.players};if(campaign.archaeology.revealedFactionIds.length===campaign.factions.length)campaign.phase='season';}
    const props={campaign,host,canAdvance,busy:false,onContinue(){continued++;},onAction(action){actions.push(action);if(autoReveal)reveal(campaign.archaeology.order.find(id=>!campaign.archaeology.revealedFactionIds.includes(id)));}};
    const draw=()=>{let tree;for(let i=0;i<6;i++){cursor=effectCursor=0;effects=[];changed=false;tree=browser.App.DuatPresentation.DynastyArchaeology(props);effects.forEach(fn=>fn());if(!changed)return tree;}throw Error('Expedition render did not settle');};
    return {draw,props,campaign,reveal,images,actions,continued:()=>continued};
}

test('Chapter II awakens the ruler and full army together, then travels to a distinct illustrated culture',()=>{
    const page=storyHarness();let tree=page.draw();
    assert(!text(tree).includes('The Test Pharaoh'));assert(!text(tree).includes('egypt Hidden Quarterback'));
    assert.equal(nodes(tree).find(n=>n.type==='img').props.src,'images/duat/expeditions/egypt.webp');
    assert.deepEqual(page.images,['images/duat/expeditions/rome.webp'],'Only the next culture is preloaded');
    button(tree,'Awaken the ruler').props.onClick();tree=page.draw();
    assert.deepEqual(page.actions.map(a=>a.type),['reveal-next']);
    for(const name of ['The Test Pharaoh','egypt Hidden Quarterback','egypt Hidden Receiver'])assert(text(tree).includes(name));
    assert(!nodes(tree).some(n=>n.type==='button'&&/Uncover|Reveal the full army|Write the record/.test(text(n))));
    button(tree,'Continue to Rome →').props.onClick();tree=page.draw();
    assert.equal(nodes(tree).find(n=>n.type==='img').props.src,'images/duat/expeditions/rome.webp');
    assert(!text(tree).includes('egypt Hidden Receiver'));assert(!text(tree).includes('rome Hidden Receiver'));assert.equal(page.actions.length,1);
    button(tree,'Awaken the ruler').props.onClick();tree=page.draw();assert(text(tree).includes('rome Hidden Receiver'));
    assert.equal(page.campaign.phase,'season');button(tree,'Enter the realm · Week 1').props.onClick();assert.equal(page.continued(),1);
    const revisit=nodes(tree).find(n=>n.type==='button'&&n.children.some(child=>child?.type==='span'&&text(child)==='Egypt'));
    revisit.props.onClick();tree=page.draw();assert(!text(tree).includes('egypt Hidden Receiver'));
    button(tree,'Awaken the ruler').props.onClick();tree=page.draw();assert(text(tree).includes('egypt Hidden Receiver'));assert.equal(page.actions.length,2,'Revisiting a discovered army is local and does not roll again');
});

test('shared updates reveal the whole current army without skipping a reader past an earlier culture',()=>{
    const page=storyHarness({host:false,canAdvance:false,autoReveal:false});let tree=page.draw();
    assert.equal(button(tree,'Awaken the ruler').props.disabled,true);assert(text(tree).includes('The host is leading this discovery'));
    page.reveal('egypt');tree=page.draw();assert(text(tree).includes('egypt Hidden Quarterback')&&text(tree).includes('egypt Hidden Receiver'));
    page.reveal('rome');tree=page.draw();assert(text(tree).includes('egypt Hidden Receiver'));assert(!text(tree).includes('rome Hidden Receiver'));
    button(tree,'Continue to Rome →').props.onClick();tree=page.draw();assert(!text(tree).includes('rome Hidden Receiver'));assert.equal(button(tree,'Awaken the ruler').props.disabled,false);
    button(tree,'Awaken the ruler').props.onClick();tree=page.draw();assert(text(tree).includes('rome Hidden Receiver'));assert.equal(page.actions.length,0);
    button(tree,'Enter the realm · Week 1').props.onClick();assert.equal(page.continued(),1);
});

test('readiness and an in-flight reveal keep secret roster content sealed until authoritative data arrives',()=>{
    const page=storyHarness({canAdvance:false,autoReveal:false});let tree=page.draw();assert(button(tree,'Awaken the ruler').props.disabled);
    page.props.canAdvance=true;tree=page.draw();button(tree,'Awaken the ruler').props.onClick();page.props.busy=true;tree=page.draw();
    assert(button(tree,'The seal is opening…').props.disabled);assert(!text(tree).includes('egypt Hidden Receiver'));assert(!text(tree).includes('The Test Pharaoh'));
    page.reveal('egypt');page.props.busy=false;tree=page.draw();assert(text(tree).includes('The Test Pharaoh')&&text(tree).includes('egypt Hidden Receiver'));
});

test('a reader who misses multiple shared updates can still awaken the known earlier army locally',()=>{
    const page=storyHarness({host:false,canAdvance:false,autoReveal:false});page.draw();
    page.reveal('egypt');page.reveal('rome');let tree=page.draw();
    assert(!text(tree).includes('egypt Hidden Receiver'));assert.equal(button(tree,'Awaken the ruler').props.disabled,false);
    button(tree,'Awaken the ruler').props.onClick();tree=page.draw();assert(text(tree).includes('egypt Hidden Receiver'));assert(!text(tree).includes('rome Hidden Receiver'));assert.equal(page.actions.length,0);
});

test('legacy revealed saves show every player without timers, preserve final completion and handle a missing illustration',()=>{
    const page=storyHarness({version:3});page.reveal('egypt');page.reveal('rome');let tree=page.draw();
    assert(text(tree).includes('rome Hidden Quarterback')&&text(tree).includes('rome Hidden Receiver'));assert(button(tree,'Enter the realm · Week 1'));
    const illustration=nodes(tree).find(n=>n.type==='img');illustration.props.onError();tree=page.draw();
    const fallback=nodes(tree).find(n=>n.type==='img');assert.equal(fallback.props.src,'images/duat/excavation.webp');assert.match(fallback.props.alt,/temporarily unavailable/);
    button(tree,'Enter the realm · Week 1').props.onClick();assert.equal(page.continued(),1);assert.equal(page.actions.length,0);
});

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
