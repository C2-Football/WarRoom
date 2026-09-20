-- A checkout retry keeps one provider idempotency key, including when the
-- provider succeeded but the response or local checkpoint was lost.
begin;
create table if not exists public.billing_checkout_attempts (
  user_id uuid not null references public.app_users(id) on delete cascade,
  product_slug text not null references public.products(slug),
  attempt_id uuid not null default gen_random_uuid(),
  request jsonb not null check(jsonb_typeof(request)='object'),
  created_at timestamptz not null default clock_timestamp(),
  session_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  primary key(user_id,product_slug)
);
alter table public.billing_checkout_attempts enable row level security;
revoke all on public.billing_checkout_attempts from public,anon,authenticated;
grant all on public.billing_checkout_attempts to service_role;

create or replace function public.claim_billing_checkout(p_user_id uuid,p_product_slug text,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.billing_checkout_attempts%rowtype; v_token uuid:=gen_random_uuid(); v_enabled boolean;
begin
  select enabled into v_enabled from public.billing_event_control where singleton for share;
  if not coalesce(v_enabled,false) then return jsonb_build_object('outcome','paused'); end if;
  perform 1 from public.app_users where id=p_user_id for update;
  if not found then raise exception 'Billing account unavailable'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>8192 then raise exception 'Invalid checkout request'; end if;
  insert into public.billing_checkout_attempts(user_id,product_slug,request) values(p_user_id,p_product_slug,p_request) on conflict do nothing;
  select * into v_row from public.billing_checkout_attempts where user_id=p_user_id and product_slug=p_product_slug for update;
  if v_row.lease_expires_at>clock_timestamp() then return jsonb_build_object('outcome','busy'); end if;
  -- A database nonce cannot fence a Stripe expiration already being sent by
  -- an older worker. Seven minutes exceeds the maximum 400-second worker
  -- lifetime, so a still-running worker cannot overlap its replacement.
  update public.billing_checkout_attempts set lease_token=v_token,lease_expires_at=clock_timestamp()+interval '7 minutes' where user_id=p_user_id and product_slug=p_product_slug;
  return jsonb_build_object('outcome','claimed','attempt_id',v_row.attempt_id,'lease_token',v_token,'request',v_row.request,'session_id',v_row.session_id,'created_at',v_row.created_at);
end; $$;

create or replace function public.checkpoint_billing_checkout(p_user_id uuid,p_product_slug text,p_lease_token uuid,p_session_id text,p_next_request jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.billing_checkout_attempts%rowtype; v_enabled boolean;
begin
  select enabled into v_enabled from public.billing_event_control where singleton for share;
  if not coalesce(v_enabled,false) then raise exception 'Billing processing paused'; end if;
  perform 1 from public.app_users where id=p_user_id for update;
  if not found then raise exception 'Billing account unavailable'; end if;
  select * into v_row from public.billing_checkout_attempts where user_id=p_user_id and product_slug=p_product_slug for update;
  if not found or v_row.lease_token is distinct from p_lease_token or not coalesce(v_row.lease_expires_at>clock_timestamp(),false) then raise exception 'Checkout lease expired'; end if;
  if p_next_request is not null then
    -- Only the server calls this after proving the previous Stripe session
    -- cannot be completed (expired, or completed subscription now canceled).
    if v_row.session_id is distinct from p_session_id or jsonb_typeof(p_next_request) is distinct from 'object' or octet_length(p_next_request::text)>8192 then raise exception 'Checkout rotation does not match confirmed session'; end if;
    update public.billing_checkout_attempts set attempt_id=gen_random_uuid(),request=p_next_request,session_id=null,created_at=clock_timestamp() where user_id=p_user_id and product_slug=p_product_slug returning * into v_row;
  else
    if nullif(p_session_id,'') is null or length(p_session_id)>255 or (v_row.session_id is not null and v_row.session_id<>p_session_id) then raise exception 'Checkout session changed'; end if;
    update public.billing_checkout_attempts set session_id=p_session_id where user_id=p_user_id and product_slug=p_product_slug returning * into v_row;
  end if;
  return jsonb_build_object('outcome','saved','attempt_id',v_row.attempt_id,'lease_token',v_row.lease_token,'request',v_row.request,'session_id',v_row.session_id,'created_at',v_row.created_at);
end; $$;

create or replace function public.release_billing_checkout(p_user_id uuid,p_product_slug text,p_lease_token uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  update public.billing_checkout_attempts set lease_token=null,lease_expires_at=null where user_id=p_user_id and product_slug=p_product_slug and lease_token=p_lease_token;
$$;
revoke all on function public.claim_billing_checkout(uuid,text,jsonb),public.checkpoint_billing_checkout(uuid,text,uuid,text,jsonb),public.release_billing_checkout(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_billing_checkout(uuid,text,jsonb),public.checkpoint_billing_checkout(uuid,text,uuid,text,jsonb),public.release_billing_checkout(uuid,text,uuid) to service_role;

-- The checkout writer now has another local dependency; activation must pin
-- its deployed bytes together with the original billing writer manifest.
create or replace function public.stage_billing_event_cutover(p_writer_revisions jsonb)
returns timestamptz language plpgsql security definer set search_path=public,pg_temp as $$
declare v_key text; v_after timestamptz:=clock_timestamp()+interval '7 minutes';
begin
  foreach v_key in array array['fw-stripe-webhook','fw-revenuecat-webhook','fw-create-checkout','_shared/billing-events.ts','_shared/billing-checkout.ts'] loop
    if coalesce(p_writer_revisions->>v_key,'') !~ '^[0-9a-f]{64}$' then raise exception 'Verified billing writer manifest required' using errcode='22023'; end if;
  end loop;
  update public.billing_event_control set enabled=false,writer_revisions=p_writer_revisions,activate_after=v_after where singleton;
  return v_after;
end; $$;
revoke all on function public.stage_billing_event_cutover(jsonb) from public,anon,authenticated;
grant execute on function public.stage_billing_event_cutover(jsonb) to service_role;
commit;
