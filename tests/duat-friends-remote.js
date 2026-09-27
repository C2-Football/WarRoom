'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/duat/remote.js','utf8');
function harness(){
    let actor={userId:'host',token:'account-token',kind:'account'},reply={data:{ok:true,rooms:[]}},calls=0,during;const bodies=[];
    const App={GameGuest:{getActor:()=>actor},OD:{getClient:()=>({functions:{invoke:async(name,options)=>{calls++;bodies.push(options.body);assert.equal(name,'duat');assert.equal(options.headers.Authorization,'Bearer '+actor.token);if(during)during();return reply;}}})}};
    vm.runInNewContext(source,{window:{App}});
    return {request:App.DuatRemote.request,actor:value=>actor=value,reply:value=>reply=value,during:fn=>during=fn,calls:()=>calls,bodies};
}
test('Duat transports scoped guest credentials without a Dynasty HQ account',async()=>{
    const page=harness();page.actor({userId:'guest',token:'guest-token',kind:'guest',roomId:'private-room'});
    assert.equal((await page.request({op:'load',roomId:'private-room'})).ok,true);assert.equal(page.calls(),1);
    page.actor(null);const missing=await page.request({op:'list'});assert.equal(missing.authRequired,true);assert.equal(page.calls(),1);
});
test('Duat caches only a rejected credential and retries a replacement token',async()=>{
    const page=harness();page.reply({error:{context:{status:401,json:async()=>({error:'Unauthorized'})}}});
    assert.equal((await page.request({op:'list'})).authRequired,true);assert.equal((await page.request({op:'action'})).authRequired,true);assert.equal(page.calls(),1);
    page.actor({userId:'host',token:'fresh-token',kind:'account'});page.reply({data:{ok:true}});
    assert.equal((await page.request({op:'list'})).ok,true);assert.equal(page.calls(),2);
});
test('same-user token changes and guest/account switches discard stale replies',async()=>{
    for(const replacement of [{userId:'host',token:'replacement',kind:'account'},{userId:'host',token:'account-token',kind:'guest'}]){
        const page=harness();page.during(()=>page.actor(replacement));const result=await page.request({op:'load'});
        assert.equal(result.ok,false);assert.match(result.error,/changed/);
    }
});
test('ordinary room conflicts stay retryable and preserve revision',async()=>{
    const page=harness();page.reply({error:{context:{status:409,json:async()=>({conflict:true,revision:4,error:'Room changed'})}}});
    const result=await page.request({op:'action'});assert.equal(result.conflict,true);assert.equal(result.revision,4);assert.equal(result.authRequired,undefined);
    await page.request({op:'load'});assert.equal(page.calls(),2);
});

const roomReply=(scouting,id='one')=>({data:{ok:true,room:{id,campaign:{draft:{scouting}}}}});
const archive={armyId:'army',revision:'a'.repeat(64),rows:[{id:'public-player',name:'Public Player',canDraft:false}]};
test('public scouting revision avoids repeated payloads and restores only matching server-approved rows',async()=>{
 const page=harness();page.reply(roomReply(archive));await page.request({op:'load',roomId:'one'});
 assert.equal(page.bodies[0].scoutingRevision,undefined);
 page.reply(roomReply({armyId:'army',revision:archive.revision,unchanged:true}));
 const result=await page.request({op:'load',roomId:'one'});
 assert.equal(page.bodies[1].scoutingRevision,archive.revision);assert.equal(result.room.campaign.draft.scouting.rows[0].id,'public-player');
 assert.equal(result.room.campaign.draft.scouting.unchanged,undefined);
 page.reply(roomReply({armyId:'new-army',revision:'b'.repeat(64),rows:[{id:'different'}]}));await page.request({op:'action',roomId:'one'});
 page.reply(roomReply({armyId:'new-army',revision:'b'.repeat(64),unchanged:true}));
 assert.equal((await page.request({op:'load',roomId:'one'})).room.campaign.draft.scouting.rows[0].id,'different');
});
test('research cache cannot cross a room, actor credential or mismatched army',async()=>{
 for(const change of ['room','token','army']){
  const page=harness();page.reply(roomReply(archive));await page.request({op:'load',roomId:'one'});
  if(change==='token')page.actor({userId:'host',token:'replacement',kind:'account'});
  const roomId=change==='room'?'two':'one';
  page.reply(roomReply({armyId:change==='army'?'other-army':'army',revision:archive.revision,unchanged:true},roomId));
  const result=await page.request({op:'load',roomId,scoutingRevision:archive.revision});
  assert.equal(result.ok,false);if(change!=='army')assert.equal(page.bodies.at(-1).scoutingRevision,undefined);
  page.reply(roomReply(archive,roomId));await page.request({op:'load',roomId});assert.equal(page.bodies.at(-1).scoutingRevision,undefined,'Mismatch forces a full next fetch');
 }
});
