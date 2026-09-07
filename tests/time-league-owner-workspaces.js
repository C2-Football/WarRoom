'use strict';
const assert = require('node:assert/strict');
global.window = globalThis;
global.App = {};
for (const name of ['roster','rules','draft-room','era-rules','types','season','helmet','engine','rivals','ai','actions','ui']) require('../js/shared/time-league-' + name + '.js');
const E = App.TimeLeagueEngine;
const disk = new Map();
global.localStorage = { getItem: key => disk.get(key) || null, setItem: (key,value) => disk.set(key,value) };
let states = [], refs = [], cursor = 0, refCursor = 0;
global.React = {
    createElement: (type,props,...children) => ({type,props:props||{},children}), Fragment:'fragment',
    useState: value => { const i=cursor++; if (!(i in states)) states[i]=typeof value==='function'?value():value; return [states[i],next=>{ states[i]=typeof next==='function'?next(states[i]):next; }]; },
    useRef: value => { const i=refCursor++; refs[i] ||= {current:value}; return refs[i]; },
    useMemo: fn=>fn(), useCallback:fn=>fn, useEffect:()=>{},
};
window.requestAnimationFrame=()=>{};
for(const name of ['TeamPanel','RivalsPanel','WeekGates','HomePanel']) window['WrTimeLeague'+name]=function Panel(){};
require('../js/tabs/time-league.js');
const nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.children)];
const render=()=>{cursor=0;refCursor=0;return TimeLeague({onClose(){}});};
const component=(tree,name)=>nodes(tree).find(node=>node.type===window['WrTimeLeague'+name]);
const fixture=seed=>({...E.createTimeLeague({seed,name:seed,createdAt:'2026-09-07T12:00:00Z',seats:[{name:'You',manager:'human'},{name:'Kade',manager:'ai',aiPersona:'warlord'},{name:'Friend',manager:'human'}],settings:{rosterSlots:{QB:1,BN:1},regularSeasonWeeks:12,maxQuarterbacks:2,scoring:{passTd:4,reception:0.5,rushRecYd:0.1,passingYd:0.04,turnover:-2}}}),phase:'season',weekStage:'lineup',seasonsRevealed:true});
(async()=>{
    states[1]=fixture('Owner workspaces');states[4]='roster';states[5]='t2';states[6]=new Map([['x',{}]]);
    let tree=render();
    assert.equal(component(tree,'TeamPanel').props.activeTeamId,'t1','Old rival selection cannot replace My Roster');
    assert.equal(component(tree,'WeekGates').props.compact,true);
    assert.equal(component(tree,'RivalsPanel'),undefined,'Full owner mail does not repeat above the roster');
    component(tree,'TeamPanel').props.onBrowseWaivers('SUPER_FLEX');
    tree=render();
    assert.equal(component(tree,'TeamPanel').props.section,'waivers');
    assert.equal(component(tree,'TeamPanel').props.waiverSlot,'SUPER_FLEX');
    states[4]='messages';tree=render();
    assert(!component(tree,'WeekGates'),'Chat does not repeat weekly admin');
    const fieldset=nodes(tree).find(node=>node.type==='fieldset');
    assert(!component(fieldset,'RivalsPanel'),'Chat composer remains outside the game-write disabled fieldset');
    const panel=component(tree,'RivalsPanel').props;
    assert.equal(panel.teamId,'t1');
    assert.equal(await panel.onSend({toTeamId:'t2',text:'See you on Sunday!',tone:'competitive',messageId:'owner_message_001'}),true);
    assert.equal(states[1].rivalMessages.length,2,'Typed send and AI reply persisted through the root normalizer');
    assert.equal(states[1].rivalMessages[0].fromTeamId,'t1');
    assert.equal(states[1].rivalRelationships[0].heat,2);
    assert(JSON.parse(disk.get(App.TimeLeagueTypes.timeLeagueStorageKey(states[1].leagueId))).rivalMessages.length===2);
    await panel.onSend({toTeamId:'t2',text:'See you on Sunday!',tone:'competitive',messageId:'owner_message_001'});
    assert.equal(states[1].rivalMessages.length,2,'Retry does not duplicate the exchange');
    const updated=component(render(),'RivalsPanel').props;
    await updated.onSend({teamId:'t2',fromTeamId:'t2',toTeamId:'t3',text:'Want to talk trades?',tone:'friendly',messageId:'owner_message_002'});
    assert.equal(states[1].rivalMessages.at(-1).fromTeamId,'t1','Spoofed payload sender is overridden by the active human seat');
    assert.equal(states[1].rivalMessages.length,3,'Human recipient does not generate a fake reply');
    states[5]='t3';
    const friendPanel=component(render(),'RivalsPanel').props;
    assert.equal(friendPanel.teamId,'t3','Local hotseat follows the selected human manager');
    assert(App.TimeLeagueRivals.messagesFor(states[1],'t3').some(message=>message.text==='Want to talk trades?'));
    assert(!App.TimeLeagueRivals.messagesFor(states[1],'t3').some(message=>message.text==='See you on Sunday!'));
    states[4]='home';
    assert.equal(component(render(),'HomePanel').props.seatTeamId,'t3','Home follows the same human manager as roster and chat');
    states[1]=fixture('Different league');states[4]='waivers';
    assert.equal(component(render(),'TeamPanel').props.waiverSlot,null,'A targeted add from another league does not leak its filter');
    console.log('PASS: own-roster isolation, eligible waiver navigation, focused chat, durable replies, idempotent retry and human sender boundaries.');
})().catch(error=>{console.error(error);process.exitCode=1;});
