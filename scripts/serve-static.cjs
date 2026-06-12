#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

// --compile (dev): transpile type="text/babel" scripts server-side so the browser
// never loads @babel/standalone (the ~3-10s in-browser JSX compile). Lazy-required
// only when the flag is present so other server modes carry no extra cost.
let Babel = null;

const LIVE_AI_ENDPOINT = 'https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/ai-analyze';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find(arg => arg.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const host = getArg('host', '127.0.0.1');
const port = Number(getArg('port', process.env.PORT || 3001));
const root = path.resolve(getArg('root', process.cwd()));
const openPath = getArg('open', '');
const COMPILE = process.argv.includes('--compile');
if (COMPILE) {
  try {
    Babel = require('@babel/standalone');
  } catch (err) {
    console.error('[serve-static] --compile needs @babel/standalone installed; serving raw JSX instead.');
  }
}

function loadLocalEnv() {
  ['.env.local', '.env'].forEach(file => {
    const envPath = path.join(root, file);
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) return;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    });
  });
}

loadLocalEnv();

function isInsideRoot(filePath) {
  const relative = path.relative(root, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveRequestPath(reqUrl) {
  const url = new URL(reqUrl, `http://${host}:${port}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  if (pathname === '/favicon.ico') pathname = '/icon-192.png';

  const directPath = path.join(root, pathname);
  if (isInsideRoot(directPath) && fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return directPath;
  }

  const indexPath = path.join(root, pathname, 'index.html');
  if (isInsideRoot(indexPath) && fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
    return indexPath;
  }

  return null;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function landingContentPath() {
  return path.join(root, 'content', 'landing-pages.json');
}

async function handleLandingContent(req, res) {
  const filePath = landingContentPath();

  if (req.method === 'GET') {
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { error: 'Landing content file not found.' });
      return;
    }
    try {
      sendJson(res, 200, JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Landing content could not be read.' });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const body = await readJson(req);
      if (!body || typeof body !== 'object' || !body.pages || typeof body.pages !== 'object') {
        sendJson(res, 400, { error: 'Landing content must include a pages object.' });
        return;
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Landing content could not be saved.' });
    }
    return;
  }

  res.writeHead(405, { Allow: 'GET, PUT' });
  res.end('Method Not Allowed');
}

function localAIProvider() {
  if (process.env.OPENAI_API_KEY) {
    return {
      name: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
      apiKey: process.env.OPENAI_API_KEY,
    };
  }
  if (process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY) {
    return {
      name: 'gemini',
      model: process.env.GOOGLE_AI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      apiKey: process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY,
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      name: 'anthropic',
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  return null;
}

function normalizeMessages(type, context) {
  let parsed = context;
  if (typeof context === 'string') {
    try {
      parsed = JSON.parse(context);
    } catch {
      parsed = { userMessage: context };
    }
  }
  const system = parsed?.system || 'You are Alex Ingram, a fantasy football GM assistant. Give direct, format-aware, league-grounded advice using the supplied context.';
  const sourceMessages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const userMessage = parsed?.userMessage || parsed?.userPrompt || parsed?.question || '';
  const messages = sourceMessages.length
    ? sourceMessages
    : [{ role: 'user', content: userMessage || `Analyze this ${type || 'fantasy football'} context:\n${JSON.stringify(parsed, null, 2)}` }];
  const maxTokens = Math.max(100, Math.min(Number(parsed?.maxTokens || 700), 2200));
  return { system, messages, maxTokens };
}

async function callOpenAI(provider, request) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      instructions: request.system,
      input: request.messages.map(message => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || ''),
      })),
      max_output_tokens: request.maxTokens,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI API error ${response.status}`);
  return {
    analysis: data.output_text || (data.output || [])
      .flatMap(item => item?.content || [])
      .filter(part => part?.type === 'output_text' || part?.type === 'text')
      .map(part => part?.text || '')
      .join('') || 'No response.',
    usage: data.usage || {},
  };
}

async function callGemini(provider, request) {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: request.maxTokens,
      // Gemini 2.5 "thinking" silently consumes the token budget, truncating
      // short advisory blurbs. These prompts don't need reasoning — disable it
      // so the cap goes to visible output.
      reasoning_effort: 'none',
      messages: [{ role: 'system', content: request.system }, ...request.messages],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Gemini API error ${response.status}`);
  return {
    analysis: data.choices?.[0]?.message?.content || 'No response.',
    usage: data.usage || {},
  };
}

async function callAnthropic(provider, request) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages
        .filter(message => message.role !== 'system')
        .map(message => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: String(message.content || ''),
        })),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Anthropic API error ${response.status}`);
  return {
    analysis: (data.content || []).filter(part => part.type === 'text').map(part => part.text || '').join('') || 'No response.',
    usage: data.usage || {},
  };
}

async function proxyLiveAI(body, authHeader, apiKey) {
  const response = await fetch(LIVE_AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
      'apikey': apiKey,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function handleDevAI(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
    });
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = await readJson(req);
    const authHeader = req.headers.authorization || '';
    const apiKey = req.headers.apikey || '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const hasUserToken = bearer && apiKey && bearer !== apiKey && bearer.split('.').length === 3;

    if (hasUserToken) {
      const proxied = await proxyLiveAI(body, authHeader, apiKey);
      sendJson(res, proxied.status, proxied.data);
      return;
    }

    const provider = localAIProvider();
    if (!provider) {
      sendJson(res, 503, {
        error: 'Local AI preview bridge is not configured. Add OPENAI_API_KEY, GOOGLE_AI_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY to warroom/.env.local, or sign in with a real app session and restart the preview.',
      });
      return;
    }

    const request = normalizeMessages(body.type, body.context);
    const result = provider.name === 'openai'
      ? await callOpenAI(provider, request)
      : provider.name === 'gemini'
        ? await callGemini(provider, request)
        : await callAnthropic(provider, request);

    sendJson(res, 200, {
      analysis: result.analysis,
      provider: provider.name,
      model: provider.model,
      usage: {
        ...(result.usage || {}),
        plan: 'local-preview',
        routeTier: 'preview',
      },
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Local AI preview failed.' });
  }
}

function isValidMflUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'api.myfantasyleague.com' ||
        parsed.hostname === 'myfantasyleague.com' ||
        parsed.hostname.endsWith('.myfantasyleague.com'))
    );
  } catch {
    return false;
  }
}

