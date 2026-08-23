#!/usr/bin/env node
// War Room design-token contract checks.
//
// Dynasty HQ's visual identity is ROUNDED (owner ruling 2026-08-22): panels
// 10px, wells/buttons 8px, chips 5px, hero cards 14px. This replaced the
// older "sharp terminal, 0-2px corners" direction. Roundness is a single
// knob — the four --card-radius-* tokens in index.html :root — and every
// surface must go through it.
//
// scripts/radius-codemod.cjs migrated ~1,007 hardcoded literals onto those
// tokens. This contract is what stops them creeping back: if a new inline
// `borderRadius: '6px'` lands, the app quietly drifts sharp again in one
// spot and the knob stops being a knob. Fail the build instead.
//
// Deliberately NOT flagged (same carve-outs the codemod uses):
//   - 1-3px  micro-details (form-guide squares, hairline tags) — these read
//            wrong at 5px+ and are intentionally sharp.
//   - >=15px / 99px / 999px / 50%  — pills, circles, avatars. Not a card corner.
//   - Multi-value shorthands ('8px 8px 0 0') — corner-specific by intent.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write('.');
  } catch (err) {
    failed += 1;
    failures.push(`  FAIL: ${name}\n        ${err.message}`);
    process.stdout.write('F');
  }
}

function ok(value, label) {
  if (!value) throw new Error(label || 'expected truthy value');
}

// theme.js owns token defs; landing pages are standalone marketing.
const SKIP = new Set(['theme.js', 'landing-content.js', 'landing-editor.js']);

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// Same bands the codemod enforces: 4-14px must be tokenized.
const JS_LITERAL = /borderRadius\s*:\s*(['"`])(\d+(?:\.\d+)?)px\1/g;
const CSS_LITERAL = /border-radius\s*:\s*(\d+(?:\.\d+)?)px(?=\s*[;}])/g;

function offendersIn(src, relPath) {
  const hits = [];
  let m;
  JS_LITERAL.lastIndex = 0;
  while ((m = JS_LITERAL.exec(src))) {
    const px = parseFloat(m[2]);
    if (px >= 4 && px <= 14) hits.push(`${relPath}: borderRadius: '${px}px'`);
  }
  CSS_LITERAL.lastIndex = 0;
  while ((m = CSS_LITERAL.exec(src))) {
    const px = parseFloat(m[1]);
    if (px >= 4 && px <= 14) hits.push(`${relPath}: border-radius: ${px}px`);
  }
  return hits;
}

console.log('\nWar Room design-token contract tests');

test('index.html defines the four corner-radius tokens', () => {
  const index = read('index.html');
  [
    ['--card-radius-xs', '5px'],
    ['--card-radius-sm', '8px'],
    ['--card-radius', '10px'],
    ['--card-radius-lg', '14px'],
  ].forEach(([token, value]) => {
    const re = new RegExp(token.replace(/[-]/g, '\\-') + '\\s*:\\s*' + value.replace('px', 'px'));
    ok(re.test(index), `${token} must be defined as ${value} (roundness is one knob)`);
  });
});

test('var() fallbacks agree with the token values they shadow', () => {
  // Found in audit: changing --card-radius-sm 6px -> 8px left six pre-existing
  // `var(--card-radius-sm, 6px)` call sites behind, so those corners would
  // render 6px anywhere the custom property fails to resolve (an isolated
  // component, a test harness, a stripped page) while everything else renders
  // 8px. A fallback that disagrees with its token is a silent split identity.
  const index = read('index.html');
  const declared = {};
  const declRe = /(--card-radius(?:-[a-z]+)?)\s*:\s*(\d+px)\s*;/g;
  let d;
  while ((d = declRe.exec(index))) declared[d[1]] = d[2];
  ok(Object.keys(declared).length >= 4, 'expected all four radius tokens declared');

  const files = walk(path.join(ROOT, 'js')).filter(f => !SKIP.has(path.basename(f)));
  files.push(path.join(ROOT, 'index.html'));
  const bad = [];
  files.forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    const useRe = /var\((--card-radius(?:-[a-z]+)?),\s*(\d+px)\)/g;
    let m;
    while ((m = useRe.exec(src))) {
      const want = declared[m[1]];
      if (want && m[2] !== want) {
        bad.push(`${path.relative(ROOT, f)}: var(${m[1]}, ${m[2]}) but ${m[1]} is ${want}`);
      }
    }
  });
  ok(bad.length === 0,
    `${bad.length} var() fallback(s) disagree with their token:\n        ` +
    bad.slice(0, 10).join('\n        '));
});

test('rounded identity: no hardcoded 4-14px radius literals in js/ or index.html', () => {
  const files = walk(path.join(ROOT, 'js')).filter(f => !SKIP.has(path.basename(f)));
  files.push(path.join(ROOT, 'index.html'));
  const hits = [];
  files.forEach(f => {
    hits.push(...offendersIn(fs.readFileSync(f, 'utf8'), path.relative(ROOT, f)));
  });
  ok(hits.length === 0,
    `${hits.length} hardcoded radius literal(s) bypass the tokens — run ` +
    `\`node scripts/radius-codemod.cjs\` to migrate them:\n        ` +
    hits.slice(0, 12).join('\n        ') +
    (hits.length > 12 ? `\n        ...and ${hits.length - 12} more` : ''));
});

test('shared engine surfaces are tokenized too (they render inside this app)', () => {
  const sharedDir = path.join(ROOT, 'reconai-shared');
  if (!fs.existsSync(sharedDir)) return; // vendored at build time; skip if absent
  const hits = [];
  walk(sharedDir).filter(f => !SKIP.has(path.basename(f))).forEach(f => {
    hits.push(...offendersIn(fs.readFileSync(f, 'utf8'), path.relative(ROOT, f)));
  });
  ok(hits.length === 0,
    `${hits.length} hardcoded radius literal(s) in the shared engine — fix in ` +
    `../dhq-shared (canonical), run \`node scripts/radius-codemod.cjs --dir ../dhq-shared\`, ` +
    `then \`npm run sync:shared\`:\n        ` + hits.slice(0, 12).join('\n        '));
});

console.log('\n');
if (failures.length) console.log(failures.join('\n') + '\n');
console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
