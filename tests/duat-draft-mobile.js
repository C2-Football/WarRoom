'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const raw=fs.readFileSync('js/components/duat-presentation.js','utf8');
const source=Babel.transform(raw.slice(raw.indexOf('    function Draft('),raw.indexOf('    function DynastyArchaeology('))+'\nwindow.Draft=Draft;',{presets:['react']}).code;
const candidates=Array.from({length:45},(_,i)=>({id:'p'+i,name:'Player '+i,position:'RB',referenceSeason:2024,estimatedPoints:i-2}));
const campaign={version:4,dynastySeason:1,seasons:[2025],factions:[{id:'egypt',armies:[{id:'a1',season:2025,rulerName:'Djoser',players:[]}]}],draft:{status:'active',cursor:0,totalPicks:64,picks:[],queue:[{factionId:'egypt'}]}};
const Engine={draftTurn:()=>({factionId:'egypt',round:1,season:2025}),draftCandidates:()=>candidates,rosterSize:()=>8,settingsOf:()=>({conquest:false,bench:3}),slotsOf:()=>['QB','FLEX','FLEX','FLEX','FLEX']};
const nodes=n=>Array.isArray(n)?n.flatMap(nodes):n&&typeof n==='object'?[n,...nodes(n.children)]:[];
const text=n=>JSON.stringify(n);
function harness(phone){let cells=[],cursor=0;const calls=[];
 const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
 const useState=initial=>{const i=cursor++;if(!(i in cells))cells[i]=initial;return [cells[i],v=>cells[i]=typeof v==='function'?v(cells[i]):v];};
 const window={WR:{useViewport:()=>({isPhone:phone})}};
 vm.runInNewContext(source,{window,React,useState,useMemo:f=>f(),useEffect(){},Engine,art:()=>'',nameOf:id=>id,Sigil:()=>null,number:n=>String(n)});
 const render=extra=>{cursor=0;return window.Draft({campaign,factionId:'egypt',data:{},online:false,host:true,canAdvance:true,busy:false,onAction:a=>calls.push(a),...extra});};
 return {render,calls};
}
for(const [phone,pageSize] of [[true,20],[false,40]]){
 const h=harness(phone),before=JSON.stringify(campaign);let tree=h.render();
 const rows=()=>nodes(tree).filter(n=>n.props.className==='duat-draft-player');
 assert.equal(rows().length,pageSize);
 if(phone){const details=nodes(tree).filter(n=>n.type==='details');assert(details.some(n=>n.props.className?.includes('duat-draft-overview')));assert(details.some(n=>n.props.className?.includes('duat-draft-army-details')));assert(details.every(n=>!n.props.open));}
 const more=()=>nodes(tree).find(n=>n.type==='button'&&text(n.children).includes('more players'));
 while(more()){more().props.onClick();tree=h.render();}
 assert.equal(rows().length,45,'Every remaining candidate is reachable');
 assert(text(tree).includes('Est. PPG')&&text(tree).includes('-2'),'References remain labeled and signed');
 const pick=nodes(tree).find(n=>n.props['aria-label']==='Draft Player 0');pick.props.onClick();assert.equal(h.calls[0].type,'draft-pick');assert.equal(h.calls[0].playerId,'p0');
 const waiting=h.render({campaign:{...campaign,draft:{...campaign.draft,status:'waiting'}},online:true,host:false,canAdvance:false});
 assert(nodes(waiting).find(n=>n.type==='button'&&text(n.children).includes('Open the draft')).props.disabled);
 assert.equal(JSON.stringify(campaign),before,'Reading details and choosing a UI action cannot rewrite the supplied campaign');
}
console.log('PASS: Duat phone draft disclosures, 20/40 row defaults, complete pagination, labeled estimates and guest opening guard');
