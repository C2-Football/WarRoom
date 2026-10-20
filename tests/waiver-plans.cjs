'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),babel=require('@babel/standalone');
const values=new Map();let user='alice',blocked=false,notebookWrites=0,event;
const window={App:{OD:{getCurrentUserId:()=>user}},S:{platform:'sleeper'},WR:{PlayerNotebook:{update:()=>{notebookWrites++;},contextFor:x=>x}},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>{if(blocked)throw Error('quota');values.set(key,value);}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},dispatchEvent:e=>event=e};
const ctx=vm.createContext({window,console});vm.runInContext(fs.readFileSync('js/shared/waiver-plans.js','utf8'),ctx);
const store=window.WR.WaiverPlans,league={league_id:'league-a',season:2026,settings:{waiver_budget:100}},leagueB={...league,league_id:'league-b'};
let saved=store.save(league,{pid:'add-a',dropPid:'drop-a',bid:14,position:'WR'});
assert(saved);assert.equal(event.type,'wr:waiver-plans-changed');assert.equal(store.get(league,'add-a').bid,14);
const originalId=saved.id,created=saved.createdAt;
saved=store.save(league,{pid:'add-a',dropPid:'drop-b',bid:9,position:'WR'});
assert.equal(saved.id,originalId);assert.equal(saved.createdAt,created);assert.equal(store.list(league).length,1);assert.equal(store.get(league,'add-a').dropPid,'drop-b');
store.save(league,{pid:'add-b',dropPid:null,bid:0});assert(store.move(league,originalId,1));assert.deepEqual(Array.from(store.list(league),p=>p.pid),['add-b','add-a']);
assert.equal(store.move(league,originalId,1),false);assert.equal(store.get(league,'add-b').bid,0,'A zero-dollar bid stays a real bid');
assert.equal(store.list(leagueB).length,0);assert.equal(store.list({...league,season:2027}).length,0);user='bob';assert.equal(store.list(league).length,0);user='alice';
vm.runInContext(fs.readFileSync('js/shared/waiver-plans.js','utf8'),ctx);assert.equal(window.WR.WaiverPlans.get(league,'add-a').bid,9,'Plan survives reloading the store');
assert.equal(store.save(league,{pid:'bad',bid:-2}),null);assert.equal(store.save(league,{pid:'bad',bid:2.5}),null);
blocked=true;assert.equal(store.save(league,{pid:'add-a',bid:20}),null);assert.equal(store.get(league,'add-a').bid,9,'Failed persistence retains last saved plan');blocked=false;
user=null;window.S={platform:'mfl',user:{user_id:'franchise-1'}};assert.equal(store.scope(league),null);assert.equal(store.save(league,{pid:'bad',bid:4}),null,'A league-local franchise is never an account scope');user='alice';window.S={platform:'sleeper'};
const source=fs.readFileSync('js/free-agency.js','utf8'),ast=babel.packages.parser.parse(source,{plugins:['jsx']});
function take(name){let out;babel.packages.traverse.default(ast,{FunctionDeclaration(p){if(p.node.id?.name===name)out=source.slice(p.node.start,p.node.end)}});assert(out);return out;}
const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(x=>x!=null&&x!==false)}),walk=n=>n&&typeof n==='object'?[n,...(n.children||[]).flatMap(walk)]:[],text=n=>n&&typeof n==='object'?(n.children||[]).map(text).join(''):String(n??''),button=(tree,label)=>walk(tree).find(n=>n.type==='button'&&text(n)===label);
Object.assign(ctx,{React:{createElement:h,Fragment:'fragment'},currentLeague:league,acquisitionLeagueId:'league-a',playersData:{'add-a':{full_name:'Target A'},'add-b':{full_name:'Target B'},'drop-a':{full_name:'Drop A'},'drop-b':{full_name:'Drop B'}},availablePlayers:[{pid:'add-a',pos:'WR',p:{position:'WR'},dhq:500},{pid:'add-b',pos:'RB',p:{position:'RB'},dhq:400}],myRoster:{players:['drop-a','drop-b'],settings:{waiver_budget_used:25}},hasFAAB:true,remaining:75,plannedBid:'',acquisitionContext:null,claimPlans:store.list(league),missionNotice:'',isPro:false,_faPhone:false,playerName:(p,id)=>p.full_name||id,normPos:x=>x,faabSuggest:()=>null,openFaPlayer(){},setFaFilter(){},setFaSection(){},setClaimPlanRevision(){},setPlannedBid:value=>ctx.plannedBid=value,setAcquisitionContext:value=>ctx.acquisitionContext=value,setMissionNotice:value=>ctx.missionNotice=value,renderSavedTargets:()=>h('aside',{},'Watchlist stays separate')});
vm.runInContext(babel.transform(take('waiverBidEvidence')+'\n'+take('renderAcquisitionPlan')+'\n'+take('renderMissionClaims'),{presets:['react']}).code,ctx);
let tree=ctx.renderMissionClaims();assert.match(text(tree),/Add Target A.*Drop Drop B.*\$9/s);
const targetRow=walk(tree).find(n=>n.props.className==='mc-claim-row'&&text(n).includes('Target A'));
button(targetRow,'Edit plan').props.onClick();assert.equal(ctx.plannedBid,'9');assert.equal(ctx.acquisitionContext.dropPid,'drop-b');
ctx.plannedBid='12';tree=ctx.renderAcquisitionPlan();button(tree,'Update claim plan').props.onClick();assert.equal(store.get(league,'add-a').bid,12);assert.equal(store.list(league).length,2);assert.equal(notebookWrites,0,'Editing a plan does not append duplicate notebook prose or modify watches');
ctx.plannedBid='80';tree=ctx.renderAcquisitionPlan();button(tree,'Update claim plan').props.onClick();assert.match(ctx.missionNotice,/remaining budget/);assert.equal(store.get(league,'add-a').bid,12);
ctx.claimPlans=store.list(league);tree=ctx.renderMissionClaims();const row=walk(tree).find(n=>n.props.className==='mc-claim-row'&&text(n).includes('Target A'));button(row,'Remove').props.onClick();assert.equal(store.get(league,'add-a'),null);assert.equal(ctx.acquisitionContext,null);
// The real acquisition event effect hydrates saved bid/drop, even when the incoming
// recommendation suggests a different drop. It does not erase edits on tab changes.
store.save(league,{pid:'add-a',dropPid:'drop-b',bid:17});
let receive;Object.assign(ctx,{useEffect:fn=>fn(),claimScope:store.scope(league),initialView:null,setFaSearch(){},setRookieOnly(){},setRookieTeamFilter(){},setRookieCollegeFilter(){},setRookieSlotFilter(){}});
window.acquisitionContext={pid:'add-a',dropPid:'drop-a',leagueId:'league-a'};window.WR.acquisitionContext=window.acquisitionContext;window.addEventListener=(name,fn)=>{if(name==='wr:acquisition-context')receive=fn;};window.removeEventListener=()=>{};
let hook;babel.packages.traverse.default(ast,{CallExpression(p){if(p.node.callee.name==='useEffect'&&source.slice(p.node.start,p.node.end).includes("window.addEventListener('wr:acquisition-context'"))hook=source.slice(p.node.start,p.node.end)}});vm.runInContext(hook,ctx);assert.equal(ctx.plannedBid,'17');assert.equal(ctx.acquisitionContext.dropPid,'drop-b');assert(receive);
// Phone planning keeps its budget and primary save above optional bid history.
Object.assign(ctx,{_faPhone:true,isPro:true,FaabCommandCard:()=>null});
tree=ctx.renderAcquisitionPlan();
const planNodes=walk(tree),save=button(tree,'Update claim plan'),evidence=planNodes.find(n=>n.props.className==='mc-claim-bid-evidence');
assert(save);assert(evidence && evidence.type==='details' && !evidence.props.open);
assert(planNodes.indexOf(save)<planNodes.indexOf(evidence),'Saving a local claim does not require scrolling through bid history');
assert.match(text(tree),/\$75 remaining/,'Budget stays visible before the save action');
for(const invalidSpent of [undefined,null,'','   ','invalid',-1,Infinity]) {
    ctx.myRoster={...ctx.myRoster,settings:{waiver_budget_used:invalidSpent}};tree=ctx.renderAcquisitionPlan();
    assert.match(text(tree),/Remaining budget unavailable/);assert.equal(walk(tree).find(n=>n.type==='input'&&n.props.type==='number').props.max,undefined,'Unknown spending cannot set a fabricated bid maximum');
    assert.match(text(ctx.renderMissionClaims()),/Budget unknown/,'The claim header uses the same unknown balance as its editor');
}
for(const invalidBudget of [undefined,null,'','   ','invalid',-1,Infinity]) {
    ctx.currentLeague={...league,settings:{waiver_budget:invalidBudget}};ctx.myRoster={...ctx.myRoster,settings:{waiver_budget_used:25}};tree=ctx.renderAcquisitionPlan();
    assert.match(text(tree),/Remaining budget unavailable/);assert.equal(walk(tree).find(n=>n.type==='input'&&n.props.type==='number').props.max,undefined);
    assert.match(text(ctx.renderMissionClaims()),/Budget unknown/);
}
ctx.currentLeague=league;ctx.myRoster={...ctx.myRoster,settings:{waiver_budget_used:'   '}};ctx.plannedBid='80';blocked=true;
button(ctx.renderAcquisitionPlan(),'Update claim plan').props.onClick();assert.match(ctx.missionNotice,/Could not save/,'Unknown balance does not reject a local plan using an invented full-budget limit');blocked=false;
ctx.myRoster={...ctx.myRoster,settings:{waiver_budget_used:100}};tree=ctx.renderAcquisitionPlan();
assert.match(text(tree),/\$0 remaining/);assert.equal(walk(tree).find(n=>n.type==='input'&&n.props.type==='number').props.max,0,'A real zero balance remains an enforceable maximum');
ctx.myRoster={...ctx.myRoster,settings:{waiver_budget_used:25}};ctx.plannedBid='17';ctx.missionNotice='';
// On a phone the editor is one focused task. Only a confirmed local write
// returns to saved priorities; validation and storage failures retain edits.
ctx.claimPlans=store.list(league);tree=ctx.renderMissionClaims();
assert(!walk(tree).some(n=>n.props.className==='mc-claim-list'),'Saved priorities stay out of the active phone editor');
const editingContext=ctx.acquisitionContext;
window.WR.acquisitionContext=editingContext;
ctx.plannedBid='80';button(ctx.renderAcquisitionPlan(),'Update claim plan').props.onClick();
assert.equal(ctx.acquisitionContext,editingContext);assert.equal(ctx.plannedBid,'80');assert.match(ctx.missionNotice,/remaining budget/);
window._playerTags={'drop-b':'untouchable'};ctx.plannedBid='21';button(ctx.renderAcquisitionPlan(),'Update claim plan').props.onClick();
assert.equal(ctx.acquisitionContext,editingContext);assert.equal(ctx.plannedBid,'21');assert.match(ctx.missionNotice,/Untouchable/);
window._playerTags={};blocked=true;button(ctx.renderAcquisitionPlan(),'Update claim plan').props.onClick();
assert.equal(ctx.acquisitionContext,editingContext);assert.equal(window.WR.acquisitionContext,editingContext);assert.equal(ctx.plannedBid,'21');assert.match(ctx.missionNotice,/Could not save/);assert.equal(store.get(league,'add-a').bid,17);
blocked=false;button(ctx.renderAcquisitionPlan(),'Update claim plan').props.onClick();
assert.equal(store.get(league,'add-a').bid,21);assert.equal(ctx.acquisitionContext,null);assert.equal(window.WR.acquisitionContext,null);assert.equal(ctx.plannedBid,'');
ctx.claimPlans=store.list(league);tree=ctx.renderMissionClaims();
assert.match(text(tree),/Claim plans/);assert.match(text(tree),/Target A.*\$21/s);assert.match(text(tree),/saved.*(?:platform|submit)|(?:platform|submit).*saved/i,'A successful phone save retains the local-only next step');
assert(walk(tree).some(n=>n.props.className==='mc-claim-list'),'Successful saves return to the saved priority list');
const phoneSavedRow=walk(tree).find(n=>n.props.className==='mc-claim-row'&&text(n).includes('Target A'));
const orderMenu=walk(phoneSavedRow).find(n=>n.type==='details'&&text(n).includes('Order & remove'));
assert(orderMenu && !orderMenu.props.open,'Ordering and removal are optional controls');
ctx.claimPlans=[{id:'review',pid:'add-a',dropPid:'former-player',bid:80}];tree=ctx.renderMissionClaims();
let reviewAlerts=walk(tree).filter(n=>n.props.role==='alert');
assert.equal(reviewAlerts.length,1,'Several stale-plan issues share one compact review alert');assert.match(text(reviewAlerts[0]),/Drop no longer owned.*Bid exceeds \$75 remaining/);assert.equal(store.get(league,'add-a').bid,21,'Review warnings never rewrite a saved bid or drop');
window._playerTags={'drop-b':'untouchable'};ctx.claimPlans=[{id:'protected',pid:'add-a',dropPid:'drop-b',bid:null}];tree=ctx.renderMissionClaims();assert.match(text(walk(tree).find(n=>n.props.role==='alert')),/Drop marked Untouchable/);window._playerTags={};
ctx.claimPlans=store.list(league);ctx.acquisitionContext={pid:'missing',dropPid:'drop-b',position:'WR'};tree=ctx.renderAcquisitionPlan();
assert(!walk(tree).some(n=>n.props.className==='mc-claim-editor-fields'),'A targetless phone plan shows the player choice before drop or bid fields');assert(button(tree,'Choose player from Market'));assert.equal(ctx.acquisitionContext.dropPid,'drop-b','Choosing a target later can retain the original drop intent');
ctx._faPhone=false;tree=ctx.renderAcquisitionPlan();assert(walk(tree).some(n=>n.props.className==='mc-claim-editor-fields'),'Desktop targetless planning keeps its existing controls');ctx._faPhone=true;ctx.acquisitionContext=null;
button(phoneSavedRow,'Edit plan').props.onClick();
ctx.hasFAAB=false;tree=ctx.renderAcquisitionPlan();
assert(!walk(tree).some(n=>n.props.className==='mc-claim-bid-evidence'),'Priority leagues do not show an empty bid-history disclosure');
ctx.hasFAAB=true;
// Empty phone watchlists lead to the primary Stats hub, rather than an omitted
// mobile Players & picks destination.
Object.assign(ctx,{_faPhone:true,notebookRevision:0});window.WR.PlayerNotebook.list=()=>[];window.wrNavigateTab=tab=>ctx.navigatedTab=tab;
vm.runInContext(babel.transform(take('renderSavedTargets'),{presets:['react']}).code,ctx);
tree=ctx.renderSavedTargets();button(tree,'Browse Stats hub').props.onClick();assert.equal(ctx.navigatedTab,'stats');
const NotebookEditor=()=>null;Object.assign(ctx,{skinFeatures:{},isDraftProspect:()=>false});window.WR.PlayerNotebook.NotebookEditor=NotebookEditor;window.WR.PlayerNotebook.list=()=>[{pid:'add-a'},{pid:'add-b'}];window.WR.PlayerNotebook.resolveAction=()=>({kind:'watch'});
tree=ctx.renderSavedTargets();const playerNotes=walk(tree).filter(n=>n.type==='details'&&n.props.className==='mc-claim-player-notes');
assert.equal(playerNotes.length,2);assert(playerNotes.every(n=>!n.props.open&&walk(n).some(child=>child.type===NotebookEditor)),'Phone watchlists keep each notebook inside its own collapsed Notes disclosure');
ctx._faPhone=false;tree=ctx.renderSavedTargets();assert(!walk(tree).some(n=>n.type==='details'&&n.props.className==='mc-claim-player-notes'));assert.equal(walk(tree).filter(n=>n.type===NotebookEditor).length,2,'Desktop watchlists keep the existing inline notebook editors');
console.log('PASS local waiver plans: account/league/season isolation, reload, edit without duplicate notes, zero/unset bids, priority order, remove, failed-storage retention and acquisition hydration');
