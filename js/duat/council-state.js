/* global module, require */
(function (root) {
    'use strict';
    const App = root.App = root.App || {}, common = typeof module !== 'undefined' && module.exports;
    const Personalities = common ? require('./personalities.js') : App.DuatPersonalities;
    const INTENTS = ['respect', 'counsel', 'challenge', 'alliance'];
    const MAX_MESSAGES = 400;
    const fail = message => { const error = new Error(message); error.code = 'INVALID_COUNCIL'; throw error; };
    const string = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
    const pair = (from, to) => from + ':' + to;
    function relationships(messages) {
        const result = {};
        for (const message of messages) {
            const key = pair(message.fromFactionId, message.toFactionId);
            result[key] = Math.max(-5, Math.min(5, (result[key] || 0) + ({ respect: 1, counsel: 0, challenge: -1, alliance: 0 })[message.intent]));
        }
        return result;
    }
    function normalize(value, factionIds) {
        if (value === undefined) return undefined;
        if (!value || value.version !== 1 || Object.keys(value).some(key => !['version', 'messages', 'relationships'].includes(key))
            || !Array.isArray(value.messages) || value.messages.length > MAX_MESSAGES) fail('The council history is not valid.');
        const seen = new Set(), fields = ['id', 'cycle', 'week', 'fromFactionId', 'toFactionId', 'rulerId', 'rulerName', 'intent', 'prompt', 'text', 'createdAt'];
        for (const m of value.messages) {
            if (!m || Object.keys(m).some(key => !fields.includes(key)) || !string(m.id, 120) || seen.has(m.id)
                || !Number.isInteger(m.cycle) || m.cycle < 1 || !Number.isInteger(m.week) || m.week < 0 || m.week > 17
                || !factionIds.includes(m.fromFactionId) || !factionIds.includes(m.toFactionId) || m.fromFactionId === m.toFactionId
                || !string(m.rulerId, 160) || !string(m.rulerName, 160) || !INTENTS.includes(m.intent)
                || !string(m.prompt, 120) || !string(m.text, 1200) || !string(m.createdAt, 60) || !Number.isFinite(Date.parse(m.createdAt))) fail('A council exchange is not valid.');
            seen.add(m.id);
        }
        const expected = relationships(value.messages);
        if (!value.relationships || Object.keys(value.relationships).length !== Object.keys(expected).length
            || Object.keys(expected).some(key => value.relationships[key] !== expected[key])) fail('The council relationship record does not match its exchanges.');
        return { version: 1, messages: value.messages.map(m => ({ ...m })), relationships: expected };
    }
    function apply(state, action, actorFactionId) {
        const ids = state.factions.map(f => f.id), before = normalize(state.council, ids) || { version: 1, messages: [], relationships: {} };
        const target = state.factions.find(f => f.id === action.targetFactionId);
        if (!state.humanFactionIds.includes(actorFactionId) || !target || target.controller !== 'ai' || target.id === actorFactionId) fail('Choose an awakened AI ruler to address.');
        if (!string(action.messageId, 120) || !/^[A-Za-z0-9_-]{8,120}$/.test(action.messageId) || !INTENTS.includes(action.intent)) fail('Choose a council response with a valid send identifier.');
        const existing = before.messages.find(m => m.id === action.messageId);
        if (existing) {
            if (existing.fromFactionId === actorFactionId && existing.toFactionId === target.id && existing.intent === action.intent && existing.week === action.seenThroughWeek) return state;
            fail('That council identifier was already used for a different exchange.');
        }
        const latest = Math.max(0, ...(state.completedWeeks || []).map(w => w.week));
        if (!Number.isInteger(action.seenThroughWeek) || action.seenThroughWeek < 0 || action.seenThroughWeek > latest) fail('Use the games you have already revealed in this conversation.');
        if (!Personalities.isAwake(state, actorFactionId) || !Personalities.isAwake(state, target.id)) fail('Wait until both rulers have awakened.');
        const options = { campaign: state, factionId: target.id, viewerFactionId: actorFactionId, visibleThroughWeek: action.seenThroughWeek,
            allianceVisible: action.seenThroughWeek > 0, intent: action.intent };
        const view = Personalities.council(options), response = Personalities.reply(options);
        const choice = view.choices.find(c => c.intent === action.intent), army = target.armies.find(a => a.id === target.activeArmyId);
        if (!response || !choice || !army) fail('That council response is not available.');
        const createdAt = action.createdAt || state.updatedAt;
        const message = { id: action.messageId, cycle: state.dynastySeason || 1, week: action.seenThroughWeek,
            fromFactionId: actorFactionId, toFactionId: target.id, rulerId: army.rulerId || view.profile.id,
            rulerName: view.profile.name, intent: action.intent, prompt: choice.label, text: response.text, createdAt };
        const messages = [...before.messages, message].slice(-MAX_MESSAGES);
        const council = normalize({ version: 1, messages, relationships: relationships(messages) }, ids);
        return { ...state, council };
    }
    function project(value, viewerFactionId) {
        if (value === undefined) return undefined;
        const messages = value.messages.filter(m => m.fromFactionId === viewerFactionId).map(m => ({ ...m }));
        return { version: 1, messages, relationships: relationships(messages) };
    }
    const api = { normalize, apply, project, INTENTS };
    App.DuatCouncilState = api;
    if (common) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
