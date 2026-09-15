'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
let slots=[],index=0,viewport={isPhone:true,height:844,width:390,kbOpen:false};
const React={Fragment:'fragment',useState(init){const i=index++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]},useRef(v){const i=index++;return slots[i]||={current:v}},useMemo(fn){index++;return fn()},useCallback(fn){index++;return fn},useEffect(){},createElement(type,props,...children){return{type,props:props||{},children}}};
const boundary=function Boundary(){};
const root={App:{},DraftCC:{state:{gradeDraft:()=>({letter:'',totalDHQ:0})},styles:{panelCard:()=>({}),DRAFT_CC_LAYOUT:{GRID_GAP:12},bpBucket:()=> 'mobile',FONT_UI:'sans-serif',FONT_MONO:'monospace'},BigBoardPanel:boundary,LiveRoomPanel:boundary,LiveRoomPulse:boundary},WR:{useViewport:()=>viewport,Sheet:boundary,MobileSection:boundary},wrIsPro:()=>false};
const ctx={window:root,React,console,wrAlpha:c=>c,localStorage:{getItem(){return null}},setTimeout,clearTimeout};vm.createContext(ctx);
let source=fs.readFileSync('js/draft/command-center.js','utf8').replace('window.DraftCommandCenter = DraftCommandCenter;','window.__PhoneDraft = MobileFeed; window.__DraftGrid = CommandCenterGrid; window.DraftCommandCenter = DraftCommandCenter;');vm.runInContext(Babel.transform(source,{presets:['react']}).code,ctx);
const walk=n=>n==null||typeof n==='boolean'?[]:Array.isArray(n)?n.flatMap(walk):typeof n==='object'?[n,...walk(n.children)]:[n];const text=n=>walk(n).filter(x=>typeof x!=='object').join('');const find=(tree,pred)=>walk(tree).find(n=>typeof n==='object'&&pred(n));
const base={phase:'drafting',mode:'live-sync',draftMechanic:'snake',variant:'startup',userRosterId:1,userSlot:1,leagueSize:2,rounds:3,currentIdx:0,picks:[],pool:[],personas:{1:{teamName:'Owner with a long franchise name'},2:{teamName:'Other franchise'}},pickOrder:[{rosterId:1,overall:1,round:1,slot:1}],alex:{stream:[]},liveSync:{}};
let actions=[];function render(state=base){index=0;return root.__PhoneDraft({state,dispatch:a=>actions.push(a),currentSlot:state.pickOrder[0],isUserTurn:true})}
for(const mode of ['live-sync','manual','solo']){
 slots=[];let state={...base,mode};let tree=render(state);const select=find(tree,n=>n.type==='select');assert(select,'Inner views are selectable for '+mode);assert(text(select).includes('My roster'));assert.equal(text(select).includes('Teams'),mode==='live-sync','Team tracking remains live-only');
 assert.equal(find(tree,n=>n.props.className==='la-draft-pane').props.style.minHeight,0);
 select.props.onChange({target:{value:'board'}});tree=render(state);assert(find(tree,n=>n.type===boundary&&n.props.showPickAdvisory===true),'Board retains pick-advisory capabilities');
 assert.equal(actions.length,0,'Selecting views never makes a pick');
 viewport={isPhone:true,height:390,width:320,kbOpen:false};tree=render(state);assert.equal(find(tree,n=>n.props.className==='la-draft-pane').props.style.height,'auto','Short phone uses document scrolling');
 viewport={isPhone:true,height:600,width:390,kbOpen:true};tree=render(state);assert.equal(find(tree,n=>n.props.className==='la-draft-pane').props.style.overflowY,'visible','Keyboard never forces minimum-height pane');
 viewport={isPhone:true,height:844,width:390,kbOpen:false};
}
slots=[];const picks=Array.from({length:33},(_,i)=>({pid:'p'+i,name:'Player full name '+i,pos:'WR',dhq:100,overall:i+1,round:i+1,rosterId:1}));const recap={id:'r1',picks,totalDHQ:3300,grade:{letter:'B',totalDHQ:3300},teamRecaps:[]};index=0;let tree=root.DraftCC.DraftRecapReport({recap,inline:true,userRosterId:1});assert(text(tree).includes('Show 10 more picks'),'Long completed drafts have continuation');const showMore=find(tree,n=>n.type==='button'&&text(n)==='Show 10 more picks');showMore.props.onClick();index=0;tree=root.DraftCC.DraftRecapReport({recap,inline:true,userRosterId:1});assert(text(tree).includes('Player full name 19'));assert(!text(tree).includes('Player full name 20'),'Only selected continuation renders');

slots=[];viewport={isPhone:true,height:390,width:320,kbOpen:false};index=0;
const auctionTree=root.__DraftGrid({state:{...base,draftMechanic:'auction',variant:'auction',originalPool:[],teamBudgets:{},liveSync:{status:'ready'},draftedPids:new Set()},dispatch:a=>actions.push(a),viewport:'mobile',currentSlot:base.pickOrder[0],isUserTurn:false});
assert(find(auctionTree,n=>n.props['aria-label']==='Live auction'),'Live auctions keep the sales/budget mirror instead of simulated bidding');
assert(find(auctionTree,n=>n.type===boundary&&n.props.title==='Players & roster'),'Auction board and roster are disclosed together');
assert(find(auctionTree,n=>n.type===boundary&&n.props.title==='Draft log & analysis'),'Auction secondary analysis stays disclosed');
assert(!find(auctionTree,n=>n.props.style?.height==='clamp(420px, 50vh, 560px)'),'Short live auction removes the minimum420px panes');
assert.equal(actions.length,0,'Reading live auction never dispatches a bid or pick');
console.log('PASS phone draft snake/manual/solo selection, read-only live auction, short-height/keyboard panes and completed continuation');
