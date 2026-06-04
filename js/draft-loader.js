// ══════════════════════════════════════════════════════════════════
// draft-loader.js — lazy-loader for the Draft Command module (~1.26MB across
// ~28 scripts). Those scripts are emitted INERT in the HTML (type="text/wr-deferred",
// data-wr-defer="draft") by every build/serve pipeline, so the browser never parses
// or executes them at app boot. On first Draft-tab open, league-detail.js calls
// window.wrLoadDraft(), which injects executable copies in DOM order.
//
// Must be SERIAL (onload-chained): 11 draft modules destructure window.DraftCC.styles
// at IIFE entry, so styles.js must run before them — never load these in parallel.
// ══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var _promise = null;
  window.__wrDraftLoaded = false;

  window.wrLoadDraft = function wrLoadDraft() {
    if (_promise) return _promise;
    _promise = new Promise(function (resolve, reject) {
      var tags = Array.prototype.slice.call(
        document.querySelectorAll('script[data-wr-defer="draft"]')
      );
      if (!tags.length) {
        // Already executable (e.g. a pipeline that didn't defer) — nothing to inject.
        window.__wrDraftLoaded = true;
        return resolve();
      }
      var i = 0;
      function next() {
        if (i >= tags.length) {
          window.__wrDraftLoaded = true;
          try { window.dispatchEvent(new Event('wr:draft-loaded')); } catch (e) {}
          return resolve();
        }
        var srcTag = tags[i++];
        var src = srcTag.getAttribute('src');
        if (!src) return next();
        var s = document.createElement('script');
        s.src = src;
        s.async = false; // preserve execution order
        s.onload = next;
        s.onerror = function () {
          reject(new Error('Draft module failed to load: ' + src));
        };
        document.head.appendChild(s);
      }
      next();
    });
    return _promise;
  };
})();
