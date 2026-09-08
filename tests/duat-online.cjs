'use strict';
// Offline acceptance: real PostgreSQL-compatible transactions plus the actual
// Edge request handler with an in-memory Supabase adapter. No live accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const factionIds = require('../js/duat/rules.js').FACTIONS.map(f => f.id);
const fixture = input => ({ version: 1, id: input.id || 'fixture', name: input.name || 'Duat QA', seed: input.seed || 'private-seed',
    phase: 'preseason', week: 1, createdAt: input.createdAt || '2026-09-08T12:00:00Z', seasons: [2021,2022,2023,2024],
    hostFactionId: factionIds[0], humanFactionIds: factionIds.slice(0,3),
    factions: factionIds.map(id => ({ id, armies: [{ hidden: 'secret-deck-' + id }], lineup: [] })) });

(async () => {
    const db = new PGlite();
    let passed = 0;
    const test = async (label, run) => { await run(); passed++; console.log('ok ' + passed + ' - ' + label); };
    const query = async (sql, values = []) => (await db.query(sql, values)).rows;
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role;
            create table app_users(id uuid primary key);
            create function gen_random_bytes(n integer) returns bytea language sql as $$select substring(decode(repeat(md5(random()::text),n),'hex') from 1 for n)$$;`);
        const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260908160000_duat_campaigns.sql'), 'utf8');
        await db.exec(migration); await db.exec(migration);
        const draftMigration=fs.readFileSync(path.join(root,'supabase/migrations/20260908180000_duat_draft_campaigns.sql'),'utf8');
        await db.exec(draftMigration); await db.exec(draftMigration);
        const settingsMigration=fs.readFileSync(path.join(root,'supabase/migrations/20260908210000_duat_campaign_settings.sql'),'utf8');
        await db.exec(settingsMigration); await db.exec(settingsMigration);
        const users = (await query('insert into app_users select gen_random_uuid() from generate_series(1,6) returning id')).map(row => row.id);
        const create = async () => (await query('select create_duat_campaign($1,$2) as id', [users[0], fixture({})]))[0].id;
        const row = async id => (await query('select * from duat_campaigns where id=$1', [id]))[0];
        const seats = id => query('select * from duat_campaign_members where room_id=$1 order by faction_id', [id]);
        const commit = async (id, user, revision, actionId, action, next = null) => (await query('select commit_duat_campaign_action($1,$2,$3,$4,$5,$6) as result', [user,id,revision,actionId,action,next]))[0].result;
        const claim = async (user, code) => (await query('select claim_duat_campaign_invite($1,$2) as id', [user,code]))[0].id;

        await test('migration replay and atomic creation preserve private state and reserved factions', async () => {
            const id = await create(); const members = await seats(id);
            assert.equal(members.length, 3); assert.equal(members.filter(m => m.user_id).length, 1);
            assert.equal(members.find(m => m.role === 'host').user_id, users[0]);
            assert(members.every(m => /^[0-9a-f]{48}$/.test(m.invite_code)));
            assert.equal((await row(id)).state.seed, 'private-seed');
            const before = (await query('select count(*)::int as count from duat_campaigns'))[0].count;
            await assert.rejects(() => query('select create_duat_campaign($1,$2)', [users[0], { ...fixture({}), humanFactionIds: [factionIds[0],factionIds[0]] }]), /unique/);
            assert.equal((await query('select count(*)::int as count from duat_campaigns'))[0].count, before);
        });
        await test('claim contention permits one owner; retries and duplicate-account denial are atomic', async () => {
            const id = await create(); const members = await seats(id); const invitation = members.find(m => m.faction_id === factionIds[1]);
            // PGlite queues these requests on one connection. This verifies the
            // transaction outcomes, not independent production connection load.
            const claims = await Promise.allSettled([claim(users[1],invitation.invite_code), claim(users[2],invitation.invite_code)]);
            assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1);
            const owner = (await seats(id)).find(m => m.faction_id === factionIds[1]).user_id;
            const revision = (await row(id)).revision;
            assert.equal(await claim(owner,invitation.invite_code),id); assert.equal((await row(id)).revision,revision);
            const third = members.find(m => m.faction_id === factionIds[2]);
            await assert.rejects(() => claim(owner,third.invite_code), /already own/);
            await assert.rejects(() => claim(users[4],'invalid'), /does not exist/);
        });
        await test('readiness requires ownership and invalidates stale starts', async () => {
            const id = await create(); const initial = await row(id);
            await assert.rejects(() => commit(id,users[4],1,'outsider',{type:'set-ready',ready:true}), /faction/);
            await assert.rejects(() => commit(id,users[0],1,'other',{type:'set-ready',factionId:factionIds[1],ready:true}), /own faction/);
            const ready = await commit(id,users[0],1,'ready',{type:'set-ready',ready:true});
            assert.equal(ready.revision,2);
            assert.equal((await commit(id,users[0],1,'stale',{type:'reveal-rulers'}, {...initial.state,phase:'season'})).conflict,true);
            await assert.rejects(() => commit(id,users[0],2,'start',{type:'reveal-rulers'}, {...initial.state,phase:'season'}), /Every human/);
        });
        await test('action receipts deduplicate by actor and prevent ID reuse with changed intent', async () => {
            const id = await create(); const action = {type:'set-ready',ready:true};
            const first = await commit(id,users[0],1,'retry',action);
            const second = await commit(id,users[0],1,'retry',action);
            assert.equal(second.deduplicated,true); assert.equal(second.revision,first.revision);
            await assert.rejects(() => commit(id,users[0],first.revision,'retry',{...action,ready:false}), /another intent/);
            assert.equal((await query('select count(*)::int as count from duat_campaign_actions where room_id=$1',[id]))[0].count,1);
        });
        await test('host gates, ready locks and final compare-and-swap protect campaign progression', async () => {
            const id = await create(); const members = await seats(id);
            await claim(users[1],members.find(m => m.faction_id===factionIds[1]).invite_code);
            await claim(users[2],members.find(m => m.faction_id===factionIds[2]).invite_code);
            for (let i=0;i<3;i++) await commit(id,users[i],(await row(id)).revision,'ready-'+i,{type:'set-ready',ready:true});
            const before = await row(id), next = {...before.state,phase:'season'};
            await assert.rejects(() => commit(id,users[1],before.revision,'friend-start',{type:'reveal-rulers'},next), /host/);
            await assert.rejects(() => commit(id,users[0],before.revision,'locked',{type:'set-lineup',playerIds:[]},next), /unready/);
            const results = await Promise.all([commit(id,users[0],before.revision,'start-a',{type:'reveal-rulers'},next), commit(id,users[0],before.revision,'start-b',{type:'reveal-rulers'},next)]);
            assert.equal(results.filter(result => result.ok).length,1); assert.equal(results.filter(result => result.conflict).length,1);
            assert((await seats(id)).every(member => !member.ready));
            assert.equal((await row(id)).state.phase,'season');
            await assert.rejects(async () => commit(id,users[0],(await row(id)).revision,'early-week',{type:'advance-week'},{...next,week:2}), /Every human/);
        });
        await test('browser database roles cannot read private rows, invitation codes, receipts or call mutation RPCs', async () => {
            for (const role of ['anon','authenticated']) {
                await db.exec('set role ' + role);
                try {
                    for (const table of ['duat_campaigns','duat_campaign_members','duat_campaign_actions']) await assert.rejects(() => query('select * from '+table), /permission denied/);
                    await assert.rejects(() => query('select create_duat_campaign($1,$2)',[users[0],fixture({})]), /permission denied/);
                    await assert.rejects(() => query('select claim_duat_campaign_invite($1,$2)',[users[0],'x']), /permission denied/);
                } finally { await db.exec('reset role'); }
            }
            const grants = (await query("select has_function_privilege('service_role','public.commit_duat_campaign_action(uuid,uuid,integer,text,jsonb,jsonb)','EXECUTE') as allowed"))[0];
            assert.equal(grants.allowed,true);
        });

        // Minimal PostgREST test adapter. Reads and RPCs use the same PGlite DB;
        // the game engine is replaced by an observable deterministic fixture.
        const rpcNames = {
            create_duat_campaign: ['p_user_id','p_state'], claim_duat_campaign_invite: ['p_user_id','p_code'],
            commit_duat_campaign_action: ['p_user_id','p_room_id','p_expected_revision','p_action_id','p_action','p_next_state'],
        };
        class Read {
            constructor(table) { this.table=table; this.filters=[]; }
            select(fields) { this.fields=fields; return this; }
            eq(key,value) { this.filters.push({key,value}); return this; }
            not(key,op,value) { assert.equal(op,'is'); assert.equal(value,null); this.notNull=key; return this; }
            maybeSingle() { this.one=true; return this.run(); }
            single() { this.one=true; return this.run(); }
            then(resolve,reject) { return this.run().then(resolve,reject); }
            async run() {
                try {
                    const where=this.filters.map((filter,index)=>filter.key+'=$'+(index+1));
                    if(this.notNull) where.push(this.notNull+' is not null');
                    const rows=await query('select * from '+this.table+(where.length?' where '+where.join(' and '):''),this.filters.map(filter=>filter.value));
                    if(this.fields.includes('duat_campaigns(')) for(const entry of rows) entry.duat_campaigns=await row(entry.room_id);
                    return {data:this.one?rows[0]||null:rows,error:null};
                } catch(error) { return {data:null,error}; }
            }
        }
        const admin = {
            from: table=>new Read(table),
            rpc: async (name,args)=>{
                try {const values=rpcNames[name].map(key=>args[key]); return {data:(await query('select '+name+'('+values.map((_,i)=>'$'+(i+1)).join(',')+') as result',values))[0].result,error:null};}
                catch(error){return {data:null,error};}
            },
        };
        let engineCalls=0;
        const sandbox = { Request,Response,URL,crypto:webcrypto,console,createClient:()=>admin,
            handleOptions:()=>null,json:(_req,body,status=200)=>new Response(JSON.stringify(body),{status}),
            requireActiveAppSession:async(_db,req)=>req.headers.get('x-test-user')?{userId:req.headers.get('x-test-user')}:null,
            availableSeasons:[2021,2022,2023,2024],loadData:async()=>({}),
            App:{DuatRules:{FACTIONS:factionIds.map(id=>({id}))},DuatWorld:{FACTIONS:factionIds.map(id=>({id}))},DuatCampaign:{
                normalizeSettings:require('../js/duat/campaign.js').normalizeSettings,
                SCORING:require('../js/duat/campaign.js').SCORING,
                createCampaign:fixture,
                projectCampaign:(state,viewer)=>({id:state.id,name:state.name,phase:state.phase,week:state.week,viewer}),
                applyAction:(state,action)=>{engineCalls++;return {...state,...(action.type==='reveal-rulers'?{phase:'season'}:{}),...(action.type==='advance-week'?{week:state.week+1}:{})};},
            }},Deno:{env:{get:()=>''},serve:handler=>{sandbox.handler=handler;}},
        };
        let source=fs.readFileSync(path.join(root,'supabase/functions/duat/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
        source=require('@babel/standalone').transform(source,{filename:'duat-endpoint.ts',presets:['typescript']}).code;
        vm.runInNewContext(source,sandbox);
        const call=async(user,body)=>{const response=await sandbox.handler(new Request('https://qa.invalid/duat',{method:'POST',headers:user?{'x-test-user':user}:{},body:JSON.stringify(body)}));return {status:response.status,...await response.json()};};
        let apiRoom;
        await test('actual endpoint requires an app identity and projects create/list/load without engine secrets', async()=>{
            assert.equal((await call(null,{op:'list'})).status,401);
            const created=await call(users[0],{op:'create',input:{name:'API QA',seasons:[2021,2022,2023,2024],hostFactionId:factionIds[0],humanFactionIds:factionIds.slice(0,3)}});
            assert.equal(created.ok,true,created.error);apiRoom=created.room;
            assert.equal(apiRoom.seats.length,14);assert.equal(apiRoom.seats.filter(seat=>seat.inviteCode).length,2);
            assert.equal(JSON.stringify(apiRoom).includes('secret-deck'),false);assert.equal('seed' in apiRoom.campaign,false);
            const listed=await call(users[0],{op:'list'});assert.equal(listed.ok,true);assert(listed.rooms.some(room=>room.id===apiRoom.id));assert.equal(JSON.stringify(listed).includes('private-seed'),false);
            assert.equal((await call(users[5],{op:'load',roomId:apiRoom.id})).status,403);
        });
        await test('actual endpoint hides invite secrets from friends and rejects forged controls before engine execution',async()=>{
            const code=apiRoom.seats.find(seat=>seat.factionId===factionIds[1]).inviteCode;
            assert.equal((await call(users[1],{op:'claim',code})).roomId,apiRoom.id);
            const loaded=await call(users[1],{op:'load',roomId:apiRoom.id});assert.equal(loaded.room.self.factionId,factionIds[1]);assert(loaded.room.seats.every(seat=>!seat.inviteCode));
            const before=engineCalls;
            const result=await call(users[1],{op:'action',roomId:apiRoom.id,expectedRevision:loaded.room.revision,actionId:'forge',action:{type:'set-lineup',factionId:factionIds[0],playerIds:[]}});
            assert.equal(result.status,403);assert.equal(engineCalls,before);
            const replacement=await call(users[1],{op:'action',roomId:apiRoom.id,expectedRevision:loaded.room.revision,actionId:'replace',action:{type:'set-ready',ready:true,state:{seed:'forged'}}});
            assert.equal(replacement.ok,false);assert.equal(engineCalls,before);
        });
        await test('actual endpoint saves readiness, returns fresh versions, deduplicates retries and rejects stale intent',async()=>{
            const loaded=(await call(users[1],{op:'load',roomId:apiRoom.id})).room;
            const body={op:'action',roomId:apiRoom.id,expectedRevision:loaded.revision,actionId:'api-ready',action:{type:'set-ready',ready:true}};
            const saved=await call(users[1],body);assert.equal(saved.ok,true,saved.error);assert.equal(saved.room.self.ready,true);
            const retry=await call(users[1],body);assert.equal(retry.deduplicated,true);assert.equal(retry.room.revision,saved.room.revision);
            const stale=await call(users[1],{...body,actionId:'new-stale',action:{type:'set-ready',ready:false}});assert.equal(stale.status,409);assert.equal(stale.conflict,true);
            const altered=await call(users[1],{...body,action:{type:'set-ready',ready:false}});assert.equal(altered.ok,false);assert.match(altered.error,/another intent/);
        });
        await test('remote client rejects signed-out access and account switches during a request',async()=>{
            const browser={App:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'js/duat/remote.js'),'utf8'),{window:browser});
            assert.equal((await browser.App.DuatRemote.request({op:'list'})).ok,false);
            let actor='first';browser.App.OD={getCurrentUserId:()=>actor,getSessionToken:()=> 'test-token',getClient:()=>({functions:{invoke:async()=>{actor='second';return {data:{ok:true,rooms:[]}};}}})};
            const switched=await browser.App.DuatRemote.request({op:'list'});assert.equal(switched.ok,false);assert.match(switched.error,/account changed/);
        });
        await test('bundled Edge runtime loads four complete real seasons and preserves private campaign projection',async()=>{
            require('node:child_process').execFileSync(process.execPath,[path.join(root,'scripts/build-duat-server.cjs')],{cwd:root,stdio:'pipe'});
            const runtimeSource=fs.readFileSync(path.join(root,'supabase/functions/duat/runtime.js'),'utf8');
            const runtime=await import('data:text/javascript;base64,'+Buffer.from(runtimeSource).toString('base64'));
            const data=await runtime.loadData([2021,2022,2023,2024]);
            assert.deepEqual(runtime.App.DuatCampaign.availableSeasons(data),[2024,2023,2022,2021]);
            assert(data.cards.size>1000);assert(data.logIndex.size>15000);
            const campaign=runtime.App.DuatCampaign.createCampaign({version:1,id:'edge-runtime-qa',name:'Edge runtime QA',seed:'edge-private-seed',createdAt:'2026-09-08T18:00:00Z',
                seasons:[2021,2022,2023,2024],hostFactionId:factionIds[0],humanFactionIds:factionIds.slice(0,2)},data);
            const view=runtime.App.DuatCampaign.projectCampaign(campaign,factionIds[0]);
            assert.equal(view.seed,undefined);assert.equal(view.factions[1].armies.length,0);assert.equal(view.factions[0].armies.length,4);
            const revealed=runtime.App.DuatCampaign.applyAction(campaign,{type:'reveal-rulers'},data);
            const scored=runtime.App.DuatCampaign.applyAction(revealed,{type:'advance-week'},data);
            assert.equal(scored.completedWeeks.length,1);assert.equal(scored.completedWeeks[0].factions.length,14);
            assert.equal(runtime.App.DuatCampaign.projectCampaign(scored,factionIds[1]).factions[0].lineup.length,0);
            await assert.rejects(()=>runtime.loadData([2021,2022,2023,2023]),/unique complete/);
            sandbox.App=runtime.App;sandbox.loadData=runtime.loadData;sandbox.availableSeasons=runtime.availableSeasons;
        });
        await test('cached clients without a version retain the complete original preseason API and unsupported versions fail',async()=>{
            const input={name:'Cached original client',seasons:[2021,2022,2023,2024],hostFactionId:factionIds[0],humanFactionIds:[factionIds[0]]};
            for(const version of [0,4,'2',null])assert.equal((await call(users[0],{op:'create',input:{...input,version}})).ok,false);
            const made=await call(users[0],{op:'create',input});assert.equal(made.ok,true,made.error);
            assert.equal(made.room.campaign.version,1);assert.equal(made.room.campaign.phase,'preseason');
            assert.equal(made.room.campaign.factions.find(f=>f.id===factionIds[0]).armies.length,4);
            const roomId=made.room.id;
            const ready=await call(users[0],{op:'action',roomId,expectedRevision:made.room.revision,actionId:'legacy-ready',action:{type:'set-ready',ready:true}});
            assert.equal(ready.ok,true,ready.error);
            const revealed=await call(users[0],{op:'action',roomId,expectedRevision:ready.room.revision,actionId:'legacy-reveal',action:{type:'reveal-rulers'}});
            assert.equal(revealed.ok,true,revealed.error);assert.equal(revealed.room.campaign.phase,'season');
        });
        await test('real v2 endpoint drafts both owned factions, enforces readiness and handles a simultaneous pick race',async()=>{
            const selected=['persia',...sandbox.App.DuatWorld.FACTIONS.filter(f=>f.id!=='persia').slice(0,13).map(f=>f.id)];
            const hostFaction='persia',friendFaction=selected[1];
            const made=await call(users[0],{op:'create',input:{version:2,name:'Real v2 online draft',seasons:[2021,2022,2023,2024],hostFactionId:hostFaction,humanFactionIds:[friendFaction],factionIds:selected}});
            assert.equal(made.ok,true,made.error);let room=made.room;const roomId=room.id;
            assert.equal(room.campaign.version,2);assert.equal(room.campaign.phase,'draft');assert.equal(room.campaign.factions.length,14);
            assert.equal(room.campaign.conquest.seed,undefined);
            const invitation=room.seats.find(seat=>seat.factionId===friendFaction).inviteCode;assert(invitation);
            const load=async user=>(await call(user,{op:'load',roomId})).room;
            let dataLoads=0;const actualLoad=sandbox.loadData;sandbox.loadData=async(...args)=>{dataLoads++;return actualLoad(...args);};
            let serial=0;
            const action=async(user,intent)=>{const fresh=await load(user);return call(user,{op:'action',roomId,expectedRevision:fresh.revision,actionId:'v2-'+serial++,action:intent});};
            const must=async(user,intent)=>{const result=await action(user,intent);assert.equal(result.ok,true,result.error);return result.room;};
            assert.equal((await action(users[0],{type:'start-draft'})).ok,false);
            assert.equal((await call(users[1],{op:'claim',code:invitation})).ok,true);
            await must(users[0],{type:'set-ready',ready:true});await must(users[1],{type:'set-ready',ready:true});
            assert.equal((await action(users[1],{type:'start-draft'})).status,403);
            room=await must(users[0],{type:'start-draft'});assert.equal(room.campaign.draft.status,'active');
            assert(room.seats.filter(s=>s.controller==='human').every(s=>!s.ready));
            assert.equal((await action(users[0],{type:'set-ready',ready:true})).ok,false);
            let humanPicks=0;
            while(room.campaign.phase==='draft'){
                const turn=room.campaign.draft.turn;assert([hostFaction,friendFaction].includes(turn.factionId));
                const actor=turn.factionId===hostFaction?users[0]:users[1],other=actor===users[0]?users[1]:users[0];
                const beforeOwn=dataLoads,own=await load(actor);assert.equal(dataLoads,beforeOwn+1);
                const beforeOther=dataLoads,rival=await load(other);assert.equal(dataLoads,beforeOther);
                const candidates=own.campaign.draft.candidates;
                assert(candidates.length);assert.equal(rival.campaign.draft.candidates.length,0);
                assert.equal(own.campaign.seed,undefined);assert.equal(own.campaign.conquest.seed,undefined);
                for(const pick of rival.campaign.draft.picks)if(pick.factionId===turn.factionId)assert.equal(pick.playerId,undefined);
                if(humanPicks===0){
                    assert.equal((await action(other,{type:'draft-pick',playerId:candidates[0].id})).ok,false);
                    const requests=candidates.slice(0,2).map((player,index)=>({op:'action',roomId,expectedRevision:own.revision,actionId:'v2-raced-pick-'+index,action:{type:'draft-pick',playerId:player.id}}));
                    const race=await Promise.all(requests.map(body=>call(actor,body)));
                    assert.equal(race.filter(r=>r.ok).length,1);assert.equal(race.filter(r=>r.status===409&&r.conflict).length,1);
                    const winner=race.findIndex(r=>r.ok),retry=await call(actor,requests[winner]);assert.equal(retry.deduplicated,true);
                    assert.equal((await call(actor,{...requests[winner],action:{type:'draft-pick',playerId:candidates[2].id}})).ok,false);
                    room=retry.room;
                }else room=await must(actor,{type:'draft-pick',playerId:candidates[0].id});
                humanPicks++;
            }
            assert.equal(humanPicks,64);assert.equal(room.campaign.draft.cursor,448);assert.equal(room.campaign.phase,'reveal');
            assert.equal((await action(users[0],{type:'reveal-next'})).ok,false);
            await must(users[0],{type:'set-ready',ready:true});await must(users[1],{type:'set-ready',ready:true});
            assert.equal((await action(users[1],{type:'reveal-next'})).status,403);
            for(let count=1;count<=14;count++){
                room=await must(users[0],{type:'reveal-next'});
                assert.equal(room.campaign.archaeology.revealedFactionIds.length,count);assert.equal(room.campaign.archaeology.latest.players.length,8);
                if(count===1)assert.equal((await action(users[1],{type:'set-ready',ready:false})).ok,false);
                const friend=await load(users[1]);
                for(const faction of friend.campaign.factions)if(faction.id!==friendFaction)assert.equal(faction.armies.length,friend.campaign.archaeology.revealedFactionIds.includes(faction.id)?4:0);
                assert.equal(room.campaign.phase,count===14?'season':'reveal');
            }
            assert(room.seats.filter(s=>s.controller==='human').every(s=>!s.ready));
            await must(users[0],{type:'set-ready',ready:true});await must(users[1],{type:'set-ready',ready:true});
            room=await must(users[0],{type:'advance-week'});assert.equal(room.campaign.week,2);assert.equal(room.campaign.completedWeeks[0].factions.length,14);
            const rejoined=await load(users[1]);assert.deepEqual(rejoined.campaign.completedWeeks,room.campaign.completedWeeks);
            const protectedHome=room.campaign.conquest.homes[hostFaction];
            const fortify=await action(users[0],{type:'fortify',territoryId:protectedHome});assert.equal(fortify.ok,false);assert.doesNotMatch(fortify.error,/Unknown campaign action|supported Duat action/);
            assert.equal((await action(users[1],{type:'attack',factionId:hostFaction,territoryId:protectedHome})).status,403);
        });
        await test('v3 shared rules support two human Superflex drafts, odd-round snake resets, sealed reveals and optional systems',async()=>{
            const settings=sandbox.App.DuatCampaign.normalizeSettings({leagueSize:8,mummyCount:2,roster:'superflex',bench:1,favors:false,conquest:false,playoffTeams:4});
            const scoring={...sandbox.App.DuatCampaign.SCORING,reception:1,passTd:6,turnover:-2};
            const selected=sandbox.App.DuatWorld.FACTIONS.slice(0,8).map(f=>f.id), host=selected[0], friend=selected[1];
            const input={version:3,name:'Custom shared dynasty',settings,scoring,seasons:[2024,2023],hostFactionId:host,humanFactionIds:[friend],factionIds:selected};
            for(const bad of [{...input,settings:{...settings,leagueSize:9}},{...input,seasons:[2024]},{...input,scoring:{reception:99}}])assert.equal((await call(users[0],{op:'create',input:bad})).ok,false);
            const made=await call(users[0],{op:'create',input});assert(made.ok,made.error);let room=made.room,serial=0;const roomId=room.id;
            assert.deepEqual(room.campaign.settings,settings);assert.deepEqual(room.campaign.scoring,scoring);
            assert.equal((await call(users[1],{op:'claim',code:room.seats.find(s=>s.factionId===friend).inviteCode})).ok,true);
            const load=async user=>(await call(user,{op:'load',roomId})).room;
            const action=async(user,intent)=>{const fresh=await load(user);return call(user,{op:'action',roomId,expectedRevision:fresh.revision,actionId:'v3-'+serial++,action:intent});};
            const must=async(user,intent)=>{const result=await action(user,intent);assert(result.ok,result.error);return result.room;};
            for(const user of users.slice(0,2))await must(user,{type:'set-ready',ready:true});
            room=await must(users[0],{type:'start-draft'});let picks=0;
            while(room.campaign.phase==='draft'){
                const actor=room.campaign.draft.turn.factionId===host?users[0]:users[1];const own=await load(actor);
                room=await must(actor,{type:'draft-pick',playerId:own.campaign.draft.candidates[0].id});picks++;
            }
            assert.equal(picks,36);assert.equal(room.campaign.draft.totalPicks,144);
            for(const user of users.slice(0,2))await must(user,{type:'set-ready',ready:true});
            for(let n=0;n<8;n++)room=await must(users[0],{type:'reveal-next'});
            assert.equal(room.campaign.archaeology.latest.players.length,9);
            const full=(await row(roomId)).state;
            const own=room.campaign.factions.find(f=>f.id===host);
            room=await must(users[0],{type:'set-lineup',playerIds:own.lineup});assert.equal(own.lineup.length,8);
            for(const type of ['declare-favor','clear-favor','claim','attack','fortify'])assert.equal((await action(users[0],{type,territoryId:undefined})).ok,false);
            const changed=JSON.parse(JSON.stringify(full));changed.settings.favorBudget=500;
            await assert.rejects(()=>commit(roomId,users[0],room.revision,'change-rules',{type:'set-lineup',factionId:host,playerIds:own.lineup},changed),/authoritative campaign/);
            for(const user of users.slice(0,2))await must(user,{type:'set-ready',ready:true});
            room=await must(users[0],{type:'advance-week'});
            const after=(await row(roomId)).state;assert.equal(sandbox.App.DuatCampaign.validateCampaign(after),true);
            assert.deepEqual(after.conquest,full.conquest);assert(after.factions.every(f=>f.favorBalance===0));
            const reloaded=await load(users[1]);assert.deepEqual(reloaded.campaign.settings,settings);assert.deepEqual(reloaded.campaign.completedWeeks,room.campaign.completedWeeks);
            for(const result of after.completedWeeks[0].factions)for(const player of result.players)assert.equal(player.basePoints,player.stats?sandbox.App.TimeLeagueSeason.scoreStatLine(player.stats,scoring,{}):0);
        });
        console.log('\n'+passed+' Duat online transaction and endpoint scenarios passed.');
    } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
