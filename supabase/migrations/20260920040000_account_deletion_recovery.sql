-- Cross-service deletion remains synchronous: the Edge handler verifies billing
-- cancellation and exact Auth identities before asking this transaction to erase
-- the app row. No credentials, billing source IDs, or retry state are discarded
-- on an unconfirmed external operation. Requires billing source migration 010000.
begin;
create or replace function public.inspect_account_deletion(
  p_actor_id uuid, p_actor_version integer, p_email text, p_self boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.app_users%rowtype;
  v_target public.app_users%rowtype;
  v_subscriptions jsonb;
  v_sources jsonb;
begin
  if p_actor_id is null or p_actor_version is null or p_actor_version < 1
     or p_self is null or p_email is null or p_email <> lower(btrim(p_email))
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid deletion request' using errcode='22023';
  end if;
  -- Deterministic account locking avoids upgrades of two concurrent self-read
  -- locks and opposite actor/target lock order in administrative requests.
  perform 1 from public.app_users where id=p_actor_id or email=p_email order by id for update;
  select * into v_actor from public.app_users where id=p_actor_id;
  if v_actor.id is null or v_actor.session_version<>p_actor_version then
    raise exception 'Account authorization changed' using errcode='42501';
  end if;
  if not p_self then
    perform 1 from public.app_user_roles where user_id=p_actor_id and role in ('admin','owner') for share;
    if not found then raise exception 'Administrator authorization required' using errcode='42501'; end if;
    if lower(v_actor.email)=p_email then raise exception 'Use self-service deletion for your own account' using errcode='42501'; end if;
  end if;
  select * into v_target from public.app_users where email=p_email;
  if p_self and (v_target.id is null or v_target.id<>p_actor_id) then
    raise exception 'Account identity changed' using errcode='42501';
  end if;
  if not p_self and v_target.id is not null then
    perform 1 from public.app_user_roles where user_id=v_target.id and role in ('admin','owner') for share;
    if found then raise exception 'Administrator accounts cannot be deleted here' using errcode='42501'; end if;
  end if;
  -- The account row lock also serializes with apply_billing_event. Preserve the
  -- complete inventory, including Stripe purchases hidden by an RC aggregate.
  select coalesce(jsonb_agg(to_jsonb(s) order by s.product_slug),'[]'::jsonb)
    into v_subscriptions from public.subscriptions s where s.user_id=v_target.id;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.provider,s.source_id),'[]'::jsonb)
    into v_sources from public.billing_subscription_sources s where s.user_id=v_target.id;
  return jsonb_build_object(
    'actor',jsonb_build_object('id',v_actor.id,'session_version',v_actor.session_version),
    'target',case when v_target.id is null then null else jsonb_build_object('id',v_target.id,'email',v_target.email,'session_version',v_target.session_version) end,
    'email',p_email,'self',p_self,'subscriptions',v_subscriptions,'sources',v_sources);
end;
$$;

create or replace function public.finalize_account_deletion(
  p_actor_id uuid, p_actor_version integer, p_email text, p_self boolean, p_snapshot jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_current jsonb; v_id uuid; v_deleted uuid;
begin
  v_current := public.inspect_account_deletion(p_actor_id,p_actor_version,p_email,p_self);
  if p_snapshot is null or v_current is distinct from p_snapshot then
    raise exception 'Account or billing state changed; retry deletion' using errcode='40001';
  end if;
  v_id := (v_current->'target'->>'id')::uuid;
  if v_id is not null then
    delete from public.app_users where id=v_id and session_version=(v_current->'target'->>'session_version')::integer
      returning id into v_deleted;
    if v_deleted is null then raise exception 'Account changed; retry deletion' using errcode='40001'; end if;
  end if;
  return jsonb_build_object('deletedAppUser',v_deleted is not null);
end;
$$;
revoke all on function public.inspect_account_deletion(uuid,integer,text,boolean),
  public.finalize_account_deletion(uuid,integer,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.inspect_account_deletion(uuid,integer,text,boolean),
  public.finalize_account_deletion(uuid,integer,text,boolean,jsonb) to service_role;
commit;
