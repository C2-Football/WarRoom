#!/usr/bin/env node
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Heptad = require('../js/duat/heptad.js');
const Rules = require('../js/duat/rules.js');
const slots = ['QB', 'FLEX', 'FLEX', 'FLEX', 'FLEX'];
const alliance = {id:'h1',name:'The First Pact',teamIds:['a','b'],entry:1};
function player(id, position, points, extra = {}) { return {id,identity:id,name:id,position,starter:true,basePoints:points,effectivePoints:points,...extra}; }
function faction(factionId, players, season = 2020) { return {factionId,season,players}; }
function weekly() { return [faction('a',[player('qa','QB',18),player('ra','RB',20),player('wa','WR',8),player('ta','TE',9),player('wa2','WR',7),player('bench','RB',70,{starter:false})]),faction('b',[player('qb','QB',14),player('rb','RB',12),player('wb','WR',16),player('tb','TE',10),player('wb2','WR',11)])]; }
function tournament() {
    const alliances = Rules.buildHeptadAlliances(Array.from({length:14},(_,i)=>'f'+i),{allianceSize:2},'test-heptad');
    const heptad = Rules.runHeptadGauntlet(alliances,(id,week)=>100-Number(id.slice(1))+week,2);
    return {alliances,heptad};
}
test('2024 defaults retain submitted starters, base points and separate season cards',()=>{
    const results=weekly(); results[0].players[2].effectivePoints=200;
    const before=JSON.stringify(results), score=Heptad.scoreAlliance(alliance,results,slots);
    assert.deepEqual(score.options,{pool:'starters',duplicates:'allow',favorPoints:false});
    assert.equal(score.total,77);
    assert.equal(score.contributors.length,5);
    assert.ok(!score.contributors.some(p=>p.id==='bench'));
    assert.ok(!score.contributors.some(p=>p.id==='wa'));
    assert.equal(score.mvp.playerId,'ra');
    assert.equal(score.members.reduce((sum,member)=>sum+member.points,0),score.total);
    assert.equal(JSON.stringify(results),before);
});
test('explicit army and favor options change the eligible pool and produce exact receipts',()=>{
    const results=weekly(); results[0].players[2].effectivePoints=40;
    const score=Heptad.scoreAlliance(alliance,results,slots,{pool:'army',favorPoints:true});
    assert.equal(score.total,164);
    assert.deepEqual(score.contributors.map(p=>p.id).sort(),['qa','bench','wa','ra','wb'].sort());
    assert.equal(score.contributors.find(p=>p.id==='wa').basePoints,8);
    assert.equal(score.contributors.find(p=>p.id==='wa').points,40);
    assert.equal(score.members.reduce((n,m)=>n+m.counted,0),5);
});
test('unique-athlete best ball chooses one year-version without sacrificing positional legality',()=>{
    const rows=[faction('a',[player('x:2019','QB',30,{identity:'x'}),player('z','QB',12),player('r','RB',9)]),faction('b',[player('x:2020','QB',28,{identity:'x'}),player('y','QB',20),player('w','WR',10)])];
    const allow=Heptad.scoreAlliance(alliance,rows,['QB','SUPER_FLEX']);
    const unique=Heptad.scoreAlliance(alliance,rows,['QB','SUPER_FLEX'],{duplicates:'unique-athlete'});
    assert.equal(allow.total,58); assert.equal(unique.total,50);
    assert.equal(new Set(unique.contributors.map(p=>p.identity)).size,2);
    assert.ok(unique.contributors.some(p=>p.id==='x:2019'));
});
test('slot solver fills Classic and Superflex accurately instead of greedily consuming required players',()=>{
    const rows=[faction('a',[player('qa','QB',21),player('r1','RB',25),player('w1','WR',24),player('t1','TE',22)]),faction('b',[player('qb','QB',20),player('r2','RB',19),player('w2','WR',18),player('t2','TE',17)])];
    const score=Heptad.scoreAlliance(alliance,rows,['QB','RB','RB','WR','WR','TE','FLEX','SUPER_FLEX']);
    assert.equal(score.total,166);assert.equal(score.contributors.length,8);
    assert.equal(new Set(score.contributors.map(p=>p.id)).size,8);
    assert.equal(score.contributors[1].position,'RB');assert.equal(score.contributors[5].position,'TE');
});
test('required negative scores count and absent or unfinalized inputs never become fabricated results',()=>{
    const rows=[faction('a',[player('qa','QB',-2),player('ra','RB',10)]),faction('b',[player('qb','QB',-3),player('rb','RB',5)])];
    assert.equal(Heptad.scoreAlliance(alliance,rows,['QB','FLEX']).total,8);
    assert.throws(()=>Heptad.scoreAlliance(alliance,rows.slice(0,1),['QB','FLEX']),/finalized/);
    assert.throws(()=>Heptad.scoreAlliance(alliance,[{...rows[0],finalized:false},rows[1]],['QB','FLEX']),/finalized/);
    assert.throws(()=>Heptad.scoreAlliance(alliance,[...rows,rows[0]],['QB','FLEX']),/finalized/);
    rows[0].players[0].basePoints=NaN;
    assert.throws(()=>Heptad.scoreAlliance(alliance,rows,['QB','FLEX']),/recorded/);
});
test('alliance naming accepts real multilingual banners and rejects controls, duplicates and markup',()=>{
    assert.equal(Heptad.validateName('  Team 日本一  &   The Reeds  '),'Team 日本一 & The Reeds');
    for(const name of ['', 'x','a'.repeat(61),'<script>','Banner\nOther','Banner\u202ehidden'])assert.throws(()=>Heptad.validateName(name));
    const original=[alliance,{id:'h2',name:'Keepers of Dawn',teamIds:['c','d'],entry:2}];
    assert.throws(()=>Heptad.renameAlliance(original,'h1','keepers of dawn'),/already/);
    const renamed=Heptad.renameAlliance(original,'h1','The Shield of the Ziggurats');
    assert.equal(original[0].name,'The First Pact');assert.equal(renamed[0].customName,true);
});
test('progress explains pending entrants and keeps the championship reset a second life',()=>{
    const {alliances}=tournament();
    const start=Heptad.progress(alliances,null);
    assert.equal(start[0].next.week,2);assert.equal(start[1].next.week,2);assert.equal(start[6].entranceWeek,7);
    assert.equal(start[6].lives,2);
    const finished=Rules.runHeptadGauntlet(alliances,(id,week)=>week===9 && id==='h1'?0:100-Number(id.slice(1)),2);
    assert.ok(finished.matches.some(m=>m.bracket==='rematch'));
    assert.equal(Heptad.progress(alliances,finished).find(a=>a.id===finished.championId).status,'champion');
    assert.ok(Heptad.progress(alliances,finished).filter(a=>a.id!==finished.championId).every(a=>a.lives===0));
});
test('Pinnacle offers only a real non-finalist after the resolved tournament and reserves the canonical Week 11',()=>{
    const {alliances,heptad}=tournament();
    assert.equal(Heptad.createPinnacle({heptad:null,alliances}),null);
    const p=Heptad.createPinnacle({heptad,alliances});
    assert.equal(p.status,'offered');assert.equal(p.earliestWeek,11);assert.equal(p.participantFactionIds.length,4);
    assert.notEqual(p.challengerId,heptad.runnerUpId);
    const two=alliances.slice(0,2), twoGame=Rules.runHeptadGauntlet(two,(id)=>id==='h1'?20:10,2);
    assert.equal(Heptad.createPinnacle({heptad:twoGame,alliances:two}).status,'unavailable');
});
test('Pinnacle scheduling requires participant agreement and rejects past weeks or outsider consent',()=>{
    const {alliances,heptad}=tournament(), p=Heptad.createPinnacle({heptad,alliances});
    const [a,b,c,d]=p.participantFactionIds;
    assert.throws(()=>Heptad.proposePinnacle(p,{week:11,currentWeek:10,factionId:'outsider'}),/Only/);
    assert.throws(()=>Heptad.proposePinnacle(p,{week:9,currentWeek:10,factionId:a}),/unplayed/);
    assert.throws(()=>Heptad.proposePinnacle(p,{week:11,currentWeek:10,factionId:a,autoApproveFactionIds:['outside']}),/Only/);
    let pending=Heptad.proposePinnacle(p,{week:11,currentWeek:10,factionId:a,autoApproveFactionIds:[b]});
    assert.equal(pending.status,'proposed');assert.equal(p.status,'offered');
    pending=Heptad.approvePinnacle(pending,{factionId:c,currentWeek:10});
    assert.equal(pending.status,'proposed');
    pending=Heptad.approvePinnacle(pending,{factionId:d,currentWeek:11});
    assert.equal(pending.status,'scheduled');
    assert.throws(()=>Heptad.proposePinnacle(pending,{week:12,currentWeek:11,factionId:a}),/locked/);
    assert.throws(()=>Heptad.declinePinnacle(pending,{factionId:a}),/locked/);
});
test('changing a proposed week resets consent, stale approvals fail, and decline never alters the main title',()=>{
    const {alliances,heptad}=tournament(), p=Heptad.createPinnacle({heptad,alliances});
    let pending=Heptad.proposePinnacle(p,{week:11,currentWeek:10,factionId:p.participantFactionIds[0],autoApproveFactionIds:[p.participantFactionIds[1]]});
    assert.throws(()=>Heptad.approvePinnacle(pending,{factionId:p.participantFactionIds[2],currentWeek:12}),/unplayed/);
    pending=Heptad.proposePinnacle(pending,{week:13,currentWeek:12,factionId:p.participantFactionIds[2]});
    assert.deepEqual(pending.approvedFactionIds,[p.participantFactionIds[2]]);
    const declined=Heptad.declinePinnacle(pending,{factionId:p.participantFactionIds[0]});
    assert.equal(declined.status,'declined');assert.equal(heptad.championId,p.championId);
});
test('the optional title defense resolves only its agreed finalized week and ties keep the reigning holder',()=>{
    const {alliances,heptad}=tournament(), p=Heptad.createPinnacle({heptad,alliances});
    const scheduled=Heptad.proposePinnacle(p,{week:11,currentWeek:10,factionId:p.participantFactionIds[0],autoApproveFactionIds:p.participantFactionIds});
    const result={week:11,allianceScores:[{allianceId:p.championId,total:50,contributors:[{playerId:'mvp',points:40,name:'MVP',factionId:p.participantFactionIds[0]}]},{allianceId:p.challengerId,total:50,contributors:[]}]};
    assert.equal(Heptad.resolvePinnacle(scheduled,{...result,week:12}).status,'scheduled');
    assert.throws(()=>Heptad.resolvePinnacle(scheduled,{...result,finalized:false}),/finalized/);
    const tied=Heptad.resolvePinnacle(scheduled,result);
    assert.equal(tied.result.winnerId,p.championId);assert.equal(tied.result.tied,true);assert.equal(tied.result.mvp.playerId,'mvp');
    result.allianceScores[1].total=51;
    const won=Heptad.resolvePinnacle(scheduled,result);
    assert.equal(won.result.winnerId,p.challengerId);assert.equal(won.result.defended,false);
    assert.equal(heptad.championId,p.championId,'The Heptad history is not overwritten by a later title defense');
});
test('match MVP is the highest actual contributor across both alliances and never reads later weeks',()=>{
    const match={week:2,homeId:'h1',awayId:'h2'};
    const weeks=[{week:2,allianceScores:[{allianceId:'h1',contributors:[{playerId:'one',points:20}]},{allianceId:'h2',contributors:[{playerId:'two',points:30}]}]},{week:3,allianceScores:[{allianceId:'h1',contributors:[{playerId:'future',points:100}]}]}];
    assert.equal(Heptad.matchMVP(match,weeks).playerId,'two');assert.equal(Heptad.matchMVP({...match,week:1},weeks),null);
});
test('persistent records are idempotent by season, retain renamed champions and survive recurring alliance IDs',()=>{
    const {alliances,heptad}=tournament();
    const named=Heptad.renameAlliance(alliances,heptad.championId,'The Shield of the Ziggurats');
    const context={seasonId:'campaign-one:season-one',alliances:named,heptad};
    const once=Heptad.archiveSeason([],context), twice=Heptad.archiveSeason(once,context);
    assert.deepEqual(twice,once);assert.equal(once.length,7);
    const champion=Heptad.championGallery(once)[0];
    assert.equal(champion.name,'The Shield of the Ziggurats');assert.equal(champion.finalist,true);assert.equal(champion.played,7);
    const two=Heptad.archiveSeason(once,{...context,seasonId:'campaign-one:season-two'});
    assert.equal(two.length,14);assert.equal(Heptad.championGallery(two).length,2);
    assert.throws(()=>Heptad.archiveSeason([],{...context,heptad:null}),/Finish/);
});
test('browser helper registers without storage, network or undeclared engine dependencies',()=>{
    const source=fs.readFileSync(require.resolve('../js/duat/heptad.js'),'utf8');
    const context={window:{App:{DuatRules:Rules}}};vm.runInNewContext(source,context);
    assert.equal(typeof context.window.App.DuatHeptad.scoreWeek,'function');
    assert.equal(context.window.App.DuatHeptad.normalizeOptions().pool,'starters');
});
