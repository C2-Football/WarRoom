'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../js/duat/weekly-progress.js');
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};};
const campaign=(week=1,completedWeeks=[],extra={})=>({id:'guided-campaign',dynastySeason:1,phase:'season',week,completedWeeks:completedWeeks.map(week=>({week})),...extra});
const context={fingerprint:'chosen-five',legal:true,dirty:false,hasFavors:false};
const stage=(progress,state,extra={})=>P.describe(progress,state,'egypt',{...context,...extra});
const event=(progress,state,type,fields={})=>P.update(progress,state,'egypt',{type,...fields});

test('first week introduces the alliance once, then explicitly confirms lineup before kickoff',()=>{
    const state=campaign(),storage=memory();let progress=P.read(state,'egypt',storage);
    assert.equal(stage(progress,state).stage,'alliance');
    progress=event(progress,state,'alliance-seen');P.write(progress,state,'egypt',storage);
    progress=P.read(state,'egypt',storage);assert.equal(stage(progress,state).stage,'lineup');
    progress=event(progress,state,'lineup-confirm',{fingerprint:context.fingerprint});
    assert.equal(stage(progress,state).stage,'kickoff');
    assert.equal(stage(progress,state,{dirty:true}).stage,'lineup');
    assert.equal(stage(progress,state,{legal:false}).stage,'lineup');
});

test('available favors are optional, unavailable favors disappear and pending Mahdi always needs resolution',()=>{
    const state=campaign();let progress=event(event(P.create(state,'egypt'),state,'alliance-seen'),state,'lineup-confirm',{fingerprint:context.fingerprint});
    assert.equal(stage(progress,state,{hasFavors:false}).stage,'kickoff');
    assert.equal(stage(progress,state,{hasFavors:true}).stage,'favors');
    progress=event(progress,state,'favors-done');
    assert.equal(stage(progress,state,{hasFavors:true}).stage,'kickoff');
    assert.equal(stage(progress,state,{pendingMahdi:true}).stage,'favors');
    assert.equal(stage(progress,state,{pendingMahdi:true,dirty:true}).stage,'lineup');
    assert.equal(stage(progress,state,{fingerprint:'different-army'}).stage,'lineup','A roster-changing ritual requires the new army to be confirmed.');
});

test('engine advances to Week 2 but a refreshed half-played Week 1 stays in its own replay',()=>{
    const before=campaign(),after=campaign(2,[1]),storage=memory();
    let progress=P.create(before,'egypt');progress=event(progress,after,'clock',{week:1,clock:28.2});
    P.write(progress,after,'egypt',storage);progress=P.read(after,'egypt',storage);
    assert.deepEqual({stage:stage(progress,after).stage,week:stage(progress,after).week,prep:stage(progress,after).preparationWeek,clock:stage(progress,after).clock},{stage:'games',week:1,prep:null,clock:28.2});
    progress=event(progress,after,'clock',{week:1,clock:60});assert.equal(stage(progress,after).stage,'recap');
    progress=event(progress,after,'clock',{week:1,clock:0});assert.equal(stage(progress,after).stage,'recap','Replaying an already viewed result cannot reseal it.');
    progress=event(progress,after,'recap-done',{week:1});assert.equal(stage(progress,after).stage,'conquest');
    progress=event(progress,after,'conquest-done',{week:1});
    assert.equal(stage(progress,after).stage,'lineup');assert.equal(stage(progress,after).preparationWeek,2);
    assert.equal(after.completedWeeks.length,1,'Moving to next preparation does not resolve another game.');
});

test('missed remote polls hold the oldest outstanding result and do not unlock later spoilers',()=>{
    let state=campaign(2,[1]),progress=P.create(state,'egypt');
    progress=event(progress,state,'clock',{week:1,clock:12});
    state=campaign(4,[1,2,3]);
    assert.equal(stage(progress,state).resultWeek,1);assert.equal(stage(progress,state).caughtUp,false);
    progress=event(progress,state,'clock',{week:3,clock:60});progress=event(progress,state,'recap-done',{week:3});progress=event(progress,state,'conquest-done',{week:3});
    assert.equal(stage(progress,state).resultWeek,1,'A historical/recent replay cannot skip an older outstanding report.');
    for(const week of [1,2]){progress=event(progress,state,'clock',{week,clock:60});progress=event(progress,state,'recap-done',{week});progress=event(progress,state,'conquest-done',{week});}
    assert.equal(stage(progress,state).resultWeek,3);assert.equal(stage(progress,state).caughtUp,true);
});

test('returning older saves start at their latest report while final week holds the season honors',()=>{
    const state=campaign(17,Array.from({length:17},(_,i)=>i+1),{phase:'complete'});let progress=P.create(state,'egypt');
    assert.equal(stage(progress,state).resultWeek,17);assert.equal(stage(progress,state).stage,'games');
    progress=event(progress,state,'clock',{week:17,clock:60});progress=event(progress,state,'recap-done',{week:17});
    assert.equal(stage(progress,state).stage,'conquest');
    progress=event(progress,state,'conquest-done',{week:17});assert.equal(stage(progress,state).stage,'complete');
    assert.equal(stage(progress,campaign(1,[],{dynastySeason:2})).stage,'alliance');
});

test('campaign, cycle, faction and account scope do not share presentation progress',()=>{
    const state=campaign(),storage=memory(),progress=event(P.create(state,'egypt'),state,'alliance-seen');
    P.write(progress,state,'egypt',storage,'online:owner');
    assert.equal(P.read(state,'egypt',storage,'online:owner').allianceSeen,true);
    for(const [other,faction,scope] of [[state,'rome','online:owner'],[state,'egypt','online:friend'],[{...state,id:'second'},'egypt','online:owner'],[{...state,dynastySeason:2},'egypt','online:owner']])assert.equal(P.read(other,faction,storage,scope).allianceSeen,false);
});

test('malformed or unavailable browser progress falls back without altering the campaign',()=>{
    const state=campaign(2,[1]),original=JSON.stringify(state);
    const storage={getItem(){throw Error('Storage disabled');},setItem(){throw Error('Storage disabled');}};
    let progress=P.read(state,'egypt',storage);progress=event(progress,state,'clock',{week:1,clock:60});
    assert.throws(()=>P.write(progress,state,'egypt',storage),/Storage disabled/);
    assert.equal(stage(progress,state).stage,'recap','The caller can keep in-memory progress even when persistence fails.');
    assert.equal(JSON.stringify(state),original);
    const invalid={...progress,results:{1:{clock:12,watched:true,recapSeen:true}},reviewedThrough:99};
    assert.equal(stage(invalid,state).stage,'games');
});

test('rolling a backup back removes future acknowledgements and changed results cannot reuse an old recap',()=>{
    const played=campaign(2,[1]),storage=memory();let progress=P.create(played,'egypt');
    for(const type of ['clock','recap-done','conquest-done'])progress=event(progress,played,type,{week:1,clock:60});
    P.write(progress,played,'egypt',storage);
    const restored=campaign();progress=P.read(restored,'egypt',storage);P.write(progress,restored,'egypt',storage);
    assert.deepEqual(progress.results,{});assert.equal(progress.reviewedThrough,0);
    assert.equal(stage(P.read(played,'egypt',storage),played).stage,'games');
    for(const type of ['clock','recap-done','conquest-done'])progress=event(progress,played,type,{week:1,clock:60});
    const changed={...played,completedWeeks:[{week:1,factions:[{factionId:'egypt',total:99,players:[]}]}]};
    assert.equal(stage(progress,changed).stage,'games');assert.equal(stage(progress,changed).week,1);
});
