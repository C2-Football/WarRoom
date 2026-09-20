'use strict';
const assert=require('node:assert/strict');
const load=require('./helpers/security-ts-loader.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const stamp='2026-09-20T00:00:00Z';
const claims=(version=2)=>({sub:'admin-a',app_metadata:{user_id:'admin-a',session_version:version,email:'admin@example.invalid'}});
const token=payload=>'header.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.signature';
function fixture(slug, options={}) {
 const state={privateReads:0,authCalls:0,events:[],rpcCalls:[],error:false};
 const admin={
  auth:{getUser:async()=>{state.authCalls++;return{data:{user:{email:'admin@example.invalid',email_confirmed_at:options.unconfirmed?null:stamp}}};}},
  from(table){const query={columns:'',field:null,select(cols){this.columns=cols;return this;},eq(field){this.field=field;return this;},in(){return this;},limit(){return this;},range(){return this;},order(){return this;},not(){return this;},gte(){return this;},or(){return this;},ilike(){return this;},
   async maybeSingle(){assert.equal(table,'app_users');return{data:{id:'admin-a',email:'admin@example.invalid',session_version:2}};},
   then(ok,bad){return Promise.resolve().then(()=>{
    if(table==='app_user_roles')return{data:options.nonadmin?[]:[{role:'owner'}]};
    state.privateReads++;if(state.error)return{error:{message:'temporary query failure'}};
    if(table==='analytics_events')return{data:state.events};
    if(table==='security_events')return{data:[]};
    if(table==='app_users')return{data:this.columns==='platform_usernames'?[]:[{id:'member-a',email:'member@example.invalid',display_name:'Member',created_at:stamp,platform_usernames:{},subscriptions:[{product_slug:'war_room',tier:'free',status:'active'}]}],count:1};
    throw new Error('Unexpected table '+table);
   }).then(ok,bad);}
  };return query;},
  rpc:async(name,args)=>{state.privateReads++;state.rpcCalls.push({name,args});return state.error?{error:{message:'temporary RPC failure'}}:{data:{totals:{events:1}}};},
 };
 const sec=load('supabase/functions/_shared/security.ts',{jwtVerify:async jwt=>({payload:JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString())})}).context;
 const handler=load('supabase/functions/'+slug+'/index.ts',{
  createClient:()=>admin,handleOptions:()=>null,resolveAppUserId:sec.resolveAppUserId,hasAdminRole:sec.hasAdminRole,
  auditEvent:async()=>{},json:(_req,body,status=200)=>({body,status}),
 }).handler;
 const call=(query='',payload=claims())=>handler(new Request('https://example.invalid/'+slug+query,{headers:{Authorization:'Bearer '+token(payload)}}));
 return{state,call};
}
async function rolesAndOperations(){
 for(const slug of ['admin-list-users','admin-analytics-report']){
  for(const options of [{nonadmin:true},{unconfirmed:true}]){
   const x=fixture(slug,options);const result=await x.call('',options.unconfirmed?{sub:'oauth-a',app_metadata:{provider:'google'}}:claims());assert.equal(result.status,401);assert.equal(x.state.privateReads,0,'no operational data before admin identity/role');
  }
  let x=fixture(slug);assert.equal((await x.call('',claims(1))).status,401);assert.equal(x.state.authCalls,0,'revoked app token cannot regain admin via OAuth');assert.equal(x.state.privateReads,0);
  x=fixture(slug);assert.equal((await x.call()).status,200);assert(x.state.privateReads>0);
  x=fixture(slug);assert.equal((await x.call('',{sub:'oauth-a',app_metadata:{provider:'google'}})).status,200);assert.equal(x.state.authCalls,1,'confirmed OAuth admin retains access');
  x=fixture(slug);x.state.error=true;assert.equal((await x.call()).status,500,'failed primary read is never an empty success');
 }
 let x=fixture('admin-list-users');x.state.events=[{username:'ConnectedMember',user_id:'member-a',event_ts:stamp},{username:'GuestOne',user_id:null,event_ts:stamp}];let result=await x.call();assert.equal(result.body.users[0].sleeperUsername,'ConnectedMember');assert.deepEqual(plain(result.body.guests.map(g=>g.username)),['GuestOne']);
 x=fixture('admin-analytics-report');x.state.events=[
  {session_id:'prod-guest',user_id:null,username:null,event_ts:stamp,event_name:'connected',metadata:{host:'dhqfootball.com',sleeper:'GuestOne',guest:true}},
  {session_id:'native-guest',user_id:null,username:null,event_ts:stamp,event_name:'connected',metadata:{surface:'ios_app',sleeper:'AppGuest',guest:true}},
  {session_id:'owner',user_id:null,username:null,event_ts:stamp,event_name:'connected',metadata:{host:'dhqfootball.com',sleeper:'skjjcruz',guest:true}},
  {session_id:'sandbox',user_id:null,username:null,event_ts:stamp,event_name:'connected',metadata:{host:'c2-football.github.io',sleeper:'SandboxGuest',guest:true}},
 ];
 result=await x.call('?detail=guests');assert.equal(result.status,200);assert.deepEqual(plain(result.body.guests.map(g=>g.username).sort()),['AppGuest','GuestOne'],'current production/native fence and owner guest exclusion preserved');
 result=await x.call('?detail=users');assert.equal(result.status,200);assert.deepEqual(plain(result.body.users.map(g=>g.username).sort()),['AppGuest (guest)','GuestOne (guest)']);
 result=await x.call('?days=999');assert.equal(result.body.days,90);assert.equal(x.state.rpcCalls.at(-1).name,'admin_analytics_report');
 console.log('PASS actual admin handlers preserve current operational detail and confirmed OAuth while denying members, revoked accounts, unconfirmed identity and failed primary reads');
}
async function scoreboard(){
 const state={fetches:0,upserts:0,cached:false,error:false};
 const payload={events:[{id:'provider-fixture',date:stamp}]};
 const admin={from(table){assert.equal(table,'nfl_week_context');return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:state.cached?{payload,updated_at:new Date().toISOString()}:null};},async upsert(){state.upserts++;return{error:{message:'cache unavailable'}};}};}};
 const fn=load('supabase/functions/nfl-scoreboard/index.ts',{createClient:()=>admin,fetch:async url=>{state.fetches++;assert.match(url,/^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/nfl\/scoreboard\?/);assert.match(url,/week=1/);assert.match(url,/dates=2026/);return{ok:!state.error,status:503,json:async()=>payload};}}).handler;
 const call=(method='GET',query='?week=1&season=2026')=>fn(new Request('https://example.invalid/nfl-scoreboard'+query,{method,headers:{Origin:'https://dhqfootball.com'}}));
 let result=await call('OPTIONS');assert.equal(result.status,200);assert.equal(result.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(result.headers.get('Access-Control-Allow-Credentials'),null);assert.equal(state.fetches,0);
 result=await call('POST');assert.equal(result.status,405);assert.equal(state.fetches,0);
 result=await call('GET','?week=99');assert.equal(result.status,400);assert.equal(state.fetches,0);
 result=await call();assert.equal(result.status,200);assert.deepEqual(await result.json(),payload);assert.equal(state.upserts,1,'provider result survives cache-write error');assert.equal(result.headers.get('X-Wr-Cache'),'miss');
 state.cached=true;result=await call();assert.equal(result.headers.get('X-Wr-Cache'),'hit');assert.equal(state.fetches,1);
 state.cached=false;state.error=true;result=await call();assert.equal(result.status,502);assert.match((await result.json()).error,/ESPN scoreboard error/);assert.equal(state.upserts,1,'provider failure never saved as fake score');
 console.log('PASS actual public GET scoreboard preserves wildcard CORS, fixed provider, cache, bad-input rejection and truthful provider failure');
}
(async()=>{await rolesAndOperations();await scoreboard();})().catch(error=>{console.error(error);process.exitCode=1;});
