#!/usr/bin/env node
/* Deterministic assembly for mockups/module-gallery-v1.html.
   Reads skeleton.html + design-system.css + screens/scr-*.html, validates
   the fragment contract, injects with FUNCTION replacers (fragment content
   contains "$" — string replacements corrupt via $-pattern expansion),
   writes ../module-gallery-v1.html. Exit 1 on any contract violation. */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const OUT = path.join(DIR, '..', 'module-gallery-v1.html');

const ORDER = [
    ['scr-hub', 'Hub — Franchise Picker + Empire hero', '', 'HUB'],
    ['scr-dashboard', 'Home — Dashboard widgets', 'dashboard', 'LEAGUE CORE'],
    ['scr-myteam', 'My Roster', 'myteam', 'LEAGUE CORE'],
    ['scr-gameday', 'Game Day Central', 'lineup', 'LEAGUE CORE'],
    ['scr-compare', 'Compare', 'compare', 'LEAGUE CORE'],
    ['scr-trades-desk', 'Trade Desk', 'trades', 'TRADE & MARKET'],
    ['scr-trades-log', 'Trade Log + Owner DNA', 'trades', 'TRADE & MARKET'],
    ['scr-fa', 'Free Agency', 'fa', 'TRADE & MARKET'],
    ['scr-draft-board', 'Draft — Big Board', 'draft', 'DRAFT'],
    ['scr-draft-live', 'Draft — Live Cockpit', 'draft', 'DRAFT'],
    ['scr-analytics-roster', 'Analytics — Roster', 'analytics', 'INTELLIGENCE'],
    ['scr-analytics-reports', 'Analytics — Custom Reports', 'analytics', 'INTELLIGENCE'],
    ['scr-gmoffice', "GM's Office", 'alex', 'INTELLIGENCE'],
    ['scr-trophies', 'Trophy Room', 'trophies', 'CLUB'],
    ['scr-settings', 'Settings', 'settings', 'CLUB'],
    ['scr-legend', 'Legend', 'legend', 'CLUB'],
    ['scr-player-card', 'Overlay — Player Card sheet', 'myteam', 'OVERLAYS'],
    ['scr-ask-alex', 'Overlay — Ask Alex chat sheet', 'dashboard', 'OVERLAYS'],
    ['scr-strategy-editor', 'Overlay — GM Strategy editor', 'alex', 'OVERLAYS'],
    ['scr-ipad-portrait', 'iPad portrait reference (tablet tier)', 'dashboard', 'REFERENCE'],
];

const PARTIAL = process.argv.includes('--partial');
const fail = [];
const note = (m) => fail.push(m);

const css = fs.readFileSync(path.join(DIR, 'design-system.css'), 'utf8');
const skeleton = fs.readFileSync(path.join(DIR, 'skeleton.html'), 'utf8');

let combined = '';
for (const [slug, title, nav, group] of ORDER) {
    const f = path.join(DIR, 'screens', slug + '.html');
    if (!fs.existsSync(f)) {
        if (PARTIAL) { console.warn(`partial: skipping missing ${slug}`); continue; }
        note(`MISSING fragment: screens/${slug}.html`); continue;
    }
    let frag = fs.readFileSync(f, 'utf8').trim();

    if (/<script\b/i.test(frag)) note(`${slug}: contains <script> (forbidden)`);
    if (/<style\b/i.test(frag)) note(`${slug}: contains <style> (forbidden)`);
    if (!new RegExp(`<section[^>]+id="${slug}"`).test(frag)) note(`${slug}: root <section id="${slug}"> missing`);
    if (!/class="screen"/.test(frag)) note(`${slug}: root section missing class="screen"`);
    if (!/class="phone-only"/.test(frag)) note(`${slug}: missing .phone-only wrapper`);
    if (!/class="tablet-only"/.test(frag)) note(`${slug}: missing .tablet-only wrapper`);
    if (!/class="notes"/.test(frag)) note(`${slug}: missing .notes block`);
    if (!frag.includes('IMPL CONTRACT')) note(`${slug}: notes missing an IMPL CONTRACT entry`);

    // Enforce/repair the section attributes the viewer depends on.
    frag = frag.replace(/<section[^>]*>/, () =>
        `<section class="screen" id="${slug}" data-title="${title.replace(/"/g, '&quot;')}" data-nav="${nav}" data-group="${group}">`);

    // All non-root ids must be slug-prefixed (collision guard across 20 builders).
    const ids = [...frag.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    for (const id of ids) {
        if (id !== slug && !id.startsWith(slug + '-')) note(`${slug}: unprefixed id "${id}"`);
    }
    combined += '\n' + frag + '\n';
}

// Global duplicate-id scan
const all = [...combined.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const seen = new Set();
for (const id of all) {
    if (seen.has(id)) note(`DUPLICATE id across fragments: "${id}"`);
    seen.add(id);
}

if (fail.length) {
    console.error('ASSEMBLY FAILED:\n  - ' + fail.join('\n  - '));
    process.exit(1);
}

let out = skeleton.replace('/* == DESIGN SYSTEM == */', () => css);
out = out.replace('<!-- SCREENS -->', () => combined);
fs.writeFileSync(OUT, out);

const kb = Math.round(Buffer.byteLength(out) / 1024);
console.log(`OK: ${ORDER.length} screens -> ${path.relative(process.cwd(), OUT)} (${kb} KB)`);
if (kb > 450) console.warn(`WARN: size ${kb} KB exceeds the ~450 KB budget`);
