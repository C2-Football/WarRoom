-- Keep browser product analytics insert-only after RLS lockdown.
--
-- Client apps may write privacy-light behavior events, but dashboards and
-- rollups must use service-role paths rather than browser read/update access.

do $$
begin
  if to_regclass('public.analytics_events') is not null then
    revoke all on table public.analytics_events from anon, authenticated;
    grant insert on table public.analytics_events to anon, authenticated;
    grant select, insert, update, delete on table public.analytics_events to service_role;
  end if;
end $$;
