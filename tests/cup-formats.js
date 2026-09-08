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
