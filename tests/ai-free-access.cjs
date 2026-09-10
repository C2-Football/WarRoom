'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const load = require('./helpers/security-ts-loader.cjs');

async function server() {
  const requests = [], limits = [], writes = [], reads = [];
  let session = { identifier: 'app:user-a', userId: 'user-a', plan: 'free', source: 'app' };
  let failed = false, blocked = '', cache = null, enabled = true;
  const env = { GOOGLE_AI_KEY: 'owner-gemini-synthetic', OPENAI_API_KEY: 'owner-openai-never', ANTHROPIC_API_KEY: 'owner-anthropic-never', SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test' };
  const { context: c, handler } = load('supabase/functions/ai-analyze/index.ts', {
    Deno: { env: { get: name => { reads.push(name); return env[name]; } }, serve: fn => { globalThis.testAIHandler = fn; } },
    handleOptions: () => null, corsHeaders: () => ({}), createClient: () => ({}),
    checkSecurityRateLimit: async (_db, scope) => { limits.push(scope); return { allowed: scope !== blocked, retryAfterSeconds: 60 }; },
    fetch: async (url, args) => {
      requests.push({ url, ...args, body: JSON.parse(args.body) });
      if (failed) return new Response(JSON.stringify({ error: { message: 'sensitive-provider-error' } }), { status: 429 });
      if (url.includes('googleapis')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '<read>Useful answer</read>' }] } }], usageMetadata: {} }));
      return new Response(JSON.stringify({ output_text: 'Useful answer', usage: {} }));
    },
    Anthropic: class {
      constructor(args) { requests.push({ provider: 'anthropic', key: args.apiKey }); this.messages = { create: async body => { requests.at(-1).body = body; if (failed) throw Error('sensitive-provider-error'); return { content: [{ type: 'text', text: 'Useful answer' }], usage: {}, stop_reason: 'end_turn' }; } }; }
    },
  });
  const invoke = globalThis.testAIHandler; delete globalThis.testAIHandler;
  c.resolveAISession = async () => session;
  c.isAIEnabled = () => enabled;
  c.fetchPreferenceSummary = async () => null;
  c.readAIResponseCache = async () => cache;
  c.writeAIResponseCache = async args => writes.push(args);
  function req(headers = {}, type = 'recon-chat', context = { userMessage: 'Compare these teams', maxTokens: 100 }) {
    return new Request('https://example.invalid/ai', { method: 'POST', headers, body: JSON.stringify({ type, context }) });
  }
  const shared = await invoke(req()); assert.equal(shared.status, 200);
  assert.equal((await shared.json()).usage.source, 'shared-gemini');
  assert.match(requests.at(-1).url, /gemini-2.5-flash:generateContent$/);
  assert.equal(requests.at(-1).headers['x-goog-api-key'], env.GOOGLE_AI_KEY);
  assert.deepEqual(limits, ['ai-analyze:minute', 'ai-shared:user-day', 'ai-shared:project-minute', 'ai-shared:project-day']);
  assert(!reads.includes('OPENAI_API_KEY') && !reads.includes('ANTHROPIC_API_KEY'));
  for (const provider of ['gemini', 'openai', 'anthropic']) {
    limits.length = 0; const before = requests.length;
    const response = await invoke(req({ 'X-AI-Provider': provider, 'X-AI-Key': 'personal-synthetic-key' }));
    assert.equal(response.status, 200); assert.equal((await response.json()).usage.source, 'personal-key');
    assert.deepEqual(limits, ['ai-analyze:minute']); assert.equal(requests.length, before + 1);
    const r = requests.at(-1); assert.equal(provider === 'anthropic' ? r.key : provider === 'gemini' ? r.headers['x-goog-api-key'] : r.headers.Authorization, provider === 'openai' ? 'Bearer personal-synthetic-key' : 'personal-synthetic-key');
    failed = true; const failBefore = requests.length;
    const failResponse = await invoke(req({ 'X-AI-Provider': provider, 'X-AI-Key': 'personal-synthetic-key' }));
    assert.equal(failResponse.status, 503); assert.equal(requests.length, failBefore + 1);
    assert(!JSON.stringify(await failResponse.json()).includes('sensitive-provider-error')); failed = false;
  }
  for (const headers of [{ 'X-AI-Provider': 'openai' }, { 'X-AI-Key': 'personal-synthetic-key' }, { 'X-AI-Provider': 'other', 'X-AI-Key': 'personal-synthetic-key' }, { 'X-AI-Provider': 'gemini', 'X-AI-Key': 'personal-synthetic-key', 'X-AI-Model': '../invalid' }]) {
    const before = requests.length; assert.equal((await invoke(req(headers))).status, 400); assert.equal(requests.length, before);
  }
  await invoke(req({ 'X-AI-Provider': 'openai', 'X-AI-Key': 'personal-synthetic-key' }, 'dynasty_read', { name: 'Test' }));
  assert.deepEqual(requests.at(-1).body.tools, [{ type: 'web_search' }]);
  assert.equal(requests.at(-1).body.store, false);
  failed = true; const before = requests.length;
  assert.equal((await invoke(req())).status, 503); assert.equal(requests.length, before + 1); failed = false;
  blocked = 'ai-shared:project-day'; const quotaBefore = requests.length;
  assert.equal((await invoke(req())).status, 429); assert.equal(requests.length, quotaBefore);
  assert.equal((await invoke(req({ 'X-AI-Provider': 'gemini', 'X-AI-Key': 'personal-synthetic-key' }))).status, 200); blocked = '';
  await invoke(req({}, 'dynasty_read', { name: 'Test player', season: 2026 }));
  assert.deepEqual(requests.at(-1).body.tools, [{ google_search: {} }]);
  assert.equal(writes.length, 1); assert(!JSON.stringify(writes).includes('synthetic-key')); assert.match(writes[0].cacheKey, /app:user-a/);
  cache = { analysis: 'Cached answer' }; limits.length = 0; const cacheBefore = requests.length;
  assert.equal((await invoke(req({}, 'dynasty_read', { name: 'Test player' }))).status, 200);
  assert.equal(requests.length, cacheBefore); assert.deepEqual(limits, ['ai-analyze:minute']);
  await invoke(req({ 'X-AI-Provider': 'gemini', 'X-AI-Key': 'personal-synthetic-key' }, 'dynasty_read', { name: 'Test player' }));
  assert.equal(requests.length, cacheBefore + 1); assert.equal(writes.length, 1);
  enabled = false; assert.equal((await invoke(req())).status, 503); enabled = true;
  session = null; assert.equal((await invoke(req())).status, 401);
  console.log('PASS default Gemini only, all personal providers, no fallback, quotas, cache isolation, web search, and authenticated access');
}
function storage() { const m = new Map(); return { getItem: k => m.get(k) || null, setItem: (k,v) => m.set(k,String(v)), removeItem: k => m.delete(k) }; }
async function browser() {
  const localStorage = storage(), sessionStorage = storage(), requests = [];
  let jwt = 'x.' + btoa(JSON.stringify({ sub: 'user-a' })) + '.x';
  const window = { OD: { getSessionToken: () => jwt, signOut: () => { jwt = null; } }, App: {}, S: {}, addEventListener() {} };
  localStorage.setItem('dynastyhq_ai_key', 'old-key');
  vm.runInNewContext(fs.readFileSync('js/shared/ai-access.js','utf8'), { window, localStorage, sessionStorage, atob, fetch: async (url, args) => { requests.push({url,...args}); return { ok: true, json: async () => ({ analysis: 'done' }) }; } });
  assert.equal(localStorage.getItem('dynastyhq_ai_key'), null);
  window.DHQAI.save('openai','synthetic-personal-key','gpt-example');
  assert.equal(localStorage.getItem('dhq_personal_ai_v1'), null);
  await window.callClaude([{ role: 'user', content: 'hello' }], true, 2, 600, 'chat');
  assert.equal(requests[0].headers['X-AI-Key'], 'synthetic-personal-key'); assert.equal(requests[0].headers['X-AI-Provider'], 'openai');
  assert.equal(JSON.parse(requests[0].body).context.useWebSearch, true);
  assert(!requests[0].body.includes('synthetic-personal-key'));
  jwt = 'x.' + btoa(JSON.stringify({ sub: 'user-b' })) + '.x';
  assert.equal(window.DHQAI.get(), null); assert.equal(sessionStorage.getItem('dhq_personal_ai_v1'), null);
  await window.OD.callAI({ type: 'chat', context: 'hello' }); assert(!requests.at(-1).headers['X-AI-Key']);
  window.DHQAI.save('gemini','synthetic-personal-key',''); window.OD.signOut();
  assert.equal(sessionStorage.getItem('dhq_personal_ai_v1'), null);
  await assert.rejects(window.OD.callAI({type:'chat', context:'hello'}), /Sign in/);
  console.log('PASS browser session storage, account isolation, sign-out cleanup, and selected-provider transport');
}
(async () => { await server(); await browser();
})().catch(err => { console.error(err); process.exit(1); });
