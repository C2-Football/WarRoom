'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Campaign=require('../js/duat/campaign.js');
const source=fs.readFileSync(require.resolve('../js/duat/storage.js'),'utf8');
const KEY='dhq-duat-campaigns-v1',PREFIX='dhq-duat-campaign-v1:';
const copy=value=>JSON.parse(JSON.stringify(value));
// Deterministic synthetic roster data: these tests exercise save transactions,
// not historical scoring. Campaigns still pass the real game validator.
const seasons=[2022,2023,2024,2025],cards=[];
for(const [position,count] of [['QB',30],['RB',80],['WR',90],['TE',40]]){
    for(let i=0;i<count;i++){
        const player={name:position+' Storage Player '+i,position};
        cards.push({...player,identity:globalThis.App.TimeLeagueDraftRoom.canonicalPlayerIdentity(player),seasons:seasons.map(season=>({season,games:17,points:100+i}))});
    }
}
const logIndex=new Map(seasons.flatMap(season=>Array.from({length:17},(_,i)=>[season+':'+i,{season,week:i+1,position:'QB'}])));
const data={cards,logIndex},stamp='2026-09-08T18:00:00.000Z';
const initial=Campaign.createCampaign({version:1,id:'saved-a',name:'Núbia · "Duat" <West> & East',seed:'storage-fixture',createdAt:stamp,seasons,hostFactionId:'nubia'},data);
const firstWeek=Campaign.applyAction(Campaign.applyAction(initial,{type:'reveal-rulers'},data),{type:'advance-week'},data);
const metadata=state=>({id:state.id,name:state.name,week:state.week,phase:state.phase,factionId:state.hostFactionId,createdAt:state.createdAt});

class LocalStorage {
    constructor(entries=[]){this.values=new Map(entries);this.writes=0;this.removals=0;this.failWriteAt=0;this.blocked=null;}
    guard(operation){if(this.blocked===operation)throw Object.assign(new Error('Browser storage is blocked'),{name:'SecurityError'});}
    get length(){this.guard('length');return this.values.size;}
    key(index){this.guard('key');return [...this.values.keys()][index]??null;}
    getItem(key){this.guard('get');return this.values.get(String(key))??null;}
    setItem(key,value){this.guard('set');this.writes++;if(this.writes===this.failWriteAt)throw Object.assign(new Error('No storage space'),{name:'QuotaExceededError'});this.values.set(String(key),String(value));}
    removeItem(key){this.guard('remove');this.removals++;this.values.delete(String(key));}
}
function open(db){
    const browser={localStorage:db,App:{DuatCampaign:Campaign}};
    vm.runInNewContext(source,{window:browser});
    return browser.App.DuatStorage;
}
function savedDb(state=initial,index=JSON.stringify([metadata(state)])){
    return new LocalStorage([[PREFIX+state.id,JSON.stringify(state)],[KEY,index],['unrelated-app','untouched']]);
}
const snapshot=db=>[...db.values];

