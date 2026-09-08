'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster','rules','draft-room','era-rules','types','season','helmet','engine','rivals','ai','actions','ui','gamecast']) require('../js/shared/time-league-' + name + '.js');
const { TimeLeagueEngine: E, TimeLeagueGamecast: G, TimeLeagueSeason: S } = App;
const disk = new Map(); let saveFails = false;
window.localStorage = { getItem: key => disk.get(key) || null, setItem: (key, value) => { if (saveFails) throw new Error('Disk full'); disk.set(key, value); }, removeItem: key => disk.delete(key) };
window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = () => {};
let current;
const same = (a,b) => a && b && a.length === b.length && a.every((value,i) => Object.is(value,b[i]));
function harness() { return { states: [], refs: [], memos: [], effects: [], pending: [], render(fn, runEffects = false) {
    current = this; this.si = this.ri = this.mi = this.ei = 0; this.pending = [];
    const tree = fn(); if (runEffects) this.pending.forEach(run => run()); return tree;
} }; }
global.React = {
    Fragment:'fragment', createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState:value=>{const ctx=current,i=ctx.si++;ctx.states[i]??={value:typeof value==='function'?value():value}; const slot=ctx.states[i];slot.set ||= next=>{slot.value=typeof next==='function'?next(slot.value):next;};return[slot.value,slot.set];},
    useRef:value=>{const ctx=current,i=ctx.ri++;return ctx.refs[i] ||= {current:value};},
    useMemo:(make,deps)=>{const ctx=current,i=ctx.mi++;if(!same(ctx.memos[i]?.deps,deps))ctx.memos[i]={value:make(),deps};return ctx.memos[i].value;},
    useCallback:(fn,deps)=>React.useMemo(()=>fn,deps),
    useEffect:(fn,deps)=>{const ctx=current,i=ctx.ei++;if(!same(ctx.effects[i]?.deps,deps)){const old=ctx.effects[i];ctx.effects[i]={deps};ctx.pending.push(()=>{old?.cleanup?.();ctx.effects[i].cleanup=fn();});}},
};
require('../js/components/time-league-week-gates.js');
require('../js/components/time-league-gamecast-panel.js');
require('../js/components/time-league-rivals-panel.js');
for(const name of ['Home','Team','Draft','Setup']) window['WrTimeLeague'+name+'Panel']=function Panel(){};
require('../js/tabs/time-league.js');
const all = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(all) : [value,...all(value.children)];
const words = node => !node ? '' : Array.isArray(node) ? node.map(words).join(' ') : typeof node === 'object' ? words(node.children) : String(node);
const button = (tree,label) => all(tree).find(node=>node.type==='button' && words(node)===label);
const component = (tree,type) => all(tree).find(node=>node.type===type);
const seed = E.createTimeLeague({ name:'Live matchup', seed:'head-to-head', createdAt:'2026-09-07T00:00:00Z', seats:[{name:'You',manager:'human'},{name:'Opponent',manager:'human'}], settings:{rosterSlots:{QB:1,RB:2,SUPER_FLEX:1,K:1,DEF:1,BN:1}, maxQuarterbacks:2, regularSeasonWeeks:12, playoffTeams:0, scoring:{passTd:4,reception:.5,rushRecYd:.1,passingYd:.04,turnover:-2}, eraRules:{mode:'any-era',decades:[]}} });
const slots=['QB','RB','RB','SUPER_FLEX','K','DEF','BN'];
const statLines=[{passYd:320,passTd:4},{rushYd:80,rushTd:1},null,{passInt:2},{extra:{xpm:4}},{extra:{sack:3}}, {rushYd:200,rushTd:4}];
const cards=new Map(), logs=new Map();
const teams=seed.teams.map((team,side)=>({...team,roster:slots.map((slot,i)=>{
    const position=slot==='SUPER_FLEX'?'QB':slot==='BN'?'RB':slot;
    const identity=`player:${side}:${i}`, entry={entryId:`e${side}${i}`,identity,name:`${side?'Rival':'Your'} ${slot} ${i}`,position,slot,drawnSeason:2000,acquiredWeek:0,acquiredVia:'draft'};
    cards.set(identity,{identity,name:entry.name,position,seasons:[{season:2000,games:16,points:200}]});
    if(statLines[i])logs.set(S.gameLogKey(identity,2000,1),{identity,season:2000,week:1,stats:{passYd:0,passTd:0,passInt:0,rushYd:0,rushTd:0,rec:0,recYd:0,recTd:0,fumblesLost:0,twoPointConversions:0,...statLines[i]}});
    return entry;
})}));
let league=E.normalizeTimeLeague({...seed,teams,phase:'season',weekStage:'claims',seasonsRevealed:true});
const root=harness(); root.states[1]={value:league};root.states[4]={value:'home'};root.states[6]={value:cards};root.states[7]={value:logs};
const rootTree=()=>root.render(()=>TimeLeague({onClose(){}}));
const dockProps=()=>component(rootTree(),WrTimeLeagueWeekGates).props;
function dock(props){const ctx=harness();return ctx.render(()=>WrTimeLeagueWeekGates(props));}
const gateButton=label=>button(dock(dockProps()),label);
(async()=>{
    let tree=rootTree();
    assert(component(tree,WrTimeLeagueGamecastPanel),'The gamecast stays mounted outside its tab');
    assert.equal(component(tree,WrTimeLeagueGamecastPanel).props.active,false);
    assert(!all(tree).some(node=>node.props.className==='tl-stage-gates tl-card'));
    gateButton('Review bids').props.onClick(); assert.equal(root.states[4].value,'waivers');
    await gateButton('Run waivers').props.onClick(); assert.equal(root.states[1].value.weekStage,'lineup'); assert.equal(root.states[4].value,'roster');
    const legal=root.states[1].value;
    root.states[1].value={...legal,teams:legal.teams.map((team,i)=>i?team:{...team,roster:team.roster.filter(entry=>entry.slot!=='QB')})};
    assert.equal(await gateButton('Lock lineup').props.onClick(),false);
    assert.equal(root.states[4].value,'roster','An invalid lineup stays on the screen that needs attention');
    root.states[1].value=legal; saveFails=true;
    assert.equal(await gateButton('Lock lineup').props.onClick(),false);
    assert.equal(root.states[1].value.weekStage,'lineup'); assert.equal(root.states[4].value,'roster','A failed save cannot advance the UI');
    saveFails=false; await button(rootTree(),'Retry save').props.onClick();
    assert.equal(root.states[4].value,'gameday','A successful retry routes to the next stage too');
    await gateButton('Start game day').props.onClick();
    assert.equal(root.states[1].value.weekStage,'postgame');
    assert.equal(root.states[1].value.finalizedWeeks.length,1);
    assert.equal(gateButton('Advance week'),undefined,'The saved final cannot expose advance before playback mounts');

    root.states[1].value = { ...root.states[1].value, teams: root.states[1].value.teams.map((team, i) => i ? { ...team, manager: 'ai', aiPersona: 'warlord' } : team) };
    assert.equal(component(rootTree(), WrTimeLeagueGamecastPanel).props.mailNotice, null, 'Saved results cannot announce an owner message before playback starts');
    assert(!all(rootTree()).some(node => node.props.className === 'tl-mail-trigger'), 'Unread badges cannot spoil the saved game either');
    const cast=harness();
    const play=()=>{const props=component(rootTree(),WrTimeLeagueGamecastPanel).props;return cast.render(()=>WrTimeLeagueGamecastPanel(props),true);};
    play(); tree=play();
    assert(gateButton('Pause'));assert(gateButton('Next quarter'));assert(!gateButton('Advance week'));
    assert.equal(await dockProps().onAction({type:'advance-week'}),false,'Stale callbacks cannot skip an unfinished game');
    const getLineups=()=>{const node=all(tree).find(node=>typeof node.type==='function'&&node.type.name==='LiveLineups');return node.type(node.props);};
    const points=()=>all(getLineups()).filter(node=>node.props.className?.includes('tl-live-player-points')).map(node=>words(node));
    assert(points().every(value=>value==='0.00'),'Final player totals stay hidden at kickoff');
    assert(!words(getLineups()).includes('320 passing yards'));
    assert(!words(getLineups()).includes('Your BN'),'Bench production does not count toward the matchup');
    const players=()=>all(getLineups()).filter(node=>node.props['data-entry-id']);
    for(let quarter=1;quarter<=4;quarter++){
        gateButton('Next quarter').props.onClick();tree=play();
        const landed=cast.states[0].value.timeline.events.filter(event=>event.t<=quarter*15);
        for(const player of players()){
            const cents=landed.filter(event=>event.entryId===player.props['data-entry-id']).reduce((sum,event)=>sum+Math.round(event.points*100),0);
            const visible=all(player).find(node=>node.props.className?.includes('tl-live-player-points'));
            assert.equal(Number(words(visible)),cents/100,'Each starter follows the same scoring moments as the team score');
        }
        if (quarter < 4) assert.equal(component(rootTree(), WrTimeLeagueGamecastPanel).props.mailNotice, null, 'Postgame correspondence stays hidden during every unfinished quarter');
        if(quarter===1){
            const oldClock=cast.states[1].value;
            dockProps().onNavigate('roster');tree=play();assert.equal(cast.states[2].value,false);
            assert(gateButton('Watch game'));gateButton('Watch game').props.onClick();tree=play();
            assert.equal(cast.states[1].value,oldClock,'Changing tabs cannot rewind the game');
        }
    }
    assert(points().includes('-4.00'),'Negative-scoring starters remain visible');
    assert(words(getLineups()).includes('No game recorded'),'Missing historical games are identified at final');
    assert(gateButton('Advance week'));assert(!gateButton('Next quarter'));
    const finals=root.states[1].value.finalizedWeeks[0];
    assert.equal(players().length,12,'Both complete starting lineups include zero-score players and superflex');

    tree = play();
    const notice = component(tree, WrTimeLeagueMailNotice);
    assert(notice, 'The final scoreboard surfaces its opponent message');
    assert(all(dock(dockProps())).some(node => node.props['aria-label'] === 'New message from Opponent. Read and reply'), 'The fixed bottom action row announces the sender even when the scoreboard is offscreen');
    const noticeTree = WrTimeLeagueMailNotice(notice.props);
    assert(words(noticeTree).includes('Opponent sent you a message'));
    assert(all(rootTree()).some(node => node.props.className === 'tl-mail-trigger'), 'The header shows unread mail outside the inbox');
    button(tree,'CLOSE GAMECAST').props.onClick();tree=play();tree=play();
    assert(component(tree, WrTimeLeagueMailNotice), 'The saved final also keeps unread correspondence visible');
    all(noticeTree).find(node => node.props['aria-label'] === 'Read message from Opponent').props.onClick();
    assert.equal(root.states[4].value, 'messages');
    const chat = harness();
    const renderChat = () => { const props = component(rootTree(), WrTimeLeagueRivalsPanel).props; return chat.render(() => WrTimeLeagueRivalsPanel(props), true); };
    renderChat(); const conversation = renderChat();
    assert(conversation.props.className.includes('has-thread'), 'A notification opens the sender conversation directly on mobile');
    assert(all(conversation).some(node => node.props['aria-label'] === 'Conversation with Opponent'));
    const read = TimeLeagueMail.readIds(league.leagueId, teams[0].teamId);
    assert(read.includes(`game:1:${teams[0].teamId}`), 'Opening the conversation persists its read receipt');
    component(rootTree(), WrTimeLeagueRivalsPanel).props.onNavigate('gameday');tree=play();
    assert.equal(component(rootTree(), WrTimeLeagueGamecastPanel).props.mailNotice, null, 'Read messages disappear from the final card');
    assert(!all(rootTree()).some(node => node.props.className === 'tl-mail-trigger'), 'Reading updates the global unread badge immediately');
    button(tree,'REPLAY').props.onClick();tree=play();
    root.states[1].value={...root.states[1].value,teams:teams.map(team=>({...team,roster:[]}))};
    tree=play();assert(words(getLineups()).includes('Your QB'),'Replays use saved starters even when current rosters changed');
    assert(points().every(value=>value==='0.00'),'A replay starts all player scores at zero again');
    button(tree,'INSTANT').props.onClick();tree=play();
    await gateButton('Advance week').props.onClick();tree=play();tree=play();
    assert.equal(root.states[4].value,'waivers');assert.equal(root.states[1].value.weekStage,'claims');
    assert.equal(cast.states[0].value,null,'Advancing clears the old replay so the next game shows its own lineup');
    assert.deepEqual(root.states[1].value.finalizedWeeks[0],finals,'Watching, pausing and advancing preserves the saved box score');

    const member={role:'member',seatTeamId:'t1'};
    let props={...dockProps(),league:{...root.states[1].value,weekStage:'claims',settings:{...league.settings,advancementMode:'majority'}},currentTab:'waivers',onlineMeta:member};
    let intent;props.onAction=action=>{intent=action;};
    button(dock(props),'Vote to advance').props.onClick();assert.equal(intent.type,'vote-advance');
    props.league={...props.league,gateVotes:['t1']};assert(button(dock(props),'Vote recorded').props.disabled);
    props.league={...props.league,settings:{...props.league.settings,advancementMode:'commissioner'}};
    assert(button(dock(props),'Waiting for commissioner').props.disabled,'Members cannot gain commissioner actions through the dock');
    console.log('PASS: live starter scoring, no final leaks, negative/missing games, saved replay lineups, tab continuity, routed gates, invalid/save failure recovery and multiplayer permissions.');
})().catch(error=>{console.error(error);process.exitCode=1;});
