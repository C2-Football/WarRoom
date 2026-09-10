(function () {
  'use strict';
  var el = function (id) { return document.getElementById(id); };
  var api = window.DHQAI;
  function refresh() {
    var config = api.get();
    el('current-source').textContent = config ? 'Using your ' + ({ gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Anthropic' }[config.provider] || 'AI') + ' key' : 'Using shared Gemini';
    if (config) { el('provider').value = config.provider; el('model').value = config.model || ''; }
    el('key').value = '';
  }
  if (new URLSearchParams(location.search).has('setup')) el('continue').href = 'onboarding.html';
  if (!api.isSignedIn()) {
    el('status').textContent = 'Sign in to use AI or save a personal key.';
    el('continue').href = 'login.html'; el('continue').textContent = 'Sign in →';
    el('test-key').disabled = true;
  }
  el('ai-form').addEventListener('submit', function (e) {
    e.preventDefault();
    try {
      api.save(el('provider').value, el('key').value, el('model').value);
      refresh(); el('status').textContent = 'Personal key saved for this session. You can test the connection below.';
    } catch (err) { el('status').textContent = err.message; }
  });
  el('use-shared').addEventListener('click', function () { api.clear(); refresh(); el('model').value = ''; el('status').textContent = 'Personal key removed. Shared Gemini will handle your AI requests.'; });
  el('test-key').addEventListener('click', async function () {
    this.disabled = true; el('status').textContent = 'Testing connection…';
    try {
      await window.OD.callAI({ type: 'recon-chat', context: { userMessage: 'Reply with OK.', callType: 'recon-chat', maxTokens: 100 } });
      el('status').textContent = 'Connected. Your AI is ready.';
    } catch (err) { el('status').textContent = err.message; }
    finally { this.disabled = false; }
  });
  refresh();
})();
