'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone'),Lore=require('../js/duat/lore.js');
const source=Babel.transform(fs.readFileSync('js/components/duat-identity-library.js','utf8'),{presets:['react']}).code;
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.children)]:[];
const content=tree=>Array.isArray(tree)?tree.map(content).join(' '):tree==null||typeof tree==='boolean'?'':typeof tree==='object'?content(tree.children):String(tree);
function fixture(){const names=Lore.nameLibrary('egypt').rulers;return {version:4,phase:'season',week:1,humanFactionIds:['egypt','rome'],factions:[{id:'egypt',activeArmyId:'own-a',armies:[{id:'own-a',rulerName:names[0].name,season:2024},{id:'own-b',rulerName:names[1].name,season:2023}]},{id:'rome',armies:[{id:'rival-a',rulerName:'SEALED RIVAL NAME',season:2099}]}],alliances:[{id:'a',name:'Saved alliance',teamIds:['egypt','rome']}],completedWeeks:[],dynasty:{retiredRulers:[{factionId:'egypt',rulerName:names[2].name}]}};}
function mount(overrides={}){
    const cells=[],calls=[],App={DuatLore:Lore,DuatFactionMark:()=>null};let cursor=0;
    const React={createElement:(type,props,...children)=>typeof type==='function'?type({...props,children}):({type,props:props||{},children}),useState(initial){const i=cursor++;if(!(i in cells))cells[i]=initial;return [cells[i],value=>cells[i]=typeof value==='function'?value(cells[i]):value];},useRef(initial){const i=cursor++;if(!(i in cells))cells[i]={current:initial};return cells[i];}};
    vm.runInNewContext(source,{window:{App},React});
    const props={campaign:fixture(),factionId:'egypt',allianceVisible:true,onAction:async action=>{calls.push(action);return true;},...overrides};
    const render=()=>{cursor=0;return App.DuatIdentityLibraryView(props);};
    return {props,calls,render};
}
function button(tree,label){const result=nodes(tree).find(node=>node.type==='button'&&(content(node).trim()===label||node.props['aria-label']===label));assert(result,'Missing button '+label);return result;}
function input(tree,label){const result=nodes(tree).find(node=>node.props['aria-label']===label);assert(result,'Missing input '+label);return result;}
function nameButton(tree,name){const result=nodes(tree).find(node=>node.type==='button'&&nodes(node).some(child=>child.type==='strong'&&content(child)===name));assert(result,'Missing name '+name);return result;}

test('library defaults to the current culture and browsing cannot target another manager or disclose their sealed ruler',()=>{
    const h=mount(),before=JSON.stringify(h.props.campaign);let tree=h.render();assert.equal(input(tree,'Name library culture').props.value,'egypt');assert.equal(nodes(input(tree,'Name library culture')).filter(node=>node.type==='option').length,28);assert.equal(input(tree,'Ruler to name').props.value,'own-a');
    input(tree,'Name library culture').props.onChange({target:{value:'rome'}});tree=h.render();assert.equal(nodes(tree).filter(node=>node.props['aria-label']==='Ruler to name').length,0);assert.equal(nodes(tree).filter(node=>node.type==='button'&&content(node).trim()==='Name this ruler').length,0);assert.doesNotMatch(content(tree),/SEALED RIVAL NAME|2099/);assert.match(content(tree),/another culture/);assert.equal(JSON.stringify(h.props.campaign),before);assert.deepEqual(h.calls,[]);
});

test('ruler choices explain used and retired names, preserve explicit target selection and emit only canonical own-ruler intent',async()=>{
    const h=mount(),names=Lore.nameLibrary('egypt').rulers;let tree=h.render();assert.equal(nameButton(tree,names[1].name).props.disabled,true);assert.match(content(nameButton(tree,names[1].name)),/Already names/);assert.equal(nameButton(tree,names[2].name).props.disabled,true);assert.match(content(nameButton(tree,names[2].name)),/Retired/);
    input(tree,'Ruler to name').props.onChange({target:{value:'own-b'}});tree=h.render();assert.equal(nameButton(tree,names[0].name).props.disabled,true);nameButton(tree,names[3].name).props.onClick();tree=h.render();await button(tree,'Name this ruler').props.onClick();assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{type:'name-ruler',armyId:'own-b',name:names[3].name}]);assert.match(content(h.render()),/Ruler name saved/);
});

test('banner suggestions perform the existing own-alliance action and never rename a cultural faction',async()=>{
    const h=mount(),before=JSON.stringify(h.props.campaign);let tree=h.render();button(tree,'Alliance names').props.onClick();tree=h.render();const banner=Lore.nameLibrary('egypt').banners[0];assert(banner);button(tree,banner.name).props.onClick();tree=h.render();await button(tree,'Name your alliance').props.onClick();assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{type:'name-alliance',name:banner.name}]);assert.match(content(tree),/Saved alliance/);assert.equal(JSON.stringify(h.props.campaign),before);
});

