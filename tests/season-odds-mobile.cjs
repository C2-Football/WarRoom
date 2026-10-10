'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const panel = fs.readFileSync('js/components/season-odds-panel.js', 'utf8');
const css = fs.readFileSync('gameday-mobile.css', 'utf8');

// Phone presentation needs explicit hooks, rather than broad inline-style
// overrides that change every piece of the odds panel as the component grows.
for (const hook of [
    'gd-season-odds-heading',
    'gd-season-odds-title',
    'gd-season-odds-meta',
    'gd-season-odds-kpis',
    'gd-season-odds-kpi',
    'gd-season-odds-table-row',
    'gd-season-odds-table-inner',
]) assert.match(panel, new RegExp(hook), hook + ' remains a stable mobile hook');

assert.doesNotMatch(css, /\.gd-season-odds \[style\*="font-size: 0\."\]/, 'odds typography is not controlled by a broad inline-style selector');
assert.doesNotMatch(css, /\.gd-season-odds > div:last-child/, 'odds typography is not controlled by the last child');
assert.match(css, /\.gd-mobile \.gd-season-odds-meta\s*\{[^}]*font-family:\s*var\(--font-body/, 'odds explanation uses the readable body font on phones');
assert.match(css, /\.gd-mobile \.gd-season-odds-kpis\s*\{[^}]*grid-template-columns:\s*repeat\(2,/, 'odds KPIs form a compact phone grid');
assert.match(css, /\.gd-mobile \.gd-season-odds-table-row\s*\{[^}]*grid-template-columns:/, 'odds standings use a phone-width table grid');
assert.match(css, /\.gd-mobile \.gd-season-odds-bye,\s*\.gd-mobile \.gd-season-odds-proj\s*\{[^}]*display:\s*none/, 'secondary odds columns are hidden on phones');

console.log('PASS season odds mobile: readable type, compact KPIs, and phone-width standings');
