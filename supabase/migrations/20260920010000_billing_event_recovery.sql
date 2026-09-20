-- Keep provider purchases independent while retaining the established public
-- subscriptions row. Every receipt, source change and aggregate commits together.
-- Existing subscriptions and gifts are preserved. Safe to replay.
begin;

-- Staging starts paused. Separate Edge deployments are not atomic: do not
-- begin source tracking until all legacy requests have drained. The manifest
-- records verified deployed source hashes; 7 minutes exceeds the hosted
-- platform's documented maximum 400-second worker lifetime.
create table if not exists public.billing_event_control (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  writer_revisions jsonb,
  activate_after timestamptz,
  activated_at timestamptz
);
insert into public.billing_event_control(singleton) values(true) on conflict do nothing;
alter table public.billing_event_control enable row level security;
revoke all on public.billing_event_control from public,anon,authenticated;
grant all on public.billing_event_control to service_role;

create or replace function public.stage_billing_event_cutover(p_writer_revisions jsonb)
returns timestamptz language plpgsql security definer set search_path=public,pg_temp as $$
declare v_key text; v_after timestamptz := clock_timestamp()+interval '7 minutes';
begin
  foreach v_key in array array['fw-stripe-webhook','fw-revenuecat-webhook','fw-create-checkout','_shared/billing-events.ts'] loop
    if coalesce(p_writer_revisions->>v_key,'') !~ '^[0-9a-f]{64}$' then
      raise exception 'Verified billing writer manifest required' using errcode='22023';
    end if;
  end loop;
  update public.billing_event_control set enabled=false,writer_revisions=p_writer_revisions,activate_after=v_after where singleton;
  return v_after;
end;
$$;
create or replace function public.activate_billing_event_processing()
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_control public.billing_event_control%rowtype;
begin
  select * into v_control from public.billing_event_control where singleton for update;
  if v_control.enabled then return true; end if;
  if v_control.activate_after is null or v_control.activate_after>clock_timestamp() or v_control.writer_revisions is null then
    raise exception 'Billing writers have not completed the verified drain window' using errcode='40001';
  end if;
  update public.billing_event_control set enabled=true,activated_at=clock_timestamp() where singleton;
  return true;
end;
$$;
create or replace function public.pause_billing_event_processing()
returns void language sql security definer set search_path=public,pg_temp as $$
  update public.billing_event_control set enabled=false,activate_after=null where singleton;
$$;
create or replace function public.billing_event_processing_enabled()
returns boolean language sql security definer set search_path=public,pg_temp as $$
  select coalesce((select enabled from public.billing_event_control where singleton),false);
$$;
revoke all on function public.stage_billing_event_cutover(jsonb),public.activate_billing_event_processing(),public.pause_billing_event_processing(),public.billing_event_processing_enabled() from public,anon,authenticated;
grant execute on function public.stage_billing_event_cutover(jsonb),public.activate_billing_event_processing(),public.pause_billing_event_processing(),public.billing_event_processing_enabled() to service_role;

create table if not exists public.billing_event_leases (
  provider text not null check (provider in ('stripe', 'revenuecat')),
  source_id text not null,
  lease_token uuid,
  expires_at timestamptz,
  primary key(provider, source_id)
);
create table if not exists public.billing_subscription_sources (
  provider text not null check (provider in ('stripe', 'revenuecat')),
  source_id text not null,
  user_id uuid not null references public.app_users(id) on delete cascade,
  product_slug text not null references public.products(slug),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  event_at timestamptz not null,
  event_id text,
  legacy boolean not null default false,
  superseded_by text,
  primary key(provider, source_id)
);
create index if not exists billing_sources_account_product_idx
  on public.billing_subscription_sources(user_id, product_slug);
create table if not exists public.billing_event_receipts (
  provider text not null check (provider in ('stripe', 'revenuecat')),
  event_id text not null,
  user_id uuid not null references public.app_users(id) on delete cascade,
  source_id text not null,
  outcome text not null,
  received_at timestamptz not null default now(),
  primary key(provider, event_id)
);
alter table public.subscriptions add column if not exists billing_source_key text;
alter table public.billing_event_leases enable row level security;
alter table public.billing_subscription_sources enable row level security;
alter table public.billing_event_receipts enable row level security;
revoke all on public.billing_event_leases, public.billing_subscription_sources, public.billing_event_receipts from public, anon, authenticated;
grant all on public.billing_event_leases, public.billing_subscription_sources, public.billing_event_receipts to service_role;

