'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/shared/reminder-unsubscribe.js'), 'utf8');
function fixture(hash = '#token=' + 'a'.repeat(64)) {
    const nodes = {}, calls = [], history = [];
    let response = { ok: true, status: 200, json: async () => ({ ok: true, unsubscribed: true }) };
    for (const name of ['title', 'description', 'button', 'status']) nodes[name] = { textContent: '', disabled: true, hidden: false, addEventListener: (_, fn) => { nodes[name].click = fn; } };
    const window = { AbortController, location: { hash, pathname: '/WarRoom/reminder-unsubscribe.html', search: '' }, history: { replaceState: (...args) => history.push(args) },
        setTimeout, clearTimeout, fetch: async (url, options) => { calls.push({ url, options }); if (response instanceof Error) throw response; return response; } };
    vm.runInNewContext(source, { window, document: { getElementById: id => nodes[id.replace('reminder-unsubscribe-', '')] }, URL, URLSearchParams, AbortController });
    return { nodes, calls, history, respond: value => { response = value; } };
}
(async () => {
    let f = fixture();
    assert.equal(f.calls.length, 0, 'opening a link never opts out automatically');
    assert.equal(f.history[0][2], '/WarRoom/reminder-unsubscribe.html');
    assert.equal(f.nodes.button.disabled, false);
    await f.nodes.button.click();
    assert.equal(f.calls.length, 1);
    assert.equal(new URL(f.calls[0].url).origin, 'https://sxshiqyxhhifvtfqawbq.supabase.co');
    assert.equal(new URL(f.calls[0].url).searchParams.get('token'), 'a'.repeat(64));
    assert.equal(f.calls[0].options.method, 'POST');
    assert.equal(f.calls[0].options.credentials, 'omit');
    assert.equal(f.calls[0].options.referrerPolicy, 'no-referrer');
    assert.equal(f.calls[0].options.headers.Accept, 'application/json');
    assert.equal(f.nodes.title.textContent, 'Email reminders stopped');
    assert.equal(f.nodes.button.hidden, true);
    await f.nodes.button.click(); assert.equal(f.calls.length, 1);
    console.log('PASS explicit opt-out, private fragment cleanup, fixed destination and acknowledged success');
    for (const hash of ['', '#token=bad', '#token=' + 'b'.repeat(64) + '&token=' + 'c'.repeat(64), '#token=' + 'b'.repeat(64) + '&extra=1']) {
        f = fixture(hash); assert.equal(f.calls.length, 0); assert.equal(f.nodes.button.hidden, true); assert.match(f.nodes.title.textContent, /no longer active/);
    }
    f = fixture(); f.respond({ ok: false, status: 410, json: async () => ({ ok: false, unsubscribed: false }) });
    await f.nodes.button.click(); assert.match(f.nodes.title.textContent, /no longer active/); assert.equal(f.nodes.button.hidden, true);
    console.log('PASS malformed, missing, duplicate and rotated links never claim a successful opt-out');
    for (const response of [new Error('offline'), { ok: true, status: 200, json: async () => ({ ok: true }) }, { ok: false, status: 503, json: async () => ({ error: 'unavailable' }) }]) {
        f = fixture(); f.respond(response); await f.nodes.button.click(); assert.equal(f.nodes.button.disabled, false); assert.match(f.nodes.status.textContent, /couldn’t confirm/);
        f.respond({ ok: true, status: 200, json: async () => ({ ok: true, unsubscribed: true }) });
        await f.nodes.button.click(); assert.equal(f.calls.length, 2); assert.equal(f.nodes.title.textContent, 'Email reminders stopped');
    }
    console.log('PASS failed and ambiguous requests remain retryable without a false success');
})().catch(error => { console.error(error); process.exitCode = 1; });
