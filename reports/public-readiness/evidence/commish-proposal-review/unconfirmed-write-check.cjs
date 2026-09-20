'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/shared/commish-proposals.js','utf8');
const KEY='commish_rulelab_proposals',BACKUP=KEY+'_recovery_v1',raw='{"private":"original bytes",';
for(const failedKey of [BACKUP,KEY]){
 const records=new Map([['account:A:'+KEY,raw]]),key=name=>'account:A:'+name;
 const ctx={Date,localStorage:{getItem:k=>records.get(k)??null},App:{AccountStorage:{key,get:(name,fallback)=>{try{return JSON.parse(records.get(key(name))??'null')??fallback;}catch{return fallback;}},set:(name,value)=>{records.set(key(name),JSON.stringify(value));return name!==failedKey;}}}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
 assert.throws(()=>ctx.App.Commish.Proposals.recover(),failedKey===KEY?/new list could not be confirmed/:/copy was not saved/);
 assert.equal(JSON.parse(records.get(key(BACKUP)))[0].raw,raw);
 assert.equal(records.get(key(KEY)),failedKey===KEY?'[]':raw);
 console.log('PASS written but unconfirmed '+failedKey+' keeps original raw bytes and truthful failure');
}
