-- Read-only catalog evidence; returns no user/account/game records.
begin read only;
set local statement_timeout = '15s';
select
  (select json_agg(version order by version) from supabase_migrations.schema_migrations
   where version in ('20260918010000', '20260918020000')) as migrations,
  (select json_agg(t order by t.table_name) from (
    select c.relname as table_name, c.relrowsecurity as rls_enabled,
      (select json_agg(p) from (
        select policyname, permissive, roles, cmd, qual, with_check
        from pg_policies where schemaname = 'public' and tablename = c.relname
          and policyname = 'active_app_session'
      ) p) as active_session_policy
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  ) t) as tables,
  (select json_agg(f) from (
    select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
      p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as definition,
      has_function_privilege('anon', p.oid, 'execute') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
      has_function_privilege('service_role', p.oid, 'execute') as service_execute
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('current_app_user_id', 'confirm_app_password_reset')
  ) f) as functions;
rollback;
