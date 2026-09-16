'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Council=require('../js/duat/council-state.js'),Personalities=require('../js/duat/personalities.js');
require('../js/duat/strategy.js');
const copy=value=>JSON.parse(JSON.stringify(value));
function faction(id,name,controller='ai'){return{id,name:id,controller,activeArmyId:id+'-army',armies:[{id:id+'-army',rulerId:id+'-ruler',rulerName:name,rulerOrigin:'historical-reference',players:[]}]};}
function fixture(){return{version:4,phase:'season',week:3,dynastySeason:1,updatedAt:'2026-09-15T12:00:00Z',humanFactionIds:['egypt','rome'],factions:[faction('egypt','Djoser','human'),faction('rome','Romulus','human'),faction('mesopotamia','Hammurabi')],archaeology:{revealedFactionIds:['egypt','rome','mesopotamia']},completedWeeks:[{week:1,factions:[{factionId:'egypt',total:100},{factionId:'rome',total:80},{factionId:'mesopotamia',total:90}]},{week:2,factions:[{factionId:'egypt',total:110},{factionId:'rome',total:90},{factionId:'mesopotamia',total:105}]}],alliances:[{id:'alliance',name:'Existing banner',teamIds:['egypt','mesopotamia']}],hiddenYears:{assignments:{secret:{season:2017}}}};}
const action=(intent='respect',messageId='council-exchange-001',seenThroughWeek=1)=>({type:'address-ruler',targetFactionId:'mesopotamia',intent,messageId,seenThroughWeek});
test('ruler replies persist deterministically, retry without duplication, and preserve actual alliances',()=>{
 const state=fixture(),before=copy(state),next=Council.apply(state,action(),'egypt');assert.deepEqual(state,before);assert.equal(next.council.messages.length,1);assert.equal(next.council.messages[0].week,1);assert.equal(next.council.messages[0].rulerName,'Hammurabi');assert(next.council.messages[0].text.length>20);assert.deepEqual(next.alliances,state.alliances);
 const replayed=Council.apply(copy(next),action(),'egypt');assert.deepEqual(replayed,next);assert.throws(()=>Council.apply(next,action('challenge'),'egypt'),/different exchange/);
 const reloaded=copy(next);reloaded.hiddenYears.assignments.secret.season=2023;const again=Council.apply(reloaded,action('alliance','council-exchange-002'),'egypt');assert.deepEqual(again.alliances,state.alliances);assert.match(again.council.messages.at(-1).text,/already share a revealed banner/);assert.equal(Council.normalize(again.council,state.factions.map(f=>f.id)).messages.length,2);
});
test('private council exchanges filter by viewer and relationship indexes cannot be forged',()=>{
 let next=Council.apply(fixture(),action(),'egypt');next=Council.apply(next,action('challenge','council-exchange-002'),'rome');assert.equal(next.council.messages.length,2);
 const own=Council.project(next.council,'egypt'),other=Council.project(next.council,'rome');assert.equal(own.messages.length,1);assert.equal(other.messages.length,1);assert.equal(own.messages[0].fromFactionId,'egypt');assert.equal(other.messages[0].fromFactionId,'rome');assert.deepEqual(Object.keys(own.relationships),['egypt:mesopotamia']);
 const tampered=copy(next.council);tampered.relationships['egypt:mesopotamia']=5;assert.throws(()=>Council.normalize(tampered,next.factions.map(f=>f.id)),/relationship record/);assert.equal(Council.normalize(undefined,[]),undefined);assert.equal(Council.project(undefined,'egypt'),undefined);
});
test('human managers and sealed rulers cannot be impersonated; playback horizon stays within observed games',()=>{
 const state=fixture();assert.throws(()=>Council.apply(state,{...action(),targetFactionId:'rome'},'egypt'),/awakened AI/);assert.throws(()=>Council.apply(state,action(),'mesopotamia'),/awakened AI/);assert.throws(()=>Council.apply(state,action('respect','council-too-far',3),'egypt'),/already revealed/);
 state.archaeology.revealedFactionIds=['egypt','rome'];assert.throws(()=>Council.apply(state,action(),'egypt'),/both rulers/);
 const human=Personalities.council({campaign:fixture(),factionId:'rome',viewerFactionId:'egypt',visibleThroughWeek:1});assert.equal(human.humanControlled,true);assert.deepEqual(human.lines,[]);assert.deepEqual(human.choices,[]);assert.equal(Personalities.reply({campaign:fixture(),factionId:'rome',viewerFactionId:'egypt',intent:'challenge'}),null);
});
test('dialogue uses only the viewed week, retains memory after reload and never uses hidden scoring seasons',()=>{
 const state=fixture();Object.defineProperty(state.completedWeeks[1],'factions',{get(){throw Error('Read unrevealed game');}});
 const next=Council.apply(state,action('challenge'),'egypt');assert.match(next.council.messages[0].text,/Week 1/);assert(!next.council.messages[0].text.includes('Week 2'));
 const first=Council.apply(fixture(),action('respect'),'egypt');const changed=fixture();changed.hiddenYears.assignments.secret.season=2024;assert.equal(Council.apply(changed,action('respect'),'egypt').council.messages[0].text,first.council.messages[0].text);
 const saved=copy(first),view=Personalities.council({campaign:saved,factionId:'mesopotamia',viewerFactionId:'egypt',visibleThroughWeek:1});assert.equal(view.conversation.length,1);assert(view.lines.some(line=>line.kind==='memory'));assert.equal(Personalities.council({campaign:saved,factionId:'mesopotamia',viewerFactionId:'egypt',visibleThroughWeek:0}).conversation.length,0);
});
