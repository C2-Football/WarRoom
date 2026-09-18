'use strict';

// Browser QA may read public provider data, but must never write to an external
// service: the local/sandbox frontend uses the production backend. Fulfill the
// failure locally, including preflight, so no real account/data mutation occurs.
async function installReadOnlyRoutes(context, { fixture } = {}) {
  const blocked = [];
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
    if (['image', 'font', 'media'].includes(request.resourceType())) return route.abort();
    return route.continue();
  });
  return blocked;
}
module.exports = { installReadOnlyRoutes };
