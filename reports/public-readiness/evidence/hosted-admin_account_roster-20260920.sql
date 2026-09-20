CREATE OR REPLACE FUNCTION public.admin_account_roster(p_limit integer DEFAULT 100)
 RETURNS TABLE(account_id uuid, email text, display_name text, created_at timestamp with time zone, connected_platform boolean, last_activity timestamp with time zone, events bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select u.id, u.email, u.display_name, u.created_at,
         (
           (u.platform_usernames is not null and u.platform_usernames <> '{}'::jsonb)
           or coalesce(a.league_events, 0) > 0
         ),
         a.last_activity,
         coalesce(a.events, 0)
  from app_users u
  left join lateral (
    select max(event_ts) as last_activity,
           count(*) as events,
           count(*) filter (
             where e.module in ('myteam','trades','lineup','fa','compare',
                                'draft','league','trophies','legend')
           ) as league_events
    from analytics_events e
    where e.user_id = u.id
  ) a on true
  order by u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$function$