test('ready, after-kickoff and read-only states retain browse access without allowing name writes',async()=>{
    for(const mode of ['ready','late','readonly']){const h=mount(mode==='ready'?{ready:true}:mode==='readonly'?{onAction:undefined}:{});if(mode==='late'){h.props.campaign.week=2;h.props.campaign.completedWeeks=[{week:1}];}let tree=h.render();const apply=nodes(tree).find(node=>node.type==='button'&&content(node).trim()==='Name this ruler');assert(!apply||apply.props.disabled);if(apply)await apply.props.onClick();button(tree,'Alliance names').props.onClick();tree=h.render();const bannerApply=nodes(tree).find(node=>node.type==='button'&&content(node).trim()==='Name your alliance');assert(!bannerApply||bannerApply.props.disabled);if(bannerApply)await bannerApply.props.onClick();assert.deepEqual(h.calls,[]);assert.equal(input(tree,'Name library culture').props.disabled,undefined);}
});

test('failed shared naming keeps the selected source choice and actual error visible and prevents duplicate submissions',async()=>{
    let finish;const submitted=[],h=mount({actionError:'The room changed; please try again.',onAction:action=>{submitted.push(action);return new Promise(resolve=>{finish=resolve;});}}),name=Lore.nameLibrary('egypt').rulers[3].name;let tree=h.render();nameButton(tree,name).props.onClick();tree=h.render();const submit=button(tree,'Name this ruler'),first=submit.props.onClick(),second=submit.props.onClick();assert.equal(submitted.length,1);finish(false);await Promise.all([first,second]);tree=h.render();assert.equal(nameButton(tree,name).props['aria-pressed'],true);assert.match(content(tree),/The room changed/);assert.doesNotMatch(content(tree),/Ruler name saved/);
});

test('name filters and three story previews are local, with references collapsed and actual ruler identities sealed',()=>{
    const h=mount();let tree=h.render();input(tree,'Find a ruler name').props.onChange({target:{value:'NO MATCHING RULER'}});tree=h.render();assert.match(content(tree),/No names match/);input(tree,'Find a ruler name').props.onChange({target:{value:''}});input(tree,'Name traditions').props.onChange({target:{value:'archive'}});tree=h.render();assert(nodes(tree).some(node=>node.type==='details'&&node.props.className==='duat-identity-source'&&node.props.open===undefined));
    button(tree,'Reveal stories').props.onClick();tree=h.render();const stories=nodes(tree).find(node=>node.props.className==='duat-identity-stories');assert.equal(nodes(stories).filter(node=>node.type==='details').length,3);assert.doesNotMatch(content(stories),/SEALED RIVAL NAME|\{rulerName\}|\{playerCount\}/);assert.deepEqual(h.calls,[]);
});

test('banner suggestions already used by another alliance are disabled with a clear reason',()=>{
    const h=mount(),banner=Lore.nameLibrary('egypt').banners[0];h.props.campaign.alliances.push({id:'rival-alliance',name:banner.name,teamIds:['a','b']});let tree=h.render();button(tree,'Alliance names').props.onClick();tree=h.render();const taken=nodes(tree).find(node=>node.type==='button'&&content(node).includes(banner.name));assert(taken.props.disabled);assert.match(content(taken),/Already names another alliance/);assert(button(tree,'Name your alliance').props.disabled);assert.deepEqual(h.calls,[]);
});


test('sealed alliances keep public banner ideas browsable but reveal no paired identity or reservation until the ceremony',async()=>{
    const h=mount({allianceVisible:false}),banner=Lore.nameLibrary('egypt').banners[0];h.props.campaign.alliances.push({id:'secret',name:banner.name,teamIds:['secret-partner-a','secret-partner-b']});
    let tree=h.render();button(tree,'Alliance names').props.onClick();tree=h.render();assert.doesNotMatch(content(tree),/Saved alliance|secret-partner|Already names another alliance/);assert.match(content(tree),/Week 1 ceremony/);assert.equal(button(tree,banner.name).props.disabled,false);button(tree,banner.name).props.onClick();tree=h.render();assert(!nodes(tree).some(n=>n.type==='button'&&content(n).trim()==='Name your alliance'));assert.deepEqual(h.calls,[]);
    h.props.allianceVisible=true;tree=h.render();assert.match(content(tree),/Saved alliance/);assert.match(content(tree),/Already names another alliance/);const available=Lore.nameLibrary('egypt').banners[1];button(tree,available.name).props.onClick();tree=h.render();await button(tree,'Name your alliance').props.onClick();assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{type:'name-alliance',name:available.name}]);
});


test('selected saved identities display their current name without promising a redundant rename',()=>{
    const h=mount();let tree=h.render();nameButton(tree,h.props.campaign.factions[0].armies[0].rulerName).props.onClick();tree=h.render();assert.match(content(tree),/Current name:/);assert.doesNotMatch(content(tree),/will name/);assert(button(tree,'Name this ruler').props.disabled);
    const banner=Lore.nameLibrary('egypt').banners[0];h.props.campaign.alliances[0].name=banner.name;button(tree,'Alliance names').props.onClick();tree=h.render();button(tree,banner.name).props.onClick();tree=h.render();assert.match(content(tree),/Current name:/);assert.doesNotMatch(content(tree),/will become/);assert(button(tree,'Name your alliance').props.disabled);
});
