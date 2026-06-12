#!/usr/bin/env node
// build-deploy.cjs — Precompile in-browser Babel (type="text/babel") scripts to
// plain JS for the GitHub Pages deploy, so production never downloads ~3.1MB of
// @babel/standalone or transforms ~3MB of JSX in the browser on every cold load.
//
// Also minifies (terser) every local script the entries ship — both the compiled
// JSX modules and the plain-JS ones (theme.js, shared-loader.js, college-stats.js,
// …) — cutting shipped JS bytes roughly in half and, more importantly on phones,
// halving main-thread parse/compile time. Top-level names are NOT mangled
// (terser default): these are classic scripts whose cross-file contract is
// implicit globals (OwnerDashboard, LeagueDetail, …).
//
// Difference vs scripts/build-preview.cjs: that script targets a nested
// dist-preview/ directory and rewrites every asset path with `../`. This one
// emits a *flat overlay* rooted at the repo root, so the deploy workflow can copy
// the normal source tree into the Pages artifact and then drop this on top:
//
//   dist-deploy/<entry>.html  — @babel/standalone tag removed, type="text/babel" stripped
//   dist-deploy/js/...        — compiled+minified JS for every local script tag
//
// Uses the same Babel preset/options as build-preview.cjs so the emitted code is
// semantically identical to what the regression/browser test suites validate.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Babel = require('@babel/standalone');
const { minify } = require('terser');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist-deploy');

// Every HTML entry point that loads @babel/standalone + type="text/babel" scripts.
const ENTRIES = ['index.html', 'draft-warroom.html', 'free-agency.html', 'trade-calculator.html'];

const assetHash = new Map(); // pathname -> content hash of the emitted (minified) output
let compiledCount = 0;
let minifiedCount = 0;
let rawBytes = 0;
let outBytes = 0;

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

// Short content hash for cache-busting. Derived from the *emitted* output, so
// the ?v= changes exactly when a module's shipped bytes change — no manual bumps.
function contentHash(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 10);
}

function transform(code, filename) {
  return Babel.transform(code, {
    filename,
    presets: [['react', { runtime: 'classic' }]],
    sourceType: 'script',
    sourceMaps: false,
    comments: false,
  }).code;
}

// toplevel:false (default) keeps top-level function/var names intact — the
// modules talk to each other through implicit globals, and the boot guard
// checks `typeof OwnerDashboard`.
async function minifyCode(code, filename) {
  const result = await minify(code, { compress: true, mangle: true, sourceMap: false });
  if (!result || typeof result.code !== 'string' || !result.code.length) {
    throw new Error(`terser produced no output for ${filename}`);
  }
  return result.code;
}

function isExternalSrc(src) {
  return /^(https?:)?\/\//i.test(src);
}

