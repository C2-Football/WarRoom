insert into supabase_migrations.schema_migrations(version,name) values ('20261012030000','20261012030000_commish_ignored_tasks') on conflict(version) do nothing;
