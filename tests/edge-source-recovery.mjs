import assert from 'node:assert/strict';
import { originalFiles } from '../scripts/extract-edge-source.mjs';

const prefix = 'file:///isolated/deployment/source/';
const entry = prefix + 'functions/time-league/index.ts';
const shared = prefix + 'functions/_shared/security.ts';
const runtime = prefix + 'functions/time-league/runtime.js';
const originals = new Map([
    [entry, '// original TypeScript\r\nimport "../_shared/security.ts";\r\nconst count: number = 0;\r\n'],
    [shared, 'export const signed: boolean = true;\n'],
    [runtime, '// untouched generated JS\nglobalThis.__untrustedBundleExecuted = true;\n'],
]);
const reads = [];
const sourceOf = async specifier => { reads.push(['source', specifier]); return specifier.endsWith('.ts') ? '// emitted JavaScript without types' : originals.get(specifier); };
const mapOf = async specifier => { reads.push(['map', specifier]); return specifier.endsWith('.ts') ? JSON.stringify({ version: 3, sources: [specifier], sourcesContent: [originals.get(specifier)] }) : null; };
const output = await originalFiles([entry, shared, runtime, 'npm:untrusted@1', 'vfs://metadata.json', 'https://example.invalid/dependency.js'], sourceOf, mapOf, 'time-league');
assert.deepEqual([...output.keys()], ['supabase/functions/time-league/index.ts', 'supabase/functions/_shared/security.ts', 'supabase/functions/time-league/runtime.js']);
for (const [specifier, original] of originals) assert.equal(output.get('supabase/' + specifier.slice(prefix.length)), original, 'Original bytes including CRLF/comments survive');
assert.equal(globalThis.__untrustedBundleExecuted, undefined, 'Recovered source must never execute');
assert.equal(reads.length, 6, 'External modules and opaque metadata are not interpreted or read');

for (const bad of [
    prefix + 'functions/time-league/../fw-signin/index.ts',
    prefix + 'functions/time-league/../../outside.js',
    prefix + 'functions/time-league/./extra.js',
    prefix + 'functions/time-league//extra.js',
    prefix + 'functions/time-league/%2e%2e/extra.js',
    prefix + 'functions/time-league/extra\\escape.js',
    prefix + 'functions/fw-signin/index.ts',
    prefix + 'functions/duat/index.ts',
    prefix + 'functions/time-league/data.json',
]) {
    await assert.rejects(originalFiles([entry, bad], sourceOf, mapOf, 'time-league'), /Unsafe source path|Unexpected game source scope/, bad);
}
await assert.rejects(originalFiles([entry, entry], sourceOf, mapOf, 'time-league'), /ambiguous/);
await assert.rejects(originalFiles([entry, shared, shared], sourceOf, mapOf, 'time-league'), /Duplicate source path/);
await assert.rejects(originalFiles([runtime], sourceOf, mapOf, 'time-league'), /entrypoint/);
await assert.rejects(originalFiles([entry, 'file:///second/functions/time-league/index.ts'], sourceOf, mapOf, 'time-league'), /ambiguous/);
await assert.rejects(originalFiles([entry], sourceOf, mapOf, 'fw-signin'), /Unsupported game/);

for (const sourceMap of [
    null, '', '{',
    JSON.stringify({ version: 2, sources: [entry], sourcesContent: ['original'] }),
    JSON.stringify({ version: 3, sources: ['../another.ts'], sourcesContent: ['original'] }),
    JSON.stringify({ version: 3, sources: [entry, shared], sourcesContent: ['one', 'two'] }),
    JSON.stringify({ version: 3, sources: [entry], sourcesContent: [null] }),
    JSON.stringify({ version: 3, sources: [entry], sourcesContent: [''] }),
    JSON.stringify({ version: 3, sources: [entry], sourcesContent: ['  \n '] }),
    JSON.stringify({ version: 3, sources: [entry], sourcesContent: ['one', 'two'] }),
]) {
    await assert.rejects(originalFiles([entry], sourceOf, async () => sourceMap, 'time-league'), /Original|Empty|JSON|property name/, 'Never accept emitted TS as original when provenance is incomplete');
}
await assert.rejects(originalFiles([entry, runtime], async specifier => specifier === runtime ? '' : sourceOf(specifier), mapOf, 'time-league'), /Empty original source/);
await assert.rejects(originalFiles([entry], async () => { throw Error('Incomplete archive'); }, mapOf, 'time-league'), /Incomplete archive/);
await assert.rejects(originalFiles([entry], sourceOf, async () => { throw Error('Missing mapping bytes'); }, 'time-league'), /Missing mapping bytes/);

// Same helper may be used for independent comparison against a successfully
// unbundled Duat fixture; the release fallback itself remains Vault-only.
const duat = prefix + 'functions/duat/index.ts';
const duatSource = 'const original: string = "Duat";\n';
const duatFiles = await originalFiles([duat], async () => 'const original="Duat";', async () => JSON.stringify({ version: 3, sources: [duat], sourcesContent: [duatSource] }), 'duat');
assert.equal(duatFiles.get('supabase/functions/duat/index.ts'), duatSource);
console.log('PASS exact original-source recovery, strict maps/paths/game scope, incomplete bundles, metadata isolation, and no recovered-code execution.');
