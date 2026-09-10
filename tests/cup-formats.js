const assert=require('node:assert/strict');
const C=require('../js/shared/woeppel-cup.js'),T=C.tournament;
function league(n){return {rosters:Array.from({length:n},(_,i)=>({roster_id:i+1})),settings:{playoff_week_start:15}};}
function fill(s,weeks){for(const week of weeks)s.weeks[week]={final:true,scores:Object.fromEntries(s.teams.map((id,i)=>[id,200-i*7+week]))};}
for(const n of [2,3,5,6,8,10,12,14,16,24,32,64]){
 const s=T.defaults(league(n));s.locked=true;s.enabled=true;C.validate(s);
 assert.equal(T.schedule(s).at(-1),14);assert.ok(s.qualifierCount<=n);
 fill(s,Array.from({length:s.groupWeeks},(_,i)=>s.startWeek+i));
 assert.equal(C.qualifiers(s).length,s.qualifierCount);
 fill(s,T.schedule(s));const rounds=C.knockout(s);assert.equal(rounds.length,Math.log2(s.qualifierCount));assert.equal(rounds.at(-1)[0].winner,'1');
 const b=C.bracket(s);if(s.qualifierCount===8)assert.deepEqual(b,[['1','8'],['4','5'],['2','7'],['3','6']]);
 const first=b[0],w=s.knockoutStart;s.weeks[w].scores[first[1]]=s.weeks[w].scores[first[0]];
 assert.equal(C.knockout(s)[0][0].winner,null);
 s.tieRulings={[`${w}:${first[0]}:${first[1]}`]:{winner:first[0],reason:'Agreed tiebreak'}};assert.equal(C.knockout(s).at(-1)[0].winner,'1');
 s.weeks[s.startWeek].final=false;assert.throws(()=>C.qualifiers(s),/Finalize/);
}
for(const n of [3,4,5,6,8,10,12]){
 const s=T.defaults(league(n));Object.assign(s,{format:'round-robin',startWeek:1,groupWeeks:n%2?n:n-1,knockoutStart:(n%2?n:n-1)+1});
 const fixtures=C.fixtures(s),pairs=new Set(fixtures.map(f=>[f.a,f.b].sort().join(':')));assert.equal(pairs.size,n*(n-1)/2);
 for(let week=1;week<=s.groupWeeks;week++){const ids=fixtures.filter(f=>f.week===week).flatMap(f=>[f.a,f.b]);assert.equal(ids.length,new Set(ids).size);}
 fill(s,T.schedule(s));assert.ok(C.tables(s).every(r=>r.played===n-1));assert.equal(C.qualifiers(s)[0].id,'1');
}
const s=T.defaults(league(12));s.knockoutStart=18;assert.throws(()=>C.validate(s),/Weeks 1–18/);
s.knockoutStart=s.startWeek;assert.throws(()=>C.validate(s),/non-overlapping/);
s.knockoutStart=12;s.qualifierCount=7;assert.throws(()=>C.validate(s),/Knockout field/);
s.qualifierCount=8;s.format='round-robin';assert.throws(()=>C.validate(s),/complete 11-week/);
s.format='points';fill(s,T.schedule(s));s.weeks[s.startWeek].scores['2']=s.weeks[s.startWeek].scores['1']+14;assert.throws(()=>C.qualifiers(s),/tied/);
s.seedRuling={reason:'League tiebreak',ids:s.teams.slice(0,8)};assert.equal(C.qualifiers(s).length,8);
s.seedRuling.ids[1]='1';assert.throws(()=>C.qualifiers(s),/different/);
console.log('Configurable Cup: league sizes, odd-team byes, round robin fairness, seed placement, calendar bounds and ties passed');

