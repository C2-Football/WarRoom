select jsonb_build_object(
 'migration',(select jsonb_build_object('version',version,'name',name) from supabase_migrations.schema_migrations where version='20261012030000'),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
  'anonAccess',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
  'authenticatedAccess',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
  'serviceDirectAccess',has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
  'policies',(select count(*) from pg_policy p where p.polrelid=c.oid),
  'accountCascade',(select count(*) from pg_constraint k where k.conrelid=c.oid and k.confrelid='public.app_users'::regclass and k.confdeltype='c')) order by c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('commish_ignored_tasks','commish_ignored_operations')),
 'routines',(select jsonb_agg(jsonb_build_object('name',p.proname,'signature',p.oid::regprocedure::text,'definer',p.prosecdef,
  'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('read_commish_ignored_tasks','change_commish_ignored_task','commish_ignored_record_json'))
) as verification;
