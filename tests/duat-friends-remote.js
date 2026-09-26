'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/duat/remote.js','utf8');
function harness(){
    let actor={userId:'host',token:'account-token',kind:'account'},reply={data:{ok:true,rooms:[]}},calls=0,during;
    const App={GameGuest:{getActor:()=>actor},OD:{getClient:()=>({functions:{invoke:async(name,options)=>{calls++;assert.equal(name,'duat');assert.equal(options.headers.Authorization,'Bearer '+actor.token);if(during)during();return reply;}}})}};
    vm.runInNewContext(source,{window:{App}});
    return {request:App.DuatRemote.request,actor:value=>actor=value,reply:value=>reply=value,during:fn=>during=fn,calls:()=>calls};
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
