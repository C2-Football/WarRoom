/* global module */
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const BACKDROPS = [
        { id: 'midnight', label: 'Midnight', detail: 'Clean and classic' },
        { id: 'stadium', label: 'Friday night', detail: 'Under the lights' },
        { id: 'gridiron', label: 'Gridiron', detail: 'Paint the field' },
        { id: 'heritage', label: 'Heritage', detail: 'Varsity tradition' },
        { id: 'aurora', label: 'Northern lights', detail: 'A little electric' },
    ];
    const currentUser = () => App.OD?.getCurrentUserId?.() || null;
    const storageKey = userId => `wr-vault-profile-v1:${userId ? `account:${userId}` : 'guest'}`;
    const cleanText = (value, limit, fallback = '') => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) || fallback : fallback;
    const safeHex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value.toUpperCase() : fallback;
    function normalize(value) {
        const data = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        const helmet = App.TimeLeagueHelmet.normalizeHelmet(data.helmet, 'vault-profile');
        const publicProfile = data.publicProfile === true;
        return {
            displayName: cleanText(data.displayName, 40, 'Commander'),
            teamName: cleanText(data.teamName, 40, 'Commander'),
            primaryColor: safeHex(data.primaryColor, App.TimeLeagueHelmet.shellColorFor?.(helmet) || App.TimeLeagueHelmet.colorById(helmet.color).hex),
            secondaryColor: safeHex(data.secondaryColor, helmet.accentColor),
            backdrop: BACKDROPS.some(item => item.id === data.backdrop) ? data.backdrop : 'midnight',
            helmet,
            publicProfile,
            lookingForLeague: publicProfile && data.lookingForLeague === true,
            ...(typeof data.profileId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(data.profileId) ? { profileId: data.profileId } : {}),
        };
    }
    function readLocal(userId = currentUser()) {
        try {
            const profile = normalize(JSON.parse(root.localStorage.getItem(storageKey(userId)) || '{}'));
            return userId ? profile : { ...profile, publicProfile: false, lookingForLeague: false };
        } catch { return normalize(); }
    }
    function hasSaved(userId = currentUser()) {
        try { return Boolean(root.localStorage.getItem(storageKey(userId))); } catch { return false; }
    }
    function saveLocal(value, userId = currentUser()) {
        const profile = normalize(value);
        if (!userId) { profile.publicProfile = false; profile.lookingForLeague = false; delete profile.profileId; }
        try {
            root.localStorage.setItem(storageKey(userId), JSON.stringify(profile));
            return { ok: true, profile };
        } catch { return { ok: false, profile, error: 'This device could not save your team design. Free some browser storage and try again.' }; }
    }
    function announce(profile) {
        if (root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent('vault-profile-saved', { detail: { profile } }));
    }
    async function get() {
        const userId = currentUser();
        if (!userId) return { ok: true, profile: readLocal(null), storage: 'device' };
        const fallback = readLocal(userId);
        try {
            const result = await App.TimeLeagueRemote.getProfile();
            if (currentUser() !== userId) return { ok: false, error: 'Your account changed. Reopen your profile.' };
            if (!result?.ok) return { ok: false, profile: fallback, error: result?.error || 'Your account profile could not be loaded.' };
            const profile = result.profile ? normalize(result.profile) : fallback;
            if (result.profile) saveLocal(profile, userId);
            return { ok: true, profile, storage: 'account' };
        } catch { return { ok: false, profile: currentUser() === userId ? fallback : undefined, error: 'Your account profile could not be loaded. Try again.' }; }
    }
    async function save(value) {
        const userId = currentUser();
        const profile = normalize(value);
        if (!userId) {
            const local = saveLocal(profile, null);
            if (local.ok) announce(local.profile);
            return { ...local, storage: 'device' };
        }
        // Public identity is always an explicit Save. Never publish from a cache read.
        const { profileId: _profileId, ...input } = profile;
        try {
            const result = await App.TimeLeagueRemote.saveProfile(input);
            if (currentUser() !== userId) return { ok: false, error: 'Your account changed. Reopen your profile.' };
            if (!result?.ok) return { ok: false, error: result?.error || 'Your profile could not be saved. Try again.' };
            const saved = normalize(result.profile || input);
            saveLocal(saved, userId);
            announce(saved);
            return { ok: true, profile: saved, storage: 'account' };
        } catch { return { ok: false, error: 'Your profile could not be saved. Your changes are still here.' }; }
    }
    function teamDefaults() {
        if (!hasSaved()) return null;
        const profile = readLocal();
        return { name: profile.teamName, helmet: profile.helmet, primaryColor: profile.primaryColor,
            secondaryColor: profile.secondaryColor, backdrop: profile.backdrop };
    }
    App.TimeLeagueProfile = { BACKDROPS, normalize, readLocal, saveLocal, hasSaved, get, save, teamDefaults };
    if (typeof module !== 'undefined' && module.exports) module.exports = App.TimeLeagueProfile;
})(typeof window !== 'undefined' ? window : globalThis);