-- A short durable lease serializes a provider's current-object fetch and write.
-- Unlike event.created seconds, this never guesses an ordering between Stripe
-- events. A crashed/slow fetch loses its lease and cannot overwrite a successor.
create or replace function public.claim_billing_event(p_provider text, p_source_id text, p_event_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_token uuid; v_now timestamptz := clock_timestamp(); v_lease public.billing_event_leases%rowtype;
begin
  if p_provider not in ('stripe','revenuecat') or p_provider is null
     or coalesce(length(p_source_id),0) not between 1 and 500
     or coalesce(length(p_event_id),0) not between 1 and 200 then
    raise exception 'Invalid billing event identity' using errcode='22023';
  end if;
  if not public.billing_event_processing_enabled() then return jsonb_build_object('outcome','paused'); end if;
  if exists(select 1 from public.billing_event_receipts where provider=p_provider and event_id=p_event_id) then
    return jsonb_build_object('outcome','duplicate');
  end if;
  insert into public.billing_event_leases(provider, source_id) values(p_provider,p_source_id) on conflict do nothing;
  select * into v_lease from public.billing_event_leases where provider=p_provider and source_id=p_source_id for update;
  if v_lease.lease_token is not null and v_lease.expires_at > v_now then
    return jsonb_build_object('outcome','busy');
  end if;
  v_token := gen_random_uuid();
  update public.billing_event_leases set lease_token=v_token, expires_at=v_now+interval '60 seconds'
    where provider=p_provider and source_id=p_source_id;
  return jsonb_build_object('outcome','claimed','lease_token',v_token);
end;
$$;

create or replace function public.apply_billing_event(
  p_provider text, p_source_id text, p_event_id text, p_lease_token uuid,
  p_event_at timestamptz, p_user_id uuid, p_product_slug text, p_state jsonb
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := clock_timestamp();
  v_current public.subscriptions%rowtype;
  v_source public.billing_subscription_sources%rowtype;
  v_legacy public.billing_subscription_sources%rowtype;
  v_selected public.billing_subscription_sources%rowtype;
  v_state jsonb;
  v_key text;
  v_outcome text := 'applied';
  v_incomplete_recovery boolean := false;
begin
  if p_provider not in ('stripe','revenuecat') or p_provider is null
     or p_user_id is null or p_event_at is null
     or p_product_slug not in ('dhq','war_room','dynast_hq','bundle') or p_product_slug is null
     or jsonb_typeof(p_state) is distinct from 'object'
     or coalesce(length(p_event_id),0) not between 1 and 200 then
    raise exception 'Invalid billing event state' using errcode='22023';
  end if;
  -- Hold a shared control lock through commit; pause waits for any in-flight
  -- atomic write, and no later write can start after pause returns.
  perform 1 from public.billing_event_control where singleton and enabled for share;
  if not found then raise exception 'Billing event processing is paused' using errcode='40001'; end if;
  perform 1 from public.billing_event_leases where provider=p_provider and source_id=p_source_id
    and lease_token=p_lease_token and expires_at>v_now for update;
  if not found then raise exception 'Billing event lease expired or unavailable' using errcode='40001'; end if;
  -- All billing providers serialize by account before source/aggregate writes.
  perform 1 from public.app_users where id=p_user_id for update;
  if not found then raise exception 'Billing account not found' using errcode='23503'; end if;
  if exists(select 1 from public.billing_event_receipts where provider=p_provider and event_id=p_event_id) then
    update public.billing_event_leases set lease_token=null,expires_at=null where provider=p_provider and source_id=p_source_id;
    return jsonb_build_object('outcome','duplicate');
  end if;
  select * into v_current from public.subscriptions where user_id=p_user_id and product_slug=p_product_slug for update;

  -- Bootstrap only known provenance, once. A free provisioning row has no
  -- payment source. Do not infer a second current store from leftover columns.
  if v_current.id is not null and not exists(select 1 from public.billing_subscription_sources where user_id=p_user_id and product_slug=p_product_slug) then
    if v_current.stripe_subscription_id is not null and (v_current.store is null or v_current.store='stripe') then
      v_key := v_current.stripe_subscription_id;
      insert into public.billing_subscription_sources(provider,source_id,user_id,product_slug,state,event_at,legacy)
        values('stripe',v_key,p_user_id,p_product_slug,to_jsonb(v_current),'-infinity',true);
      v_current.billing_source_key := 'stripe:'||v_key;
    elsif v_current.rc_app_user_id is not null then
      v_key := 'legacy:'||v_current.id::text;
      insert into public.billing_subscription_sources(provider,source_id,user_id,product_slug,state,event_at,legacy)
        values('revenuecat',v_key,p_user_id,p_product_slug,to_jsonb(v_current),coalesce(v_current.rc_last_event_at,'-infinity'),true);
      v_current.billing_source_key := 'revenuecat:'||v_key;
    end if;
  end if;
  select * into v_source from public.billing_subscription_sources where provider=p_provider and source_id=p_source_id for update;
  if v_source.user_id is not null and (v_source.user_id<>p_user_id or v_source.product_slug<>p_product_slug) then
    raise exception 'Billing source belongs to another account or product' using errcode='23514';
  end if;

  -- Old RC rows lack original transaction IDs. A negative event can adopt
  -- only the recorded store/product/period, never another purchase's period.
  -- A later positive snapshot for that store/product establishes its renewal.
  if p_provider='revenuecat' then
    select * into v_legacy from public.billing_subscription_sources
      where user_id=p_user_id and product_slug=p_product_slug and provider='revenuecat' and legacy and superseded_by is null
        and state->>'store'=p_state->>'store' and state->>'rc_product_id'=p_state->>'rc_product_id'
      order by event_at desc limit 1 for update;
    if v_legacy.user_id is not null and p_event_at>=v_legacy.event_at and (
      (p_state->>'status' in ('active','trialing') and p_state->>'tier'='pro'
        and (p_state->>'current_period_end')::timestamptz >= (v_legacy.state->>'current_period_end')::timestamptz) or
      ((v_legacy.state->>'current_period_start')::timestamptz=(p_state->>'current_period_start')::timestamptz
        and (v_legacy.state->>'current_period_end')::timestamptz=(p_state->>'current_period_end')::timestamptz)
    ) then
      -- Retain the original snapshot for evidence, but retire its grant once
      -- this event identifies it. Reconcile even if an earlier ambiguous event
      -- already created the incoming source; otherwise the legacy grant lives forever.
      update public.billing_subscription_sources set superseded_by=p_source_id
        where provider='revenuecat' and source_id=v_legacy.source_id;
      if v_source.user_id is null then v_source := v_legacy; end if;
      if v_current.billing_source_key='revenuecat:'||v_legacy.source_id then v_current.billing_source_key:='revenuecat:'||p_source_id; end if;
    elsif v_legacy.user_id is not null then
      v_outcome := 'legacy_preserved';
    end if;
  end if;

  -- A cancellation is not evidence of a currently paid purchase. Preserve
  -- known state; negative-only delivery starts incomplete/free, never Pro.
  v_incomplete_recovery := p_provider='revenuecat' and v_source.state->>'status'='incomplete'
    and p_state->>'status' in ('active','trialing')
    and (p_state->>'current_period_end')::timestamptz >= (v_source.state->>'current_period_end')::timestamptz;
  v_state := coalesce(v_source.state,'{"tier":"free","status":"incomplete","cancel_at_period_end":false}'::jsonb)||p_state;
  -- An earlier purchase can fill a cancellation-only record, while the later
  -- cancellation continues to control its renewal flag.
  if coalesce(v_incomplete_recovery,false) and p_event_at<v_source.event_at then
    v_state := v_state||jsonb_build_object('cancel_at_period_end',v_source.state->'cancel_at_period_end');
  end if;
  -- Replayed historical RC purchase events do not establish current access.
  -- Stripe uses its freshly retrieved status, so this rule is RC-only.
  if p_provider='revenuecat' and (v_source.user_id is null or coalesce(v_incomplete_recovery,false))
    and v_state->>'status' in ('active','trialing')
    and (v_state->>'current_period_end')::timestamptz<=v_now then
    v_state := v_state||'{"tier":"free","status":"incomplete"}'::jsonb;
  end if;
  if v_state->>'status' not in ('active','trialing','past_due','canceled','unpaid','incomplete') or v_state->>'status' is null
     or v_state->>'tier' not in ('free','pro') or v_state->>'tier' is null then
    raise exception 'Incomplete billing subscription state' using errcode='22023';
  end if;
  if p_provider='revenuecat' and v_source.user_id is not null and (
    (p_event_at<v_source.event_at and not coalesce(v_incomplete_recovery,false)) or
    (p_state ? 'current_period_end' and (p_state->>'current_period_end')::timestamptz<(v_source.state->>'current_period_end')::timestamptz) or
    (p_event_at=v_source.event_at and v_source.state->>'status'='canceled' and p_state->>'status' in ('active','trialing'))
  ) then
    v_outcome := 'stale';
  else
    insert into public.billing_subscription_sources(provider,source_id,user_id,product_slug,state,event_at,event_id)
      values(p_provider,p_source_id,p_user_id,p_product_slug,v_state,case when coalesce(v_incomplete_recovery,false) then greatest(p_event_at,v_source.event_at) else p_event_at end,p_event_id)
      on conflict(provider,source_id) do update set state=excluded.state,event_at=excluded.event_at,event_id=excluded.event_id,legacy=false;
  end if;

  -- Keep the displayed active source until it stops granting access. A second
  -- active purchase cannot revoke it; if it expires, another valid source can
  -- retain access. This does not alter product prices or gift expiry semantics.
  select * into v_selected from public.billing_subscription_sources
    where user_id=p_user_id and product_slug=p_product_slug and superseded_by is null
    order by ((state->>'status' in ('active','trialing')) and state->>'tier'='pro'
      and (state->>'expires_at' is null or (state->>'expires_at')::timestamptz>v_now)) desc,
      (provider||':'||source_id=v_current.billing_source_key) desc, event_at desc, provider, source_id
    limit 1;
  v_state := v_selected.state;
  insert into public.subscriptions(user_id,product_slug,tier,status,store,billing_period,stripe_subscription_id,stripe_price_id,
    current_period_start,current_period_end,cancel_at_period_end,rc_app_user_id,rc_product_id,rc_last_event_at,expires_at,billing_source_key)
    values(p_user_id,p_product_slug,v_state->>'tier',v_state->>'status',v_state->>'store',v_state->>'billing_period',
      v_state->>'stripe_subscription_id',v_state->>'stripe_price_id',(v_state->>'current_period_start')::timestamptz,
      (v_state->>'current_period_end')::timestamptz,coalesce((v_state->>'cancel_at_period_end')::boolean,false),
      v_state->>'rc_app_user_id',v_state->>'rc_product_id',(v_state->>'rc_last_event_at')::timestamptz,
      (v_state->>'expires_at')::timestamptz,v_selected.provider||':'||v_selected.source_id)
    on conflict(user_id,product_slug) do update set tier=excluded.tier,status=excluded.status,store=excluded.store,
      billing_period=excluded.billing_period,stripe_subscription_id=excluded.stripe_subscription_id,stripe_price_id=excluded.stripe_price_id,
      current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,
      rc_app_user_id=excluded.rc_app_user_id,rc_product_id=excluded.rc_product_id,rc_last_event_at=excluded.rc_last_event_at,
      expires_at=excluded.expires_at,billing_source_key=excluded.billing_source_key;
  insert into public.billing_event_receipts(provider,event_id,user_id,source_id,outcome) values(p_provider,p_event_id,p_user_id,p_source_id,v_outcome);
  update public.billing_event_leases set lease_token=null,expires_at=null where provider=p_provider and source_id=p_source_id;
  return jsonb_build_object('outcome',v_outcome);
end;
$$;

revoke all on function public.claim_billing_event(text,text,text) from public,anon,authenticated;
revoke all on function public.apply_billing_event(text,text,text,uuid,timestamptz,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_billing_event(text,text,text) to service_role;
grant execute on function public.apply_billing_event(text,text,text,uuid,timestamptz,uuid,text,jsonb) to service_role;
commit;