async function handleMflProxy(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = await readJson(req);
    const { url } = body || {};

    if (!url || !isValidMflUrl(url)) {
      sendJson(res, 400, { error: 'Invalid URL — only myfantasyleague.com URLs are allowed.' });
      return;
    }

    const mflRes = await fetch(url, {
      headers: { 'User-Agent': 'FantasyWarRoom/1.0', 'Accept': 'application/json' },
    });

    if (!mflRes.ok) {
      const status = mflRes.status;
      let msg = `MFL API error ${status}`;
      if (status === 401 || status === 403) msg = 'This MFL league is private. Provide your API key to connect.';
      else if (status === 404) msg = 'MFL league not found. Check your League ID and year.';
      sendJson(res, status, { error: msg });
      return;
    }

    const data = await mflRes.text();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'MFL proxy error' });
  }
}

// ── Dev-time JSX compilation (--compile) ─────────────────────────────────────
// Transpiles only the files index.html (and other pages) mark as type="text/babel",
// caching by mtime so a save recompiles a single file in ~10-50ms instead of the
// browser compiling ~3.4MB of JSX on every page load. Mirrors build-preview.cjs.
const _xpileCache = new Map();   // absPath -> { mtimeMs, code }
const _babelSrcSet = new Set();  // normalized repo-relative paths flagged text/babel
let _seeded = false;

