'use strict';

// Browser QA may read public provider data, but must never write to an external
// service: the local/sandbox frontend uses the production backend. Fulfill the
// failure locally, including preflight, so no real account/data mutation occurs.
async function installReadOnlyRoutes(context, { fixture, cachePublicReads = false } = {}) {
  const blocked = [];
  const publicReads = new Map();
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (!local && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push({ method: request.method(), url: url.origin + url.pathname });
      return route.fulfill({ status: 403, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'External mutations are disabled in isolated browser QA.' }) });
    }
    if (!local && request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    } });
    if (fixture) {
      const value = fixture(url);
      if (value !== undefined) return route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(value) });
    }
    // Routing disables Chromium's HTTP cache. Layout/click matrices can opt
    // into a per-run snapshot of public Sleeper GETs to avoid refetching the
    // same multi-megabyte roster corpus on every new page. Recovery/network
    // tests leave this off; unsuccessful reads are never retained.
    if (cachePublicReads && request.method() === 'GET' && /^api\.sleeper\.(?:app|com)$/.test(url.hostname)) {
      const key = url.href;
      if (!publicReads.has(key)) publicReads.set(key, (async () => {
        const response = await route.fetch({ timeout: 30000 });
        const headers = Object.fromEntries(Object.entries(response.headers()).filter(([name]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())));
        return { status: response.status(), headers, body: await response.body() };
      })());
      try {
        const response = await publicReads.get(key);
        if (response.status < 200 || response.status >= 300) publicReads.delete(key);
        return await route.fulfill(response);
      } catch (error) {
        publicReads.delete(key);
        return route.abort('failed');
      }
    }
    if (['image', 'font', 'media'].includes(request.resourceType())) return route.abort();
    return route.continue();
  });
  return blocked;
}
module.exports = { installReadOnlyRoutes };
