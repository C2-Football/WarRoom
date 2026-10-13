-- Account-owned Commissioner choices. Restoring writes a tombstone rather than
-- deleting the record: an older device must not resurrect an ignored task.
-- Apply through the account backend's reviewed release lane, never C2 games.
begin;

create table if not exists public.commish_ignored_tasks (
  user_id uuid not null references public.app_users(id) on delete cascade,
  task_id text not null check (octet_length(task_id) between 1 and 512),
  state text not null check (state in ('ignored', 'restored')),
  revision integer not null check (revision > 0),
  snapshot jsonb check (snapshot is null or (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 8192)),
  updated_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

create table if not exists public.commish_ignored_operations (
  user_id uuid not null references public.app_users(id) on delete cascade,
  operation_id uuid not null,
  task_id text not null,
  state text not null,
  expected_revision integer not null,
  snapshot jsonb,
  applied_revision integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);

alter table public.commish_ignored_tasks enable row level security;
alter table public.commish_ignored_tasks force row level security;
alter table public.commish_ignored_operations enable row level security;
alter table public.commish_ignored_operations force row level security;
-- No client policies or direct table grants. Edge authenticates the account;
-- service-only routines also recheck its session under the account row lock.
revoke all on public.commish_ignored_tasks, public.commish_ignored_operations from public, anon, authenticated, service_role;

create or replace function public.commish_ignored_record_json(p_record public.commish_ignored_tasks)
returns jsonb language sql immutable set search_path = public
as $$ select case when p_record.task_id is null then null else jsonb_build_object(
  'taskId', p_record.task_id, 'state', p_record.state, 'revision', p_record.revision,
  'updatedAt', p_record.updated_at, 'snapshot', p_record.snapshot) end $$;
revoke all on function public.commish_ignored_record_json(public.commish_ignored_tasks) from public, anon, authenticated, service_role;

create or replace function public.read_commish_ignored_tasks(
  p_user_id uuid, p_session_version integer, p_cursor text default null, p_limit integer default 200
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_rows jsonb;
  v_cursor text := null;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 or (p_cursor is not null and octet_length(p_cursor) > 512) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Invalid page request.');
  end if;
  perform 1 from public.app_users where id = p_user_id and session_version = p_session_version for share;
  if not found then return jsonb_build_object('ok', false, 'code', 'invalid_session', 'error', 'Sign in again.'); end if;
  select coalesce(jsonb_agg(page.record order by page.task_id collate "C"), '[]'::jsonb) into v_rows from (
    select t.task_id, public.commish_ignored_record_json(t) as record
    from public.commish_ignored_tasks t
    where t.user_id = p_user_id and (p_cursor is null or t.task_id collate "C" > p_cursor collate "C")
    order by t.task_id collate "C" limit p_limit + 1
  ) page;
  if jsonb_array_length(v_rows) > p_limit then
    v_cursor := v_rows -> (p_limit - 1) ->> 'taskId';
    v_rows := v_rows - p_limit;
  end if;
  return jsonb_build_object('ok', true, 'accountId', p_user_id, 'records', v_rows, 'nextCursor', v_cursor);
end;
$$;

create or replace function public.change_commish_ignored_task(
  p_user_id uuid, p_session_version integer, p_task_id text, p_state text,
  p_expected_revision integer, p_operation_id uuid, p_snapshot jsonb default null
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_current public.commish_ignored_tasks;
  v_operation public.commish_ignored_operations;
begin
  if p_task_id is null or octet_length(p_task_id) not between 1 and 512 or p_task_id ~ '[[:cntrl:]]'
    or p_state is null or p_state not in ('ignored', 'restored') or p_operation_id is null
    or p_expected_revision is null or p_expected_revision not between 0 and 2000000000
    or (p_snapshot is not null and (jsonb_typeof(p_snapshot) <> 'object' or octet_length(p_snapshot::text) > 8192
      or p_snapshot ->> 'id' is distinct from p_task_id)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'error', 'Invalid task change.');
  end if;
  -- Serialize small per-account writes, including operation IDs reused across
  -- different tasks. This also closes the auth-check/revocation race.
  perform 1 from public.app_users where id = p_user_id and session_version = p_session_version for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'invalid_session', 'error', 'Sign in again.'); end if;
  select * into v_current from public.commish_ignored_tasks where user_id = p_user_id and task_id = p_task_id;
  select * into v_operation from public.commish_ignored_operations where user_id = p_user_id and operation_id = p_operation_id;
  if found then
    if v_operation.task_id <> p_task_id or v_operation.state <> p_state
      or v_operation.expected_revision <> p_expected_revision or v_operation.snapshot is distinct from p_snapshot then
      return jsonb_build_object('ok', false, 'accountId', p_user_id, 'code', 'operation_conflict',
        'error', 'This operation ID was already used for another change.', 'record', public.commish_ignored_record_json(v_current));
    end if;
    -- Return current truth, even when the original successful change has since
    -- been restored elsewhere. A lost-response retry never rewrites it.
    return jsonb_build_object('ok', true, 'accountId', p_user_id, 'record', public.commish_ignored_record_json(v_current),
      'appliedRevision', v_operation.applied_revision, 'duplicate', true);
  end if;
  if coalesce(v_current.revision, 0) <> p_expected_revision then
    return jsonb_build_object('ok', false, 'accountId', p_user_id, 'code', 'revision_conflict',
      'error', 'This task changed on another device. Reload your choices before trying again.',
      'record', public.commish_ignored_record_json(v_current));
  end if;
  insert into public.commish_ignored_tasks(user_id, task_id, state, revision, snapshot, updated_at)
  values (p_user_id, p_task_id, p_state, p_expected_revision + 1,
    case when p_state = 'restored' then coalesce(v_current.snapshot, p_snapshot) else p_snapshot end, clock_timestamp())
  on conflict (user_id, task_id) do update set state = excluded.state, revision = excluded.revision,
    snapshot = excluded.snapshot, updated_at = excluded.updated_at
  returning * into v_current;
  insert into public.commish_ignored_operations(user_id, operation_id, task_id, state, expected_revision, snapshot, applied_revision)
  values (p_user_id, p_operation_id, p_task_id, p_state, p_expected_revision, p_snapshot, v_current.revision);
  return jsonb_build_object('ok', true, 'accountId', p_user_id, 'record', public.commish_ignored_record_json(v_current),
    'appliedRevision', v_current.revision, 'duplicate', false);
end;
$$;

revoke all on function public.read_commish_ignored_tasks(uuid, integer, text, integer) from public, anon, authenticated;
revoke all on function public.change_commish_ignored_task(uuid, integer, text, text, integer, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.read_commish_ignored_tasks(uuid, integer, text, integer) to service_role;
grant execute on function public.change_commish_ignored_task(uuid, integer, text, text, integer, uuid, jsonb) to service_role;

commit;
