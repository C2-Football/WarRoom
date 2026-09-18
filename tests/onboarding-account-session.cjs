'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const helper = fs.readFileSync('js/shared/account-storage.js', 'utf8');
const page = fs.readFileSync('onboarding.html', 'utf8');
const inline = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(code => code.includes('function saveSleeper()'));
const functions = ['goToStripe', 'saveSleeper', 'enterApp', 'getProfile', 'patchProfile', 'getUsername'];
const boot = Babel.transform(inline, { plugins: [() => ({ visitor: { Program(path) { path.node.body = path.node.body.filter(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' && n.expression.callee.type === 'FunctionExpression' && n.expression.callee.id?.name === 'init'); } } })] }).code;
const code = Babel.transform(inline, { plugins: [() => ({ visitor: { Program(path) { path.node.body = path.node.body.filter(n => n.type === 'FunctionDeclaration' && functions.includes(n.id.name)); } } })] }).code;
function storage() {
  const map = new Map();
  return { map, get length() { return map.size; }, key: i => [...map.keys()][i], getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,String(v)), removeItem: k => map.delete(k) };
}
function browser() {
  const local = storage(), temporary = storage(), elements = {}, listeners = {}, log = [], timers = [];
  const install = id => { local.setItem('fw_session_v1', JSON.stringify({token:'synthetic-'+id,user:{id}})); local.setItem('wr_active_connection_owner_v1','account:'+id); local.setItem('od_profile_v1',JSON.stringify({private:id})); };
  install('a');
  const main = { textContent: 'A setup', replaceChildren() { this.textContent = ''; log.push('hide'); } };
  for (const id of ['sleeperUsernameInput','alertSleeper','sleeperBtn','alertPayment','stripeBtn']) elements[id] = {value:'verified-user',textContent:'',className:'',disabled:false};
  const context = vm.createContext({ console, URL, atob, localStorage:local, sessionStorage:temporary,
    document:{ getElementById: id => id === 'account-session-root' ? main : elements[id] || null, addEventListener:(name,fn)=>listeners[name]=fn },
    addEventListener:(name,fn)=>listeners[name]=fn,
    location:{href:'onboarding.html',origin:'https://example.invalid',pathname:'/onboarding.html',reload:()=>log.push('reload')},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},
    OD:{saveProfile:async p=>log.push(['cloud-profile',p]),savePlatformUsernames:async p=>log.push(['cloud-username',p])},
    goStep5:()=>{context.enterApp();},
  });
  context.window = context;
  vm.runInContext(helper,context);
  vm.runInContext("const PROFILE_KEY='od_profile_v1', SESSION_KEY='fw_session_v1', LEGACY_KEY='od_auth_v1', SUPABASE_URL='https://example.invalid'; let selectedStandardProduct='war_room';",context);
  vm.runInContext(code,context);
  return {context,local,install,elements,listeners,main,log,timers};
}
(async()=> {
  assert(page.includes('id="account-session-root"'));
  assert(page.includes('js/shared/account-storage.js?v='));
  for (const value of ['broken-json', JSON.stringify({token:'expired.'+Buffer.from(JSON.stringify({exp:1})).toString('base64')+'.signature',user:{id:'a'}}), 'null']) {
    const invalid = browser(); invalid.local.setItem('fw_session_v1',value);
    invalid.local.setItem('od_auth_v1',JSON.stringify({username:'connection-only'}));
    vm.runInContext(boot, invalid.context);
    assert.equal(invalid.context.location.href,'login.html','malformed/expired sessions and connection metadata alone cannot enter setup');
  }
  const b = browser();
  let resolve;
  b.context.fetch = () => new Promise(done=>{resolve=done;});
  const pending = b.context.saveSleeper();
  b.install('b');
  const before=[...b.local.map];
  resolve({ok:true,json:async()=>({user_id:'public-sleeper-id'})});
  await pending;
  assert.deepEqual([...b.local.map],before,'a delayed A lookup cannot modify B connection/profile before a storage event');
  assert(!b.log.some(entry=>Array.isArray(entry)), 'no stale cloud writes');
  assert(b.log.includes('reload')); assert(!b.main.textContent.includes('A setup'));
  assert.deepEqual(JSON.parse(JSON.stringify(b.context.getProfile())),{});
  assert.throws(()=>b.context.patchProfile({tier:'standard'}), /account changed/);
  b.context.enterApp(); assert.equal(b.context.location.href,'onboarding.html');
  assert.equal(b.context.getUsername(),'Commander');

  const checkout = browser();
  checkout.context.fetch = () => new Promise(done=>{resolve=done;});
  const paying = checkout.context.goToStripe();
  checkout.install('b');
  resolve({ok:true,json:async()=>({checkoutUrl:'https://checkout.example.invalid/account-a'})});
  await paying;
  assert.equal(checkout.context.location.href,'onboarding.html','late checkout cannot send B into A checkout');
  assert(checkout.log.includes('reload'));

  const happy=browser();
  happy.local.setItem('od_auth_v1',JSON.stringify({username:'previous-user',sleeperUsername:'previous-user',preserved:'context'}));
  happy.context.fetch=async()=>({ok:true,json:async()=>({user_id:'public-sleeper-id',username:'canonical-user'})});
  await happy.context.saveSleeper();
  assert.equal(JSON.parse(happy.local.getItem('od_profile_v1')).sleeperUserId,'public-sleeper-id');
  assert.equal(JSON.parse(happy.local.getItem('od_auth_v1')).username,'canonical-user');
  assert.equal(JSON.parse(happy.local.getItem('od_auth_v1')).sleeperUsername,'canonical-user','reconnect cannot retain the old higher-priority pointer');
  assert.equal(JSON.parse(happy.local.getItem('od_auth_v1')).preserved,'context');
  assert.equal(happy.local.getItem('od_locked_username_v2'),'canonical-user');
  assert.equal(JSON.parse(happy.local.getItem('od_profile_v1')).sleeperUsername,'canonical-user');
  assert.equal(happy.log.filter(entry=>Array.isArray(entry)&&entry[0]==='cloud-username').length,1);
  happy.install('b');
  happy.timers.forEach(fn=>fn());
  assert.equal(JSON.parse(happy.local.getItem('od_profile_v1')).onboardingComplete,undefined,'delayed next-step cannot complete B setup');
  assert.equal(happy.context.location.href,'onboarding.html');

  const complete=browser(); complete.context.enterApp();
  assert.equal(JSON.parse(complete.local.getItem('od_profile_v1')).onboardingComplete,true);
  assert.equal(complete.log.filter(entry=>Array.isArray(entry)&&entry[0]==='cloud-profile').length,1);
  assert.equal(complete.context.location.href,'index.html');
  const event=browser();event.install('b');event.listeners.storage({key:'fw_session_v1'});
  assert(event.log.includes('reload'),'standalone page invalidates when another tab changes accounts');
  console.log('PASS actual onboarding functions block cross-account lookup, delayed continuation, checkout redirect, profile reads/writes and cloud sync; same-account connection/completion works');
})().catch(error=>{console.error(error);process.exitCode=1;});
