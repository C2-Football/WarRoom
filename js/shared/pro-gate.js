/* Legacy capability names remain for shared components; every product feature is free.
 * These are display capabilities, never account roles or server authorization.
 */
(function () {
  'use strict';
  window.wrIsPro = window.isScoutPro = window.canAccess = function () { return true; };
  window.getTier = function () { return 'paid'; }; // shared component compatibility only
  window.wrLockCard = function () { return ''; };
  window.showUpgradePrompt = window.showProLaunchPage = function () { window.location.href = 'ai-settings.html'; };
  window._applyScoutProChrome = function () {
    if (document.body) { document.body.classList.add('is-pro'); document.body.classList.remove('is-scout-free'); }
  };
  window.App = window.App || {};
  window.App.canAccess = window.canAccess;
  window.App.isScoutPro = window.isScoutPro;
  window.App.getTier = window.getTier;
  window.App.showUpgradePrompt = window.showUpgradePrompt;
  window._applyScoutProChrome();
})();
