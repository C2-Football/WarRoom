'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const OUTPUT = 'dist-native';
const MANIFEST = 'native-artifact.json';
const ENTRIES = ['index.html', 'landing.html', 'onboarding.html', 'ai-settings.html',
  'upgrade.html', 'login.html', 'reset-password.html', 'gift.html', 'free-agency.html',
  'draft-warroom.html', 'trade-calculator.html'];
const FILES = [...ENTRIES, 'charts.js', 'college-stats.js', 'draft-history.js',
  'manifest.json', 'icon-192.png', 'icon-512.png'];
const DIRECTORIES = ['js', 'content', 'reconai-shared', 'draft-war-room', 'team-comps',
  'images', 'img', 'data/duat'];
const EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.csv', '.svg', '.png',
  '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.webmanifest']);
const PRIVATE = new Set(['scripts', 'tests', 'reports', 'docs', 'supabase', 'node_modules',
  'ios', 'android', 'package.json', 'package-lock.json', 'capacitor.config.json', 'eslint.config.js']);
const VAULT_BLOCKER = 'The Vault requires a distribution-cleared historical archive. ' +
  'The current data/time-league corpus is excluded from native packaging by the existing data policy. ' +
  'Native copy, sync and build remain blocked; staging is not a working native release. ' +
  'See docs/native-packaging.md.';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function safePath(relative) {
  const parts = relative.split('/');
  return relative && !path.isAbsolute(relative) && !relative.includes('\\') &&
    !parts.some(part => !part || part.startsWith('.') || PRIVATE.has(part)) &&
    !relative.startsWith('data/time-league/') && relative !== 'data/time-league' &&
    EXTENSIONS.has(path.extname(relative).toLowerCase());
}

function walk(directory, prefix = '') {
  const files = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = fs.lstatSync(path.join(directory, name));
    if (stat.isSymbolicLink()) throw new Error(`Symbolic link is not allowed in native assets: ${relative}`);
    if (stat.isDirectory()) files.push(...walk(path.join(directory, name), relative));
    else if (stat.isFile()) files.push(relative);
    else throw new Error(`Unsupported native asset: ${relative}`);
  }
  return files;
}

function sourceFiles(root) {
  const files = [...FILES, ...fs.readdirSync(root).filter(name => name.endsWith('.css'))];
  for (const directory of DIRECTORIES) {
    files.push(...walk(path.join(root, directory), directory).filter(safePath));
  }
  return [...new Set(files)].sort();
}

function stageNative(root) {
  const output = path.join(root, OUTPUT);
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error('Native output must not be a symbolic link');
  const sources = sourceFiles(root);
  const overlay = path.join(root, 'dist-deploy');
  if (!fs.existsSync(path.join(overlay, 'index.html'))) throw new Error('Build production assets before native staging');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const inputs = {};
  for (const relative of sources) {
    if (!safePath(relative)) throw new Error(`Non-public native source: ${relative}`);
    const source = path.join(root, relative);
    if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`Symbolic link is not allowed: ${relative}`);
    inputs[relative] = sha256(fs.readFileSync(source));
    const compiled = path.join(overlay, relative);
    if (fs.existsSync(compiled) && fs.lstatSync(compiled).isSymbolicLink()) throw new Error(`Symbolic link is not allowed: dist-deploy/${relative}`);
    fs.mkdirSync(path.dirname(path.join(output, relative)), { recursive: true });
    fs.copyFileSync(fs.existsSync(compiled) ? compiled : source, path.join(output, relative));
  }
  const release = JSON.parse(fs.readFileSync(path.join(overlay, 'release.json'), 'utf8'));
  fs.copyFileSync(path.join(overlay, 'release.json'), path.join(output, 'release.json'));
  const assets = Object.fromEntries(walk(output).map(relative => [relative, sha256(fs.readFileSync(path.join(output, relative)))]));
  fs.writeFileSync(path.join(output, MANIFEST), JSON.stringify({
    version: 1, revision: release.revision, assets, inputs,
    readyForNativeCopy: false, blockers: [{ id: 'vault-archive-distribution', message: VAULT_BLOCKER }],
  }, null, 2) + '\n');
  inspectNativeArtifact(root);
  return { output, files: Object.keys(assets).length, bytes: Object.keys(assets).reduce((n, file) => n + fs.statSync(path.join(output, file)).size, 0) };
}

function inspectNativeArtifact(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
  if (config.webDir !== OUTPUT) throw new Error(`Capacitor webDir must be ${OUTPUT}; repository-root packaging is unsafe`);
  if (config.server?.url) throw new Error('Native release configuration must not use server.url');
  const output = path.join(root, OUTPUT);
  if (!fs.existsSync(output)) throw new Error('Missing native staging; run npm run build:native');
  if (fs.lstatSync(output).isSymbolicLink()) throw new Error('Native output must not be a symbolic link');
  const files = walk(output);
  for (const relative of files) if (!safePath(relative)) throw new Error(`Non-public or restricted native asset: ${relative}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, MANIFEST), 'utf8'));
  if (manifest.version !== 1 || !manifest.assets || !manifest.inputs) throw new Error('Invalid native artifact manifest');
  const expected = new Set([...Object.keys(manifest.assets), MANIFEST]);
  if (files.length !== expected.size || files.some(file => !expected.has(file))) throw new Error('Native artifact file inventory changed; rebuild');
  for (const [relative, hash] of Object.entries(manifest.assets)) {
    if (!safePath(relative) || !fs.existsSync(path.join(output, relative)) || sha256(fs.readFileSync(path.join(output, relative))) !== hash) {
      throw new Error(`Native asset missing or changed: ${relative}`);
    }
  }
  const sources = sourceFiles(root);
  if (sources.length !== Object.keys(manifest.inputs).length) throw new Error('Native source inventory changed; rebuild');
  for (const relative of sources) {
    if (fs.lstatSync(path.join(root, relative)).isSymbolicLink() || sha256(fs.readFileSync(path.join(root, relative))) !== manifest.inputs[relative]) {
      throw new Error(`Native source changed after staging: ${relative}`);
    }
  }
  for (const relative of files.filter(file => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(output, relative), 'utf8');
    if (/<script\b[^>]*\btype=["']text\/babel["']|<script\b[^>]*\bsrc=["'][^"']*@babel\/standalone/i.test(html)) {
      throw new Error(`Uncompiled browser Babel in native entry: ${relative}`);
    }
    for (const match of html.matchAll(/<(script|link)\b([^>]*?)\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
      const url = match[3].split(/[?#]/)[0];
      if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), url));
      if (!safePath(target) || !expected.has(target)) throw new Error(`Missing native dependency: ${relative} -> ${url}`);
    }
  }
  for (const entry of ENTRIES) if (!expected.has(entry)) throw new Error(`Missing native entry: ${entry}`);
  return manifest;
}

function assertNativeReleaseReady(root) {
  inspectNativeArtifact(root);
  // Never trust an editable artifact flag or --include-time-league override.
  // Resolve the archive policy and validate the full Vault journey first.
  throw new Error(VAULT_BLOCKER);
}

module.exports = { OUTPUT, MANIFEST, FILES, DIRECTORIES, VAULT_BLOCKER, safePath,
  stageNative, inspectNativeArtifact, assertNativeReleaseReady };
