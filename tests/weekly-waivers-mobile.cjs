'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const h = (type, props, ...children) => typeof type === 'function' ? type(props || {}) : ({ type, props: props || {}, children: children.flat(Infinity).filter(x => x != null && x !== false) });
const nodes = n => n && typeof n === 'object' ? [n, ...(n.children || []).flatMap(nodes)] : [];
const text = n => n == null ? '' : typeof n === 'object' ? (n.children || []).map(text).join(' ').trim() : String(n);
const source = fs.readFileSync('js/free-agency.js', 'utf8');
const panel = source.slice(source.indexOf('        function renderWeeklyStreams()'), source.indexOf('        function renderRosterSyncBlocker()'));
let claim, section, sort;
const ctx = vm.createContext({ React: { createElement: h, Fragment: 'fragment' }, weeklyWaivers: true, skinFeatures: {}, isPro: true, marketWeek: 3, marketIsCurrent: true, availablePlayers: [{proj: 15}], acquisitionLeagueId: 'league-123', playerName: p => p.full_name, openFaPlayer: () => {}, setFaSection: s => section = s, setFaSort: s => sort = s, window: { WR: { openAcquisition: c => claim = c }, WrGatedMoreRow: p => h('aside', {}, p.title, p.sub) }, streamHorizon:'week', setStreamHorizon:()=>{}, streamCandidates: [{ fa: {pid: 'add', proj: 15, p: {full_name: 'Available Player', team: 'BUF'}}, pos: 'QB', delta: 3, dropPid: 'drop', dropName: 'Bench Player' }] });
vm.runInContext(babel.transform(panel, {presets:['react']}).code, ctx);
let out = ctx.renderWeeklyStreams();
assert.match(text(out), /Available Player.*Suggested drop: Bench Player.*15.0.*Week proj.*\+\s*3.0.*Week lineup gain/);
nodes(out).find(n => n.props.className === 'fa-weekly-stream').props.onClick();
assert.equal(claim.pid, 'add'); assert.equal(claim.dropPid, 'drop'); assert.equal(claim.leagueId, 'league-123');
nodes(out).find(n => n.props.className === 'fa-mobile-more').props.onClick();
assert.equal(section, 'market'); assert.equal(sort.key, 'proj');
ctx.streamCandidates = []; ctx.availablePlayers = [];
assert.match(text(ctx.renderWeeklyStreams()), /projections are unavailable/);
ctx.availablePlayers = [{proj:15}];
assert.match(text(ctx.renderWeeklyStreams()), /No confirmed upgrades/);
ctx.isPro = false;
assert.match(text(ctx.renderWeeklyStreams()), /recommendations are Pro/);
ctx.weeklyWaivers = false; assert.equal(ctx.renderWeeklyStreams(), null);
ctx.weeklyWaivers = true; ctx.skinFeatures = {showStreaming:false}; assert.equal(ctx.renderWeeklyStreams(), null);
const leagueSource = fs.readFileSync('js/league-detail.js', 'utf8');
const dock = leagueSource.slice(leagueSource.indexOf('    function PhoneDockInner('), leagueSource.indexOf('    // League Detail Component'));
ctx.window.WR.LeagueWorkspaces = require('../js/shared/league-workspaces.js');
const navItems = ctx.window.WR.LeagueWorkspaces.navigation();
let selected;
Object.assign(ctx, {useState: init => [typeof init === 'function' ? init() : init, () => {}], useEffect: () => {}, NAV_ICON_PATHS: {home: []}, navItemIsActive: (item, tab) => item.tab === tab});
vm.runInContext(babel.transform(dock, {presets:['react']}).code, ctx);
for (const leagueType of ['redraft', 'chopped']) {
 out = ctx.PhoneDockInner({activeTab:'fa', navItems, onSelectTab:t=>selected=t, workspaceOptions:{leagueType}});
 const buttons = nodes(out).filter(n => n.type === 'button');
 assert.deepEqual(buttons.map(text), ['Home','My Team','Waivers','League','More']);
 buttons[2].props.onClick(); assert.equal(selected,'fa'); assert.equal(buttons[2].props['aria-current'],'page');
}
out = ctx.PhoneDockInner({activeTab:'dashboard',navItems,onSelectTab:()=>{},workspaceOptions:{leagueType:'dynasty'}});
assert.deepEqual(nodes(out).filter(n=>n.type==='button').map(text),['Home','My Team','League','More']);
console.log('PASS weekly waiver navigation, stream claims, projection sorting, unavailable data, and format/access boundaries');
if (process.env.WAIVER_PREVIEW) {
    ctx.isPro = true; ctx.skinFeatures = {};
    ctx.streamCandidates = [{ fa: {pid: 'preview', proj: 16.8, p: {full_name: 'Example Streaming Player', team: 'BUF'}}, pos: 'QB', delta: 3.2, rosPoints: 160.5, rosGain: -12.4, dropPid: 'bench', dropName: 'Example Bench Player' }];
    const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    function html(n) {
        if (typeof n !== 'object') return esc(n);
        if (n.type === 'fragment') return n.children.map(html).join('');
        const attrs = Object.entries(n.props).filter(([k,v]) => !k.startsWith('on') && k !== 'key' && k !== 'style' && v != null).map(([k,v]) => `${k === 'className' ? 'class' : k}="${esc(v)}"`).join(' ');
        const style = n.props.style ? ' style="'+Object.entries(n.props.style).map(([k,v])=>k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+':'+v).join(';')+'"' : '';
        return `<${n.type} ${attrs}${style}>${n.children.map(html).join('')}</${n.type}>`;
    }
    const dockOut = ctx.PhoneDockInner({activeTab:'fa',navItems,onSelectTab:()=>{},workspaceOptions:{leagueType:'redraft'}});
    fs.mkdirSync('output/playwright', {recursive:true});
    fs.writeFileSync('output/playwright/weekly-waivers.html', '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/league-workspaces.css"><link rel="stylesheet" href="/free-agency-market.css"><style>:root{--white:#eee;--silver:#aaa;--gold:#d4af37;--panel:#15151b;--ov-5:#333;--acc-line2:#665621}*{box-sizing:border-box}body{background:#111;color:#eee;font-family:Arial;margin:12px;padding-bottom:90px}h1{font-size:26px}.wr-phone-dock{position:fixed;bottom:0;left:0;right:0;background:#15151b}.wr-dock-chip{display:flex;flex-direction:column;align-items:center;background:transparent;color:#eee;border:0;min-height:64px}.wr-dock-chip.is-active{color:#d4af37}.wr-dock-strip{display:grid}</style><h1>Waivers</h1><p>Sample data · layout preview</p>'+html(ctx.renderWeeklyStreams())+html(dockOut));
}
