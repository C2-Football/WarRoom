'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('js/free-agency.js','utf8'), storage=new Map();
const window={App:{},WR:{},S:{user:{username:'owner'}}};
const c=vm.createContext({window,console,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
vm.runInContext(src.slice(0,src.indexOf('    // ── UDFA craze')),c);
vm.runInContext(src.slice(src.indexOf('    const WAIVER_TAKE_CACHE_TTL_MS'),src.indexOf('    // Shared player headshot')),c);
vm.runInContext(src.slice(src.indexOf('    function waiverBidEvidence'),src.indexOf('    function FaabCommandCard')),c);
const league={league_id:'one',settings:{type:0,waiver_budget:100,waiver_budget_min:0},roster_positions:['QB','BN'],scoring_settings:{pass_td:4}};
const roster={players:['q'],settings:{waiver_budget_used:70}};
const tx=(id,bid,extra={})=>({transaction_id:id,type:'waiver',status:'complete',adds:{q:1},settings:{waiver_bid:bid},...extra});
const txns=[0,5,10,15,20].map((b,i)=>tx(String(i),b));
const e=c.waiverBidEvidence([...txns,txns[0],tx('bad',99,{status:'failed'}),tx('other',90,{league_id:'two'}),tx('unknown',null),tx('multi',80,{adds:{q:1,r:1}})],league,roster,{q:{position:'QB'}},'QB');
assert.equal(e.sampleSize,5);assert.equal(e.low,5);assert.equal(e.median,10);assert.equal(e.high,15);assert.equal(e.remaining,30);assert.equal(e.minBid,0);
assert.equal(c.waiverBidEvidence(txns.slice(0,4),league,{}, {q:{position:'QB'}},'QB').low,null);
assert.equal(c.waiverBidEvidence([],league,{}, {},'QB').remaining,null);
const player={pid:'a',name:'Available Starter',pos:'QB',p:{position:'QB',team:'KC',depth_chart_order:1},dhq:6000,fit:{dropPid:'q',dropName:'Current Backup',weeklyGain:3,seasonGain:1000,candidateProjection:25,dropProjection:15,dropValue:3000,label:'3 points'}};
const read={week:2,owned:[{pid:'q',projection:15,available:true}],beforeWeekly:{total:22}};
const snap=c.buildWaiverTakeContext([player],league,read,roster),sig=JSON.stringify(snap);
assert.equal(snap.candidates[0].possibleDrop.pid,'q');assert.equal(snap.budget.remaining,30);assert.equal(snap.evidence.liveNewsVerified,false);
for(const mutate of [()=>roster.settings.waiver_budget_used++,()=>league.scoring_settings.pass_td++,()=>read.week++,()=>read.owned[0].available=false,()=>player.fit.weeklyGain++,()=>roster.players.push('new')]) {
 const before=JSON.stringify(c.buildWaiverTakeContext([player],league,read,roster));mutate();
 assert.notEqual(JSON.stringify(c.buildWaiverTakeContext([player],league,read,roster)),before);
}
c.saveCachedWaiverTake(league,[{name:'Available Starter'}],sig);assert.equal(c.loadCachedWaiverTake(league).signature,sig);
assert.equal(c.loadCachedWaiverTake({...league,league_id:'other'}).recommendations.length,0);
window.S.user.username='different';assert.equal(c.loadCachedWaiverTake(league).recommendations.length,0);window.S.user.username='owner';
const key=c.waiverTakeCacheKey(league);storage.set(key,JSON.stringify({ts:Date.now()-16*60000,recommendations:[{}],signature:sig}));assert.equal(c.loadCachedWaiverTake(league).recommendations.length,0);
console.log('Waiver bid evidence, decision context and cache isolation passed');
