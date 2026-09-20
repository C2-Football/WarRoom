#!/usr/bin/env python3
"""Permanent C2 game-only release boundary. No automatic or manifest SQL writes.

Pushes validate but never deploy. A manual run needs a committed reviewed scope,
exact candidate/build inputs, previous hosted bytes/version, and read-only schema
compatibility. Missing/stale evidence never falls back to a larger deployment.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
import urllib.request

PROJECT = 'sxshiqyxhhifvtfqawbq'
REPOSITORY = 'C2-Football/WarRoom'
PREFIX = '.github/c2-releases/'
FUNCTIONS = ('league-cup', 'time-league', 'duat')
CONTROLS = ('scripts/c2-edge-release.py', '.github/workflows/deploy-functions.yml',
            'supabase/config.toml', 'package.json', 'package-lock.json')
GENERATED = {'time-league': 'supabase/functions/time-league/runtime.js',
             'duat': 'supabase/functions/duat/runtime.js'}
BUILDERS = {'time-league': 'scripts/build-time-league-server.cjs',
            'duat': 'scripts/build-duat-server.cjs'}
COMMON_MIGRATIONS = ('20260317000000', '20260502020000', '20260909000000', '20260918020000')
MIGRATIONS = {
    'league-cup': ('20260907000000', '20260907010000'),
    'time-league': ('20260907193000', '20260908010000', '20260908020000',
                    '20260908030000', '20260908040000', '20260908050000'),
    'duat': ('20260908160000', '20260908180000', '20260908210000',
             '20260908230000', '20260916010000'),
}

# Fixed catalog-only query: never execute manifest SQL or invoke application
# routines. Include function definitions because a table's unchanged trigger
# name does not establish that the referenced function still has safe behavior.
SCHEMA_QUERY = """
select jsonb_build_object(
 'relations',coalesce((select jsonb_agg(jsonb_build_object(
  'name',c.relname,'owner',pg_get_userbyid(c.relowner),'kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
  'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid)) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
  'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(select jsonb_agg(case when r=0 then 'public' else pg_get_userbyid(r) end order by r) from unnest(p.polroles) r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
  'acl',c.relacl::text,
  'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid::regclass::text) from pg_index i where i.indrelid=c.oid),
  'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
  'view',case when c.relkind in ('v','m') then pg_get_viewdef(c.oid) else null end
 ) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')
 and (c.relname in ('app_users','app_user_roles','league_cups','cup_honours') or c.relname like 'time_league%' or c.relname like 'duat_%')), '[]'::jsonb),
 'routines',coalesce((select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')), '[]'::jsonb)
) as schema;
"""


class Rejected(Exception):
    pass


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL)


def commit(root, revision):
    if not re.fullmatch(r'[0-9a-f]{40}', revision or ''):
        raise Rejected('Use an exact commit revision')
    git(root, 'cat-file', '-e', revision + '^{commit}')


def safe_path(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_./-]+', value) or value.startswith('/') or '..' in PurePosixPath(value).parts:
        raise Rejected('Unsafe source path')
    return value


def local_bytes(root, name):
    safe_path(name)
    current = Path(root)
    for part in PurePosixPath(name).parts:
        current /= part
        if current.is_symlink():
            raise Rejected('Symbolic source is not releasable: ' + name)
    return current.read_bytes()


def content(root, head, name):
    value = git(root, 'show', head + ':' + safe_path(name))
    if local_bytes(root, name) != value:
        raise Rejected('Working source differs from candidate: ' + name)
    return value


def selected_functions(values):
    if not isinstance(values, list) or not values or len(set(values)) != len(values) or any(value not in FUNCTIONS for value in values):
        raise Rejected('C2 may release only league-cup, time-league and duat; use the owning repository for all other endpoints')
    return sorted(values)


def tracked(root, head):
    return set(git(root, 'ls-tree', '-r', '--name-only', head).decode().splitlines())


def changed(root, base, head):
    return set(git(root, 'diff', '--name-only', base, head).decode().splitlines())


def migration_inputs(root, head, selected):
    versions = set(COMMON_MIGRATIONS)
    for name in selected:
        versions.update(MIGRATIONS[name])
    paths = tracked(root, head)
    result = {}
    for version in sorted(versions):
        matches = [p for p in paths if p.startswith('supabase/migrations/' + version + '_') and p.endswith('.sql')]
        if len(matches) != 1:
            raise Rejected('Missing or ambiguous game schema prerequisite: ' + version)
        result[version] = {'path': matches[0], 'sha256': digest(content(root, head, matches[0]))}
    return result


def dependencies(root, head, name, generated, hosted=False):
    result, pending = set(), ['supabase/functions/' + name + '/index.ts']
    while pending:
        path = pending.pop()
        if path in result:
            continue
        safe_path(path)
        if not (path.startswith('supabase/functions/' + name + '/') or path.startswith('supabase/functions/_shared/') or path == 'js/shared/woeppel-cup.js'):
            raise Rejected('Cross-endpoint dependency requires ownership review: ' + path)
        source = local_bytes(root, path) if hosted or path in generated else content(root, head, path)
        result.add(path)
        text = source.decode()
        if re.search(r'\bimport\s*\(\s*[^\s\'\"]', text):
            raise Rejected('Computed import requires explicit review: ' + path)
        for ref in re.findall(r'(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)[\'\"]([^\'\"]+)[\'\"]', text):
            if ref.startswith('.'):
                pending.append(os.path.normpath(str(PurePosixPath(path).parent / ref)).replace(os.sep, '/'))
    return result


def input_paths(root, head, selected, generated):
    paths = tracked(root, head)
    result = set(CONTROLS)
    # Configurable import maps could change resolution without changing a
    # literal relative import. Current game builds have none; new ones require
    # an explicit planner extension rather than an implicit bypass.
    if any(PurePosixPath(p).name in ('deno.json', 'deno.jsonc', 'import_map.json') for p in paths if p.startswith('supabase/')):
        raise Rejected('An import map requires an explicit release dependency review')
    for name in selected:
        result.update(dependencies(root, head, name, generated) - set(generated))
        if name in BUILDERS:
            result.add(BUILDERS[name])
            result.update(p for p in paths if p.startswith('js/shared/time-league-') and p.endswith('.js'))
            result.update(p for p in paths if p.startswith('data/' + name + '/'))
            if name == 'duat':
                result.update(p for p in paths if p.startswith('js/duat/') and p.endswith('.js'))
    result.update(value['path'] for value in migration_inputs(root, head, selected).values())
    return result


def validate_manifest(root, head, manifest_path):
    commit(root, head)
    if not re.fullmatch(re.escape(PREFIX) + r'[a-z0-9-]+\.json', manifest_path or ''):
        raise Rejected('Select a committed .github/c2-releases/<name>.json manifest')
    manifest = json.loads(content(root, head, manifest_path))
    if manifest.get('schema') != 1 or manifest.get('repository') != REPOSITORY or manifest.get('project') != PROJECT:
        raise Rejected('Wrong release manifest ownership or project')
    base = manifest.get('base')
    commit(root, base)
    if subprocess.run(['git', 'merge-base', '--is-ancestor', base, head], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        raise Rejected('Reviewed base is not an ancestor of this candidate')
    selected = selected_functions(manifest.get('functions'))
    generated = manifest.get('generated', {})
    if set(generated) != {GENERATED[name] for name in selected if name in GENERATED}:
        raise Rejected('Generated runtime scope does not match selected games')
    for path, expected in generated.items():
        if digest(local_bytes(root, path)) != expected:
            raise Rejected('Generated runtime changed; rebuild and review: ' + path)
    delta = changed(root, base, head)
    if manifest_path not in delta:
        raise Rejected('Manifest must be part of the reviewed candidate delta')
    if any(p.startswith(PREFIX) and p != manifest_path for p in delta):
        raise Rejected('Only one release manifest may change')
    inputs = input_paths(root, head, selected, generated) | (delta - {manifest_path})
    hashes = manifest.get('candidate', {})
    if set(hashes) != inputs:
        raise Rejected('Candidate delta or required build inputs changed outside the reviewed hashes')
    current_paths = tracked(root, head)
    for path, expected in hashes.items():
        if expected is None:
            if path in current_paths or Path(root, path).exists():
                raise Rejected('Reviewed deletion no longer matches: ' + path)
        elif not re.fullmatch(r'[0-9a-f]{64}', expected or '') or digest(content(root, head, path)) != expected:
            raise Rejected('Candidate hash mismatch: ' + path)
    if manifest.get('requiredMigrations') != migration_inputs(root, head, selected):
        raise Rejected('Game migration prerequisites changed; no migrations are applied by this workflow')
    if not re.fullmatch(r'[0-9a-f]{64}', manifest.get('databaseSchemaSha256', '')):
        raise Rejected('A reviewed database schema snapshot is required')
    hosted = manifest.get('hosted', {})
    if set(hosted) != set(selected):
        raise Rejected('Hosted scope differs from selected games')
    for name, value in hosted.items():
        if not isinstance(value.get('version'), int) or value['version'] < 1 or value.get('verify_jwt') is not False:
            raise Rejected('Missing verified hosted version/gateway state: ' + name)
        sources = value.get('sources', {})
        if 'supabase/functions/' + name + '/index.ts' not in sources:
            raise Rejected('Missing previous hosted source: ' + name)
        for path, expected in sources.items():
            safe_path(path)
            if not (path.startswith('supabase/functions/' + name + '/') or path.startswith('supabase/functions/_shared/') or path == 'js/shared/woeppel-cup.js') or not re.fullmatch(r'[0-9a-f]{64}', expected or ''):
                raise Rejected('Invalid hosted source scope')
    config = content(root, head, 'supabase/config.toml').decode()
    if not re.search(r'^project_id\s*=\s*"' + PROJECT + r'"', config, re.M):
        raise Rejected('Supabase project configuration changed')
    for name in selected:
        if not re.search(r'\[functions\.' + re.escape(name) + r'\]\s*\nverify_jwt\s*=\s*false\b', config):
            raise Rejected('Internal-auth gateway pin missing: ' + name)
    return manifest


def management(route, payload=None):
    token = os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not token:
        raise Rejected('Supabase access is required for read-only compatibility verification')
    request = urllib.request.Request('https://api.supabase.com/v1/projects/' + PROJECT + '/' + route,
        data=canonical(payload) if payload is not None else None,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
        method='POST' if payload is not None else 'GET')
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except Exception as error:
        # API errors can include sensitive diagnostics. Keep workflow output
        # confined to the failed operation; do not print response bodies.
        raise Rejected('Read-only hosted verification failed: ' + route) from error


def database_snapshot(versions):
    if any(not re.fullmatch(r'[0-9]{14}', value) for value in versions):
        raise Rejected('Invalid migration version')
    quoted = ','.join("'" + value + "'" for value in sorted(versions))
    rows = management('database/query', {'query': 'select version from supabase_migrations.schema_migrations where version in (' + quoted + ') order by version'})
    if not isinstance(rows, list) or {row.get('version') for row in rows} != set(versions):
        raise Rejected('Game schema prerequisites are not all recorded; apply only through a separate reviewed migration release')
    rows = management('database/query', {'query': SCHEMA_QUERY})
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0].get('schema'), dict) or not rows[0]['schema'].get('relations') or not rows[0]['schema'].get('routines'):
        raise Rejected('Database schema snapshot is unavailable')
    return digest(canonical(rows[0]['schema']))


def downloaded_sources(directory):
    result = {}
    for path in Path(directory).rglob('*'):
        if path.is_symlink():
            raise Rejected('Symbolic hosted source is unsupported')
        if not path.is_file():
            continue
        name = path.relative_to(directory).as_posix()
        if name == 'supabase/config.toml' or name.startswith('supabase/.temp/'):
            continue
        result[name] = digest(local_bytes(directory, name))
    return result


def hosted_snapshot(selected):
    rows = management('functions')
    if not isinstance(rows, list):
        raise Rejected('Hosted function inventory is unavailable')
    result = {}
    with tempfile.TemporaryDirectory(prefix='dhq-c2-game-preflight-') as temporary:
        for name in selected:
            matches = [row for row in rows if row.get('slug') == name]
            if len(matches) != 1 or matches[0].get('verify_jwt') is not False:
                raise Rejected('Hosted function or gateway state needs review: ' + name)
            target = Path(temporary, name)
            target.mkdir()
            download = subprocess.run(['supabase', 'functions', 'download', name, '--project-ref', PROJECT, '--use-api'], cwd=target, capture_output=True)
            if download.returncode and name == 'time-league':
                # The Vault already requires Docker bundling. Its large source
                # can also exceed server-side unbundling limits. Retry the
                # documented local unbundler in a fresh temporary directory;
                # the exact same complete-source checks still apply.
                shutil.rmtree(target)
                target.mkdir()
                download = subprocess.run(['supabase', 'functions', 'download', name, '--project-ref', PROJECT], cwd=target, capture_output=True)
            if download.returncode:
                raise Rejected('Cannot download complete hosted source: ' + name)
            sources = downloaded_sources(target)
            try:
                refs = dependencies(target, '', name, {}, hosted=True)
            except (OSError, Rejected) as error:
                raise Rejected('Hosted source download is incomplete: ' + name) from error
            if refs != set(sources):
                raise Rejected('Hosted source inventory differs from its import closure: ' + name)
            result[name] = {'version': matches[0].get('version'), 'verify_jwt': False, 'sources': sources}
    # A redeploy during source download must not create mixed old-version /
    # new-source evidence. This narrows, but cannot remove, the later external
    # interval before Supabase accepts a deployment (there is no CAS here).
    latest = management('functions')
    if not isinstance(latest, list):
        raise Rejected('Hosted inventory became unavailable during inspection')
    for name in selected:
        matches = [row for row in latest if row.get('slug') == name]
        if len(matches) != 1 or matches[0].get('version') != result[name]['version'] or matches[0].get('verify_jwt') is not False:
            raise Rejected('Hosted function changed during source inspection: ' + name)
    return result


def verify_hosted(root, head, manifest, name, after=False):
    if name not in manifest['functions']:
        raise Rejected('Function is outside this release scope')
    if database_snapshot(manifest['requiredMigrations']) != manifest['databaseSchemaSha256']:
        raise Rejected('Hosted schema changed since review; no backend write is allowed')
    current = hosted_snapshot([name])[name]
    if after:
        expected_sources = {path: digest(local_bytes(root, path)) for path in dependencies(root, head, name, manifest['generated'])}
        if current['sources'] != expected_sources or current['version'] <= manifest['hosted'][name]['version']:
            raise Rejected('Served function source/version does not match the reviewed candidate: ' + name)
    elif current != manifest['hosted'][name]:
        raise Rejected('Hosted source/version changed since review: ' + name)


def prepare(root, head, base, selected, manifest_path):
    commit(root, head)
    commit(root, base)
    selected = selected_functions(selected)
    if not re.fullmatch(re.escape(PREFIX) + r'[a-z0-9-]+\.json', manifest_path or '') or Path(root, manifest_path).exists():
        raise Rejected('Choose a new .github/c2-releases/<name>.json path')
    generated = {}
    for name in selected:
        if name in BUILDERS:
            subprocess.run(['node', BUILDERS[name]], cwd=root, check=True)
            generated[GENERATED[name]] = digest(local_bytes(root, GENERATED[name]))
    files = input_paths(root, head, selected, generated) | changed(root, base, head)
    current_paths = tracked(root, head)
    candidate = {path: digest(content(root, head, path)) if path in current_paths else None for path in sorted(files)}
    prerequisites = migration_inputs(root, head, selected)
    manifest = {'schema': 1, 'repository': REPOSITORY, 'project': PROJECT, 'base': base,
                'functions': selected, 'candidate': candidate, 'generated': generated,
                'requiredMigrations': prerequisites, 'databaseSchemaSha256': database_snapshot(prerequisites),
                'hosted': hosted_snapshot(selected)}
    target = Path(root, manifest_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    print('Prepared read-only release evidence. Review, commit and validate before dispatch:', manifest_path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('plan', 'prepare', 'verify', 'verify-deployed'))
    parser.add_argument('--head', required=True)
    parser.add_argument('--base', default='')
    parser.add_argument('--event', choices=('push', 'workflow_dispatch'), default='workflow_dispatch')
    parser.add_argument('--repository', default='')
    parser.add_argument('--ref', default='')
    parser.add_argument('--manifest', default='')
    parser.add_argument('--functions', default='')
    parser.add_argument('--function', default='')
    args = parser.parse_args()
    root = Path.cwd()
    try:
        if args.command == 'prepare':
            prepare(root, args.head, args.base, args.functions.split(','), args.manifest)
            return
        if args.command == 'plan' and args.event == 'push':
            # Deliberately independent of changed paths and unavailable history.
            # Normal source/frontend pushes cannot deploy or apply migrations.
            selected = []
        else:
            if args.repository != REPOSITORY or args.ref != 'refs/heads/main' or args.event != 'workflow_dispatch':
                raise Rejected('Manual game releases run only from the owning C2 main branch')
            manifest = validate_manifest(root, args.head, args.manifest)
            selected = manifest['functions']
            if args.command in ('verify', 'verify-deployed'):
                verify_hosted(root, args.head, manifest, args.function, args.command == 'verify-deployed')
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                for name in FUNCTIONS:
                    output.write(name.replace('-', '_') + '=' + str(name in selected).lower() + '\n')
        print('Validated C2 game scope:', ', '.join(selected) or '(none; push validation only)')
    except (Rejected, ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        raise SystemExit('C2 release stopped: ' + str(error)) from error


if __name__ == '__main__':
    main()
