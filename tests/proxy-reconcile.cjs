'use strict';
const assert = require('node:assert/strict');
const load = require('./helpers/security-ts-loader.cjs');
const post = body => new Request('https://fixture.invalid/proxy', { method: 'POST', body: JSON.stringify(body) });
const cors = { 'Access-Control-Allow-Origin': 'https://dhqfootball.com' };

(async () => {
  const security = load('supabase/functions/_shared/security.ts', {}, ['checkRateLimit']).context;
  const counters = new Map();
  const db = { async rpc(name, args) {
    assert.equal(name, 'consume_auth_rate_limit'); assert.equal(args.p_scope, 'provider-proxy');
    const count = (counters.get(args.p_identifier) || 0) + 1; counters.set(args.p_identifier, count);
    return { data: { allowed: count <= args.p_limit, count, retryAfterSeconds: count > args.p_limit ? 41 : 0 } };
  } };
  const limiter = admin => load('supabase/functions/_shared/rate-limit.ts', {
    createClient: () => admin, consumeRateLimit: security.checkRateLimit,
  }).context;
  const a = limiter(db), b = limiter(db);
  assert.equal((await a.checkRateLimit('fixture-owner', 2, 60)).allowed, true);
  assert.equal((await b.checkRateLimit('fixture-owner', 2, 60)).allowed, true);
  const denied = await limiter(db).checkRateLimit('fixture-owner', 2, 60);
  assert.equal(denied.allowed, false); assert.equal(denied.count, 3);
  assert.equal(a.rateLimitResponse(denied, cors).headers.get('Retry-After'), '41');
  assert.equal(a.rateLimitResponse(denied, cors).headers.get('Access-Control-Allow-Origin'), cors['Access-Control-Allow-Origin']);
  for (const rpc of [async () => ({ error: Error('offline') }), async () => { throw Error('offline'); }, async () => ({ data: { allowed: true } })]) {
    const instance = limiter({ rpc }); const failed = await instance.checkRateLimit('fixture-owner', 2, 60);
    assert.equal(failed.allowed, false); assert.equal(instance.rateLimitResponse(failed, cors).status, 429);
  }
  const missing = load('supabase/functions/_shared/rate-limit.ts', { Deno: { env: { get: () => '' } }, consumeRateLimit: security.checkRateLimit }).context;
  assert.equal((await missing.checkRateLimit('fixture-owner', 2, 60)).allowed, false);
  console.log('PASS durable proxy bridge shares the atomic counter across fresh instances and denies storage/malformed/config failures with retry and CORS headers');

  let providerReads = 0;
  const espnGlobals = {
    corsHeaders: () => cors, clientIp: () => 'fixture-ip', checkRateLimit: a.checkRateLimit, rateLimitResponse: a.rateLimitResponse,
    fetch: async (url, options) => { providerReads++; assert.equal(url, 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026'); assert.equal(options.headers.Cookie, 'espn_s2=fixture; SWID=fixture'); return Response.json({ season: 2026 }); },
  };
  const espnA = load('supabase/functions/espn-proxy/index.ts', espnGlobals).handler;
  const espnB = load('supabase/functions/espn-proxy/index.ts', { ...espnGlobals, checkRateLimit: b.checkRateLimit }).handler;
  const espnBody = { url: 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026', espnS2: 'fixture', swid: 'fixture' };
  for (let n = 0; n < 60; n++) assert.equal((await (n % 2 ? espnA : espnB)(post(espnBody))).status, 200);
  assert.equal((await espnA(post(espnBody))).status, 429); assert.equal(providerReads, 60);
  assert.equal((await espnB(new Request('https://fixture.invalid/proxy', { method: 'OPTIONS' }))).status, 200);
  console.log('PASS actual ESPN handlers retain cookie/data behavior and enforce one shared 60/minute IP budget before provider access');

  let active = true, budget = false, tokenReads = 0, yahooReads = 0;
  const yahoo = load('supabase/functions/yahoo-proxy/index.ts', {
    corsHeaders: () => cors, requireActiveAppSession: async () => active ? { userId: 'fixture-owner', sessionVersion: 2 } : null,
    requireSleeperSession: async () => null,
    createClient: () => ({ from(table) { assert.equal(table, 'yahoo_tokens'); const fields = {}; return {
      select() { return this; }, eq(key,value) { fields[key]=value; return this; },
      async single() { tokenReads++; assert.equal(fields.owner_key,'app:fixture-owner'); assert.equal(fields.session_id,'fixture-session'); return { data: { access_token: 'fixture-access', expires_at: Date.now()+3600000 } }; },
    }; } }),
    checkProxyLimit: async (key, limit, windowSeconds) => { assert.equal(key,'yahoo-proxy:app:fixture-owner'); assert.equal(limit,120); assert.equal(windowSeconds,60); return { allowed: budget, count: 121, limit, retryAfter: 23 }; },
    rateLimitResponse: a.rateLimitResponse,
    fetch: async url => { yahooReads++; assert.equal(url,'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1?format=json'); return Response.json({ fantasy_content: { users: [] } }); },
  }).handler;
  const yahooBody = { action: 'api', endpoint: '/users;use_login=1?format=json', session_id: 'fixture-session' };
  assert.equal((await yahoo(post(yahooBody))).status,429); assert.equal(tokenReads,0); assert.equal(yahooReads,0);
  budget=true;assert.equal((await yahoo(post(yahooBody))).status,200);assert.equal(tokenReads,1);assert.equal(yahooReads,1);
  active=false;assert.equal((await yahoo(post(yahooBody))).status,401);assert.equal(tokenReads,1);assert.equal(yahooReads,1);
  console.log('PASS actual Yahoo owner limiter retains authenticated token ownership/data path; denial and revoked sessions cannot contact provider');

  let upstream = 404, mflReads = 0;
  const mfl = load('supabase/functions/mfl-proxy/index.ts', { corsHeaders: () => cors,
    fetch: async () => { mflReads++; return new Response(upstream===200?'{}':'missing',{status:upstream}); },
  }).handler;
  const notFound = await mfl(post({ url:'https://api.myfantasyleague.com/2026/export?TYPE=league&L=12345' }));
  assert.equal(notFound.status,404);assert.match((await notFound.json()).error,/League ID and year/);
  assert.equal((await mfl(post(null))).status,400);
  assert.equal((await mfl(post({url:'https://myfantasyleague.com.attacker.invalid/'}))).status,400);assert.equal(mflReads,1);
  upstream=200;assert.equal((await mfl(post({url:'https://www42.myfantasyleague.com/2026/export'}))).status,200);
  console.log('PASS actual MFL retains allowed shard reads, rejects malformed/foreign destinations and preserves hosted actionable404 guidance');
})().catch(error => { console.error(error); process.exitCode=1; });
