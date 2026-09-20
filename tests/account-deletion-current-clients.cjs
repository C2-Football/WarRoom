'use strict';
// Companion to prepare-account-deletion-client-patches.py. Executes the actual
// patched current-source functions, not the different C2 frontend.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../tmp/account-deletion-clients');
const shared=fs.readFileSync(path.join(root,'shared/supabase-client.js'),'utf8');
const start=shared.indexOf('window.OD.deleteAccount = async function(');
const fn=shared.slice(start,shared.indexOf('\n};',start)+3);
function context(options={}){
 const state={token:'session-a',calls:[],cleared:[],alerts:[],confirms:[],loads:0};
 const ctx={console,Error,window:{OD:{getSessionToken:()=>state.token},location:{href:'unchanged'}},localStorage:{removeItem:key=>state.cleared.push(key)},
  isConfigured:()=>true,getSessionToken:()=>state.token,SUPABASE_ANON:'fixture-public-key',BACKEND_ENDPOINTS:{fwDeleteAccount:'https://example.invalid/fw-delete-account'},FN_BASE:'https://example.invalid',adminSecret:'fixture-admin',
  confirm:message=>{state.confirms.push(message);return options.cancel?false:true;},alert:message=>state.alerts.push(message),loadUsers:()=>state.loads++,
  fetch:async(url,init)=>{state.calls.push({url,body:JSON.parse(init.body)});if(options.pause)await options.pause;const response=options.responses?.shift()||{status:200,body:{ok:true}};return{status:response.status,ok:response.status>=200&&response.status<300,json:async()=>response.body};},
 };vm.createContext(ctx);vm.runInContext(fn,ctx);return {ctx,state};
}
function settings(label,ctx){const text=fs.readFileSync(path.join(root,label,'js/settings.js'),'utf8');const from=text.indexOf('    async function dhqDeleteAccountFlow()');const end=text.indexOf('    window.dhqDeleteAccountFlow = dhqDeleteAccountFlow;',from);vm.runInContext(text.slice(from,end)+'\nwindow.dhqDeleteAccountFlow=dhqDeleteAccountFlow;',ctx);}
function admin(label,ctx){const text=fs.readFileSync(path.join(root,label,'admin.html'),'utf8');const from=text.indexOf('  async function requestDelete(');const end=text.indexOf("  document.getElementById('users-tbody').addEventListener",from);vm.runInContext(text.slice(from,end),ctx);}
(async()=>{
 for(const label of ['native','public']){
  let x=context({responses:[{status:503,body:{error:'Account remains; some billing cancellations may already have completed. Retry.'}}]});settings(label,x.ctx);assert.equal(await x.ctx.window.dhqDeleteAccountFlow(),false);assert.equal(x.state.cleared.length,0);assert.equal(x.ctx.window.location.href,'unchanged');assert.match(x.state.alerts[0],/some billing cancellations/);assert.match(x.state.confirms[1],/Apple and Google subscriptions/);
  x=context({responses:[{status:200,body:{}}]});settings(label,x.ctx);assert.equal(await x.ctx.window.dhqDeleteAccountFlow(),false);assert.equal(x.state.cleared.length,0,'malformed success never signs out');
  let release;const pause=new Promise(resolve=>release=resolve);x=context({pause});settings(label,x.ctx);const pending=x.ctx.window.dhqDeleteAccountFlow();x.state.token='session-b';release();assert.equal(await pending,false);assert.equal(x.state.cleared.length,0);assert.equal(x.ctx.window.location.href,'unchanged');assert.match(x.state.alerts[0],/previous account/);
  x=context({responses:[{status:200,body:{ok:true,managedSubscriptions:['app_store']}}]});settings(label,x.ctx);assert.equal(await x.ctx.window.dhqDeleteAccountFlow(),true);assert.equal(x.ctx.window.location.href,'landing.html?signout=1');assert(x.state.cleared.length>0);assert.match(x.state.alerts[0],/subscriptions must still be managed/);
  x=context({responses:[{status:409,body:{error:'Account state changed. Retry deletion.'}}]});admin(label,x.ctx);await x.ctx.deleteUserFlow('target@example.invalid');assert.equal(x.state.calls.length,1);assert.equal(x.state.confirms.length,1,'state conflict cannot become forced paid-account deletion');assert.match(x.state.alerts[0],/state changed/);assert.equal(x.state.loads,0);
  x=context({responses:[{status:409,body:{error:'paying_customer',message:'Confirm Stripe cancellation; store subscriptions stay managed with the store.'}},{status:200,body:{ok:true,deletedAuthUsers:1,managedSubscriptions:['app_store']}}]});admin(label,x.ctx);await x.ctx.deleteUserFlow('target@example.invalid');assert.equal(x.state.calls.length,2);assert.equal(x.state.calls[1].body.force,true);assert.equal(x.state.loads,1);assert.match(x.state.alerts[0],/subscriptions must still be managed/);
  console.log('PASS actual patched '+label+' settings/admin: truthful failure, malformed success, late account switch, store notice and exact paid-confirmation retry');
 }
 const x=context();x.state.token='session-b';await assert.rejects(x.ctx.window.OD.deleteAccount({expectedToken:'session-a'}),/account changed/);assert.equal(x.state.calls.length,0);
 console.log('PASS actual patched shared helper refuses mismatched account before request');
})().catch(error=>{console.error(error);process.exitCode=1;});