assert.deepEqual(T.formats.map(f=>f.id),['points','round-robin','all-play','median','knockout','survivor']);
assert.ok(T.formats.every(f=>f.name&&f.tagline&&f.description));
for(const format of T.formats.map(f=>f.id))for(const teams of [[],['2']]){
 const incomplete=T.configure(league(6),format,{teams});
 assert.deepEqual(incomplete.teams,teams,'explicit incomplete selection stays editable');
 assert.ok(T.schedule(incomplete).every(Number.isFinite));assert.ok(Number.isFinite(T.roundCount(incomplete)));
 assert.throws(()=>T.validate(incomplete),/2–64 different teams/);
}
for(const format of ['all-play','median']){
 const state=T.configure(league(4),format);Object.assign(state,{startWeek:1,groupWeeks:1,knockoutStart:2,qualifierCount:4,drawMargin:100});
 state.weeks[1]={final:false,scores:{1:10,2:0,3:0,4:-1}};
 assert.ok(T.tables(state).every(r=>r.played===0),'provisional qualifying data does not count');assert.equal(T.result(state),null);
 state.weeks[1].final=true;
 const rows=T.tables(state);assert.deepEqual(rows.map(r=>r.points),format==='all-play'?[3,1.5,1.5,0]:[1,0.5,0.5,0]);
 assert.ok(rows.every(r=>r.played===1));assert.equal(rows.find(r=>r.id==='4').pf,-1);assert.equal(T.fixtures(state).length,0);
 assert.throws(()=>T.qualifiers(state),/tied/,'seeding tie is not implicitly broken');
 state.seedRuling={ids:['1','2','3','4'],reason:'Agreed equal-score seed order'};
 fill(state,[2,3]);assert.equal(T.result(state).champion,'1');
 delete state.weeks[1].scores['4'];assert.throws(()=>T.tables(state),/missing scores/);assert.equal(T.result(state),null);
}
const oddMedian=T.configure(league(3),'median');Object.assign(oddMedian,{startWeek:1,groupWeeks:1,knockoutStart:2});oddMedian.weeks[1]={final:true,scores:{1:7,2:0,3:-2}};
assert.deepEqual(T.tables(oddMedian).map(r=>r.points),[1,0.5,0]);

for(let n=2;n<=64;n++){
 const state=T.configure(league(n),'knockout');T.validate(state);
 assert.equal(T.roundCount(state),Math.ceil(Math.log2(n)));assert.equal(state.groupWeeks,0);assert.equal(state.qualifierCount,n);
 assert.equal(T.schedule(state).at(-1),14);assert.equal(T.result(state),null);
 const pairs=T.bracket(state);assert.equal(pairs.length,2**Math.ceil(Math.log2(n))/2);
 assert.equal(pairs.flat().filter(Boolean).length,n);assert.equal(new Set(pairs.flat().filter(Boolean)).size,n);
 const byes=T.knockout(state)[0].filter(m=>m.bye);assert.equal(byes.length,2**Math.ceil(Math.log2(n))-n);
 assert.deepEqual(byes.map(m=>Number(m.a)).sort((a,b)=>a-b),Array.from({length:byes.length},(_,i)=>i+1),'top seeds receive byes');
 assert.deepEqual(T.requiredScoreIds(state,state.startWeek).sort(),pairs.filter(p=>p[1]!==null).flat().sort());
 fill(state,T.schedule(state));const final=T.result(state);assert.equal(final.champion,'1');assert.equal(final.runnerUp,'2');assert.equal(final.week,14);
 assert.equal(T.knockout(state).length,Math.ceil(Math.log2(n)));
 state.weeks[state.startWeek].final=false;assert.equal(T.result(state),null);
}
const bye=T.configure(league(3),'knockout');
bye.weeks[bye.startWeek]={final:true,scores:{2:0,3:-2}};
assert.equal(T.knockout(bye).length,2,'seed one bye advances without a score');
assert.deepEqual(T.requiredScoreIds(bye,bye.startWeek+1).sort(),['1','2']);
bye.weeks[bye.startWeek+1]={final:true,scores:{1:0,2:0}};assert.equal(T.result(bye),null);
bye.tieRulings={[`${bye.startWeek+1}:1:2`]:{winner:'2',reason:'League tie rule'}};assert.equal(T.result(bye).champion,'2');
delete bye.weeks[bye.startWeek+1].scores['1'];assert.equal(T.result(bye),null,'tie ruling cannot replace missing score');
const seeded=T.configure(league(5),'knockout',{teams:['5','3','1','2','4'],name:'Custom seeds',enabled:true,weeks:{1:{final:true}},locked:true});
assert.equal(T.bracket(seeded)[0][0],'5');assert.equal(seeded.locked,false);assert.deepEqual(seeded.weeks,{});
assert.throws(()=>T.validate({...seeded,startWeek:18,knockoutStart:18}),/Weeks 1–18/);
assert.throws(()=>T.validate({...seeded,groupWeeks:1}),/zero qualifying/);
assert.throws(()=>T.validate({...seeded,qualifierCount:4}),/all participating/);
const tooLargeRR=T.configure(league(64),'round-robin');assert.equal(tooLargeRR.teams.length,64);assert.throws(()=>T.validate(tooLargeRR),/Weeks 1–18/);

