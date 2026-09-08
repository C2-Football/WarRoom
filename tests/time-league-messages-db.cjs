'use strict';
// PGLITE_MODULE=/tmp/vault-community-qa/node_modules/@electric-sql/pglite node tests/time-league-messages-db.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
global.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'ai', 'rivals']) require(`../js/shared/time-league-${name}.js`);
(async () => {
    const db = new PGlite();
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role;
            create table app_users(id uuid primary key);
            create function current_app_user_id() returns uuid language sql as $$select null::uuid$$;
            create function gen_random_bytes(n integer) returns bytea language sql as $$select substring(decode(repeat(md5(random()::text),n),'hex') from 1 for n)$$;`);
        await db.exec(fs.readFileSync('supabase/migrations/20260907193000_time_league_multiplayer.sql', 'utf8'));
        const migration = fs.readFileSync('supabase/migrations/20260908030000_time_league_messages.sql', 'utf8');
        await db.exec(migration); await db.exec(migration);
        const messageWeekMigration = fs.readFileSync('supabase/migrations/20260908040000_time_league_message_week.sql', 'utf8');
        await db.exec(messageWeekMigration); await db.exec(messageWeekMigration);
        const q = async (sql, values = []) => (await db.query(sql, values)).rows;
        const users = (await q('insert into app_users select gen_random_uuid() from generate_series(1,5) returning id')).map(row => row.id);
        const initial = { leagueId: 'private-qa', name: 'Private messaging QA', seed: 'private-qa', phase: 'complete', currentWeek: 14,
            settings: { regularSeasonWeeks: 12 }, finalizedWeeks: [], trades: [], waiverResults: [], rivalRelationships: [],
            teams: [{ teamId: 't1', manager: 'human', name: 'Host', roster: [{ entryId: 'owned', identity: 'original' }] }, { teamId: 't2', manager: 'human', name: 'Friend', roster: [] }, { teamId: 't3', manager: 'human', name: 'Other', roster: [] }, { teamId: 't4', manager: 'human', name: 'Unjoined', roster: [] }, { teamId: 't5', manager: 'ai', name: 'AI', aiPersona: 'warlord', roster: [] }],
            pendingClaims: [{ claimId: 'kept' }], championTeamId: 't2' };
        const league = (await q('select create_time_league($1,$2) as id', [users[0], initial]))[0].id;
        for (let i = 1; i <= 2; i++) {
            const code = (await q('select invite_code from time_league_members where league_id=$1 and seat_team_id=$2', [league, `t${i + 1}`]))[0].invite_code;
            await q('select claim_time_league_invite($1,$2)', [users[i], code]);
        }
        await q("update time_league_members set user_id=$2,joined_at=null where league_id=$1 and seat_team_id='t4'", [league, users[3]]);
        const game = async () => (await q('select state,version from time_leagues where id=$1', [league]))[0];
        const inbox = async (user, limit = 1000) => (await q('select load_time_league_messages($1,$2,$3) as messages', [user, league, limit]))[0].messages;
        const count = async () => Number((await q('select count(*) as n from time_league_messages where league_id=$1', [league]))[0].n);
        let nextId = 1;
        const build = async (from = 't1', to = 't5', extra = {}) => {
            const current = await game();
            const user = users[Number(from.slice(1)) - 1];
            const state = { ...current.state, rivalMessages: await inbox(user) };
            const input = { teamId: from, toTeamId: to, text: `Message ${nextId}`, tone: 'competitive', messageId: `send_${String(nextId++).padStart(8, '0')}`, ...extra };
            const next = App.TimeLeagueRivals.sendMessage(state, input, '1900-01-01T00:00:00Z');
            return { user, version: current.version, messages: next.rivalMessages.filter(m => m.id === `chat:${input.messageId}` || m.id === `reply:${input.messageId}`),
                relationship: next.rivalRelationships?.find(r => r.ownerTeamId === to && r.otherTeamId === from) || null };
        };
        const send = async p => (await q('select send_time_league_message($1,$2,$3,$4,$5) as result', [p.user, league, p.version, p.messages, p.relationship]))[0].result;
        const first = await build(); const before = await game();
        await db.exec('set role service_role');
        const firstResult = await send(first);
        await db.exec('reset role');
        assert.equal(firstResult.ok, true); assert.equal(firstResult.version, before.version + 1);
        assert.equal(await count(), 2);
        const after = await game();
        assert.deepEqual({ ...after.state, rivalRelationships: [] }, initial, 'the send cannot change rosters, claims, champion or other game fields');
        assert.deepEqual(after.state.rivalRelationships, [{ ownerTeamId: 't5', otherTeamId: 't1', heat: 2, updatedWeek: 14 }]);
        assert.equal(Object.hasOwn(after.state, 'rivalMessages'), false, 'message text never enters the shared game');
        const stored = await inbox(users[0]);
        assert.equal(stored.length, 2); assert.equal(stored[1].replyToId, stored[0].id);
        assert.ok(new Date(stored[0].createdAt).getUTCFullYear() > 2020, 'database time overrides forged payload time');
        const dedupe = await send({ ...first, version: 1 });
        assert.equal(dedupe.deduplicated, true); assert.equal(dedupe.version, after.version);
        assert.equal(await count(), 2); assert.deepEqual((await game()).state, after.state, 'retry does not increase rivalry heat again');
        await assert.rejects(() => send({ ...first, messages: [{ ...first.messages[0], text: 'changed' }, first.messages[1]] }), /identifier was already used/);
        console.log('ok AI chat is atomic, private, timestamped by the database and idempotent before CAS');

        const human = await build('t2', 't3');
        const humanBefore = await game(); await send(human);
        assert.equal(human.messages.length, 1); assert.deepEqual((await game()).state, humanBefore.state, 'human messages do not change game relationships');
        assert.equal((await inbox(users[0])).length, 2, 'commissioner cannot read another pair of owners');
        assert.deepEqual((await inbox(users[1])).map(m => m.id), [human.messages[0].id]);
        assert.deepEqual((await inbox(users[2])).map(m => m.id), [human.messages[0].id]);
        await assert.rejects(() => inbox(users[3]), /joined seat/);
        await assert.rejects(() => inbox(users[4]), /joined seat/);
        const valid = await build('t1', 't2');
        const invalids = [
            [{ ...valid, user: users[4] }, /joined seat/],
            [{ ...valid, user: users[3] }, /joined seat/],
            [{ ...valid, messages: [{ ...valid.messages[0], fromTeamId: 't2' }] }, /own team/],
            [{ ...valid, messages: [{ ...valid.messages[0], toTeamId: 't4' }] }, /not joined/],
            [{ ...valid, messages: [{ ...valid.messages[0], text: 'x'.repeat(501) }] }, /message fields/],
            [{ ...valid, messages: [{ ...valid.messages[0], replyToId: human.messages[0].id }] }, /not part/],
            [{ ...valid, messages: [{ ...valid.messages[0], week: 0 }] }, /message fields/],
            [{ ...valid, messages: [{ ...valid.messages[0], unrelated: 'field' }] }, /message fields/],
            [{ ...valid, relationship: { ownerTeamId: 't5', otherTeamId: 't1', heat: 6, updatedWeek: 14 } }, /Human conversations/],
        ];
        const untouched = await game(); const oldCount = await count();
        for (const [input, pattern] of invalids) {
            await assert.rejects(() => send(input), pattern);
            assert.deepEqual(await game(), untouched); assert.equal(await count(), oldCount);
        }
        const badAi = await build();
        await assert.rejects(() => send({ ...badAi, messages: [badAi.messages[0], { ...badAi.messages[1], fromTeamId: 't3' }] }), /Invalid AI reply/);
        await assert.rejects(() => send({ ...badAi, relationship: { ...badAi.relationship, heat: -6 } }), /Invalid rivalry/);
        assert.equal(await count(), oldCount, 'malformed second messages roll back the first');
        assert.deepEqual(await send({ ...valid, version: 1 }), { ok: false, conflict: true });
        assert.deepEqual(await game(), untouched);
        console.log('ok private audiences, joined seats, speaker identity, reply references and atomic rollback are enforced');

        const raceA = await build('t1', 't2'); const raceB = await build('t1', 't3');
        const race = await Promise.all([send(raceA), send(raceB)]);
        assert.equal(race.filter(result => result.ok).length, 1);
        assert.equal(race.filter(result => result.conflict).length, 1);
        const rateCount = async () => Number((await q("select count(*) as n from time_league_messages where league_id=$1 and from_team_id='t1' and message_id like 'chat:%'", [league]))[0].n);
        while (await rateCount() < 10) await send(await build('t1', 't2'));
        const limited = await build('t1', 't2');
        await assert.rejects(() => send(limited), /Give that manager a moment/);
        assert.equal(await rateCount(), 10);
        assert.equal((await send({ ...first, version: 1 })).deduplicated, true, 'rate limiting never breaks safe retry acknowledgement');
        console.log('ok competing sends have one CAS winner; burst limits preserve idempotent retries');

        for (const role of ['authenticated', 'anon']) {
            await db.exec(`set role ${role}`);
            await assert.rejects(() => inbox(users[0]), /permission denied/);
            await assert.rejects(() => send(first), /permission denied/);
            await assert.rejects(() => q('select * from time_league_messages'), /permission denied/);
            await db.exec('reset role');
        }
        const rls = (await q("select relrowsecurity from pg_class where oid='public.time_league_messages'::regclass"))[0];
        assert.equal(rls.relrowsecurity, true);
        const grants = (await q("select has_table_privilege('authenticated','public.time_league_messages','SELECT') as readable,has_function_privilege('service_role','public.load_time_league_messages(uuid,uuid,integer,text,text)','EXECUTE') as allowed"))[0];
        assert.equal(grants.readable, false); assert.equal(grants.allowed, true);
        await q(`insert into time_league_messages(league_id,message_id,from_team_id,to_team_id,payload)
            select $1,'chat:page_'||lpad(n::text,8,'0'),'t2','t3',jsonb_build_object('id','chat:page_'||lpad(n::text,8,'0'),'fromTeamId','t2','toTeamId','t3','text','page '||n,'tone','neutral','week',14,'createdAt',now(),'sequence',n)
            from generate_series(1,1010) n`, [league]);
        const bounded = await inbox(users[1], 500000);
        assert.equal(bounded.length, 1000); assert.equal(bounded.at(-1).text, 'page 1010');
        assert.equal((await inbox(users[1], 3)).length, 3);
        const pinned = (await q('select load_time_league_messages($1,$2,1000,$3) as messages', [users[1], league, human.messages[0].id]))[0].messages;
        assert.equal(pinned.length, 1000); assert.ok(pinned.some(m => m.id === human.messages[0].id), 'an old send remains available for exact retry validation');
        const hiddenPinned = (await q('select load_time_league_messages($1,$2,1000,$3) as messages', [users[0], league, human.messages[0].id]))[0].messages;
        assert.ok(!hiddenPinned.some(m => m.id === human.messages[0].id), 'pinning cannot cross a private audience');
        assert.ok(!(await inbox(users[0])).some(m => m.text.startsWith('page ')));
        await q(`insert into time_league_messages(league_id,message_id,from_team_id,to_team_id,payload)
            select $1,'chat:busy_'||lpad(n::text,8,'0'),'t1','t3',jsonb_build_object('id','chat:busy_'||lpad(n::text,8,'0'),'fromTeamId','t1','toTeamId','t3','text','busy thread '||n,'tone','neutral','week',14,'createdAt',now(),'sequence',n)
            from generate_series(1,1010) n`, [league]);
        const quietReply = { teamId: 't3', toTeamId: 't2', text: 'Finally replying to our earlier message.', tone: 'friendly', messageId: 'quiet_reply_0001', replyToId: human.messages[0].id };
        const replyGame = await game();
        const recentForQuietOwner = await inbox(users[2]);
        assert.throws(() => App.TimeLeagueRivals.sendMessage({ ...replyGame.state, rivalMessages: recentForQuietOwner }, quietReply, new Date().toISOString()), /not part/, 'ordinary bounded history reproduces a quiet-thread reply falling off the page');
        const helperSource = require('@babel/standalone').transform(fs.readFileSync('supabase/functions/time-league/messages.ts','utf8'), { filename: 'messages.ts', presets: ['typescript'] }).code;
        const { sendPrivateMessage } = await import('data:text/javascript;base64,' + Buffer.from(helperSource).toString('base64'));
        const rpcCalls = [];
        const admin = { rpc: async (name, params) => {
            rpcCalls.push({ name, params });
            if (name === 'load_time_league_messages') return { data: (await q('select load_time_league_messages($1,$2,$3,$4,$5) as messages', [params.p_user_id,params.p_league_id,params.p_limit,params.p_send_id || null,params.p_reply_id || null]))[0].messages, error: null };
            return { data: await send({ user: params.p_user_id, version: params.p_expected_version, messages: params.p_messages, relationship: params.p_relationship }), error: null };
        } };
        const joined = await q('select * from time_league_members where league_id=$1', [league]);
        const delivered = await sendPrivateMessage(admin, users[2], { ...replyGame, id: league }, joined.find(m => m.user_id === users[2]), joined, quietReply, App.TimeLeagueRivals, replyGame.version);
        assert.equal(delivered.ok, true);
        assert.equal(rpcCalls[0].params.p_reply_id, human.messages[0].id);
        assert.equal((await inbox(users[1])).at(-1).replyToId, human.messages[0].id, 'a retained draft replies successfully after over 1,000 messages in a different conversation');
        const unauthorizedReplyPin = (await q('select load_time_league_messages($1,$2,1000,null,$3) as messages', [users[0],league,human.messages[0].id]))[0].messages;
        assert.ok(!unauthorizedReplyPin.some(m => m.id === human.messages[0].id), 'reply pins cannot disclose another pair of owners');
        console.log('ok quiet-thread replies remain sendable after more than 1,000 messages elsewhere');
        console.log('ok RLS and grants block direct reads; bounded private history returns the newest messages in order');

        const postgameState = { ...initial, leagueId: 'postgame-chat-qa', phase: 'season', currentWeek: 2, weekStage: 'postgame', rivalRelationships: [] };
        const postgameLeague = (await q('select create_time_league($1,$2) as id', [users[0], postgameState]))[0].id;
        const buildPostgame = async id => {
            const saved = (await q('select state,version from time_leagues where id=$1', [postgameLeague]))[0];
            const history = (await q('select load_time_league_messages($1,$2) as messages', [users[0], postgameLeague]))[0].messages;
            const next = App.TimeLeagueRivals.sendMessage({ ...saved.state, rivalMessages: history }, {
                teamId: 't1', toTeamId: 't5', text: 'Good game.', tone: 'friendly', messageId: id,
            }, new Date().toISOString());
            return { version: saved.version, messages: next.rivalMessages.filter(m => m.id === `chat:${id}` || m.id === `reply:${id}`),
                relationship: next.rivalRelationships.find(r => r.ownerTeamId === 't5' && r.otherTeamId === 't1') };
        };
        const sendPostgame = async p => (await q('select send_time_league_message($1,$2,$3,$4,$5) as result',
            [users[0], postgameLeague, p.version, p.messages, p.relationship]))[0].result;
        const finalChat = await buildPostgame('postgame_first_01');
        assert(finalChat.messages.every(m => m.week === 1));
        assert.equal((await sendPostgame(finalChat)).ok, true, 'Postgame owner and AI messages pass actual SQL validation');
        assert.equal(finalChat.relationship.updatedWeek, 2, 'Relationship decay retains its internal clock');
        const oldRuntime = await buildPostgame('postgame_legacy_01');
        const oldEnvelope = { ...oldRuntime, messages: oldRuntime.messages.map(m => ({ ...m, week: 2 })) };
        assert.equal((await sendPostgame(oldEnvelope)).ok, true, 'The additive migration accepts the old Edge envelope during rollout');
        assert.equal((await sendPostgame(oldEnvelope)).deduplicated, true, 'Normalization cannot break an old-runtime retry');
        const invalidWeek = await buildPostgame('postgame_wrong_01');
        await assert.rejects(() => sendPostgame({ ...invalidWeek, messages: invalidWeek.messages.map(m => ({ ...m, week: 3 })) }), /message fields/, 'A caller cannot choose an arbitrary message week');
        await q("update time_leagues set state=jsonb_set(state,'{weekStage}','\"claims\"'),version=version+1 where id=$1", [postgameLeague]);
        assert.equal((await sendPostgame(finalChat)).deduplicated, true, 'An exact retry after advance keeps its saved Week 1');
        assert.equal((await sendPostgame(oldEnvelope)).deduplicated, true, 'An old-runtime retry remains idempotent after the gate advances');
        const nextWeekChat = await buildPostgame('postgame_next_01');
        assert(nextWeekChat.messages.every(m => m.week === 2));
        assert.equal((await sendPostgame(nextWeekChat)).ok, true);
        await q("update time_leagues set state=state || '{\"phase\":\"complete\",\"weekStage\":\"postgame\",\"currentWeek\":15}'::jsonb,version=version+1 where id=$1", [postgameLeague]);
        const titleChat = await buildPostgame('postgame_title_01');
        assert(titleChat.messages.every(m => m.week === 14));
        assert.equal((await sendPostgame(titleChat)).ok, true, 'Championship correspondence remains Week 14');
        const chronology = (await q('select load_time_league_messages($1,$2) as messages', [users[0], postgameLeague]))[0].messages;
        assert.deepEqual(chronology.map(m => m.week), [1, 1, 1, 1, 2, 2, 14, 14], 'The DB normalizes both old and new postgame envelopes to its visible week');
        console.log('ok actual SQL keeps postgame chat with the visible final, advances at the gate, and preserves retry and rivalry semantics');
        console.log('PASS: private Vault messaging database integration');
    } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
