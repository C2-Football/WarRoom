'use strict';
// Exercise the real builders without touching runtime.js. The compressor is
// real; only its gzip host marker is varied to model Darwin and Linux builds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function build(name, osByte) {
    const written = new Map(), inputs = [];
    const target = path.join(root, 'supabase/functions', name, 'runtime.js');
    const script = path.join(root, 'scripts', name === 'duat' ? 'build-duat-server.cjs' : 'build-time-league-server.cjs');
    const fileSystem = { ...fs,
        mkdirSync(directory) { assert.equal(directory, path.dirname(target)); },
        writeFileSync(file, content) {
            assert(file === target || file === target + '.' + process.pid + '.tmp', 'Only the runtime output may be written');
            assert.equal(typeof content, 'string');
            written.set(file, content);
        },
        renameSync(from, to) {
            assert.equal(to, target); assert(written.has(from));
            written.set(to, written.get(from)); written.delete(from);
        },
    };
    const compressor = { ...zlib, gzipSync(input, options) {
        inputs.push(hash(input));
        const output = zlib.gzipSync(input, options);
        output[9] = osByte;
        return output;
    } };
    let context;
    const runtime = { Buffer, process: { pid: process.pid }, __dirname: path.dirname(script), console: { log() {} },
        require(id) {
            if (['fs', 'node:fs'].includes(id)) return fileSystem;
            if (['path', 'node:path'].includes(id)) return path;
            if (['zlib', 'node:zlib'].includes(id)) return compressor;
            if (id === 'node:vm') return vm;
            assert(['roster', 'draft-room', 'season'].some(name => id === path.join(root, 'js/shared/time-league-' + name + '.js')), 'Unexpected build import: ' + id);
            vm.runInContext(fs.readFileSync(id, 'utf8'), context, { filename: id });
            return undefined;
        },
    };
    runtime.global = runtime;
    context = vm.createContext(runtime);
    vm.runInContext(fs.readFileSync(script, 'utf8'), context, { filename: script });
    assert.equal(written.size, 1, 'No partial output remains');
    const output = written.get(target);
    assert(output && inputs.length > 0);
    const unpacked = [];
    for (const [, encoded] of output.matchAll(/['"](H4sI[A-Za-z0-9+/]*={0,2})['"]/g)) {
        const compressed = Buffer.from(encoded, 'base64');
        assert.equal(compressed[9], 255, 'Every embedded gzip has the platform-neutral OS marker');
        unpacked.push(hash(zlib.gunzipSync(compressed)));
    }
    assert.deepEqual(unpacked.sort(), inputs.sort(), 'Every packed data block survives in the output and decodes to its exact original bytes');
    return { hash: hash(output), blocks: inputs.length };
}

for (const name of ['duat', 'time-league']) {
    const linux = build(name, 3), darwin = build(name, 19);
    assert.deepEqual(darwin, linux, 'Actual ' + name + ' builder output must be identical across gzip platform markers');
    console.log(`PASS ${name}: identical full artifacts for Linux/Darwin gzip headers; all ${linux.blocks} data blocks roundtrip exactly; no runtime files written`);
}