function splitUrl(src) {
  const i = src.indexOf('?');
  return { pathname: i >= 0 ? src.slice(0, i) : src, query: i >= 0 ? src.slice(i) : '' };
}
function isRemoteUrl(value) {
  return /^(?:https?:)?\/\//i.test(value) || /^data:/i.test(value);
}
function collectBabelSrcs(html) {
  const re = /<script\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (!/type=["']text\/babel["']/i.test(attrs)) continue;
    const sm = attrs.match(/src=["']([^"']+)["']/i);
    if (sm && !isRemoteUrl(sm[1])) _babelSrcSet.add(splitUrl(sm[1]).pathname.replace(/^\.?\//, ''));
  }
}
function seedBabelSet() {
  if (_seeded) return;
  _seeded = true;
  const idx = path.join(root, 'index.html');
  if (fs.existsSync(idx)) {
    try { collectBabelSrcs(fs.readFileSync(idx, 'utf8')); } catch (_e) { /* tolerate */ }
  }
}
function rewriteHtmlForCompile(html) {
  // Drop the in-browser Babel compiler entirely.
  html = html.replace(/[ \t]*<script\b[^>]*src=["']https?:\/\/[^"']*@babel\/standalone[^"']*["'][^>]*><\/script>\s*\n?/gi, '');
  // The server already transpiles these on request. data-wr-defer scripts stay INERT
  // (type="text/wr-deferred") so the browser doesn't run them at boot — the module
  // loader injects them on demand; the rest run immediately as plain JS.
  html = html.replace(/<script\b[^>]*?\stype=["']text\/babel["'][^>]*>/gi, (tag) =>
    /\bdata-wr-defer\b/i.test(tag)
      ? tag.replace(/type=["']text\/babel["']/i, 'type="text/wr-deferred"')
      : tag.replace(/\s+type=["']text\/babel["']/i, ''));
  return html;
}
function transpileFile(absPath) {
  const stat = fs.statSync(absPath);
  const hit = _xpileCache.get(absPath);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.code;
  const rel = path.relative(root, absPath).replace(/\\/g, '/');
  const result = Babel.transform(fs.readFileSync(absPath, 'utf8'), {
    filename: rel,
    sourceFileName: '/' + rel,
    sourceMaps: 'inline',
    presets: [['react', { runtime: 'classic' }]],
    sourceType: 'script',
    comments: false,
  });
  const code = result.code + '\n';
  _xpileCache.set(absPath, { mtimeMs: stat.mtimeMs, code });
  return code;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`);
  if (url.pathname === '/api/dev-ai-analyze') {
    handleDevAI(req, res);
    return;
  }
  if (url.pathname === '/api/mfl-proxy') {
    handleMflProxy(req, res);
    return;
  }
  if (url.pathname === '/api/landing-content') {
    handleLandingContent(req, res);
    return;
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  let filePath;
  try {
    filePath = resolveRequestPath(req.url);
  } catch (_err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();

  if (COMPILE && Babel && (ext === '.html' || ext === '.js')) {
    seedBabelSet();
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext], 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (ext === '.html') {
      try {
        const html = fs.readFileSync(filePath, 'utf8');
        collectBabelSrcs(html);
        const body = rewriteHtmlForCompile(html);
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'], 'Cache-Control': 'no-store' });
        res.end(body);
        return;
      } catch (err) {
        console.error('[serve-static] html rewrite failed for', filePath, '-', err && err.message);
        // fall through to raw serving
      }
    } else { // .js
      const rel = path.relative(root, filePath).replace(/\\/g, '/');
      if (_babelSrcSet.has(rel)) {
        let code;
        try {
          code = transpileFile(filePath);
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          console.error('[serve-static] JSX compile failed:', rel, '-', msg);
          res.writeHead(200, { 'Content-Type': MIME_TYPES['.js'], 'Cache-Control': 'no-store' });
          res.end('console.error(' + JSON.stringify('[dev compile error] ' + rel + ': ' + msg) + ');');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.js'], 'Cache-Control': 'no-store' });
        res.end(code);
        return;
      }
      // not a flagged Babel module — fall through to raw streaming
    }
  }

  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  const compileNote = COMPILE ? (Babel ? '  [JSX compile: ON]' : '  [JSX compile: requested but @babel/standalone missing]') : '';
  console.log(`Serving ${root} at http://${host}:${port}/${compileNote}`);
  if (openPath) {
    const target = new URL(openPath.replace(/^\/+/, ''), `http://${host}:${port}/`).toString();
    const opener = spawn('open', [target], { detached: true, stdio: 'ignore' });
    opener.unref();
  }
});
