'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const source=Babel.transform(fs.readFileSync('js/components/duat-season-home.js','utf8'),{presets:['react']}).code;
function harness(model){
    const cells=new Map(),calls=[],App={DuatPresentation:{Sigil:({id})=>({type:'span',props:{'data-sigil':id},children:[id]}),art:()=>'/hero.webp'}};
    let path='',cursor=0;
    const React={createElement:(type,props,...children)=>({type,props:props||{},children}),useEffect(){},useRef:()=>({current:null}),useState(initial){const key=path+':'+cursor++;if(!cells.has(key))cells.set(key,initial);return [cells.get(key),value=>cells.set(key,typeof value==='function'?value(cells.get(key)):value)];}};
    vm.runInNewContext(source,{window:{App},React});
    function expand(tree,at='root'){
        if(Array.isArray(tree))return tree.map((child,index)=>expand(child,at+'.'+index));
        if(!tree||typeof tree!=='object')return tree;
        if(typeof tree.type==='function'){const oldPath=path,oldCursor=cursor;path=at;cursor=0;const rendered=tree.type({...tree.props,children:tree.children});path=oldPath;cursor=oldCursor;return expand(rendered,at+'.render');}
        return {...tree,children:expand(tree.children,at+'.children')};
    }
    const render=()=>expand(React.createElement(App.DuatSeasonHomeView,{model,factionId:'f15',campaignName:'The untouched dynasty',cycle:2,rulerName:'The current ruler',onResume:()=>calls.push('resume'),onExplore:model.allowExplore?view=>calls.push(view):undefined}));
    return {render,calls};
}
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);return tree&&typeof tree==='object'?[tree,...nodes(tree.children)]:[];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join('');return tree==null||typeof tree==='boolean'?'':typeof tree==='object'?text(tree.children):String(tree);}
function button(tree,label){const found=nodes(tree).find(node=>node.type==='button'&&(text(node)===label||node.props['aria-label']===label));assert(found,'Missing button '+label);return found;}
function fixture({locked=false,complete=false,count=16}={}){
    return {visibleThroughWeek:complete?17:4,standingsThroughWeek:complete?15:4,currentWeek:complete?17:5,pendingResultWeek:complete?null:5,resume:{week:complete?17:5,stage:complete?'complete':'games',label:complete?'View season honors':'Resume Week 5 games',detail:'Continue from your saved place in Game Day.'},standings:Array.from({length:count},(_,i)=>({factionId:'f'+i,name:'Faction '+i+' with an intentionally long royal name',rank:i+1,record:'3–2–1',points:1000-i*0.11,isMine:i===15})),timeline:Array.from({length:17},(_,i)=>({week:i+1,label:'Week '+(i+1),roundLabel:i<15?'Regular season':i===15?'Semifinals':'Championship',state:i<4?'revealed':i===4?'current':'upcoming',sacred:[5,7,10,14,15,16,17].includes(i+1),favorNames:i===4?['Kratos I','Horus II']:[],deities:i===4?['kratos','horus']:[],result:i<4?{points:100+i,record:'4–3'}:null,heptad:i===4,allianceLabel:i===4?'Octad · Challenger path + Redemption path':'',detail:i===4?'Sacred week · optional favors · Challenger path + Redemption path':'A chapter still to come.'})),outlook:{available:true,status:'in-field',heading:'On pace for the playoff field',seed:2,fieldSize:4,regularSeasonWeeks:15,remainingWeeks:complete?0:11,cutoffMargin:6,cutoffLabel:'6 all-play wins above the cutoff',explanation:'The current table is based on revealed results.',pace:{projectedWinCredits:37.5,projectedCutoffWinCredits:15}},tournament:{name:'Octad',allianceCount:8,factionCount:count,locked,allianceId:locked?null:'a1',allianceName:locked?null:'The two saved banners',teamIds:locked?[]:['f0','f15'],entry:locked?null:3,lives:locked?null:1,status:locked?'sealed':'redemption',label:'Your alliance remains in the Games.',next:locked?null:{label:'Week 5 · Redemption path · Your alliance vs the next challenger'},progress:locked?[]:[{id:'a1',name:'The two saved banners',teamIds:['f0','f15'],entry:3,status:'redemption',lives:1}],championName:null}};
}

test('compiled Home calendar selection stays local and cannot reveal an unseen result or move the current week',()=>{
    const model=fixture(),before=JSON.stringify(model),h=harness(model);let tree=h.render();
    assert.equal(nodes(tree).filter(node=>node.type==='button'&&/^Week \d/.test(node.props['aria-label']||'')).length,17);
    assert.equal(nodes(tree).find(node=>node.props['aria-current']==='step'&&node.type==='button').props['aria-label'].startsWith('Week 5'),true);
    button(tree,'Week 17 · Championship · Sacred favors').props.onClick();tree=h.render();
    assert.equal(nodes(tree).find(node=>node.type==='button'&&node.props['aria-pressed']===true).props['aria-label'].startsWith('Week 17'),true);
    const detail=nodes(tree).find(node=>node.props.className==='duat-home-schedule-detail');assert.match(text(detail),/Week 17/);assert(!text(detail).includes('pts'));
    assert.equal(nodes(tree).find(node=>node.props['aria-current']==='step'&&node.type==='button').props['aria-label'].startsWith('Week 5'),true);
    assert.deepEqual(h.calls,[]);assert.equal(JSON.stringify(model),before);
    button(tree,'Resume Week 5 →').props.onClick();assert.deepEqual(h.calls,['resume']);
});

