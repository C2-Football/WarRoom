'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), Babel = require('@babel/standalone');
const { test } = require('node:test');
const source = fs.readFileSync('js/tabs/league-central.js', 'utf8');
function fixture() {
    const hooks = [], effects = [], events = [];
    let cursor = 0, week = 6;
    const React = { createElement: (type, props, ...children) => ({type, props: props || {}, children}),
        useState(initial) {const i=cursor++; if (!(i in hooks)) hooks[i]=initial; return [hooks[i],value=>hooks[i]=typeof value==='function'?value(hooks[i]):value];}, useEffect(fn){effects.push(fn);} };
    const window = { App: { LeagueLiveScores:{currentWeek:()=>week}, NFLByes:{weekForPlayer:p=>p.testBye}, NflContext:{} }, S:{nflState:{season:2026}}, dispatchEvent:event=>events.push(event) };
    const context = vm.createContext({window,React,console,document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}}, setInterval:()=>1,clearInterval(){}, CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}}});
    vm.runInContext(Babel.transform(source,{presets:['react']}).code,context);
    const league = {league_id:'l1',season:2026,roster_positions:['QB','WR','FLEX','BN','IR']};
    const players = {a:{full_name:'Healthy Starter',position:'QB',team:'KC'}, b:{full_name:'Bye Receiver',position:'WR',team:'BUF',testBye:6}, c:{full_name:'Listed Out',position:'RB',team:'NYJ',injury_status:'Out'}};
    const props={currentLeague:league,myRoster:{starters:['a','b','c']},playersData:players,setActiveTab:tab=>events.push(tab)};
    return {window,events,effects,hooks,props,setWeek:value=>week=value,read:extra=>window.buildLeagueOverviewDecision({league,roster:props.myRoster,playersData:players,week:6,now:Date.parse('2026-10-07T12:00:00Z'),...extra}),render(){cursor=0;effects.length=0;return window.LeagueOverviewDecisions(props);}};
}
const walk = node => node && typeof node==='object' ? [node,...(node.children||[]).flat(Infinity).flatMap(walk)] : [];
const text = node => node == null || typeof node==='boolean' ? '' : typeof node==='object' ? (node.children||[]).flat(Infinity).map(text).join('') : String(node);
const button=(tree,name)=>walk(tree).find(n=>n.type==='button'&&text(n)===name);

test('overview spots loaded empty, bye and unavailable starters without treating unknown players as unsigned',()=>{
    const h=fixture(); let read=h.read(); assert.deepEqual(Array.from(read.flags,f=>f.kind),['bye','out']);
    read=h.read({roster:{starters:['unknown','0']}}); assert.equal(read.flags.length,2); assert(read.flags.every(f=>f.kind==='empty'));
    read=h.read({roster:{players:['a']}}); assert.equal(read.known,false); assert.equal(read.flags.length,0);
    read=h.read({roster:{starters:['a','b','c']},week:7}); assert.deepEqual(Array.from(read.flags,f=>f.kind),['out']);
});

test('scheduled next kickoff requires a future timestamp and excludes postponed and cancelled games',()=>{
    const h=fixture(), game={home:'KC',away:'LV',state:'pre',kickoff:'2026-10-08T20:00:00Z'};
    const read=h.read({games:[{...game,statusName:'STATUS_POSTPONED',kickoff:'2026-10-08T10:00:00Z'}, {...game,kickoff:'2026-10-06T12:00:00Z'},game]});
    assert.equal(read.next.kickoff,game.kickoff); assert.equal(read.startersInNext,1);
    assert.equal(h.read({games:[{...game,statusName:'STATUS_CANCELED'}]}).next,null);
    assert.equal(h.read({games:[{...game,kickoff:'bad'}]}).next,null);
});

test('questionable is a monitoring flag and automatic lineup leagues get a clear roster action',()=>{
    const h=fixture(); const players={a:{full_name:'Questionable QB',team:'KC',injury_status:'Questionable'}};
    assert.equal(h.read({roster:{starters:['a']},playersData:players}).flags[0].kind,'monitor');
    h.props.leagueSkin={type:'best_ball'}; const tree=h.render(); assert.match(text(tree),/sets the scoring lineup automatically/);
    assert(!button(tree,'Open Game Day →')); button(tree,'Open roster →').props.onClick(); assert.equal(h.events[0],'myteam');
});

test('overview names one primary lineup move and keeps waivers and Alex within reach',()=>{
    const h=fixture(), tree=h.render();
    assert.match(text(tree),/Replace Bye Receiver/); assert.match(text(tree),/on bye this week/); assert.match(text(tree),/\+1 more lineup issue/);
    button(tree,'Open Game Day →').props.onClick(); button(tree,'Explore waivers').props.onClick(); button(tree,'Ask Alex').props.onClick();
    assert.equal(h.events[0],'lineup'); assert.equal(h.events[1],'fa'); assert.equal(h.events[2].type,'wr:mission-alex-open');
    assert.match(h.events[2].detail.prompt,/"week":6/); assert.match(h.events[2].detail.prompt,/"kind":"bye"/); assert.match(h.events[2].detail.prompt,/no move has been submitted/);
    assert.equal(walk(tree).some(n=>n.type==='details'),false);
});

test('missing lineup and schedule data never claim lineup readiness or an invented deadline',()=>{
    const h=fixture(); h.props.myRoster=null; let tree=h.render(); assert.match(text(tree),/Starter details have not loaded/);
    h.effects[0](); tree=h.render(); assert.match(text(tree),/Kickoff times unavailable/);
    assert.doesNotMatch(text(tree),/Wednesday|Thursday|ready to go|all set|waivers close/i);
});

test('schedule load uses current week and suppresses a late result after leaving the page',async()=>{
    const h=fixture(); let resolve, args;
    h.window.App.NflContext.loadScoreboard=(...a)=>{args=a;return new Promise(r=>resolve=r);};
    h.render(); const cleanup=h.effects[0](); assert.deepEqual(args,[6,2026,2]);
    cleanup(); resolve([{home:'KC',away:'LV',state:'pre',kickoff:'2026-10-08T20:00:00Z'}]); await Promise.resolve(); await Promise.resolve();
    assert.equal(h.hooks[0].key,'','Late schedule does not update an unmounted page');
});

test('the proactive section is rendered above full scoreboard and outside dashboard disclosure',()=>{
    const start=source.indexOf('if (overview && isPhone) return');
    const end=source.indexOf('\n    return (',start);
    const overview=source.slice(start,end);
    assert(overview.indexOf('mc-overview-summary')<overview.indexOf('<LeagueOverviewDecisions'));
    assert(overview.indexOf('<LeagueOverviewDecisions')<overview.indexOf('{renderScoreboard()}'));
    assert(!overview.includes('<details'));
});
