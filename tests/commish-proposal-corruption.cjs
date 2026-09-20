'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const code = fs.readFileSync('js/shared/commish-proposals.js', 'utf8');
const KEY = 'commish_rulelab_proposals', BACKUP = KEY + '_recovery_v1';
function fixture() {
    const rows = new Map(); let owner = 'A', failed = null, afterWrite = null, blocked = false;
    const key = name => owner + ':' + name;
    const ctx = { console, Date, localStorage: { getItem(k) { if (blocked) throw Error('blocked'); return rows.get(k) ?? null; } }, App: { AccountStorage: {
        key,
        get(name, fallback) { try { return rows.has(key(name)) ? JSON.parse(rows.get(key(name))) : fallback; } catch { return fallback; } },
        set(name, value) { if (name === failed) return false; rows.set(key(name), JSON.stringify(value)); if (afterWrite) afterWrite(name); return true; },
    } } };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(code, ctx);
    return { api: ctx.App.Commish.Proposals, rows, key, setOwner: v => owner = v, fail: v => failed = v, after: fn => afterWrite = fn, block: () => blocked = true };
}
const valid = { id: 'p1', name: 'PPR', overrides: { rec: 1 }, rosterProposal: { rosterPositions: ['QB'] }, status: 'draft' };
const checks = {
    corruptJsonAndWrongShapesStayReadableWithoutWrites() {
        for (const raw of ['{', '{}', 'null', '[null]', '[{"id":"p1","name":7}]', JSON.stringify([valid, valid])]) {
            const f = fixture(); f.rows.set(f.key(KEY), raw); const state = f.api.read();
            assert(state.error); assert.equal(state.canRecover, true); assert.equal(state.raw, raw); assert.equal(state.list.length, 0);
            assert.throws(() => f.api.update(list => [...list, valid]), /could not be read/); assert.equal(f.rows.get(f.key(KEY)), raw); assert.equal(f.rows.size, 1);
        }
    },
    normalCreateReloadUpdateAndDeleteRemainValid() {
        const f = fixture(); assert.equal(f.api.read().error, null); f.api.update(rows => [...rows, valid]);
        assert.equal(f.api.read().list[0].name, 'PPR'); f.api.update(rows => rows.map(row => ({ ...row, name: 'Updated' })));
        assert.equal(f.api.read().list[0].name, 'Updated'); f.api.update(() => []); assert.equal(f.api.read().list.length, 0);
    },
    recoveryPreservesExactOriginalBeforeStartingNewList() {
        const f = fixture(), raw = '{"unrecognized":{"privateNote":"preserve exact bytes"}}'; f.rows.set(f.key(KEY), raw);
        assert.equal(f.api.recover(), true); assert.equal(f.rows.get(f.key(KEY)), '[]'); assert.equal(f.api.recoveryCopies()[0].raw, raw);
        f.api.update(rows => [...rows, valid]); assert.equal(f.api.read().list.length, 1); assert.equal(f.api.recoveryCopies()[0].raw, raw);
    },
    failedBackupNeverReplacesOriginal() {
        const f = fixture(); f.rows.set(f.key(KEY), '{'); f.fail(BACKUP);
        assert.throws(() => f.api.recover(), /copy was not saved/); assert.equal(f.rows.get(f.key(KEY)), '{'); assert.equal(f.rows.size, 1);
    },
    failedNewListIsRetryableWithoutDuplicatingBackup() {
        const f = fixture(); f.rows.set(f.key(KEY), '{}'); f.fail(KEY);
        assert.throws(() => f.api.recover(), /new list could not be confirmed/); assert.equal(f.rows.get(f.key(KEY)), '{}'); assert.equal(f.api.recoveryCopies().length, 1);
        f.fail(null); f.api.recover(); assert.equal(f.api.recoveryCopies().length, 1); assert.equal(f.api.read().error, null);
    },
    corruptPreviousArchiveCannotBeOverwritten() {
        const f = fixture(); f.rows.set(f.key(KEY), '{}'); f.rows.set(f.key(BACKUP), '{');
        assert.throws(() => f.api.recover(), /earlier recovery copy/); assert.equal(f.rows.get(f.key(KEY)), '{}'); assert.equal(f.rows.get(f.key(BACKUP)), '{');
    },
    accountSwitchDuringRecoveryCannotClearReplacementAccount() {
        const f = fixture(); f.rows.set('A:' + KEY, '{}'); f.rows.set('B:' + KEY, JSON.stringify([valid]));
        f.after(name => { if (name === BACKUP) f.setOwner('B'); });
        assert.throws(() => f.api.recover(), /account or saved proposals changed/); assert.equal(f.rows.get('A:' + KEY), '{}'); assert.equal(f.rows.get('B:' + KEY), JSON.stringify([valid])); assert.equal(f.api.recoveryCopies().length, 0);
    },
    concurrentChangedSourceCannotBeReplacedByRecovery() {
        const f = fixture(); f.rows.set(f.key(KEY), '{}'); f.after(name => { if (name === BACKUP) f.rows.set(f.key(KEY), JSON.stringify([valid])); });
        assert.throws(() => f.api.recover(), /saved proposals changed/); assert.equal(f.api.read().list[0].id, 'p1'); assert.equal(f.api.recoveryCopies()[0].raw, '{}');
    },
    blockedStorageHasNoDestructiveRecovery() {
        const f = fixture(); f.block(); const state = f.api.read(); assert(state.error); assert.equal(state.canRecover, false); assert.throws(() => f.api.recover(), /Reload/); assert.equal(f.rows.size, 0);
    },
    invalidMutationCannotCorruptGoodData() {
        const f = fixture(); f.api.update(() => [valid]); const before = f.rows.get(f.key(KEY));
        assert.throws(() => f.api.update(() => ({ unexpected: true })), /could not be saved/); assert.equal(f.rows.get(f.key(KEY)), before);
    },
};
for (const [name, run] of Object.entries(checks)) { run(); console.log('PASS ' + name); }
console.log(Object.keys(checks).length + ' proposal data/recovery groups passed');
