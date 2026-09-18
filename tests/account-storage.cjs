'use strict';
// Real planning engines, shared typed storage, account switches and a durable
// browser-storage adapter. No remote users, sessions, or data are touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const disk = new Map();
let account = 'account-a', username = 'mutable-provider-profile', token = 'app-session';
let blockWrites = false;
const rawStorage = {
    getItem: key => disk.get(key) ?? null,
    setItem: (key, value) => { if (blockWrites) throw Error('QuotaExceededError'); disk.set(key, value); },
    removeItem: key => disk.delete(key),
};
const makeBrowser = () => {
    const browser = vm.createContext({ console: { warn() {} }, localStorage: rawStorage, atob,
        App: { OD: { getCurrentUserId: () => account, getCurrentUsername: () => username, getSessionToken: () => token } } });
    browser.window = browser;
    const load = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), browser, { filename: file });
    load('reconai-shared/storage.js');
    load('js/shared/account-storage.js');
    for (const name of ['empire-decisions', 'commish-treasury', 'commish-tasks', 'commish-bylaws', 'commish-drift', 'commish-genesis', 'commish-prefs', 'commish-followups']) load('js/shared/' + name + '.js');
    return browser.App;
};
let app = makeBrowser();
const move = { title: 'A private trade plan', leagueId: 'shared-league', pid: 'p1' };
const followup = { id: 'task-1', headline: 'A private member follow-up', leagueIds: ['shared-league'] };
const league = { league_id: 'shared-league', scoring_settings: { pass_td: 4 } };
function writePrivateRecords(value) {
    app.EmpireDecisions.track({ ...move, title: value });
    app.Commish.Treasury.markPaid('shared-league', 'member', { note: value, paid: true });
    app.Commish.Tasks.add({ title: value });
    app.Commish.Bylaws.recordAmendment('shared-league', { note: value });
    app.Commish.Prefs.setManaged('shared-league', false);
    app.Commish.Followups.save(followup, { note: value });
    app.Commish.Genesis.toggleManual('shared-league', 'dues_noted');
    app.Commish.Drift.checkLeague(league);
    app.Commish.Drift.checkLeague({ ...league, scoring_settings: { pass_td: 6 } });
    app.Commish.Drift.acknowledge('shared-league');
    app.AccountStorage.set('wr_commish_schedule_shared-league', { name: value });
    app.AccountStorage.set('commish_rulelab_proposals', [{ name: value }]);
}
function privateRecords() {
    return {
        decisions: app.EmpireDecisions.list(), treasury: app.Commish.Treasury.getLedger('shared-league'),
        tasks: app.Commish.Tasks.list(), bylaws: app.Commish.Bylaws.amendments('shared-league'),
        managed: app.Commish.Prefs.isManaged('shared-league'), followups: app.Commish.Followups.list(),
        genesis: app.AccountStorage.get('commish_genesis_shared-league'), drift: app.Commish.Drift.history('shared-league'),
        schedule: app.AccountStorage.get('wr_commish_schedule_shared-league'), proposals: app.AccountStorage.get('commish_rulelab_proposals'),
    };
}
const clean = JSON.stringify(privateRecords());
writePrivateRecords('Account A confidential note');
const a = JSON.stringify(privateRecords());
assert.notEqual(a, clean);
assert(a.includes('Account A confidential note'));
account = 'account-b';
assert.equal(JSON.stringify(privateRecords()), clean, 'B must not see A planning data even for the same league');
writePrivateRecords('Account B confidential note');
const b = JSON.stringify(privateRecords());
assert(!b.includes('Account A confidential note'));
account = 'account-a';
assert.equal(JSON.stringify(privateRecords()), a, 'Returning to A restores A records without B changes');
app = makeBrowser();
assert.equal(JSON.stringify(privateRecords()), a, 'A survives reopening the browser modules');
username = 'different-league-connection';
assert.equal(JSON.stringify(privateRecords()), a, 'Changing a connected Sleeper profile does not change the app account');
account = null; token = null;
assert.equal(JSON.stringify(privateRecords()), clean, 'Signing out hides every account record');
const beforeSignedOutWrite = [...disk];
assert.equal(app.AccountStorage.set('commish_tasks_v1', ['signed out']), false);
assert.deepEqual([...disk], beforeSignedOutWrite, 'Signed-out writes cannot create shared private data');
account = 'account-b'; token = 'app-session';
assert.equal(JSON.stringify(privateRecords()), b);
const unknown = JSON.stringify([{ title: 'Unassigned legacy private data' }]);
for (const key of ['empire_decisions_v1', 'commish_tasks_v1', 'commish_rulelab_proposals', 'wr_commish_schedule_shared-league']) disk.set(key, unknown);
assert.equal(JSON.stringify(privateRecords()), b, 'No account may silently adopt unknown-owner legacy data');
for (const key of ['empire_decisions_v1', 'commish_tasks_v1', 'commish_rulelab_proposals', 'wr_commish_schedule_shared-league']) assert.equal(disk.get(key), unknown, 'Legacy recovery data is preserved byte for byte');
blockWrites = true;
assert.equal(app.AccountStorage.set('commish_tasks_v1', []), false, 'Storage failure must not be reported as a successful write');
blockWrites = false;
account = null;
const legacyToken = name => 'header.' + Buffer.from(JSON.stringify({ app_metadata: { sleeper_username: name } })).toString('base64url') + '.signature';
token = legacyToken('LegacyA'); username = 'LegacyB';
assert.equal(app.AccountStorage.owner(), 'legacy:legacya', 'Signed legacy identity wins over editable provider profile');
app.AccountStorage.set('commish_tasks_v1', ['legacy-a']);
token = legacyToken('LegacyB');
assert.equal(app.AccountStorage.get('commish_tasks_v1'), null);
token = legacyToken('LEGACYA');
assert.equal(app.AccountStorage.get('commish_tasks_v1')[0], 'legacy-a');
account = 'legacya'; token = 'app-session';
assert.equal(app.AccountStorage.get('commish_tasks_v1'), null, 'App and legacy identities cannot collide');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(index.indexOf('js/shared/account-storage.js') < index.indexOf('js/shared/empire-decisions.js'));
assert(index.indexOf('js/shared/account-storage.js') < index.indexOf('js/shared/commish-treasury.js'));
console.log('PASS account isolation for Empire and all Commissioner private stores, sign-out, return/reload, legacy preservation, profile changes and write failure');