test('compact Home standings retain the user and expand to every faction without navigation',()=>{
    const h=harness(fixture());let tree=h.render();const rows=()=>nodes(nodes(tree).find(node=>node.type==='tbody')).filter(node=>node.type==='tr');
    assert.equal(rows().length,6);assert.match(text(rows().at(-1)),/Faction 15.*You3–2–1/);
    assert.equal(nodes(rows().at(-1)).filter(node=>node.type==='th'&&node.props.scope==='row').length,1);
    button(tree,'Full standings · all 16 factions').props.onClick();tree=h.render();assert.equal(rows().length,16);
    assert.equal(button(tree,'Show compact standings').props['aria-expanded'],true);assert.deepEqual(h.calls,[]);
    assert.match(text(rows().at(-1)),/998.35/);
});

test('final Home table labels its regular-season cutoff while playoff status keeps the revealed Week 17 context',()=>{
    const h=harness(fixture({complete:true,count:8})),tree=h.render(),standings=nodes(tree).find(node=>(node.props.className||'').includes('duat-home-standings'));
    assert.match(text(standings),/Final regular-season standingsThrough Week 15/);assert(!text(standings).includes('Through Week 17'));
    assert.match(text(tree),/PLAYOFF HUNT · THROUGH WEEK 17/);assert(!text(tree).includes('AT CURRENT PACE'));
    button(tree,'View season honors →').props.onClick();assert.deepEqual(h.calls,['resume']);
});

test('Home explains real pace and signed lead while keeping sacred offerings optional and compact',()=>{
    const tree=harness(fixture()).render();assert.match(text(tree),/6 all-play wins above the cutoff/);assert.match(text(tree),/37.50.*cutoff pace 15.00/);assert.match(text(tree),/future weeks can change the outlook/);
    const offerings=nodes(tree).find(node=>node.props.className==='duat-home-calendar-offerings');assert.equal(offerings.type,'details');assert.equal(offerings.props.open,undefined);assert.match(text(offerings),/Scheduled offerings · 2 gods/);
    assert.equal(nodes(tree).filter(node=>node.type==='button'&&/Invoke|Advance|Claim/.test(text(node))).length,0);
});

test('sealed Home tournament reveals counts only and unsealed path uses actual remaining lives',()=>{
    const sealed=fixture({locked:true});sealed.visibleThroughWeek=0;sealed.pendingResultWeek=null;sealed.resume={week:1,stage:'alliance',label:'Meet your alliance',detail:'Discover your partner.'};sealed.currentWeek=1;
    const h=harness(sealed),tree=h.render();assert.match(text(tree),/8 ALLIANCES · 16 FACTIONSOctad/);assert.match(text(tree),/Resume Week 1 to reveal your alliance/);assert(!text(tree).includes('The two saved banners'));assert(!text(tree).includes('Entry 3'));assert(!text(tree).includes('NEXT IN THE GAMES'));
    assert.equal(nodes(tree).filter(node=>node.type==='button'&&/full tournament/.test(text(node))).length,0);
    const unsealed=fixture();unsealed.allowExplore=true;const open=harness(unsealed),revealed=open.render();assert.match(text(revealed),/Last life · 1 life · Entry 3/);
    assert.equal(nodes(revealed).filter(node=>node.props['aria-label']==='1 lives remaining').length,1);
    const path=nodes(revealed).find(node=>node.props['aria-label']==='Your path to the crown');assert.match(text(nodes(path).find(node=>node.props['aria-current']==='step')),/Redemption.*one life/);
    button(revealed,'Open the full tournament →').props.onClick();assert.deepEqual(open.calls,['tournaments']);
});

test('Home puts its single current Resume action before calendar inspection while retaining all seventeen weeks',()=>{
    const h=harness(fixture()),tree=h.render(),all=nodes(tree),resume=all.findIndex(node=>node.props.className==='duat-home-resume'),schedule=all.findIndex(node=>node.props.className==='duat-home-schedule');
    assert(resume>0&&resume<schedule);assert.equal(all.filter(node=>node.type==='button'&&/^Resume Week/.test(text(node))).length,1);assert.equal(all.filter(node=>node.type==='button'&&/^Week \d/.test(node.props['aria-label']||'')).length,17);assert.deepEqual(h.calls,[]);
});
