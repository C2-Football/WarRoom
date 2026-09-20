'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const load = require('./helpers/security-ts-loader.cjs');
const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.DELETION_SOURCE_ROOT || root;
const email = 'delete-fixture@example.invalid';
const appId = 'fixture-app-id';
const authId = 'fixture-distinct-auth-id';
function fixture(slug, options = {}) {
  const state = {app: {id: appId, email, session_version: 2}, actorVersion: 2, appDeletes: 0, authDeletes: [], authUsers: new Map([[authId,{id:authId,email}]]), stripeStates: new Map(), fetches: [], pages: [], sequence: []};
  const subscriptions = options.subscriptions || [{user_id: appId, tier: 'pro', status: 'active', store: 'stripe', stripe_subscription_id: 'sub_fixture'}];
  const admin = {
    auth: {admin: {
      async listUsers({page}) {
        state.pages.push(page);
        if (options.authReadFailure) return {error: {message: 'controlled Auth outage'}};
        if (options.secondAuthPage && page === 1) return {data: {users: Array.from({length: 1000}, (_, index) => ({id: 'other-' + index, email: `other-${index}@example.invalid`})), nextPage: 2, lastPage: 2}};
        return {data: {users: [...state.authUsers.values()], lastPage: options.secondAuthPage ? 2 : 1}};
      },
      async getUserById(id) {return state.authUsers.has(id) ? {data:{user:state.authUsers.get(id)}} : {error:{status:404,code:'user_not_found'}};},
      async deleteUser(id) {state.authDeletes.push(id); state.sequence.push('auth'); if(options.authDeleteFailure)return {error:{message:'controlled delete rejection'}};state.authUsers.delete(id);if(options.reappearAfterDelete)state.authUsers.set('fixture-new-auth',{id:'fixture-new-auth',email});return {data: {user: {id}}};},
    }},
    async rpc(name, params) {
      const target = state.app;
      if(options.accountReadFailure || options.subscriptionReadFailure || options.targetRoleFailure)return {error:{message:'controlled snapshot read failure'}};
      if(params.p_actor_version!==state.actorVersion)return {error:{code:'42501'}};
      const snapshot={actor:{id:params.p_actor_id,session_version:state.actorVersion},target:target?{...target}:null,email:params.p_email,self:params.p_self,subscriptions,sources:options.sources||[]};
      if(name==='inspect_account_deletion')return {data:snapshot};
      assert.equal(name,'finalize_account_deletion');
      if(JSON.stringify(snapshot)!==JSON.stringify(params.p_snapshot))return {error:{code:'40001'}};
      state.appDeletes++;state.sequence.push('app');state.app=null;if(options.lostFinalResponse)throw Error('controlled lost response after commit');return {data:{deletedAppUser:true}};
    },
    from(table) {
      return {
        mode: 'read', filters: [], select() {return this;}, eq(field, value) {this.filters.push([field,value]);return this;}, in() {return this;}, limit() {return this;},
        delete() {this.mode='delete';return this;},
        async exec(single) {
          if (table === 'app_users') {
            if (options.accountReadFailure && this.mode === 'read') return {error: {message: 'controlled account lookup failure'}};
            if (this.mode === 'delete') {state.appDeletes++;state.sequence.push('app');state.app=null;return {data: [{id: appId}]};}
            if(this.filters.some(([field,value])=>field==='id'&&value==='fixture-admin-id'))return {data:{id:'fixture-admin-id',email:'admin-fixture@example.invalid',session_version:state.actorVersion}};
            if(state.app&&this.filters.some(([field,value])=>state.app[field]!==value))return {data:single?null:[]};
            return {data: single ? state.app : state.app ? [state.app] : []};
          }
          if (table === 'subscriptions') return options.subscriptionReadFailure ? {error: {message: 'controlled billing lookup failure'}} : {data: subscriptions};
          if (table === 'billing_subscription_sources') return {data: options.sources || []};
          if (table === 'app_user_roles') return options.targetRoleFailure ? {error: {message: 'controlled role lookup failure'}} : {data: []};
          throw Error('Unexpected table ' + table);
        },
        maybeSingle() {return this.exec(true);}, single() {return this.exec(true);}, then(resolve,reject) {return this.exec(false).then(resolve,reject);},
      };
    },
  };
  const userSession = {userId: slug === 'fw-delete-account' ? appId : 'fixture-admin-id', email: slug === 'fw-delete-account' ? email : 'admin-fixture@example.invalid', sessionVersion: 2};
  const fetchFixture=async (url, init={}) => {
    const method=init.method||'GET',id=url.split('/').at(-1);state.fetches.push({url,method});state.sequence.push('stripe');
    if(options.onFetch)await options.onFetch(state,method,id);
    const failed=options.stripeFailure||options.stripeFailureFor===id;
    if(method==='DELETE'&&!failed)state.stripeStates.set(id,'canceled');
    return {ok:!failed,status:failed?503:200,json:async()=>({id,status:state.stripeStates.get(id)||'active'})};
  };
  const helper=load('supabase/functions/_shared/account-deletion.ts',{fetch:fetchFixture}).context;
  let handler;
  load(path.relative(root, path.join(sourceRoot, 'supabase/functions', slug, 'index.ts')), {
    Deno: {env: {get: name => name === 'STRIPE_SECRET_KEY' ? (options.noStripeSecret ? '' : 'synthetic-fixture-key') : 'synthetic-config'}, serve: fn => {handler=fn;}},
    createClient: () => admin, handleOptions: () => null, json: (_req, body, status = 200) => ({status,body}),
    normalizeEmail: value => String(value || '').trim().toLowerCase(), auditEvent: async () => {},
    requireActiveAppSession: async () => userSession, resolveAppUserId: async () => userSession,
    hasAdminRole: async (_admin, id) => id === 'fixture-admin-id',
    AccountDeletionError:vm.runInContext('AccountDeletionError',helper),performAccountDeletion:helper.performAccountDeletion,
    fetch: fetchFixture,
  });
  const call = (body = slug === 'fw-delete-account' ? {confirm: true} : {email,force:true}) => handler(new Request('https://example.invalid/' + slug,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  return {state,call};
}
const tests = {
  async stripeFailure() {for(const slug of ['fw-delete-account','admin-delete-user']){const x=fixture(slug,{stripeFailure:true});const r=await x.call();assert.notEqual(r.status,200,'failed Stripe cancellation cannot be deletion success');assert(x.state.app,'failed cancellation retains account and source IDs for retry');assert.equal(x.state.authDeletes.length,0);}},
  async billingLookupFailure() {for(const slug of ['fw-delete-account','admin-delete-user']){const x=fixture(slug,{subscriptionReadFailure:true});const r=await x.call();assert.notEqual(r.status,200);assert.equal(x.state.appDeletes,0);assert.equal(x.state.authDeletes.length,0);}},
  async missingStripeConfiguration() {const x=fixture('fw-delete-account',{noStripeSecret:true});const r=await x.call();assert.notEqual(r.status,200);assert(x.state.app);},
  async differentAuthIdentity() {const x=fixture('fw-delete-account',{subscriptions:[]});const r=await x.call();assert.equal(r.status,200);assert.deepEqual(x.state.authDeletes,[authId],'app UUID must not be used as Auth UUID');},
  async completeAuthInventory() {const x=fixture('admin-delete-user',{subscriptions:[],secondAuthPage:true});const r=await x.call();assert.equal(r.status,200);assert.deepEqual(x.state.pages.slice(0,2),[1,2]);assert.deepEqual(x.state.authDeletes,[authId]);},
  async authDeleteFailure() {for(const slug of ['fw-delete-account','admin-delete-user']){const x=fixture(slug,{subscriptions:[],authDeleteFailure:true});const r=await x.call();assert.notEqual(r.status,200);assert(x.state.app,'Auth cleanup failure keeps app session for retry');}},
  async accountLookupFailure() {const x=fixture('admin-delete-user',{accountReadFailure:true});const r=await x.call();assert.notEqual(r.status,200);assert.equal(x.state.authDeletes.length,0,'lookup failure cannot become orphan Auth sweep');},
  async targetRoleFailure() {const x=fixture('admin-delete-user',{subscriptions:[],targetRoleFailure:true});const r=await x.call();assert.notEqual(r.status,200,'failed target-role read cannot authorize deleting an admin');assert.equal(x.state.appDeletes,0);},
  async legacyStripePaidGuard() {const x=fixture('admin-delete-user',{subscriptions:[{user_id:appId,tier:'pro',status:'active',store:null,stripe_subscription_id:'sub_fixture'}]});const r=await x.call({email});assert.equal(r.status,409);assert.equal(x.state.appDeletes,0);},
  async hiddenStripeAndStoreNotice() {
    const x=fixture('fw-delete-account',{subscriptions:[{tier:'pro',status:'active',store:'app_store'}],sources:[{provider:'stripe',source_id:'sub_hidden',state:{tier:'pro',status:'active',store:'stripe'}}]});
    const r=await x.call();assert.equal(r.status,200);assert.deepEqual(x.state.fetches.filter(r=>r.method==='DELETE').map(r=>r.url.split('/').at(-1)),['sub_hidden']);assert.deepEqual(JSON.parse(JSON.stringify(r.body.managedSubscriptions)),['app_store']);assert.doesNotMatch(JSON.stringify(r.body),/sub_hidden|fixture-distinct-auth-id|synthetic-fixture-key/);assert.equal(x.state.sequence.at(-1),'app');
  },
  async partialCancellationRetry() {
    const options={stripeFailureFor:'sub_second',sources:[{provider:'stripe',source_id:'sub_second',state:{tier:'pro',status:'active',store:'stripe'}}]};const x=fixture('fw-delete-account',options);
    let r=await x.call();assert.equal(r.status,503);assert(x.state.app);assert.equal(r.body.canceledStripeSubscriptions,1);assert.match(r.body.error,/may already have completed/);assert.equal(x.state.authDeletes.length,0);
    options.stripeFailureFor=null;r=await x.call();assert.equal(r.status,200);assert.equal(x.state.fetches.filter(r=>r.method==='DELETE'&&r.url.endsWith('sub_fixture')).length,1,'retry verifies the already-canceled source instead of canceling again');
  },
  async authFailureRetry() {const options={subscriptions:[],authDeleteFailure:true},x=fixture('fw-delete-account',options);assert.equal((await x.call()).status,503);assert(x.state.app);options.authDeleteFailure=false;assert.equal((await x.call()).status,200);},
  async sessionChangeBeforeMutation() {const x=fixture('fw-delete-account',{onFetch:async(state,method)=>{if(method==='GET')state.actorVersion=3;}});assert.notEqual((await x.call()).status,200);assert.equal(x.state.fetches.filter(r=>r.method==='DELETE').length,0);assert.equal(x.state.authDeletes.length,0);assert(x.state.app);},
  async authReappearance() {const options={subscriptions:[],reappearAfterDelete:true},x=fixture('fw-delete-account',options);const r=await x.call();assert.equal(r.status,409);assert(x.state.app);assert.deepEqual(x.state.authDeletes,[authId],'newly observed identity is not implicitly erased');assert.equal(r.body.deletedAuthUsers,1);options.reappearAfterDelete=false;assert.equal((await x.call()).status,200);},
  async uncertainCompletionDoesNotEraseReplacement() {const x=fixture('fw-delete-account',{subscriptions:[],lostFinalResponse:true});const r=await x.call();assert.equal(r.status,503);assert.match(r.body.error,/may still be present/);assert.equal(x.state.appDeletes,1);x.state.app={id:'new-app-after-deletion',email,session_version:1};assert.equal((await x.call()).status,401);assert.equal(x.state.app.id,'new-app-after-deletion');assert.equal(x.state.appDeletes,1);},
};
(async()=>{let failed=0;for(const [name,run]of Object.entries(tests)){try{await run();console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.message);}}if(failed)process.exitCode=1;})().catch(error=>{console.error(error);process.exitCode=1;});
