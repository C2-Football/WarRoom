'use strict';
// Real PostgreSQL migrations/RPCs and production TypeScript handlers, with
// isolated data. PGlite uses one connection; this is not hosted load testing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const load = require('./helpers/security-ts-loader.cjs');
const migration = 'supabase/migrations/20260926010000_game_guest_sessions.sql';
const token = () => 'dg1.' + randomBytes(32).toString('hex');
const quiet = { ...console, error() {}, warn() {} };
(async () => {
    const db = new PGlite();
    const q = async (sql, args = []) => (await db.query(sql, args)).rows;
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role;
            create table app_users(id uuid primary key default gen_random_uuid(),email text unique not null,password_hash text not null,display_name text,session_version integer not null default 1);
            create table subscriptions(user_id uuid);
            create function current_app_user_id() returns uuid language sql as $$select null::uuid$$;
            create function gen_random_bytes(n integer) returns bytea language sql as $$select substring(decode(repeat(md5(random()::text),n),'hex') from 1 for n)$$;`);
        for (const file of ['20260907193000_time_league_multiplayer.sql','20260908010000_time_league_community.sql','20260908020000_time_league_draft_readiness.sql',
            '20260908160000_duat_campaigns.sql','20260908180000_duat_draft_campaigns.sql','20260908210000_duat_campaign_settings.sql']) {
            await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
        }
        await db.exec(fs.readFileSync(migration, 'utf8')); await db.exec(fs.readFileSync(migration, 'utf8'));
        const host = (await q("insert into app_users(email,password_hash,display_name) values('host@example.invalid','fixture','Commissioner') returning id"))[0].id;
        const newRoom = async game => {
            if (game === 'vault') {
                const state = { leagueId: randomBytes(8).toString('hex'), name: 'Guest QA', phase: 'draft', currentWeek: 1, settings: {}, teams: [{teamId:'t1',manager:'human',name:'Host'},{teamId:'t2',manager:'human',name:'Friend'},{teamId:'t3',manager:'human',name:'Another friend'}] };
                const roomId = (await q('select create_time_league($1,$2) id',[host,state]))[0].id;
                return {roomId, code:(await q("select invite_code from time_league_members where league_id=$1 and seat_team_id='t2'",[roomId]))[0].invite_code};
            }
            const state={phase:'preseason',week:1,name:'Guest Duat',seasons:[2025],factions:[{id:'host'},{id:'friend'},{id:'other'}]};
            const roomId=(await q('insert into duat_campaigns(created_by,state) values($1,$2) returning id',[host,state]))[0].id;
            await q("insert into duat_campaign_members(room_id,faction_id,role,user_id,joined_at) values($1,'host','host',$2,now()),($1,'friend','member',null,null),($1,'other','member',null,null)",[roomId,host]);
            return {roomId,code:(await q("select invite_code from duat_campaign_members where room_id=$1 and faction_id='friend'",[roomId]))[0].invite_code};
        };
        const security = load('supabase/functions/_shared/security.ts', { jwtVerify: async () => { throw Error('Opaque token is not a JWT'); }, console:quiet }).context;
        let allowJoin = true;
        const guests = load('supabase/functions/_shared/game-guest.ts', {...security,checkRateLimit:async()=>({allowed:allowJoin})}).context;
        class Read {
            constructor(table){this.table=table;this.filters=[];this.fields='';}
            select(fields){this.fields=fields;return this;}
            eq(field,value){this.filters.push([field,value]);return this;}
            in(field,values){this.inFilter=[field,values];return this;}
            not(){return this;}
            order(){return this;}
            maybeSingle(){this.one=true;return this;}
            single(){this.one=true;return this;}
            then(resolve,reject){return this.run().then(resolve,reject);}
            async run(){
                const where=this.filters.map(([key],index)=>key+'=$'+(index+1));
                const rows=await q('select * from '+this.table+(where.length?' where '+where.join(' and '):''),this.filters.map(([,value])=>value));
                for(const row of rows){
                    if(this.fields.includes('time_leagues('))row.time_leagues=(await q('select * from time_leagues where id=$1',[row.league_id]))[0];
                    if(this.fields.includes('duat_campaigns('))row.duat_campaigns=(await q('select * from duat_campaigns where id=$1',[row.room_id]))[0];
                }
                const filtered=this.inFilter?rows.filter(row=>this.inFilter[1].includes(row[this.inFilter[0]])):rows;
                return {data:this.one?filtered[0]||null:filtered,error:null};
            }
        }
        const admin={from:table=>new Read(table),rpc:async(name,args)=>{
            try{
                if(name==='claim_game_guest_invite')return {data:await q('select * from claim_game_guest_invite($1,$2,$3,$4)',[args.p_game,args.p_code,args.p_display_name,args.p_token_hash])};
                if(name==='set_time_league_ready')return {data:await q('select set_time_league_ready($1,$2,$3)',[args.p_user_id,args.p_league_id,args.p_ready])};
                if(name==='commit_duat_campaign_action')return {data:(await q('select commit_duat_campaign_action($1,$2,$3,$4,$5,$6) result',[args.p_user_id,args.p_room_id,args.p_expected_revision,args.p_action_id,args.p_action,args.p_next_state]))[0].result};
                throw Error('Unexpected RPC '+name);
            }
            catch(error){return {error};}
        }};
        const request=(body,credential='')=>new Request('https://fixture.invalid/game',{method:'POST',headers:{Authorization:'Bearer '+credential},body:JSON.stringify(body)});
        const claim=async(game,room,credential,extra={})=>{
            const response=await guests.handleGameGuestEntry(admin,request({}),{op:'guest-join',code:room.code,displayName:'Friend',guestToken:credential,...extra},game);
            return {status:response.status,...await response.json()};
        };
        const claimed=[];
        for(const game of ['vault','duat']){
            const room=await newRoom(game),credential=token();
            const first=await claim(game,room,credential);assert.equal(first.status,200,first.error);
            assert.deepEqual(Object.keys(first.guest).sort(),['displayName','expiresAt','game','roomId','userId']);
            assert.equal(first.guest.roomId,room.roomId);assert.equal(first.guest.game,game);
            const expires=Date.parse(first.guest.expiresAt)-Date.now();assert(expires>179*86400000&&expires<=180*86400000);
            assert.deepEqual((await claim(game,room,credential)).guest,first.guest,'lost-response retry resumes the exact identity');
            assert.equal((await claim(game,room,token())).status,400,'a copied invite cannot steal the claimed seat');
            const other=await newRoom(game);
            assert.equal((await claim(game,other,credential)).status,400,'one pass cannot silently change its room');
            const identity=(await q('select * from app_users where id=$1',[first.guest.userId]))[0];
            assert.match(identity.email,/@guests\.invalid$/);assert.match(identity.password_hash,/^guest:/);
            assert.equal((await q('select count(*)::int n from subscriptions'))[0].n,0);
            const rows=await q('select * from game_guest_sessions where app_user_id=$1',[first.guest.userId]);
            assert.equal(rows[0].token_hash,await security.sha256Hex(credential));assert(!JSON.stringify(rows).includes(credential));
            const self=await guests.getGameGuestSession(admin,request({},credential),game);assert.equal(self.userId,first.guest.userId);
            assert.equal(await guests.getGameGuestSession(admin,request({},credential),game==='vault'?'duat':'vault'),null);
            assert.equal(await security.requireActiveAppSession(admin,request({},credential)),null,'ordinary account endpoints reject guest pass');
            assert.equal((await claim(game,other,token(),{userId:host})).status,400,'caller cannot supply an account identity');
            const counts=async()=>[(await q('select count(*)::int n from app_users'))[0].n,(await q('select count(*)::int n from game_guest_sessions'))[0].n];
            const before=await counts();
            if(game==='vault')await q("update time_leagues set draft_started=true where id=$1",[other.roomId]);
            else await q("update duat_campaigns set state=jsonb_set(state,'{phase}','\"season\"') where id=$1",[other.roomId]);
            assert.equal((await claim(game,other,token())).status,400);assert.deepEqual(await counts(),before,'closed-room claim cannot create an orphan identity');
            claimed.push({game,room,credential,guest:first.guest});
        }
        console.log('PASS actual atomic SQL: both games, retry identity, occupied seats, closed drafts, private hash, no subscriptions, forged identity');

        for (const malformed of [{}, {phase:null}, {phase:'draft'}, {phase:'draft',draft:{status:null}}]) {
            const room=await newRoom('duat');
            await q('update duat_campaigns set state=$2 where id=$1',[room.roomId,malformed]);
            const before=(await q('select count(*)::int n from app_users'))[0].n;
            const result=await claim('duat',room,token());
            assert.equal(result.status,400,'missing or null phase/status must fail closed');
            assert.equal((await q('select count(*)::int n from app_users'))[0].n,before,'malformed room cannot create a guest identity');
            assert.equal((await q('select user_id from duat_campaign_members where invite_code=$1',[room.code]))[0].user_id,null,'malformed room seat remains unclaimed');
        }
        const waitingRoom=await newRoom('duat');
        await q('update duat_campaigns set state=$2 where id=$1',[waitingRoom.roomId,{phase:'draft',draft:{status:'waiting'}}]);
        assert.equal((await claim('duat',waitingRoom,token())).status,200,'valid waiting draft still accepts its invited guest');
        console.log('PASS missing/null Duat phase/status deny claims without orphan identities; waiting drafts remain joinable');

        const qargs=['vault',claimed[0].room.code,'Denied','b'.repeat(64)];
        for(const role of ['anon','authenticated']){
            await db.exec('set role '+role);
            await assert.rejects(q('select * from game_guest_sessions'),/permission denied/);
            await assert.rejects(q('select * from claim_game_guest_invite($1,$2,$3,$4)',qargs),/permission denied/);
            await db.exec('reset role');
        }
        const before=(await q('select count(*)::int n from app_users'))[0].n;
        const failedRoom=await newRoom('vault');
        await db.exec("create function reject_guest_receipt() returns trigger language plpgsql as $$begin raise exception 'fixture receipt unavailable';end;$$;create trigger reject_guest_receipt before insert on game_guest_sessions for each row execute function reject_guest_receipt();");
        assert.equal((await claim('vault',failedRoom,token())).status,400);
        assert.equal((await q('select count(*)::int n from app_users'))[0].n,before,'failed final receipt rolls back identity and seat');
        assert.equal((await q('select user_id from time_league_members where invite_code=$1',[failedRoom.code]))[0].user_id,null);
        await db.exec('drop trigger reject_guest_receipt on game_guest_sessions');
        console.log('PASS migration grants and real transaction rollback preserve the open seat without orphan accounts');

        const base={getGameGuestSession:guests.getGameGuestSession,guestCanAccess:guests.guestCanAccess,handleGameGuestEntry:guests.handleGameGuestEntry,loadGameMemberLabels:guests.loadGameMemberLabels,console:quiet,createClient:()=>admin,handleOptions:()=>null,json:security.json,
            requireActiveAppSession:async(_admin,req)=>req.headers.get('Authorization')==='Bearer account-token'?{userId:host}:null,
            handleCommunity:async()=>null,loadPrivateMessages:async()=>[],loadData:async()=>({cards:new Map()}),loadGamePools:async data=>data,
            App:{TimeLeagueHelmet:{normalizeHelmet(){}},TimeLeaguePublicState:{projectPublicState:(_state,seat)=>({seat})},DuatCampaign:{projectCampaign:(_state,faction)=>({faction})}},availableSeasons:[2025]};
        const handlers={vault:load('supabase/functions/time-league/index.ts',base).handler,duat:load('supabase/functions/duat/index.ts',base).handler};
        const call=async(game,body,credential)=>{const response=await handlers[game](request(body,credential));return {status:response.status,...await response.json()};};
        for(const item of claimed){
            const {game,room,credential,guest}=item,key=game==='vault'?'rowId':'roomId';
            assert.equal((await call(game,{op:'guest-resume'},credential)).guest.userId,guest.userId);
            const opened=await call(game,{op:'load',[key]:room.roomId},credential);assert.equal(opened.status,200,opened.error);
            const visible=opened.row?.members||opened.room?.seats;
            assert.equal(visible.find(seat=>seat.guest)?.displayName,'Friend');
            assert.equal(visible.find(seat=>seat.displayName==='Commissioner')?.guest,false);
            assert(!JSON.stringify(visible).includes('host@example.invalid'));assert(!JSON.stringify(visible).includes(guest.userId));
            assert.equal((await call(game,{op:'load',[key]:room.roomId},'account-token')).status,200,'host account retains access');
            const list=await call(game,{op:'list'},credential);assert.equal(list.status,200);assert.equal((list.leagues||list.rooms).length,1);
            assert.equal((await call(game,{op:'load',[key]:crypto.randomUUID()},credential)).status,403);
            for(const op of ['create','claim','profile-get','community-list'])assert.equal((await call(game,{op,[key]:room.roomId},credential)).status,403);
            assert.equal((await call(game,{op:'list'},token())).status,401);
            assert.equal((await call(game==='vault'?'duat':'vault',{op:'list'},credential)).status,401);
            if(game==='vault'){
                const start=await call(game,{op:'action',rowId:room.roomId,version:opened.row.version,action:{type:'start'}},credential);
                assert.equal(start.status,400);assert.match(start.error,/commissioner/);
                await q("update time_leagues set state=jsonb_set(state,'{phase}','\"season\"') where id=$1",[room.roomId]);
                assert.equal((await call(game,{op:'ready',rowId:room.roomId,ready:true,userId:host},credential)).status,200);
                assert.equal((await q('select ready_week from time_league_members where league_id=$1 and user_id=$2',[room.roomId,guest.userId]))[0].ready_week,1);
                assert.equal((await q('select ready_week from time_league_members where league_id=$1 and user_id=$2',[room.roomId,host]))[0].ready_week,0,'injected user ID cannot ready the host');
            }else{
                const ready=await call(game,{op:'action',roomId:room.roomId,expectedRevision:opened.room.revision,actionId:'guest-ready',action:{type:'set-ready',ready:true}},credential);
                assert.equal(ready.status,200,ready.error);
                assert.equal((await q('select ready from duat_campaign_members where room_id=$1 and user_id=$2',[room.roomId,guest.userId]))[0].ready,true);
                assert.equal((await call(game,{op:'action',roomId:room.roomId,expectedRevision:ready.room.revision,actionId:'forged-host',action:{type:'set-ready',ready:true,factionId:'host'}},credential)).status,403);
                assert.equal((await call(game,{op:'action',roomId:room.roomId,expectedRevision:ready.room.revision,actionId:'host-start',action:{type:'start-draft'}},credential)).status,403);
            }
            await q("update game_guest_sessions set expires_at=now()-interval '1 second' where app_user_id=$1",[guest.userId]);
            assert.equal((await call(game,{op:'guest-resume'},credential)).status,401);
            assert.equal((await call(game,{op:'load',[key]:room.roomId},credential)).status,401);
            assert.equal((await claim(game,room,credential)).status,400,'retry cannot resurrect an expired pass');
            await q("update game_guest_sessions set expires_at=now()+interval '1 day',revoked_at=now() where app_user_id=$1",[guest.userId]);
            assert.equal((await call(game,{op:'list'},credential)).status,401,'revocation denies access');
            await q('update game_guest_sessions set revoked_at=null where app_user_id=$1',[guest.userId]);
            await q('delete from '+(game==='vault'?'time_league_members':'duat_campaign_members')+' where user_id=$1',[guest.userId]);
            assert.equal((await call(game,{op:'guest-resume'},credential)).status,401,'deleted or detached seats cannot resume');
        }
        allowJoin=false;assert.equal((await claim('vault',failedRoom,token())).status,429);
        console.log('PASS actual game handlers: resume/load/list, wrong game/room, host/community denial, forged/expired/revoked tokens, rate limiting');
    } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
