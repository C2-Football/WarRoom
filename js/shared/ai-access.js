/* global atob */
/* Free product access and request-scoped personal AI credentials.
 * Loaded after shared AI dispatch so every surface uses the same server adapter.
 */
(function () {
  'use strict';
  var storageKey = 'dhq_personal_ai_v1';
  var legacyKeys = ['dynastyhq_ai_provider', 'dynastyhq_ai_key', 'dynastyhq_ai_model', 'dynastyhq_xai_key', 'dynastyhq_provider', 'dynastyhq_gemini_key', 'dynastyhq_anthropic_key'];
  var providers = ['gemini', 'openai', 'anthropic'];
  function token() {
    if (window.OD && window.OD.getSessionToken) return window.OD.getSessionToken();
    for (var name of ['fw_session_v1', 'od_session_v1']) {
      try { var s = JSON.parse(localStorage.getItem(name) || 'null'); if (s && s.token) return s.token; } catch (_) {}
    }
    return null;
  }
  function owner() {
    try {
      var part = token().split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var p = JSON.parse(atob(part));
      if (p.exp && Number(p.exp) * 1000 <= Date.now()) return '';
      return String(p.app_metadata && (p.app_metadata.user_id || p.app_metadata.sleeper_username) || p.sub || '');
    } catch (_) { return ''; }
  }
  function clear() {
    sessionStorage.removeItem(storageKey);
    legacyKeys.forEach(function (key) { localStorage.removeItem(key); sessionStorage.removeItem(key); });
    if (window.S) { window.S.apiKey = ''; window.S.aiProvider = 'gemini'; }
  }
  function get() {
    try {
      var config = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (!config) return null;
      if (!owner() || config.owner !== owner()) { clear(); return null; }
      return config;
    } catch (_) { return null; }
  }
  function save(provider, key, model) {
    if (!owner()) throw new Error('Sign in before adding a personal key.');
    key = String(key || '').trim(); model = String(model || '').trim();
    if (!providers.includes(provider) || key.length < 10 || key.length > 1024 || /[\s\x00-\x1f]/.test(key)) throw new Error('Choose your provider and enter a valid API key.');
    if (model && !/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('Enter a valid model name or leave it blank.');
    clear();
    sessionStorage.setItem(storageKey, JSON.stringify({ owner: owner(), provider: provider, key: key, model: model }));
  }
  // Discard unscoped legacy credentials instead of transferring another account's key.
  legacyKeys.forEach(function (key) { try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch (_) {} });
  window.DHQAI = { get: get, save: save, clear: clear, isSignedIn: function () { return !!owner(); } };
  window.OD = window.OD || {};
  function showSources(grounding) {
    if (!window.document?.body) return;
    var document = window.document;
    var panel = document.getElementById('dhq-ai-sources');
    if (panel) panel.remove();
    if (!grounding || (!grounding.sources?.length && !grounding.searchSuggestions)) return;
    panel = document.createElement('aside'); panel.id = 'dhq-ai-sources';
    panel.setAttribute('aria-label', 'Sources for latest AI response');
    panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:10050;width:min(380px,calc(100vw - 24px));max-height:35vh;overflow:auto;background:#191b24;color:#e6e9ed;border:1px solid #505360;border-radius:8px;padding:12px;font:14px system-ui';
    var heading = document.createElement('strong'); heading.textContent = 'Sources for latest AI response'; panel.appendChild(heading);
    var close = document.createElement('button'); close.textContent = 'Close'; close.type = 'button'; close.style.cssText = 'float:right;min-height:32px;cursor:pointer'; close.onclick = function () { panel.remove(); }; panel.appendChild(close);
    var list = document.createElement('ul');
    (grounding.sources || []).slice(0, 12).forEach(function (source) {
      try {
        var url = new URL(source.url); if (url.protocol !== 'https:') return;
        var li = document.createElement('li'), link = document.createElement('a');
        link.href = url.href; link.textContent = source.title || url.hostname;
        link.target = '_blank'; link.rel = 'noopener noreferrer'; link.style.color = '#dfbd61';
        li.appendChild(link); list.appendChild(li);
      } catch (_) {}
    });
    panel.appendChild(list);
    if (grounding.searchSuggestions) {
      var frame = document.createElement('iframe'); frame.title = 'Google Search suggestions';
      // Isolate provider HTML from the app and its session credentials. No scripts or same-origin access.
      frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      frame.referrerPolicy = 'no-referrer'; frame.style.cssText = 'width:100%;height:110px;border:0;background:white';
      frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src https: data:">' + String(grounding.searchSuggestions).slice(0, 50000);
      panel.appendChild(frame);
    }
    document.body.appendChild(panel);
  }
  window.OD.callAI = async function (args) {
    var jwt = token();
    if (!jwt) { clear(); throw new Error('Sign in to use AI.'); }
    var config = get();
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt };
    if (config) {
      headers['X-AI-Provider'] = config.provider; headers['X-AI-Key'] = config.key;
      if (config.model) headers['X-AI-Model'] = config.model;
    }
    var context = args.context;
    if (typeof context === 'string') {
      try { JSON.parse(context); } catch (_) { context = { callType: args.type || 'recon-chat', userMessage: context, messages: [{ role: 'user', content: context }] }; }
    }
    var appConfig = window.App && window.App.CONFIG || window.OD.CONFIG || {};
    var base = appConfig.supabaseUrl || 'https://sxshiqyxhhifvtfqawbq.supabase.co';
    // Personal keys are sent only to our authenticated AI function, never arbitrary model URLs.
    var response = await fetch(base + '/functions/v1/ai-analyze', {
      method: 'POST', headers: headers, body: JSON.stringify({ type: args.type || 'recon-chat', context: context }),
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      if (response.status === 401) clear();
      var error = new Error(data.error || 'AI request could not be completed.'); error.status = response.status; throw error;
    }
    showSources(data.grounding);
    return data;
  };
  window.hasServerAI = window.hasAnyAI = function () { return !!token(); };
  window.callClaude = async function (messages, useWebSearch, retries, maxTokens, callType) {
    var data = await window.OD.callAI({ type: callType || 'recon-chat', context: {
      messages: messages, useWebSearch: !!useWebSearch, maxTokens: maxTokens || 600,
      callType: callType || 'recon-chat', system: typeof window.DHQ_IDENTITY === 'string' ? window.DHQ_IDENTITY : undefined,
    } });
    return data.analysis;
  };
  window.App = window.App || {};
  window.App.callClaude = window.callClaude;
  window.App.hasAnyAI = window.hasAnyAI;
  window.App.hasServerAI = window.hasServerAI;
  var signOut = window.OD.signOut;
  if (signOut) window.OD.signOut = function () { clear(); return signOut.apply(this, arguments); };
  window.addEventListener('storage', function (e) { if (['fw_session_v1', 'od_session_v1'].includes(e.key)) get(); });
})();
