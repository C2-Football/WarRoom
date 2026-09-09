'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const Lore=require('../js/duat/lore.js'),Data=require('../js/duat/identity-library.js'),Engine=require('../js/duat/dynasty.js');
const clone=value=>JSON.parse(JSON.stringify(value)),key=name=>name.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');

test('every culture has a useful name and banner library with explicit provenance and synchronized runtime data',()=>{
    cp.execFileSync(process.execPath,['scripts/build-duat-identity.cjs','--check']);
    assert.equal(Data.factions.length,28);assert.deepEqual(Data,JSON.parse(fs.readFileSync('data/duat/identity-library.json','utf8')));
    assert.deepEqual(Data.factions.map(f=>f.id).sort(),Lore.FACTIONS.map(f=>f.id).sort());
    for(const culture of Lore.FACTIONS){const library=Lore.nameLibrary(culture.id);assert(library.rulers.length>=12,culture.id);assert(library.banners.length>=6,culture.id);assert.equal(new Set(library.rulers.map(r=>key(r.name))).size,library.rulers.length);assert.equal(new Set(library.banners.map(r=>key(r.name))).size,library.banners.length);assert.deepEqual(library.rulers.slice(0,culture.rulers.length),clone(culture.rulers),'Supplied choices retain their order and source spelling');
        for(const item of library.rulers){assert.equal(Lore.validateName(item.name),item.name);assert(item.id&&item.origin);if(['historical-reference','legendary-reference'].includes(item.origin))assert(item.source?.title&&/^https:\/\//.test(item.source.url),'Referenced names must carry an actual source');}
        if(culture.rulers.length<2)assert(library.rulers.filter(item=>['historical-reference','legendary-reference'].includes(item.origin)).length>=4,culture.id+' needs personal historical or legendary choices');
        for(const item of library.banners)assert.equal(globalThis.App.DuatHeptad.validateName(item.name),item.name);
    }
    assert.equal(new Set(Lore.FACTIONS.flatMap(f=>Lore.nameLibrary(f.id).rulers.map(r=>r.id))).size,Lore.FACTIONS.reduce((sum,f)=>sum+Lore.nameLibrary(f.id).rulers.length,0),'Ruler catalog IDs are unique across cultures');
    assert.doesNotMatch(JSON.stringify(Data),/\/Users\/|Form Responses|Email Address/);assert(Object.isFrozen(Data.factions[0]));
});

test('normal mummy and dynasty naming uses distinct choices, preserves prior identities, and carries selected source provenance',()=>{
    for(const culture of Lore.FACTIONS){const retired=[];for(let cycle=1;cycle<=12;cycle++){const name=Lore.chooseRuler({factionId:culture.id,ordinal:cycle,retiredNames:retired});assert.notEqual(name.origin,'new-game-title',culture.id+' exhausted ordinary choices');assert(!retired.includes(name.name));retired.push(name.name);}
        const before={id:culture.id,armies:[{id:'custom',rulerName:'My saved personal ruler',rulerId:'saved:custom'},{id:'old-fallback',rulerName:culture.fallbackTitle+' 1',rulerId:'saved:title'},{id:'new',rulerName:'2024 Ruler'}]};const after=Lore.nameArmies(before);assert.deepEqual(after.slice(0,2),before.armies.slice(0,2));assert.notEqual(after[2].rulerOrigin,'new-game-title');assert.equal(before.armies[2].rulerName,'2024 Ruler');
    }
    const item=Lore.nameLibrary('korea').rulers.find(r=>r.origin==='historical-reference');assert(item);
    const named=Lore.chooseRuler({factionId:'korea',customName:item.name});assert.deepEqual(named,item);
    assert.throws(()=>Lore.chooseRuler({factionId:'korea',customName:item.name,retiredRulerIds:[item.id]}),{code:'RULER_RETIRED_OR_USED'});
    assert.equal(Lore.chooseRuler({factionId:'korea',customName:'My own written identity'}).origin,'player-named');
    const all=Lore.nameLibrary('egypt').rulers,choices=Lore.potentialRulers({factionId:'egypt',usedNames:[all[0].name],retiredNames:[{factionId:'egypt',rulerName:all[1].name}]});assert.equal(choices[0].available,false);assert.match(choices[0].reason,/Already/);assert.equal(choices[1].available,false);assert.match(choices[1].reason,/Retired/);assert.equal(choices[2].available,true);
});

test('all84 full scripts rotate by public cycle, replay deterministically, and never depend on a sealed draw or football result',()=>{
    const texts=new Set();
    for(const faction of Lore.FACTIONS){const scripts=Lore.nameLibrary(faction.id).scripts;assert.equal(scripts.length,3,faction.id);const chosen=[];
        for(let cycle=1;cycle<=3;cycle++){const input={factionId:faction.id,campaignId:'public-campaign',cycle},script=Lore.revealScript(input);chosen.push(script.id);assert.deepEqual(script,Lore.revealScript({...input,seed:'SECRET',season:2099,rulerName:'SECRET RULER',armyId:'SECRET DRAW',futurePoints:9000}));const sealed=Lore.journey(input);assert.deepEqual(sealed,Lore.journey({...input,rulerName:'SECRET RULER',playerCount:59,season:2099}));assert.doesNotMatch(JSON.stringify(sealed),/SECRET|2099|9000/);}
        assert.equal(new Set(chosen).size,3,faction.id+' must vary in consecutive dynasty cycles');
        for(const script of scripts){const entry=Lore.revealScript({factionId:faction.id,variantId:script.id});for(const field of ['arrival','discovery','appearance','record'])assert(typeof entry[field]==='string'&&entry[field].length>30,faction.id+' '+field);assert.match(entry.appearance,/\{rulerName\}/);assert.match(entry.appearance,/\{playerCount\}/);assert(!texts.has(entry.appearance));texts.add(entry.appearance);const shown=Lore.journey({factionId:faction.id,variantId:script.id,awakened:true,rulerName:'A custom returning name',playerCount:11,season:2023});assert.match(shown.paragraphs[0],/A custom returning name/);assert.match(shown.paragraphs[0],/11/);assert.doesNotMatch(shown.paragraphs.join(' '),/\{rulerName\}|\{playerCount\}/);}
    }
    assert.equal(texts.size,84);assert.throws(()=>Lore.revealScript({factionId:'egypt',variantId:'foreign-script'}),{code:'UNKNOWN_REVEAL_SCRIPT'});
});

test('new journal records pin their script and literal prose while old saved entries remain untouched',()=>{
    const input={factionId:'egypt',campaignId:'persistent-campaign',cycle:2,rulerId:'my-ruler',rulerName:'My chosen ruler',playerCount:8,season:2024,createdAt:'2026-09-09T03:00:00Z'},journal=Lore.journalEntry(input);
    assert.deepEqual(journal,Lore.journalEntry(input));assert.equal(journal.variantId,Lore.revealScript(input).id);assert.deepEqual(journal.arrivalParagraphs,Lore.journey(input).paragraphs);assert.equal(journal.paragraphs[1],Lore.journey({...input,awakened:true}).paragraphs[0]);
    const old={id:'old',factionId:'egypt',cycle:1,title:'An earlier saved title',paragraphs:['Old arrival.','Old ruler.','Old roster.','Old closing.'],rulerName:'A previous custom name'};const campaign={dynasty:{cycle:2,seasons:[],retiredRulers:[],journal:[old,journal]}},before=JSON.stringify(campaign);const archived=Lore.dynastySummary(campaign,'egypt');assert.deepEqual(archived.journal[0],old);assert.equal(JSON.stringify(campaign),before);
});

test('browser and server library APIs agree without exposing shared campaign secrets',()=>{
    const context={window:{}};vm.createContext(context);for(const file of ['identity-library.js','lore.js'])vm.runInContext(fs.readFileSync('js/duat/'+file,'utf8'),context);
    const browser=context.window.App.DuatLore;for(const faction of Lore.FACTIONS){assert.deepEqual(clone(browser.nameLibrary(faction.id)),Lore.nameLibrary(faction.id));assert.deepEqual(clone(browser.journey({factionId:faction.id,campaignId:'shared-room',cycle:3})),Lore.journey({factionId:faction.id,campaignId:'shared-room',cycle:3}));}
});

let data;
function archive(){if(!data){const Season=globalThis.App.TimeLeagueSeason;data={cards:JSON.parse(fs.readFileSync('data/duat/player-cards.json','utf8')),logIndex:Season.buildGameLogIndex(Season.parseGameLogCsv(fs.readFileSync('data/duat/nflverse-game-logs.csv','utf8')).logs)};}return data;}
function create(mummyCount=1){const settings=Engine.normalizeSettings({leagueSize:8,mummyCount,bench:1,playoffTeams:4,conquest:false,favors:false});return Engine.createCampaign({version:4,id:'identity-authority',name:'Identity authority',seed:'unpublished-game-seed',createdAt:'2026-09-09T03:00:00Z',hostFactionId:'egypt',humanFactionIds:['egypt','rome'],settings,seasons:Array.from({length:mummyCount},(_,i)=>2025-i)},archive());}
test('authoritative naming preserves ownership, source data, saved identities and exact shared reveal scripts',()=>{
    const five=create(5);for(const faction of five.factions){assert.equal(faction.armies.length,5);assert(faction.armies.every(a=>a.rulerOrigin!=='new-game-title'));assert.equal(new Set(faction.armies.map(a=>a.rulerName)).size,5);}
    let state=create(),own=state.factions.find(f=>f.id==='egypt'),rival=state.factions.find(f=>f.id==='rome'),chosen=Lore.nameLibrary('egypt').rulers[3],before=JSON.stringify(state);
    assert.throws(()=>Engine.applyAction(state,{type:'name-ruler',factionId:'egypt',armyId:rival.armies[0].id,name:chosen.name},archive()),/your living rulers/);assert.equal(JSON.stringify(state),before);
    state=Engine.applyAction(state,{type:'name-ruler',factionId:'egypt',armyId:own.armies[0].id,name:chosen.name},archive());own=state.factions.find(f=>f.id==='egypt');assert.equal(own.armies[0].rulerId,chosen.id);assert.deepEqual(own.armies[0].rulerSource,chosen.source);assert.equal(state.version,4);assert(Engine.validateCampaign(state));
    state=Engine.applyAction(state,{type:'start-draft'},archive());let picks=0;while(state.phase==='draft'){assert(picks++<200);const turn=Engine.draftTurn(state);state=Engine.applyAction(state,{type:'draft-pick',factionId:turn.factionId,playerId:Engine.draftCandidates(state,archive())[0].id},archive());}
    while(state.phase==='reveal'){const id=state.archaeology.order[state.archaeology.revealedFactionIds.length],expected=Lore.revealScript({factionId:id,campaignId:state.id,cycle:state.dynastySeason});state=Engine.applyAction(state,{type:'reveal-next'},archive());const record=state.dynasty.journal.at(-1);assert.equal(record.variantId,expected.id);assert.equal(record.title,expected.title);assert.equal(state.archaeology.latest.stages[0].variantId,expected.id);}
    const saved=JSON.stringify(state.dynasty.journal),projected=Engine.projectCampaign(state,'rome');assert.equal(projected.seed,undefined);assert.deepEqual(Lore.journey({factionId:'egypt',campaignId:state.id,cycle:1}),Lore.journey({factionId:'egypt',campaignId:projected.id,cycle:1}));
    state=Engine.applyAction(state,{type:'name-ruler',factionId:'egypt',armyId:own.armies[0].id,name:'My explicit custom name'},archive());assert.equal(JSON.stringify(state.dynasty.journal),saved,'Explicit current naming never rewrites the historical journal');
    state=Engine.applyAction(state,{type:'advance-week'},archive());assert.throws(()=>Engine.applyAction(state,{type:'name-ruler',factionId:'egypt',armyId:own.armies[0].id,name:'Too late'},archive()),/before Week 1/);
});
