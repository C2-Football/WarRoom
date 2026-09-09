'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const MapView=require('../js/duat/map.js'),World=require('../js/duat/world.js'),Provinces=require('../js/duat/provinces.js');
const Conquest=require('../js/duat/conquest.js'),Rules=require('../js/duat/rules.js');
const point=(id,x,y)=>({id,x:x/1000,y:y/500,clientX:x,clientY:y});
test('pinch zoom preserves the land under the moving midpoint and remains bounded',()=>{
    const initial={x:200,y:100,w:500,h:250};
    let gesture=MapView.gestureStart(null,point(1,400,250),initial,'land');
    gesture=MapView.gestureStart(gesture,point(2,600,250),initial,'other-land');
    let move=MapView.gestureMove(gesture,point(1,300,300));
    move=MapView.gestureMove(move.gesture,point(2,700,300));
    assert.equal(move.view.w,250);
    assert.equal(move.view.x+.5*move.view.w,initial.x+.5*initial.w);
    assert.equal(move.view.y+.6*move.view.h,initial.y+.5*initial.h);
    assert.equal(MapView.gestureEnd(move.gesture,1,move.view).selectedId,'');
    const limited=MapView.zoomAt(initial,.00001,{x:.5,y:.5},60);
    assert.equal(limited.w,60);assert.equal(limited.h,30);
    assert.deepEqual(MapView.zoomAt(initial,100,{x:.5,y:.5}),MapView.WORLD_VIEW);
});
test('drag never selects land; taps select once; cancellation and pinch lift cannot select',()=>{
    const initial={x:200,y:100,w:500,h:250};
    const start=MapView.gestureStart(null,point(1,400,250),initial,'province-a');
    const tap=MapView.gestureEnd(start,1,initial);assert.equal(tap.selectedId,'province-a');assert.equal(tap.gesture,null);
    const move=MapView.gestureMove(start,point(1,600,350));
    assert.deepEqual(move.view,{x:100,y:50,w:500,h:250});
    assert.equal(MapView.gestureEnd(move.gesture,1,move.view).selectedId,'');
    assert.equal(MapView.gestureEnd(start,1,initial,true).selectedId,'');
    const two=MapView.gestureStart(start,point(2,600,250),initial,'province-b');
    const one=MapView.gestureEnd(two,2,initial);assert.equal(one.selectedId,'');
    assert.equal(MapView.gestureEnd(one.gesture,1,initial).selectedId,'');
    assert.deepEqual(MapView.moveView(initial,-100,100),{x:0,y:250,w:500,h:250});
});
test('wheel and touch anchors account for a phone SVG letterbox',()=>{
    const rect={left:10,top:20,width:360,height:240};
    const anchor=MapView.pointInMap(100,140,rect);
    assert.equal(anchor.x,.25);assert.equal(anchor.y,.5);
    const before={x:200,y:100,w:500,h:250},after=MapView.zoomAt(before,.5,anchor);
    assert.equal(before.x+before.w*anchor.x,after.x+after.w*anchor.x);
    assert.equal(before.y+before.h*anchor.y,after.y+after.h*anchor.y);
});
test('country overview includes every saved province, including islands absent from country geometry',()=>{
    const owners=Object.fromEntries(Provinces.TERRITORIES.map((t,i)=>[t.id,i%11===0?'egypt':i%13===0?'rome':null]));
    const before=JSON.stringify(owners),groups=MapView.countryOverview(Provinces,World,owners,'egypt');
    const members=groups.flatMap(g=>g.members.map(t=>t.id));
    assert.equal(members.length,4594);assert.equal(new Set(members).size,4594);
    assert.ok(groups.length<300);assert.equal(groups.filter(g=>g.path).length,175);
    assert.equal(groups.reduce((n,g)=>n+g.mine,0),Object.values(owners).filter(id=>id==='egypt').length);
    assert.equal(groups.reduce((n,g)=>n+g.areaKm2,0),Provinces.TERRITORIES.reduce((n,t)=>n+t.areaKm2,0));
    assert.ok(groups.some(g=>!g.path&&g.members.some(t=>t.countryName==='Aruba')));
    assert.equal(JSON.stringify(owners),before);
});
test('partial and contested countries cannot be presented as wholly owned',()=>{
    const egypt=Provinces.TERRITORIES.filter(t=>t.parentTerritoryId==='nile-delta');
    const owners={[egypt[0].id]:'egypt'};
    let group=MapView.countryOverview(Provinces,World,owners,'egypt',[egypt[2].id]).find(g=>g.id==='nile-delta');
    assert.equal(group.status,'partial');assert.equal(group.owner,null);assert.equal(group.mine,1);assert.equal(group.unclaimed,egypt.length-1);assert.deepEqual(group.claimIds,[egypt[2].id]);
    owners[egypt[1].id]='rome';
    group=MapView.countryOverview(Provinces,World,owners,'egypt',[],[egypt[1].id]).find(g=>g.id==='nile-delta');
    assert.equal(group.status,'contested');assert.equal(group.owner,null);assert.equal(group.ownerCounts.rome,1);assert.deepEqual(group.attackIds,[egypt[1].id]);
    for(const t of egypt)owners[t.id]='egypt';
    group=MapView.countryOverview(Provinces,World,owners,'egypt').find(g=>g.id==='nile-delta');
    assert.equal(group.status,'owned');assert.equal(group.owner,'egypt');assert.equal(group.unclaimed,0);
});
test('suggested expansion contains only currently legal unclaimed land and never changes ownership',()=>{
    const source={TERRITORIES:[{id:'home',areaKm2:5},{id:'near',areaKm2:10},{id:'far',areaKm2:100},{id:'enemy',areaKm2:1000}],ROUTES:[{from:'home',to:'near'}]};
    const owners={home:'egypt',enemy:'rome'},before=JSON.stringify(owners);
    assert.deepEqual(MapView.suggestedClaims(source,owners,'egypt',['near','far','enemy']).map(t=>t.id),['near','far']);
    assert.deepEqual(MapView.suggestedClaims(source,owners,'egypt',[]),[]);
    assert.equal(JSON.stringify(owners),before);
});
function renderWorld(campaign) {
    let cursor=0;const hooks=[];
    const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
        useState:initial=>{const i=cursor++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return[hooks[i],value=>{hooks[i]=typeof value==='function'?value(hooks[i]):value;}];},
        useRef:initial=>{const i=cursor++;if(!(i in hooks))hooks[i]={current:initial};return hooks[i];},useMemo:fn=>fn(),useEffect:()=>{}};
    const app={DuatMap:MapView,DuatWorld:World,DuatConquest:Conquest,DuatRules:Rules,DuatCampaign:{}};
    const context=vm.createContext({React,window:{App:app},location:{pathname:'/index.html'}});
    const raw=fs.readFileSync(require.resolve('../js/components/duat-presentation.js'),'utf8');
    vm.runInContext(Babel.transform(raw,{presets:['react'],sourceType:'script'}).code,context);
    const actions=[];
    return {render(){cursor=0;return app.DuatPresentation.World({campaign,factionId:'egypt',onAction:a=>actions.push(a),busy:false,guided:true});},actions};
}
function nodes(tree,filter){if(!tree||typeof tree!=='object')return[];return[...(filter(tree)?[tree]:[]),...(tree.children||[]).flatMap(child=>nodes(child,filter))];}
function content(tree){return typeof tree==='string'||typeof tree==='number'?String(tree):tree&&typeof tree==='object'?(tree.children||[]).map(content).join(''):'';}
test('the actual saved-province map opens with fewer than300 targets and explicit optional detail',()=>{
    const conquest=Conquest.createDynastyConquest({season:2025,seed:'map-acceptance-42',factionIds:World.FACTIONS.slice(0,8).map(f=>f.id),worldScale:'provinces',conquestMode:'combat'});
    conquest.pendingClaims.egypt=2;
    const campaign={id:'map-acceptance',version:4,phase:'season',week:2,conquest},before=JSON.stringify(campaign);
    const harness=renderWorld(campaign);let tree=harness.render();
    const targets=nodes(tree,n=>n.props?.['data-map-id']);assert.ok(targets.length<300);assert.equal(targets.filter(n=>n.type==='path').length,175);
    const claim=nodes(tree,n=>n.type==='button'&&content(n).startsWith('Claim '))[0];assert.ok(claim);claim.props.onClick();
    assert.equal(harness.actions[0].type,'claim');assert.ok(Conquest.eligibleTerritories(conquest,'egypt').includes(harness.actions[0].territoryId));
    const egypt=targets.find(n=>n.props['data-map-id']==='nile-delta');egypt.props.onClick({detail:0});tree=harness.render();
    assert.match(content(tree),/of 27 provinces are yours/);
    const detail=nodes(tree,n=>n.type==='button'&&content(n)==='Explore Egypt provinces')[0];assert.ok(detail);detail.props.onClick();tree=harness.render();
    assert.equal(nodes(tree,n=>n.props?.['data-map-id']).length,27);
    assert.equal(JSON.stringify(campaign),before,'Rendering and drilling down must not migrate or mutate a saved game.');
});
function pointerHarness(){
    const conquest=Conquest.createDynastyConquest({season:2025,seed:'pointer-acceptance',factionIds:World.FACTIONS.slice(0,8).map(f=>f.id),worldScale:'provinces',conquestMode:'combat'});
    const harness=renderWorld({id:'pointer-acceptance',version:4,phase:'season',week:2,conquest});
    const captured=new Set(),element={getBoundingClientRect:()=>({left:0,top:0,width:360,height:220}),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
    const svg=()=>{const node=nodes(harness.render(),n=>n.type==='svg')[0];node.props.ref.current=element;return node;};
    const event=(id,x,y)=>({pointerId:id,pointerType:'touch',button:0,clientX:x,clientY:y,currentTarget:element,target:{closest:()=>({getAttribute:()=> 'nile-delta'})}});
    return {harness,svg,event};
}
test('production pointer handlers suppress country selection and all actions after drag or cancelled touch',()=>{
    const {harness,svg,event}=pointerHarness();
    const zoom=nodes(harness.render(),n=>n.type==='button'&&n.props['aria-label']==='Zoom in')[0];zoom.props.onClick();
    const before=svg().props.viewBox;
    svg().props.onPointerDown(event(1,180,110));svg().props.onPointerMove(event(1,220,130));svg().props.onPointerUp(event(1,220,130));
    assert.notEqual(svg().props.viewBox,before);
    assert.equal(nodes(harness.render(),n=>n.props.className==='duat-country-summary').length,0);
    svg().props.onPointerDown(event(2,180,110));svg().props.onPointerCancel(event(2,180,110));
    assert.equal(nodes(harness.render(),n=>n.props.className==='duat-country-summary').length,0);
    assert.equal(harness.actions.length,0);
    svg().props.onPointerDown(event(3,180,110));svg().props.onPointerUp(event(3,180,110));
    assert.equal(nodes(harness.render(),n=>n.props.className==='duat-country-summary').length,1);
    assert.equal(harness.actions.length,0,'A map tap opens detail; only an explicit action button spends a claim.');
});
test('production two-finger handlers zoom then lift cleanly without a selection or claim',()=>{
    const {harness,svg,event}=pointerHarness();
    svg().props.onPointerDown(event(1,150,110));svg().props.onPointerDown(event(2,210,110));
    svg().props.onPointerMove(event(1,90,110));svg().props.onPointerMove(event(2,270,110));
    const width=Number(svg().props.viewBox.split(' ')[2]);assert.ok(width<400&&width>300);
    svg().props.onPointerUp(event(1,90,110));svg().props.onPointerUp(event(2,270,110));
    assert.equal(nodes(harness.render(),n=>n.props.className==='duat-country-summary').length,0);assert.equal(harness.actions.length,0);
});
test('Original conquest recommends a war that can actually be won, skipping a stronger first neighbor',()=>{
    let conquest=Conquest.createDynastyConquest({season:2025,seed:'original-recommendation',factionIds:['rome','egypt','gaul','china'],worldScale:'countries',conquestMode:'original'});
    conquest.owners=Object.fromEntries(World.TERRITORIES.map(t=>[t.id,'gaul']));
    for(const id of conquest.factionIds)conquest.owners[conquest.homes[id]]=id;
    conquest.claimOrder=Object.fromEntries(conquest.factionIds.map(id=>[id,Object.keys(conquest.owners).filter(t=>conquest.owners[t]===id)]));
    conquest=Conquest.recordWeek(conquest,{week:1,results:conquest.factionIds.map((factionId,i)=>({factionId,place:i+1,score:200-i*50})),createdAt:'2026-09-09T00:00:00Z'});
    const targets=Conquest.attackableTerritories(conquest,'egypt');assert.ok(targets.length>1);
    conquest.owners[targets[0]]='rome';
    assert.equal(Conquest.previewAttack(conquest,{factionId:'egypt',territoryId:targets[0]}).canAttack,false);
    const expected=targets.find(territoryId=>Conquest.previewAttack(conquest,{factionId:'egypt',territoryId}).canAttack);assert.ok(expected);
    const harness=renderWorld({id:'original-recommendation',version:4,phase:'season',week:2,conquest}),tree=harness.render();
    assert.equal(nodes(tree,n=>n.props?.['data-map-id']).length,175);
    const inspect=nodes(tree,n=>n.type==='button'&&content(n).startsWith('Inspect '))[0];
    assert.equal(content(inspect),'Inspect '+World.TERRITORIES.find(t=>t.id===expected).name);
});
