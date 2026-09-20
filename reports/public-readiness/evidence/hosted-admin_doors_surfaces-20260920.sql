CREATE OR REPLACE FUNCTION public.admin_doors_surfaces(p_since timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with scoped as (
    select
      coalesce(nullif(metadata->>'surface',''), 'unknown') as surface,
      session_id, event_name, metadata,
      -- Same production fence the rollup uses: the live website or the app
      -- shell. Everything else (lab, localhost, rig) is sandbox noise.
      (metadata->>'host' = 'dhqfootball.com' or metadata->>'surface' = 'ios_app') as is_prod,
      (session_id like 'edge\_app:%') as is_server
    from analytics_events
    where event_ts >= p_since
  )
  select jsonb_build_object(
    'surfaces', coalesce((
      select jsonb_object_agg(surface, jsonb_build_object('events', ev, 'sessions', ss))
      from (
        select surface, count(*) as ev, count(distinct session_id) as ss
        from scoped where is_prod group by surface
      ) s
    ), '{}'::jsonb),
    'signups', coalesce((
      select jsonb_object_agg(surface, n)
      from (
        select surface, count(*) as n from scoped
        where is_prod and (event_name = 'signup_succeeded'
              or (event_name = 'oauth_succeeded' and metadata->>'isNew' = 'true'))
        group by surface
      ) g
    ), '{}'::jsonb),
    'devSandbox', (
      select jsonb_build_object('events', count(*), 'sessions', count(distinct session_id))
      from scoped where not is_prod and not is_server
    ),
    'serverEvents', (select count(*) from scoped where is_server)
  );
$function$