test('corrupt shelf recovery validates full saves, preserves names, and never writes during listing',()=>{
    const db=savedDb(initial,'broken-json'),before=snapshot(db),store=open(db);
    assert.deepEqual(copy(store.list()),[metadata(initial)]);
    assert.equal(store.list()[0].name,'Núbia · "Duat" <West> & East');
    assert.deepEqual(snapshot(db),before);assert.equal(db.writes,0);assert.equal(db.removals,0);
});
test('a valid backup restores even when the existing shelf cannot be parsed',()=>{
    const db=savedDb(initial,'broken-json'),store=open(db);
    const backup={...copy(initial),id:'restored-b',name:'Restored dynasty'};
    store.write(backup);
    assert.deepEqual(copy(store.list()).map(row=>row.id),['restored-b','saved-a']);
    assert.equal(store.read('restored-b').name,'Restored dynasty');
    assert.equal(db.getItem(PREFIX+initial.id),JSON.stringify(initial));
    assert.equal(db.getItem('unrelated-app'),'untouched');
});
test('missing, non-array, duplicate, and incomplete shelf entries recover from valid records',()=>{
    const badIndices=[null,'null','{}',JSON.stringify([{id:'saved-a'}]),JSON.stringify([metadata(initial),metadata(initial)])];
    for(const index of badIndices){
        const db=savedDb();if(index===null)db.values.delete(KEY);else db.values.set(KEY,index);
        const before=snapshot(db),store=open(db);
        assert.deepEqual(copy(store.list()),[metadata(initial)]);assert.deepEqual(snapshot(db),before);
    }
});
test('recovery skips incomplete, corrupt, mismatched, and unrelated records without deleting them',()=>{
    const db=savedDb(firstWeek,'broken-json');
    db.values.set(PREFIX+'corrupt','{nope');
    db.values.set(PREFIX+'incomplete',JSON.stringify({id:'incomplete',name:'Bad save',week:1}));
    db.values.set(PREFIX+'wrong-key',JSON.stringify(initial));
    db.values.set('wr-time-league-v1:other',JSON.stringify(initial));
    const before=snapshot(db),store=open(db);
    assert.deepEqual(copy(store.list()),[metadata(firstWeek)]);assert.deepEqual(snapshot(db),before);
    store.write({...copy(initial),id:'restored'});
    for(const key of [PREFIX+'corrupt',PREFIX+'incomplete',PREFIX+'wrong-key','wr-time-league-v1:other'])assert.equal(db.getItem(key),new Map(before).get(key));
});
test('failed second write restores the exact previously saved turn and shelf',()=>{
    const db=savedDb(),store=open(db),before=snapshot(db);
    db.failWriteAt=2;
    assert.throws(()=>store.write(firstWeek),/could not be saved/);
    assert.deepEqual(snapshot(db),before);assert.equal(store.read(initial.id).phase,'preseason');
    assert.equal(store.read(initial.id).completedWeeks.length,0);
    db.failWriteAt=0;store.write(firstWeek);
    assert.equal(store.read(initial.id).completedWeeks.length,1);assert.equal(store.list()[0].week,2);
});
test('failed first write preserves existing progress and a failed creation leaves no phantom campaign',()=>{
    for(const failWriteAt of [1,2]){
        const db=savedDb(),store=open(db),before=snapshot(db);
        db.failWriteAt=failWriteAt;
        assert.throws(()=>store.write({...copy(initial),id:'new-campaign'}),/could not be saved/);
        assert.equal(db.getItem(PREFIX+'new-campaign'),null);assert.deepEqual(snapshot(db),before);
    }
});
test('failed restore retains the exact corrupt shelf and damaged records for another attempt',()=>{
    const db=savedDb(initial,'original broken shelf');db.values.set(PREFIX+'damaged','original damaged data');
    const before=snapshot(db),store=open(db);db.failWriteAt=2;
    assert.throws(()=>store.write({...copy(initial),id:'backup'}),/could not be saved/);
    assert.deepEqual(snapshot(db),before);assert.deepEqual(copy(store.list()),[metadata(initial)]);
});
test('blocked reads and enumeration propagate instead of pretending there are no saves',()=>{
    for(const operation of ['get','length','key']){
        const db=savedDb(initial,'broken-json'),store=open(db);db.blocked=operation;
        assert.throws(()=>store.list(),/storage is blocked/);assert.equal(db.writes,0);
    }
    const db=savedDb(),store=open(db),before=snapshot(db);db.blocked='get';
    assert.throws(()=>store.write(firstWeek),/storage is blocked/);assert.deepEqual(snapshot(db),before);
});
test('invalid imported campaigns cannot replace a valid saved campaign',()=>{
    const db=savedDb(),store=open(db),before=snapshot(db);
    assert.throws(()=>store.write({...copy(initial),factions:[]}),{code:'INVALID_CAMPAIGN'});
    assert.deepEqual(snapshot(db),before);assert.equal(db.writes,0);
});