for(const n of [2,3,4,5,8,16,32,64]){
 for(const length of [1,3,18]){
  const state=T.configure(league(n),'survivor');Object.assign(state,{startWeek:1,knockoutStart:1,groupWeeks:length});T.validate(state);
  assert.equal(T.roundCount(state),0);assert.equal(T.knockout(state).length,0);assert.equal(T.result(state),null);
  fill(state,T.schedule(state));const stages=T.survivor(state);let remaining=n;
  stages.forEach((stage,i)=>{assert.equal(stage.cutCount,Math.ceil((remaining-1)/(length-i)));assert.equal(stage.survivors.length,remaining-stage.cutCount);assert.equal(stage.final,true);remaining=stage.survivors.length;});
  assert.equal(remaining,1);assert.equal(T.result(state).champion,'1');
 }
}
const survival=T.configure(league(4),'survivor');Object.assign(survival,{startWeek:1,knockoutStart:1,groupWeeks:2});
survival.weeks[1]={final:false,scores:{1:10,2:5,3:5,4:0}};assert.equal(T.survivor(survival)[0].blocked,true);assert.equal(T.result(survival),null);
survival.weeks[1].final=true;
let stage=T.survivor(survival)[0];assert.deepEqual(stage.pendingTie,{ids:['2','3'],places:1});assert.deepEqual(stage.aboveCutoff,['1']);assert.equal(stage.requiredSurvivors,2);assert.equal(stage.final,false);
assert.deepEqual(T.requiredScoreIds(survival,1),['1','2','3','4']);assert.throws(()=>T.requiredScoreIds(survival,2),/prior survivor/);
survival.survivorRulings={1:{ids:['2','3'],reason:'Bad cutoff'}};assert.throws(()=>T.survivor(survival),/above the cutoff/);
survival.survivorRulings={1:{ids:['1','4'],reason:'Bad cutoff'}};assert.throws(()=>T.validate(survival),/above the cutoff/);
survival.survivorRulings={1:{ids:['1','3'],reason:'Published tie rule'}};
assert.deepEqual(T.requiredScoreIds(survival,2),['1','3']);
survival.weeks[2]={final:true,scores:{1:-2}};assert.equal(T.result(survival),null);assert.equal(T.survivor(survival)[1].blocked,true);
survival.weeks[2].scores['3']=-1;assert.deepEqual(T.result(survival),{champion:'3',runnerUp:'1',winnerScore:-1,runnerScore:-2,week:2});
survival.weeks[2].scores['4']=1000;assert.equal(T.result(survival).champion,'3','eliminated teams cannot rejoin');
survival.weeks[1].final=false;assert.throws(()=>T.survivor(survival),/unresolved or inactive/,'reopening requires downstream/ruling cleanup');
delete survival.survivorRulings;assert.equal(T.result(survival),null);
const single=T.configure(league(4),'survivor');Object.assign(single,{startWeek:18,knockoutStart:18,groupWeeks:1});single.weeks[18]={final:true,scores:{1:100,2:50,3:50,4:0}};
assert.deepEqual(T.result(single),{champion:'1',runnerUp:null,winnerScore:null,runnerScore:null,week:18});
assert.throws(()=>T.validate({...single,groupWeeks:2}),/Weeks 1–18/);
single.survivorRulings={18:{ids:['1'],reason:'Unnecessary'}};assert.throws(()=>T.validate(single),/only valid for a tied cutoff/);
console.log('Six Cup formats: all-play/median points, direct seeded byes 2–64, survivor cuts/ties/rulings, missing and provisional scores, and final results passed');
