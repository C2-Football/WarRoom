'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster','rules','draft-room','era-rules','types','season','helmet','engine','ai','actions','ui']) require('../js/shared/time-league-' + name + '.js');
window.requestAnimationFrame = () => 1;
let ctx;
function harness() { return { states:[], refs:[], render(fn) { ctx=this; this.si=this.ri=0; return fn(); } }; }
window.React = {
    Fragment:'fragment', createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState:initial=>{const owner=ctx,i=owner.si++; if(!(i in owner.states))owner.states[i]=typeof initial==='function'?initial():initial;return[owner.states[i],next=>{owner.states[i]=typeof next==='function'?next(owner.states[i]):next;}];},
    useRef:initial=>{const owner=ctx,i=owner.ri++;return owner.refs[i] ||= {current:initial};},
    useMemo:fn=>fn(), useCallback:fn=>fn, useEffect:()=>{},
};
require('../js/tabs/time-league.js');
const all = value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(all):[value,...all(value.children)];
const text = value=>value==null||typeof value==='boolean'?'':Array.isArray(value)?value.map(text).join(' '):typeof value==='object'?text(value.children):String(value);
const button=(tree,label)=>all(tree).find(node=>node.type==='button'&&text(node)===label);
const named=(tree,label)=>all(tree).find(node=>node.props['aria-label']===label);
const fixture=App.TimeLeagueEngine.createTimeLeague({name:'Friday Vault',seed:'invitations',createdAt:'2026-09-07T00:00:00Z',seats:[{name:'Host',manager:'human'},{name:'Open Owls',manager:'human'},{name:'Open Bears',manager:'human'}],settings:{rosterSlots:{QB:1},regularSeasonWeeks:12,scoring:{passTd:4,reception:.5,rushRecYd:.1,passingYd:.04,turnover:-2}}});
const meta={rowId:'test-room',seatTeamId:'t1',role:'commissioner',draftStarted:false,members:[{id:'m1',seat_team_id:'t1',role:'commissioner',joined:true,invite_code:'claimed-secret'},{id:'m2',seat_team_id:'t2',role:'member',joined:false,invite_code:'owl-code&/+?'},{id:'m3',seat_team_id:'t3',role:'member',joined:false,invite_code:'bear-code'}]};
let clipboard=[],shares=[],copyError=false,shareError=null;
Object.defineProperty(global,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>{if(copyError)throw new Error('Clipboard denied');clipboard.push(value);}},share:async value=>{if(shareError)throw shareError;shares.push(value);}}});
window.location={href:'https://c2-football.github.io/WarRoom-sandbox/index.html?mode=vault#old-league'};
const root=harness();root.states[1]=fixture;root.states[4]='draft';root.states[11]=meta;
const drawRoot=()=>root.render(()=>TimeLeague({onClose(){}}));
let tree=drawRoot();
const header=all(tree).find(node=>node.type==='header');assert(button(header,'Invite'),'The commissioner has a visible header invite action');
const roomNode=all(tree).find(node=>node.type?.name==='FriendsRoom');assert(roomNode,'Creating a friends room opens invitations immediately');
const Room=roomNode.type, room=harness();let action;
let props={...roomNode.props,onAction:input=>{action=input;return true;}};
const draw=()=>room.render(()=>Room(props));
(async()=>{
    tree=draw();assert.equal(named(tree,'Share invite for Host'),undefined,'Claimed seats cannot share a code even if a stale payload includes one');
    assert(button(tree,'Open draft room').props.disabled);
    assert(!all(tree).find(node=>node.props.className==='tl-friends-team-editor').props.open,'Helmet customization starts collapsed');
    await named(tree,'Copy invite for Open Owls').props.onClick();tree=draw();
    let url=new URL(clipboard.at(-1));assert.equal(url.pathname,'/WarRoom-sandbox/index.html');assert.equal(url.searchParams.get('tl_invite'),'owl-code&/+?');assert.equal(url.hash,'');assert.equal([...url.searchParams].length,1);
    assert(text(tree).includes('Invite copied'));assert(button(tree,'Copied'));
    await named(tree,'Share invite for Open Bears').props.onClick();
    assert.equal(shares.length,1);assert.equal(shares[0].title,'Join Friday Vault');assert.equal(new URL(shares[0].url).searchParams.get('tl_invite'),'bear-code','Sharing targets the selected seat');
    const copiesBefore=clipboard.length;shareError={name:'AbortError'};
    await named(tree,'Share invite for Open Owls').props.onClick();assert.equal(clipboard.length,copiesBefore,'Cancelling the native share sheet does not copy or send anything');
    shareError=new Error('Share unavailable');await named(tree,'Share invite for Open Bears').props.onClick();assert.equal(clipboard.length,copiesBefore+1,'A failed share falls back to copying the invite');
    shareError=null;copyError=true;tree=draw();await named(tree,'Copy invite for Open Owls').props.onClick();tree=draw();
    const manual=all(tree).find(node=>node.type==='details'&&node.props.open&&named(node,'Invite link for Open Owls'));
    assert(manual,'Clipboard failures expose a selectable link');
    let selected=false;named(manual,'Invite link for Open Owls').props.onFocus({target:{select:()=>{selected=true;}}});assert(selected);
    copyError=false;
    for(const href of ['file:///Users/test/warroom/index.html','http://localhost:3001/index.html','capacitor://localhost/index.html','https://localhost/index.html','http://192.168.1.9:3001/index.html']){
        window.location={href};tree=draw();await named(tree,'Copy invite for Open Bears').props.onClick();url=new URL(clipboard.at(-1));assert.equal(url.origin,'https://c2-football.github.io');assert.equal(url.pathname,'/WarRoom/index.html','Local/native invitations use the public app, never a device-only address');
    }
    window.location={href:'https://example.org/vault/index.html?foo=bar'};tree=draw();await named(tree,'Copy invite for Open Bears').props.onClick();assert.equal(new URL(clipboard.at(-1)).origin,'https://example.org','Hosted apps keep their own public domain');
    navigator.share=undefined;tree=draw();assert(!named(tree,'Share invite for Open Owls'));assert(named(tree,'Copy invite for Open Owls'),'Desktop copying does not depend on the share API');
    props={...props,meta:{...meta,role:'member',seatTeamId:'t2'}};tree=draw();assert(!named(tree,'Copy invite for Open Bears'));assert(!text(tree).includes('bear-code'));assert(!button(tree,'Open draft room'));
    props={...props,meta:{...meta,members:meta.members.map(member=>({...member,joined:true}))}};tree=draw();assert(!button(tree,'Open draft room').props.disabled);button(tree,'Open draft room').props.onClick();assert.equal(action.type,'start');assert(text(tree).includes('Everyone is here'));
    props={...props,meta:{...meta,draftStarted:true}};tree=draw();assert(!named(tree,'Copy invite for Open Bears'));assert(text(tree).includes('seats are locked'));
    root.states[11]={...meta,draftStarted:true};tree=drawRoot();assert(!all(tree).some(node=>node.type===Room));button(all(tree).find(node=>node.type==='header'),'Invite').props.onClick();tree=drawRoot();assert(all(tree).some(node=>node.type===Room),'Header invitations remain accessible after returning to an existing league');
    root.states[11]={...meta,role:'member',draftStarted:true};tree=drawRoot();assert(button(all(tree).find(node=>node.type==='header'),'Managers'));assert(!button(all(tree).find(node=>node.type==='header'),'Invite'));
    root.states[11]=null;tree=drawRoot();assert(!button(all(tree).find(node=>node.type==='header'),'Invite'),'Device-only solo games do not pretend to have shareable seats');
    console.log('PASS: visible multiplayer invites, seat-specific share/copy, sandbox/public/native links, cancellation and clipboard fallback, joined/locked seat guards and commissioner access.');
})().catch(error=>{console.error(error);process.exitCode=1;});
