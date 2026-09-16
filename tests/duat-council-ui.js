'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const P=require('../js/duat/personalities'),L=require('../js/duat/lore');
const source=Babel.transform(fs.readFileSync('js/components/duat-council.js','utf8'),{presets:['react']}).code;
function fixture(){return {phase:'season',week:3,dynastySeason:1,humanFactionIds:['egypt'],factions:['egypt','rome','china'].map((id,index)=>{const r=L.nameLibrary(id).rulers[0];return {id,name:L.faction(id).name,controller:index?'ai':'human',activeArmyId:id+':a',armies:[{id:id+':a',rulerId:r.id,rulerName:r.name,rulerOrigin:r.origin}]};}),archaeology:{revealedFactionIds:['egypt','rome']},completedWeeks:[{week:1,factions:[{factionId:'egypt',total:100},{factionId:'rome',total:99}]}]};}
function harness(options={}){
    const cells=[],calls=[],App={DuatPersonalities:P},campaign=options.campaign||fixture();let cursor=0;
    const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),useEffect(){},useRef(initial){const index=cursor++;if(!(index in cells))cells[index]={current:initial};return cells[index];},useState(initial){const index=cursor++;if(!(index in cells))cells[index]=initial;return [cells[index],value=>cells[index]=typeof value==='function'?value(cells[index]):value];}};
    vm.runInNewContext(source,{window:{App},React});const props={campaign,viewerFactionId:'egypt',visibleThroughWeek:1,onIntent:async action=>{calls.push(action);if(options.reject)throw new Error('Save failed safely.');},...options};
    return {calls,campaign,render:()=>{cursor=0;return App.DuatCouncil(props);}};
}
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);return tree&&typeof tree==='object'?[tree,...nodes(tree.children)]:[];}
function text(tree){return Array.isArray(tree)?tree.map(text).join(''):tree==null||typeof tree==='boolean'?'':typeof tree==='object'?text(tree.children):String(tree);}
function button(tree,label){const value=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert(value,'Missing button '+label);return value;}

test('initial council is compact, defaults to an awakened AI, and keeps characterization and sources behind disclosure',()=>{
    const h=harness(),tree=h.render();assert.match(text(tree),/Romulus/);assert(!text(tree).includes('Xiang of Xia'));const options=nodes(tree).filter(n=>n.type==='option');assert.equal(options.length,2);
    assert.equal(nodes(tree).find(n=>n.type==='select').props.value,'rome');
    const details=nodes(tree).filter(n=>n.type==='details');assert(details.length>=1);assert(details.every(n=>!n.props.open));
    assert.equal(nodes(tree).filter(n=>n.type==='button').length,4);assert.match(text(tree),/Written Duat fiction/);assert.match(text(tree),/does not make trades, spend favors or change alliances/);
    const log=nodes(tree).find(n=>n.props.role==='log');assert(log);assert.equal(log.props['aria-live'],'polite');assert.equal(nodes(tree).filter(n=>n.props.dangerouslySetInnerHTML).length,0);
});
test('a reply submits the exact target and visible cutoff, with no unsaved NPC reply inserted',async()=>{
    const h=harness(),before=JSON.stringify(h.campaign),tree=h.render(),beforeLog=text(nodes(tree).find(n=>n.props.role==='log'));
    await button(tree,'Offer respect').props.onClick();assert.equal(h.calls.length,1);const {messageId,...payload}=JSON.parse(JSON.stringify(h.calls[0]));assert.deepEqual(payload,{targetFactionId:'rome',intent:'respect',seenThroughWeek:1});assert.match(messageId,/^[A-Za-z0-9_-]{8,120}$/);
    const after=h.render();assert.equal(text(nodes(after).find(n=>n.props.role==='log')),beforeLog);assert.equal(JSON.stringify(h.campaign),before);
});
test('saved pair conversation renders; future, other-player and prior-ruler exchanges do not',()=>{
    const c=fixture(),base={cycle:1,week:1,fromFactionId:'egypt',toFactionId:'rome',rulerId:c.factions[1].armies[0].rulerId,rulerName:'Romulus',intent:'respect',prompt:'Offer respect'};
    c.council={messages:[{...base,id:'mine',text:'The saved response.'},{...base,id:'other',fromFactionId:'china',text:'PRIVATE OTHER'},{...base,id:'future',week:2,text:'FUTURE SPEECH'},{...base,id:'old',rulerId:'old',text:'OLD RULER'}]};
    const tree=harness({campaign:c}).render();assert.match(text(tree),/The saved response/);assert(!/PRIVATE OTHER|FUTURE SPEECH|OLD RULER/.test(text(tree)));
});
test('human court profile has no fabricated speech or reply controls',()=>{
    const h=harness();let tree=h.render();nodes(tree).find(n=>n.type==='select').props.onChange({target:{value:'egypt'}});tree=h.render();assert.match(text(tree),/does not speak on their behalf/);assert.equal(nodes(tree).filter(n=>n.type==='button').length,0);assert.equal(nodes(tree).filter(n=>n.props.role==='log').length,0);assert.match(text(tree),/Djoser/);
});
test('failed save stays visible and retry remains possible without inventing successful persistence',async()=>{
    const h=harness({reject:true});await button(h.render(),'Offer respect').props.onClick();const tree=h.render();assert.match(text(nodes(tree).find(n=>n.props.role==='alert')),/Save failed safely/);assert.equal(button(tree,'Offer respect').props.disabled,false);assert.equal(h.campaign.council,undefined);await button(tree,'Offer respect').props.onClick();assert.equal(h.calls[0].messageId,h.calls[1].messageId,'An uncertain save retry reuses the same exchange ID');
});
test('busy audiences prevent repeated submission and changing the recipient',()=>{
    const h=harness({busy:true}),tree=h.render();assert(nodes(tree).filter(n=>n.type==='button').every(n=>n.props.disabled));assert.equal(nodes(tree).find(n=>n.type==='select').props.disabled,true);assert.match(text(tree),/Saving your audience/);
});
