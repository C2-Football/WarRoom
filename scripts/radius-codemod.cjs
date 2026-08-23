#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// scripts/radius-codemod.cjs
//
// Migrates hardcoded border-radius literals across the War Room module JS
// (and index.html's <style> block) onto the corner-radius tokens defined
// in index.html :root, so the app's roundness is ONE knob instead of ~950
// scattered literals:
//
//     --card-radius-xs   5px   chips, badges, tiny controls
//     --card-radius-sm   8px   wells, sub-cards, inputs, buttons
//     --card-radius     10px   panels / cards
//     --card-radius-lg  14px   hero cards
//
// Why: the app today hardcodes radius in ~1,100 places and reads the tokens
// in only ~66, so bumping a token changed almost nothing. The literals
// cluster at 4-6px, which is what makes the UI read sharper than the
// Command Center mockup (panels 10 / wells 8 / chips 4-5). Tokenizing first
// means the next roundness change is a one-line edit, not another codemod.
//
// Guard rails (mirrors typescale-codemod's "never shrink" ethos — here it
// is "never sharpen", since the ask is softer corners):
//   - Every band's token value is >= the largest literal in that band, so
//     no corner ever gets sharper than it is today.
//   - 1-3px is LEFT ALONE: those are deliberate micro-details (form-guide
//     squares, hairline tags) that read wrong at 5px+.
//   - >=15px is LEFT ALONE: pills, circles, avatars (999px / 99px / 50%)
//     are already fully round and are not a "card corner".
//   - Multi-value shorthands ('6px 6px 0 0') are skipped — the JS form is
//     excluded by requiring the closing quote right after `px`, and the CSS
//     form by requiring `;`/`}` next.
//   - Anything already wrapped (var/clamp/calc) or non-literal is skipped.
//
// Bands (never sharpen — token value >= band max):
//   4-5px   -> var(--card-radius-xs,  5px)
//   6-8px   -> var(--card-radius-sm,  8px)
//   9-10px  -> var(--card-radius,    10px)
//   11-14px -> var(--card-radius-lg, 14px)
//
// Usage:
//   node scripts/radius-codemod.cjs --dry      (report only)
//   node scripts/radius-codemod.cjs            (write + emit manifest)
// ════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

function walk(dir) {
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...walk(p));
        else if (ent.name.endsWith('.js')) out.push(p);
    }
    return out;
}

// theme.js owns the token definitions; landing pages are standalone marketing.
const SKIP = new Set(['theme.js', 'landing-content.js', 'landing-editor.js']);

// --dir <path> targets another tree (used for the canonical shared engine at
// ../dhq-shared, whose player-modal/tier/tutorial surfaces render inside this
// app and would otherwise stay sharp against a softened UI). The var()
// fallbacks mean those files still render correctly standalone.
const dirArg = process.argv.indexOf('--dir');
const TARGET = dirArg > -1 ? path.resolve(process.argv[dirArg + 1]) : JS_DIR;
const FILES = walk(TARGET).filter(f => !SKIP.has(path.basename(f)));
if (TARGET === JS_DIR) FILES.push(path.join(ROOT, 'index.html'));

// ── Band -> [tokenName, fallbackPx] or null (= leave untouched). ────────
function band(px) {
    if (!isFinite(px)) return null;
    if (px < 4) return null;                       // micro-detail, keep sharp
    if (px <= 5) return ['card-radius-xs', '5px'];
    if (px <= 8) return ['card-radius-sm', '8px'];
    if (px <= 10) return ['card-radius', '10px'];
    if (px <= 14) return ['card-radius-lg', '14px'];
    return null;                                   // pills / circles, leave
}

const manifest = {};
const totals = { hits: 0, files: 0 };

function processFile(file) {
    let src = fs.readFileSync(file, 'utf8');
    const before = src;
    let n = 0;

    const bump = (px, token, fallback) => {
        manifest[token] = (manifest[token] || 0) + 1;
        n++;
        return `var(--${token}, ${fallback})`;
    };

    // 1. JS inline-style form: borderRadius: '6px'  /  borderRadius:"6px"
    //    The closing quote must sit right after `px`, which excludes
    //    multi-value shorthands like '6px 6px 0 0'.
    src = src.replace(
        /(borderRadius)(\s*:\s*)(['"`])(\d+(?:\.\d+)?)px\3/g,
        (m, key, sep, q, num) => {
            const b = band(parseFloat(num));
            if (!b) return m;
            return `${key}${sep}${q}${bump(parseFloat(num), b[0], b[1])}${q}`;
        }
    );

    // 2. CSS declaration form: border-radius: 6px;  (index.html <style>, and
    //    template-literal CSS inside JS). Requires `;` or `}` next so
    //    multi-value shorthands are skipped.
    src = src.replace(
        /(border-radius)(\s*:\s*)(\d+(?:\.\d+)?)px(?=\s*[;}])/g,
        (m, key, sep, num) => {
            const b = band(parseFloat(num));
            if (!b) return m;
            return `${key}${sep}${bump(parseFloat(num), b[0], b[1])}`;
        }
    );

    totals.hits += n;
    if (src !== before) {
        totals.files++;
        if (!DRY) fs.writeFileSync(file, src);
        console.log(`  ${path.relative(ROOT, file).padEnd(44)} ${n}`);
    }
}

console.log(`${DRY ? '[DRY RUN] ' : ''}Processing ${FILES.length} files...\n`);
FILES.forEach(processFile);

console.log(`\nTotals: ${totals.hits} literals migrated across ${totals.files} files`);
console.log('By token:');
for (const [t, c] of Object.entries(manifest).sort((a, b) => b[1] - a[1])) {
    console.log(`  --${t.padEnd(18)} ${c}`);
}

const manifestPath = path.join(ROOT, 'scripts',
    TARGET === JS_DIR ? 'radius-manifest.json' : 'radius-manifest-shared.json');
if (!DRY) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nManifest ${DRY ? '(not written)' : 'written to ' + path.relative(ROOT, manifestPath)}`);
