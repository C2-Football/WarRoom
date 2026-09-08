const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/duat/provinces.js');
const W = require('../js/duat/world.js');
const C = require('../js/duat/conquest.js');
const time = '2026-09-08T19:00:00Z';
const fresh = (options = {}) => C.createDynastyConquest({ season: 1, seed: 'province-tests', factionIds: ['rome','gaul','egypt','china'], conquestMode: 'original', ...options });
const standings = (state, scores = [120,110,100,90]) => state.factionIds.map((factionId,index) => ({factionId,place:index+1,score:scores[index]}));
const week = (state, value, options = {}) => C.recordWeek(state, {week:value,results:standings(state),createdAt:time,...options});
const claim = (state, id, target) => C.claimTerritory(state,{factionId:id,territoryId:target,createdAt:time});
function frozen(value) { Object.values(value).forEach(v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v))frozen(v);});return Object.freeze(value); }
function occupiedBoard() {
    const state = fresh();
    state.owners = Object.fromEntries(W.TERRITORIES.map(t => [t.id, 'gaul']));
    for(const id of state.factionIds)state.owners[state.homes[id]]=id;
    state.owners.australia='egypt';
    state.claimOrder=Object.fromEntries(state.factionIds.map(id => [id,Object.keys(state.owners).filter(t=>state.owners[t]===id)]));
    // Last-place has only a homeland, so its result cannot open a neutral route.
    return state;
}
test('the public-domain province atlas has source identities, real polygons, labels, and distinct faction homes', () => {
    assert.equal(P.TERRITORIES.length,4594);assert.equal(P.FACTIONS.length,W.FACTIONS.length);
    assert.equal(new Set(P.TERRITORIES.map(t=>t.id)).size,4594);
    assert.equal(P.SOURCE.sourceSha256,'22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5');
    assert.match(P.SOURCE.downloadUrl,/v5\.1\.1/);assert.equal(P.SOURCE.license,'Public domain');
    assert.equal(new Set(P.FACTIONS.map(f=>f.homeTerritoryId)).size,P.FACTIONS.length);
    assert.match(P.SOURCE.boundaryNote,/not historical empire borders/);
    for(const t of P.TERRITORIES) {
        assert(t.sourceId&&t.countryName&&t.countryCode&&t.name&&t.path.startsWith('M'));
        assert(['Polygon','MultiPolygon'].includes(t.geometry.type));assert(t.areaKm2>=1);
        assert(Number.isFinite(t.longitude)&&Math.abs(t.longitude)<=180);assert(Number.isFinite(t.latitude)&&Math.abs(t.latitude)<=90);
        assert(!/NaN|Infinity/.test(t.path));assert(!t.path.includes('M0,0L500,0L1000,0'),'No reversed tiny island can fill the globe');assert.equal(P.territoryById(t.id),t);
    }
    for(const f of P.FACTIONS)assert.equal(P.territoryById(f.homeTerritoryId).homelandOf,f.id);
    assert(Object.isFrozen(P.TERRITORIES[0].geometry.coordinates));
    const total=P.TERRITORIES.reduce((n,t)=>n+t.areaKm2,0);assert(total>130000000&&total<140000000,'Spherical source land areas must not include globe-complement polygons');
});
test('land routes use shared source boundaries; declared navigation connects the entire province board', () => {
    const adjacency=new Map(P.TERRITORIES.map(t=>[t.id,[]])),keys=new Set();
    for(const r of P.ROUTES){assert(adjacency.has(r.from)&&adjacency.has(r.to));assert.notEqual(r.from,r.to);
        const key=[r.from,r.to].sort().join(':');assert(!keys.has(key));keys.add(key);
        assert.equal(r.origin,r.type==='land'?'shared-source-boundary':'declared-game-navigation');
        adjacency.get(r.from).push(r.to);adjacency.get(r.to).push(r.from);
    }
    const queue=[P.TERRITORIES[0].id],seen=new Set(queue);
    for(const id of queue)for(const next of adjacency.get(id))if(!seen.has(next)){seen.add(next);queue.push(next);}
    assert.equal(seen.size,P.TERRITORIES.length);assert.equal(P.ROUTES.filter(r=>r.type==='sea').length,350);
});
test('province campaigns claim actual adjacent provinces, track area, and retain the country default', () => {
    let state=week(fresh({worldScale:'provinces'}),1);assert.equal(C.catalogFor(state),P);
    const before=JSON.stringify(state),target=C.eligibleTerritories(state,'rome')[0];
    const after=claim(frozen(state),'rome',target);assert.equal(JSON.stringify(state),before);
    const total=C.landTotals(after,'rome');assert.equal(total.territoryCount,2);assert.equal(total.worldTerritoryCount,4594);assert(total.areaKm2>0&&total.percent>0);
    assert.equal(after.pendingClaims.rome,1);assert.equal(after.campaignActions.rome,1);
    assert.equal(C.catalogFor(fresh()),W);
    assert.throws(()=>C.createConquest({season:1,worldId:P.WORLD_ID,seed:'x'}),{code:'UNKNOWN_WORLD'});
});
test('original conquest requires an exhausted peaceful frontier and a strictly higher completed score', () => {
    let open=week(fresh(),1);assert.deepEqual(C.attackableTerritories(open,'rome'),[]);
    let state=week(occupiedBoard(),1);assert.equal(state.pendingClaims.rome,2);
    const target=C.attackableTerritories(state,'rome')[0],preview=C.previewAttack(state,{factionId:'rome',territoryId:target});
    assert.equal(preview.mode,'original');assert.equal(preview.canAttack,true);assert.equal(preview.winChance,1);assert.equal(preview.attackerRoll,undefined);
    const projected=structuredClone(state);delete projected.seed;
    const after=C.attackTerritory(frozen(projected),{factionId:'rome',territoryId:target,createdAt:time});
    const battle=after.events.at(-1);assert.equal(battle.attackerTotal,120);assert.equal(battle.defenderTotal,110);assert.equal(battle.attackerRoll,0);
    assert.equal(after.owners[target],'rome');assert.equal(after.pendingClaims.rome,1);assert.equal(after.campaignActions.rome,1);
    assert.equal(after.pendingClaims.gaul,0);assert.equal(battle.opposingClaimCancelled,1);
    assert.deepEqual(C.fortifiableTerritories(after,'rome'),[]);
    assert.throws(()=>C.fortifyTerritory(after,{factionId:'rome',territoryId:target,createdAt:time}),{code:'COMBAT_UNAVAILABLE'});
    const tied=week(occupiedBoard(),1,{results:standings(state,[110,110,100,90])});
    assert.equal(C.previewAttack(tied,{factionId:'rome',territoryId:target}).canAttack,false);
});
test('original final-territory protection replaces homeland immunity; newest owned land is lost first', () => {
    let state=week(occupiedBoard(),1);assert(C.attackableTerritories(state,'rome').includes(state.homes.gaul));
    const gaulHome=state.homes.gaul;state=C.attackTerritory(state,{factionId:'rome',territoryId:gaulHome,createdAt:time});
    assert.equal(state.owners[gaulHome],'rome');assert(!C.attackableTerritories(state,'gaul').includes(state.homes.china));
    const results=standings(state).map(r=>({...r,place:r.factionId==='rome'?4:r.factionId==='china'?1:r.place}));
    state=week(state,2,{results});assert.equal(state.owners[gaulHome],undefined);assert.equal(state.owners[state.homes.rome],'rome');
    state=week(state,3,{results});assert.equal(state.owners[state.homes.rome],'rome');assert.equal(state.events.find(e=>e.type==='result'&&e.factionId==='rome'&&e.week===3).outcome,'final-territory-held');
});
test('only weekly first place can use a sea passage in original mode', () => {
    const initial=fresh({factionIds:['england','egypt','rome','china']});
    const sea=W.ROUTES.find(r=>r.type==='sea'&&(r.from===initial.homes.england||r.to===initial.homes.england));
    assert(sea);const target=sea.from===initial.homes.england?sea.to:sea.from;
    const first=week(initial,1);assert(C.eligibleTerritories(first,'england').includes(target));
    const second=week(initial,1,{results:standings(initial).map(r=>({...r,place:r.place===1?2:r.place===2?1:r.place}))});
    assert(!C.eligibleTerritories(second,'england').includes(target));
    assert.match(C.ORIGINAL_RULES.adaptation,/source leaves crossing interactions incomplete/);
});
test('the configured playoff calendar awards only verified survivors, including a final-week claim', () => {
    let state=fresh();for(let w=1;w<=17;w++)state=week(state,w,{regularSeasonWeeks:15,advancingFactionIds:w>15?['gaul']:[]});
    const last=state.events.filter(e=>e.type==='result'&&e.week===17);
    assert.equal(last.find(e=>e.factionId==='gaul').claimsAwarded,1);assert(last.filter(e=>e.factionId!=='gaul').every(e=>e.claimsAwarded===0));
    const target=C.eligibleTerritories(state,'gaul')[0];state=claim(state,'gaul',target);assert.equal(state.events.at(-1).week,17);
    assert.equal(week(state,17,{regularSeasonWeeks:15,advancingFactionIds:['gaul']}),state);
    assert.throws(()=>week(state,17,{regularSeasonWeeks:15,advancingFactionIds:['rome']}),{code:'RESULT_CONFLICT'});
});
test('continuing a dynasty keeps territory, routes, forts and history while resetting score authority and reserves', () => {
    let state=fresh({worldScale:'provinces',conquestMode:'combat'});
    for(let w=1;w<=17;w++)state=week(state,w,{regularSeasonWeeks:15,advancingFactionIds:w>15?['rome']:[]});
    const target=C.eligibleTerritories(state,'rome')[0];state=claim(state,'rome',target);state.fortifications[target]=2;
    const next=C.continueSeason(frozen(state),{season:2,createdAt:time});
    assert.deepEqual(next.owners,state.owners);assert.deepEqual(next.fortifications,state.fortifications);assert.equal(C.catalogFor(next).WORLD_ID,P.WORLD_ID);assert.deepEqual(next.routes,state.routes);
    assert.equal(next.events.length,state.events.length+1);assert(Object.values(next.pendingClaims).every(n=>n===0));assert(Object.values(next.campaignActions).every(n=>n===0));
    const first=week(next,1);assert.equal(first.events.find(e=>e.id==='result-2-1-rome').week,1);
    assert.equal(first.events.filter(e=>e.type==='result'&&e.season===1).length,68);
    assert.throws(()=>week(next,2),{code:'WEEK_ORDER'});
    assert.throws(()=>C.continueSeason(next,{season:4,createdAt:time}),{code:'INVALID_SEASON'});
});
test('province frontier and warfare lookups avoid a routes-by-territories cross-product', () => {
    const state=week(fresh({worldScale:'provinces'}),1),start=performance.now();
    for(let i=0;i<100;i++)for(const id of state.factionIds){C.eligibleTerritories(state,id);C.attackableTerritories(state,id);C.landTotals(state,id);}
    assert(performance.now()-start<2000,'400 complete faction board lookups should stay interactive');
});

test('province combat starts equally with connected domains and immediate rival fronts', () => {
    const state=C.createDynastyConquest({season:1,seed:'early-fronts',factionIds:require('../js/duat/rules.js').FACTIONS.map(f=>f.id),worldScale:'provinces',conquestMode:'combat'});
    assert.equal(state.routes.length,20);assert(state.routes.every(r=>r.origin==='declared-campaign-passage'&&r.type==='sea'));
    for(const id of state.factionIds){assert.equal(C.ownedTerritories(state,id).length,3);assert(C.attackableTerritories(state,id).length>0);assert.equal(state.owners[state.homes[id]],id);
        const domain=new Set(state.startingDomains[id]),seen=new Set([state.homes[id]]);for(let n=0;n<3;n++)for(const r of P.ROUTES)if(r.type==='land'&&domain.has(r.from)&&domain.has(r.to)&&(seen.has(r.from)||seen.has(r.to))){seen.add(r.from);seen.add(r.to);}assert.equal(seen.size,3);
    }
});
