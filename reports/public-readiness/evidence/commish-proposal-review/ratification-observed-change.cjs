'use strict';
// Read-only production callback reproduction. No real storage or remote requests.
// Run from the reviewed C2 root; an optional argument selects another C2 root.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const root = path.resolve(process.argv[2] || process.cwd());
process.chdir(root);
const file = path.join(root, 'tests/commish-ratification-recovery.cjs');
let source = fs.readFileSync(file, 'utf8');
const marker = "} finally { delete global.App.AccountStorage; }";
assert(source.includes(marker), 'Actual callback fixture anchor must remain available');
source = source.replace(marker, `
    records.clear(); failKey = null; writes = [];
    records.set(c.PROPOSALS_KEY, JSON.stringify([proposal('review-p3')]));
    const originalSet = storage.set; let changed = false;
    storage.set = function(key, value) {
        const saved = originalSet(key, value);
        if (key === 'commish_bylaws_L1' && !changed) {
            changed = true;
            const replacement = proposal('review-p3'); replacement.overrides.rec = 2;
            records.set(c.PROPOSALS_KEY, JSON.stringify([replacement]));
        }
        return saved;
    };
    ({ ratify } = render());
    const result = ratify('review-p3');
    const saved = storage.get(c.PROPOSALS_KEY)[0];
    console.log('Observed same-ID proposal replacement:', JSON.stringify({
        result, currentRule: saved.overrides.rec, status: saved.status,
        ledgerRules: Bylaws.amendments('L1').filter(row => row.path === 'scoring.rec').map(row => row.to)
    }));
    assert.equal(result, false, 'A changed proposal must not be marked ratified using earlier ledger rules');
    assert.equal(saved.status, 'draft');
` + marker);
const test = new Module(file, module);
test.filename = file;
test.paths = Module._nodeModulePaths(path.dirname(file));
test._compile(source, file);
