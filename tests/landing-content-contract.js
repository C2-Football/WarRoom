#!/usr/bin/env node
'use strict';

// The accepted landing page is authored directly in HTML. The older content
// editor is not its runtime source. Protect the actual public arrival contract
// without reintroducing its retired four-tier layout or changing pricing.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'landing.html'), 'utf8');
const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  .map(match => ({ href: match[1], label: match[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() }));
const entries = anchors.filter(link => /^Start free(?: with Sleeper)?$/i.test(link.label));
assert(entries.length > 0, 'arrival must offer an account-creation action');
for (const entry of entries) {
  const url = new URL(entry.href, 'https://example.invalid/WarRoom/landing.html');
  assert.equal(url.origin, 'https://example.invalid', 'account creation must remain on the application origin');
  assert.equal(url.pathname, '/WarRoom/login.html', 'each Start free entry must lead to real account creation');
  assert.equal(url.searchParams.get('mode'), 'signup');
}
assert(anchors.some(link => /^Sign in$/i.test(link.label) && link.href === 'login.html'), 'returning users must have a sign-in route');
assert(anchors.some(link => /^Go Pro$/i.test(link.label) && link.href === 'upgrade.html'), 'paid plan must route through the existing upgrade flow');
for (const link of anchors) {
  const url = new URL(link.href, 'https://example.invalid/WarRoom/landing.html');
  if (url.origin !== 'https://example.invalid') continue;
  assert(url.pathname.startsWith('/WarRoom/'), 'relative links must preserve the deployed project prefix');
  assert(fs.existsSync(path.join(root, url.pathname.slice('/WarRoom/'.length))), 'linked arrival page must exist: ' + link.href);
}
assert(/demo player set/i.test(html) && /not live projections/i.test(html), 'illustrative rankings must not masquerade as actual league values');
assert(/DHQ Labs[\s\S]*?In development/.test(html), 'future product tier must retain its development status');
assert(/aria-label="Billing period"/.test(html), 'billing toggle must have an accessible group name');
console.log('PASS accepted landing arrival routes, local destinations, demo disclosure and development status');
