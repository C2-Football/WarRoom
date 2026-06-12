// ══════════════════════════════════════════════════════════════════
// draft-loader.js — lazy-loader for the Draft Command module (~1.26MB across
// ~28 scripts). Those scripts are emitted INERT in the HTML (type="text/wr-deferred",
// data-wr-defer="draft") by every build/serve pipeline, so the browser never parses
// or executes them at app boot. On first Draft-tab open, league-detail.js calls
// window.wrLoadDraft(), which injects executable copies in DOM order.
//
// Execution must be IN ORDER: 11 draft modules destructure window.DraftCC.styles
// at IIFE entry, so styles.js must run before them. All tags are injected at once
// with async=false — the browser fetches them in parallel but the in-order queue
// guarantees they execute in DOM order (vs. the old onload-chain, which serialized
// the fetches too: ~28 sequential round trips per Draft-tab open).
// ══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var _promise = null;
  window.__wrDraftLoaded = false;

  window.wrLoadDraft = function wrLoadDraft() {
    if (_promise) return _promise;
    _promise = new Promise(function (resolve, reject) {
      var srcs = Array.prototype.slice.call(
        document.querySelectorAll('script[data-wr-defer="draft"]')
      ).map(function (tag) { return tag.getAttribute('src'); }).filter(Boolean);

      function done() {
        window.__wrDraftLoaded = true;
        try { window.dispatchEvent(new Event('wr:draft-loaded')); } catch (e) {}
        resolve();
      }

      if (!srcs.length) {
        // Already executable (e.g. a pipeline that didn't defer) — nothing to inject.
        return done();
      }

      srcs.forEach(function (src, idx) {
        var s = document.createElement('script');
        s.src = src;
        s.async = false; // parallel fetch, in-order execution
        if (idx === srcs.length - 1) s.onload = done; // last script runs last
        s.onerror = function () {
          reject(new Error('Draft module failed to load: ' + src));
        };
        document.head.appendChild(s);
      });
    });
    return _promise;
  };
})();
