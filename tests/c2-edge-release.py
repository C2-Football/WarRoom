#!/usr/bin/env python3
"""Exercise the actual planner in disposable repositories; never contact hosted APIs."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release', ROOT / 'scripts/c2-edge-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='c2-release-test-')
        self.root = Path(self.directory.name)
        self.run_git('init', '-q')
        self.run_git('config', 'user.email', 'controlled@example.invalid')
        self.run_git('config', 'user.name', 'Controlled fixture')
        self.write('supabase/config.toml', 'project_id = "' + release.PROJECT + '"\n' + ''.join('\n[functions.' + n + ']\nverify_jwt = false\n' for n in release.FUNCTIONS))
        for name in release.CONTROLS:
            if name != 'supabase/config.toml':
                self.write(name, (ROOT / name).read_text())
        for version in set(release.COMMON_MIGRATIONS).union(*release.MIGRATIONS.values()):
            self.write('supabase/migrations/' + version + '_fixture.sql', '-- controlled fixture schema prerequisite\n')
        self.write('supabase/functions/_shared/security.ts', 'export const verify = true;\n')
        self.write('js/shared/woeppel-cup.js', 'globalThis.Cup = {};\n')
        self.write('js/shared/time-league-rules.js', 'globalThis.Vault = {};\n')
        self.write('js/duat/rules.js', 'globalThis.Duat = {};\n')
        for name in release.FUNCTIONS:
            extra = "import '../../../js/shared/woeppel-cup.js';" if name == 'league-cup' else "import './runtime.js';"
            self.write('supabase/functions/' + name + '/index.ts', "import '../_shared/security.ts';\n" + extra + '\n')
            if name in release.BUILDERS:
                self.write(release.BUILDERS[name], '// controlled deterministic builder\n')
                self.write('data/' + name + '/history.csv', 'season,week\n2020,1\n')
        self.base = self.save()
        self.write('landing.html', 'reviewed frontend update\n')
        self.head = self.save()
        self.path = '.github/c2-releases/controlled-fixture.json'
        generated = {}
        for name, path in release.GENERATED.items():
            self.write(path, 'export const App = {};\n')
            generated[path] = release.digest((self.root / path).read_bytes())
        files = release.input_paths(self.root, self.head, list(release.FUNCTIONS), generated) | release.changed(self.root, self.base, self.head)
        self.manifest = {
            'schema': 1, 'repository': release.REPOSITORY, 'project': release.PROJECT,
            'base': self.base, 'functions': list(release.FUNCTIONS), 'generated': generated,
            'candidate': {name: release.digest(release.content(self.root, self.head, name)) for name in files},
            'requiredMigrations': release.migration_inputs(self.root, self.head, list(release.FUNCTIONS)),
            'databaseSchemaSha256': 'a' * 64,
            'hosted': {name: {'version': 7, 'verify_jwt': False, 'sources': {'supabase/functions/' + name + '/index.ts': 'b' * 64}} for name in release.FUNCTIONS},
        }
        self.commit_manifest()

    def tearDown(self):
        self.directory.cleanup()

    def run_git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.DEVNULL).decode().strip()

    def write(self, name, text):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def save(self):
        # Generated outputs intentionally stay outside the commit.
        files = [str(p.relative_to(self.root)) for p in self.root.rglob('*') if p.is_file() and '.git' not in p.parts and str(p.relative_to(self.root)) not in release.GENERATED.values()]
        self.run_git('add', '--', *files)
        self.run_git('commit', '-qm', 'controlled candidate')
        return self.run_git('rev-parse', 'HEAD')

    def commit_manifest(self):
        self.write(self.path, json.dumps(self.manifest))
        self.head = self.save()

    def validate(self):
        return release.validate_manifest(self.root, self.head, self.path)

    def test_reviewed_game_scope_and_complete_inputs(self):
        value = self.validate()
        self.assertEqual(set(value['functions']), set(release.FUNCTIONS))
        self.assertIn('js/shared/woeppel-cup.js', value['candidate'])
        self.assertIn('data/time-league/history.csv', value['candidate'])
        self.assertIn('data/duat/history.csv', value['candidate'])
        self.assertIn('supabase/functions/_shared/security.ts', value['candidate'])

    def test_push_never_needs_a_manifest_or_token_and_selects_no_functions(self):
        output = self.root / 'output.txt'
        env = {**os.environ, 'GITHUB_OUTPUT': str(output)}
        env.pop('SUPABASE_ACCESS_TOKEN', None)
        result = subprocess.run(['python3', str(ROOT / 'scripts/c2-edge-release.py'), 'plan', '--event', 'push', '--head', self.head], cwd=self.root, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output.read_text().splitlines(), ['league_cup=false', 'time_league=false', 'duat=false'])

    def test_single_cup_release_does_not_require_or_select_other_game_runtimes(self):
        self.manifest['functions'] = ['league-cup']
        self.manifest['generated'] = {}
        files = release.input_paths(self.root, self.head, ['league-cup'], {}) | (release.changed(self.root, self.base, self.head) - {self.path})
        self.manifest['candidate'] = {name: release.digest(release.content(self.root, self.head, name)) for name in files}
        self.manifest['requiredMigrations'] = release.migration_inputs(self.root, self.head, ['league-cup'])
        self.manifest['hosted'] = {'league-cup': self.manifest['hosted']['league-cup']}
        self.commit_manifest()
        self.assertEqual(self.validate()['functions'], ['league-cup'])
        output = self.root / 'output.txt'
        result = subprocess.run(['python3', str(ROOT / 'scripts/c2-edge-release.py'), 'plan', '--head', self.head, '--repository', release.REPOSITORY, '--ref', 'refs/heads/main', '--manifest', self.path], cwd=self.root, env={**os.environ,'GITHUB_OUTPUT':str(output)},capture_output=True,text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output.read_text().splitlines(), ['league_cup=true', 'time_league=false', 'duat=false'])

    def test_manual_missing_scope_wrong_repository_and_branch_stop(self):
        for extra in [[], ['--repository', 'C2-Football/WarRoom-sandbox', '--ref', 'refs/heads/main'], ['--repository', release.REPOSITORY, '--ref', 'refs/heads/other'], ['--repository', release.REPOSITORY, '--ref', 'refs/heads/main']]:
            result = subprocess.run(['python3', str(ROOT / 'scripts/c2-edge-release.py'), 'plan', '--head', self.head, *extra], cwd=self.root, capture_output=True)
            self.assertNotEqual(result.returncode, 0)

    def test_every_external_or_unknown_function_is_rejected(self):
        for name in ['fw-signin', 'fw-change-password', 'fw-create-checkout', 'fw-delete-account', 'admin-delete-user', 'espn-proxy', 'mfl-proxy', 'yahoo-proxy', 'ai-analyze', 'nfl-scoreboard', 'report-bug', 'new-game']:
            with self.assertRaises(release.Rejected):
                release.selected_functions([name])

    def test_shared_data_and_compiler_changes_invalidate_review(self):
        for name in ['supabase/functions/_shared/security.ts', 'data/time-league/history.csv', 'data/duat/history.csv', 'scripts/build-time-league-server.cjs', '.github/workflows/deploy-functions.yml']:
            original = (self.root / name).read_bytes()
            (self.root / name).write_bytes(original + b'\nchanged\n')
            with self.assertRaises(release.Rejected):
                self.validate()
            (self.root / name).write_bytes(original)

    def test_generated_runtime_change_is_not_accepted_as_unchanged_source(self):
        self.write(release.GENERATED['duat'], 'export const App = {changed: true};')
        with self.assertRaisesRegex(release.Rejected, 'Generated runtime'):
            self.validate()

    def test_new_candidate_commit_requires_new_review(self):
        self.write('later-front-end.html', 'new unreviewed candidate')
        self.head = self.save()
        with self.assertRaisesRegex(release.Rejected, 'outside the reviewed hashes'):
            self.validate()

    def test_schema_prerequisite_cannot_be_dropped_or_replaced_with_billing(self):
        self.manifest['requiredMigrations']['20260920010000'] = {'path': 'supabase/migrations/billing.sql', 'sha256': 'f' * 64}
        self.commit_manifest()
        with self.assertRaisesRegex(release.Rejected, 'migration prerequisites'):
            self.validate()

    def test_hosted_drift_rejected_before_any_deployment(self):
        for change in ['version', 'sources', 'verify_jwt']:
            hosted = copy.deepcopy(self.manifest['hosted']['duat'])
            hosted[change] = {'unexpected': 'c' * 64} if change == 'sources' else True if change == 'verify_jwt' else 8
            with patch.object(release, 'database_snapshot', return_value='a' * 64), patch.object(release, 'hosted_snapshot', return_value={'duat': hosted}):
                with self.assertRaisesRegex(release.Rejected, 'changed since review'):
                    release.verify_hosted(self.root, self.head, self.manifest, 'duat')

    def test_schema_drift_blocks_even_with_matching_function_bytes(self):
        with patch.object(release, 'database_snapshot', return_value='c' * 64), patch.object(release, 'hosted_snapshot') as hosted:
            with self.assertRaisesRegex(release.Rejected, 'schema changed'):
                release.verify_hosted(self.root, self.head, self.manifest, 'duat')
            hosted.assert_not_called()

    def test_served_sources_include_generated_and_cross_directory_cup_engine(self):
        for name in release.FUNCTIONS:
            paths = release.dependencies(self.root, self.head, name, self.manifest['generated'])
            served = {'version': 8, 'verify_jwt': False, 'sources': {path: release.digest(release.local_bytes(self.root, path)) for path in paths}}
            with patch.object(release, 'database_snapshot', return_value='a' * 64), patch.object(release, 'hosted_snapshot', return_value={name: served}):
                release.verify_hosted(self.root, self.head, self.manifest, name, after=True)
                served['sources'].pop(next(iter(paths)))
                with self.assertRaisesRegex(release.Rejected, 'Served function'):
                    release.verify_hosted(self.root, self.head, self.manifest, name, after=True)

    def test_catalog_queries_are_fixed_read_only_and_missing_versions_stop(self):
        calls = []
        def request(route, payload):
            calls.append((route, payload['query']))
            return [{'version': v} for v in self.manifest['requiredMigrations']] if len(calls) == 1 else [{'schema': {'relations': ['controlled'], 'routines': ['controlled']}}]
        with patch.object(release, 'management', side_effect=request):
            value = release.database_snapshot(self.manifest['requiredMigrations'])
        self.assertEqual(len(value), 64)
        self.assertTrue(all(route == 'database/query' and query.strip().lower().startswith('select ') for route, query in calls))
        self.assertEqual(calls[1][1], release.SCHEMA_QUERY)
        with patch.object(release, 'management', return_value=[]):
            with self.assertRaisesRegex(release.Rejected, 'not all recorded'):
                release.database_snapshot(self.manifest['requiredMigrations'])

    def test_download_inventory_does_not_lose_cup_engine_outside_functions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'js/shared/woeppel-cup.js')
            path.parent.mkdir(parents=True)
            path.write_text('controlled')
            self.assertIn('js/shared/woeppel-cup.js', release.downloaded_sources(directory))
            Path(directory, 'linked.js').symlink_to(path)
            with self.assertRaises(release.Rejected):
                release.downloaded_sources(directory)

    def test_deploy_during_download_cannot_produce_mixed_hosted_evidence(self):
        rows = [[{'slug':'duat','version':7,'verify_jwt':False}], [{'slug':'duat','version':8,'verify_jwt':False}]]
        with patch.object(release, 'management', side_effect=rows), patch.object(release.subprocess, 'run') as command, patch.object(release, 'downloaded_sources', return_value={'supabase/functions/duat/index.ts':'b'*64}), patch.object(release, 'dependencies', return_value={'supabase/functions/duat/index.ts'}):
            command.return_value.returncode = 0
            with self.assertRaisesRegex(release.Rejected, 'changed during source inspection'):
                release.hosted_snapshot(['duat'])
            self.assertEqual(command.call_args[0][0][1:3], ['functions', 'download'])

    def test_incomplete_download_cannot_be_recorded_as_reviewed_hosted_state(self):
        def download(*args, **kwargs):
            path = Path(kwargs['cwd'], 'supabase/functions/duat/index.ts')
            path.parent.mkdir(parents=True)
            path.write_text("import './runtime.js';")
            return subprocess.CompletedProcess(args[0], 0)
        with patch.object(release, 'management', return_value=[{'slug':'duat','version':7,'verify_jwt':False}]), patch.object(release.subprocess, 'run', side_effect=download):
            with self.assertRaisesRegex(release.Rejected, 'source download is incomplete'):
                release.hosted_snapshot(['duat'])

    def test_vault_local_unbundle_fallback_retains_complete_source_requirement(self):
        calls = []
        def download(command, **kwargs):
            calls.append(command)
            if '--use-api' in command:
                return subprocess.CompletedProcess(command, 1)
            path = Path(kwargs['cwd'], 'supabase/functions/time-league/index.ts')
            path.parent.mkdir(parents=True)
            path.write_text('export const complete = true;')
            return subprocess.CompletedProcess(command, 0)
        with patch.object(release, 'management', return_value=[{'slug':'time-league','version':7,'verify_jwt':False}]), patch.object(release.subprocess, 'run', side_effect=download):
            value = release.hosted_snapshot(['time-league'])
            self.assertIn('supabase/functions/time-league/index.ts', value['time-league']['sources'])
        self.assertEqual(len(calls), 2)
        self.assertNotIn('--use-api', calls[1])
        self.assertTrue(all(command[1:3] == ['functions','download'] for command in calls))

    def test_workflow_has_only_three_explicit_scoped_deployments_and_no_schema_writes(self):
        import re
        workflow = (ROOT / '.github/workflows/deploy-functions.yml').read_text()
        self.assertEqual(re.findall(r'supabase functions deploy ([a-z-]+)', workflow), list(release.FUNCTIONS))
        self.assertIn("if: github.event_name == 'workflow_dispatch' && github.repository == 'C2-Football/WarRoom' && github.ref == 'refs/heads/main'", workflow)
        self.assertNotIn('database/query', workflow)
        self.assertNotIn('db push', workflow)
        self.assertNotIn('Apply pending', workflow)
        self.assertIn('needs: validate', workflow)
        self.assertIn('docker info > /dev/null', workflow)
        for name in release.FUNCTIONS:
            self.assertIn("if: steps.plan.outputs." + name.replace('-', '_') + " == 'true'", workflow)
            self.assertEqual(workflow.count('--function ' + name + '\n'), 2)
        for suite in ['test:cup', 'test:security', 'test:billing', 'test:timeleague', 'test:duat']:
            self.assertIn('npm run ' + suite, workflow)


if __name__ == '__main__':
    unittest.main(verbosity=2)