// ---------------------------------------------------------------------------
// Pass A/B: collect every local script the entries reference, then emit a
// compiled (if JSX) + minified copy of each into the overlay.
// ---------------------------------------------------------------------------
const SCRIPT_TAG_RE = /<script\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
const BABEL_TAG_RE = /<script\b[^>]*?\btype=["']text\/babel["'][^>]*?\bsrc=["']([^"']+)["'][^>]*>|<script\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?\btype=["']text\/babel["'][^>]*>/gi;

function collectSources(htmlByEntry) {
  const babelSrcs = new Set();
  const allSrcs = new Set();
  for (const html of Object.values(htmlByEntry)) {
    let m;
    BABEL_TAG_RE.lastIndex = 0;
    while ((m = BABEL_TAG_RE.exec(html))) {
      const src = m[1] || m[2];
      if (src && !isExternalSrc(src)) babelSrcs.add(src.split('?')[0]);
    }
    SCRIPT_TAG_RE.lastIndex = 0;
    while ((m = SCRIPT_TAG_RE.exec(html))) {
      const src = m[1];
      if (src && !isExternalSrc(src)) allSrcs.add(src.split('?')[0]);
    }
  }
  return { babelSrcs, allSrcs };
}

async function emitModule(pathname, { jsx }) {
  if (assetHash.has(pathname)) return;
  const inputPath = path.join(ROOT, pathname);
  if (!fs.existsSync(inputPath)) throw new Error(`Missing script source: ${pathname} (${inputPath})`);
  const raw = fs.readFileSync(inputPath, 'utf8');
  const plain = jsx ? transform(raw, pathname) : raw;
  const minified = await minifyCode(plain, pathname);
  const out = path.join(OUT_DIR, pathname);
  ensureDir(path.dirname(out));
  fs.writeFileSync(out, minified + '\n', 'utf8');
  assetHash.set(pathname, contentHash(minified + '\n'));
  rawBytes += Buffer.byteLength(raw);
  outBytes += Buffer.byteLength(minified);
  if (jsx) compiledCount++;
  minifiedCount++;
}

// ---------------------------------------------------------------------------
// Pass C: rewrite each entry's HTML against the emitted overlay.
// ---------------------------------------------------------------------------
function processEntry(entry, html) {
  let entryExternal = 0;

  // 1. Remove the @babel/standalone <script> tag entirely.
  html = html.replace(
    /[ \t]*<script[^>]+src=["'][^"']*@babel\/standalone[^"']*["'][^>]*><\/script>\s*\n?/gi,
    '',
  );

  // 2. Rewrite every type="text/babel" script. External (has src): strip the
  //    type attribute, keeping the same src so the compiled overlay file loads
  //    as a plain classic script. Inline: compile the body.
  const re = /<script\b([^>]*?)\btype=["']text\/babel["']([^>]*?)>([\s\S]*?)<\/script>/gi;
  html = html.replace(re, (match, before, after, body) => {
    const attrs = (before + after).replace(/\s+/g, ' ').trim();
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (srcMatch) {
      entryExternal++;
      // data-wr-defer scripts are kept INERT (non-executing type) so the browser
      // doesn't run them at boot; the draft loader injects executable copies on
      // demand. The compiled overlay file + ?v= hashing (step 4) still apply.
      const deferred = /\bdata-wr-defer\b/i.test(attrs);
      return deferred ? `<script type="text/wr-deferred" ${attrs}></script>` : `<script ${attrs}></script>`;
    }
    // inline JSX block
    return `<script${attrs ? ' ' + attrs : ''}>${transform(body, entry + ' (inline)')}</script>`;
  });

  // 3. Refresh the boot guard: it polled for asynchronous in-browser Babel, which
  //    no longer runs now that modules are precompiled plain JS. (index.html only.)
  html = html.replace(
    /\/\/ NON-JSX BOOTSTRAP:[\s\S]*?window\.addEventListener\('DOMContentLoaded', function\(\) \{ setTimeout\(check, 500\); \}\);\n\}\)\(\);/,
    `// PRECOMPILED BOOTSTRAP: modules are plain JS (no in-browser Babel). Verify they loaded.
(function() {
  window.addEventListener('DOMContentLoaded', function() {
    if (typeof OwnerDashboard !== 'undefined') return;
    document.getElementById('root').innerHTML = '<div style="color:#E74C3C;padding:40px;text-align:center;font-family:sans-serif"><h2>Module Load Error</h2><p>Dynasty HQ modules failed to load. Try a hard refresh (Cmd+Shift+R) or check the console.</p></div>';
  });
})();`,
  );

  // 4. Content-hash cache-bust EVERY local script's ?v= from the emitted overlay
  //    bytes, so a stale or missing hand-maintained ?v= can never pin an old
  //    module after a deploy. External / CDN URLs are left untouched.
  html = html.replace(/<script\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi, (m, before, q, src, after) => {
    if (isExternalSrc(src)) return m; // external/CDN — leave as-is
    const pathname = src.split('?')[0];
    const hash = assetHash.get(pathname);
    if (!hash) return m; // unknown local asset — leave as-is
    return `<script${before}src=${q}${pathname}?v=${hash}${q}${after}>`;
  });

  // Safety net: the deploy must ship NO in-browser Babel (match real script tags,
  // not the word "text/babel" appearing inside a comment/string).
  if (/<script\b[^>]*\btype=["']text\/babel["']/i.test(html)) {
    throw new Error(`${entry}: residual <script type="text/babel"> after rewrite`);
  }
  if (/@babel\/standalone/i.test(html)) {
    throw new Error(`${entry}: @babel/standalone reference survived`);
  }

  ensureDir(OUT_DIR);
  fs.writeFileSync(path.join(OUT_DIR, entry), html, 'utf8');
  console.log(`[build-deploy]   ${entry}: rewrote ${entryExternal} external babel scripts`);
}

async function build() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  ensureDir(OUT_DIR);

  const htmlByEntry = {};
  for (const entry of ENTRIES) {
    const inPath = path.join(ROOT, entry);
    if (!fs.existsSync(inPath)) { console.warn(`[build-deploy] skip missing entry: ${entry}`); continue; }
    htmlByEntry[entry] = fs.readFileSync(inPath, 'utf8');
  }

  const { babelSrcs, allSrcs } = collectSources(htmlByEntry);
  for (const src of babelSrcs) await emitModule(src, { jsx: true });
  for (const src of allSrcs) {
    if (!babelSrcs.has(src)) await emitModule(src, { jsx: false });
  }

  for (const [entry, html] of Object.entries(htmlByEntry)) processEntry(entry, html);

  const pct = rawBytes ? Math.round((1 - outBytes / rawBytes) * 100) : 0;
  console.log(
    `[build-deploy] compiled ${compiledCount} JSX + minified ${minifiedCount} total modules ` +
    `(${(rawBytes / 1024 / 1024).toFixed(2)}MB -> ${(outBytes / 1024 / 1024).toFixed(2)}MB, -${pct}%) -> ${path.relative(ROOT, OUT_DIR)}/`,
  );
}

build().catch((err) => {
  console.error('[build-deploy] failed:', err && err.message ? err.message : err);
  process.exit(1);
});
