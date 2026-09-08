begin;

-- Online league state contains unrevealed draft eras, drawn player editions,
-- private queues and bids. Membership authorizes the Edge projection, never a
-- direct table snapshot. Keep RLS closed even if SELECT is granted later.
alter table public.time_leagues enable row level security;
alter table public.time_league_members enable row level security;
drop policy if exists time_leagues_read on public.time_leagues;
revoke all on public.time_leagues, public.time_league_members from public, anon, authenticated;
grant all on public.time_leagues, public.time_league_members to service_role;

-- Keep cryptographic draw material outside JSON state. During deployment an
-- older Edge function may still serve that JSON; it never returns this column.
-- The new server derives individual draws with this independent HMAC secret.
alter table public.time_leagues add column if not exists sealed_draw_secret uuid not null default gen_random_uuid();

-- Earlier clients received the league seed. Removing it from new responses
-- cannot make those copies secret again. Replace only that private input,
-- preserving assigned eras, already drawn editions and all recorded results.
-- A separate server column makes manual reapplication safe as well as normal
-- migration-ledger retries. The version bump invalidates an in-flight save.
alter table public.time_leagues add column if not exists sealed_seed_version integer not null default 0;
update public.time_leagues
set state = jsonb_set(state, '{seed}', to_jsonb(gen_random_uuid()::text)),
    version = version + 1,
    sealed_seed_version = 1
where sealed_seed_version = 0;
alter table public.time_leagues alter column sealed_seed_version set default 1;

-- These RPCs accept a server-verified app user id. They must never be callable
-- directly with an authenticated client's self-selected user id or state.
revoke all on function
    public.create_time_league(uuid,jsonb),
    public.claim_time_league_invite(uuid,text),
    public.set_time_league_ready(uuid,uuid,boolean),
    public.apply_time_league_profile(uuid,uuid,text),
    public.refresh_time_league_verified_records(uuid),
    public.time_league_records_after_save(),
    public.send_time_league_community_invite(uuid,uuid,text,uuid),
    public.respond_time_league_community_invite(uuid,uuid,boolean),
    public.load_time_league_messages(uuid,uuid,integer,text,text),
    public.send_time_league_message(uuid,uuid,integer,jsonb,jsonb)
from public, anon, authenticated;

commit;
