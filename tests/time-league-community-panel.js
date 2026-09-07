'use strict';
const assert = require('node:assert/strict');
global.window = globalThis;
global.App = {};
let userId = 'alice';
App.OD = { getCurrentUserId: () => userId };
App.TimeLeagueHelmet = { monogramFor: name => name.slice(0, 2) };
App.TimeLeagueProfile = { readLocal: () => ({ profileId: userId + '-profile' }) };
window.TimeLeagueHelmetIcon = function Icon() {};
const requests = [], sent = [], responses = [], opened = [];
const managers = () => [{ profileId: 'target-profile', displayName: 'Available Rival', teamName: 'Amber Owls', lookingForLeague: true, backdrop: 'stadium', primaryColor: '#112233', secondaryColor: '#ffffff', stats: { wins: 5, losses: 2, ties: 1, championships: 1, games: 8 } }, { profileId: userId + '-profile', displayName: 'My Public Manager', teamName: 'My Club', lookingForLeague: true, stats: {} }];
const inbox = () => ({ ok: true, incoming: [
    { inviteId: 'open-invite', leagueName: 'Open Summer League', teamName: 'Open Owls', from: { displayName: 'Other Commissioner' }, status: 'pending', available: true },
    { inviteId: 'stale-invite', leagueName: 'Already Full League', teamName: 'Taken Seat', from: { displayName: 'Other Commissioner' }, status: 'pending', available: false },
], outgoing: [{ inviteId: 'old-sent', leagueName: 'My Previous Invitation', to: { displayName: 'Someone Else' }, status: 'declined' }] });
App.TimeLeagueRemote = {
    listCommunity: async input => { requests.push(input); return { ok: true, profiles: managers(), hasMore: true }; },
    listCommunityInvites: async () => inbox(),
    listMyOnlineLeagues: async () => [
        { rowId: 'open-room', name: 'Open Room', role: 'commissioner', phase: 'draft' },
        { rowId: 'started-room', role: 'commissioner', phase: 'draft' },
        { rowId: 'someone-elses', role: 'member', phase: 'draft' },
    ],
    loadOnlineLeague: async rowId => ({ id: rowId, draft_started: rowId === 'started-room', state: { name: 'Open Room', teams: [{ teamId: 't1', name: 'Host' }, { teamId: 't2', name: 'Open Team' }] }, members: [{ seat_team_id: 't1', joined: true }, { seat_team_id: 't2', joined: false }] }),
    sendCommunityInvite: async input => { sent.push(input); return { ok: true, inviteId: 'sent-new' }; },
    respondCommunityInvite: async (inviteId, accept) => { responses.push({ inviteId, accept }); return { ok: true, ...(accept ? { rowId: 'joined-room' } : {}) }; },
};
let cursor = 0;
const state = [], effects = [], previousDeps = [], cleanups = [];
global.React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], update => { state[i] = typeof update === 'function' ? update(state[i]) : update; }]; },
    useEffect: (callback, deps) => { const i = cursor++; if (!previousDeps[i] || deps.some((value, index) => value !== previousDeps[i][index])) { effects.push(() => { cleanups[i]?.(); cleanups[i] = callback(); }); previousDeps[i] = deps; } },
};
require('../js/components/time-league-community-panel.js');
const all = (value, test) => Array.isArray(value) ? value.flatMap(item => all(item, test)) : value && typeof value === 'object' ? [...(test(value) ? [value] : []), ...all(value.children || [], test)] : [];
const text = value => Array.isArray(value) ? value.map(text).join(' ') : value && typeof value === 'object' ? text(value.children) : String(value || '');
const render = () => { cursor = 0; return window.WrTimeLeagueCommunityPanel({ onOpenOnline: rowId => opened.push(rowId), onProfile() {} }); };
const button = (tree, label) => all(tree, node => node.type === 'button' && text(node).trim() === label)[0];
const article = (tree, phrase) => all(tree, node => node.type === 'article' && text(node).includes(phrase))[0];
const settle = async () => { while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); };
async function run() {
    let view = render();
    await settle(); view = render();
    assert(text(view).includes('Amber Owls'));
    assert.equal(requests.at(-1).view, 'leaderboard');
    assert.equal(requests.at(-1).limit, 20);
    const searchInput = all(view, node => node.type === 'input' && node.props['aria-label'] === 'Search community')[0];
    searchInput.props.onChange({ target: { value: '  Owls  ' } });
    view = render();
    all(view, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
    await settle(); view = render(); await settle();
    assert.equal(requests.at(-1).q, 'Owls');
    view = render();
    all(view, node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } });
    view = render(); await settle();
    assert.equal(requests.at(-1).lookingOnly, true);
    button(render(), 'Find players').props.onClick();
    view = render(); await settle(); view = render();
    assert.equal(requests.at(-1).view, 'players');
    assert.equal(all(article(view, 'My Public Manager'), node => node.type === 'button' && text(node).includes('Invite to my league')).length, 0, 'Managers should not be invited to their own league');
    await button(article(view, 'Amber Owls'), 'Invite to my league').props.onClick();
    view = render();
    assert(text(view).includes('Invite Available Rival'));
    const seatChoice = all(view, node => node.type === 'select')[0];
    const choices = all(seatChoice, node => node.type === 'option' && node.props.value !== '');
    assert.equal(choices.length, 1, 'Only open, unstarted commissioner seats may be offered');
    assert(text(choices[0]).includes('Open Team'));
    assert(button(view, 'Send invitation').props.disabled);
    seatChoice.props.onChange({ target: { value: '0' } });
    view = render();
    await button(view, 'Send invitation').props.onClick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].rowId, 'open-room');
    assert.equal(sent[0].seatTeamId, 't2');
    assert.equal(sent[0].profileId, 'target-profile');
    view = render(); await settle(); view = render();
    assert(text(view).includes('Invitation sent to Available Rival'));
    all(view, node => node.type === 'button' && text(node).startsWith('Invitations'))[0].props.onClick();
    view = render(); await settle(); view = render();
    assert.equal(requests.at(-1).view, 'players', 'The inbox must not send an unsupported directory mode');
    assert(text(view).includes('Open Summer League'));
    assert.equal(all(article(view, 'Already Full League'), node => node.type === 'button' && text(node).includes('Accept')).length, 0, 'An unavailable seat must not still offer Accept');
    await button(article(view, 'Already Full League'), 'Decline').props.onClick();
    assert.deepEqual(responses.at(-1), { inviteId: 'stale-invite', accept: false });
    view = render();
    await button(article(view, 'Open Summer League'), 'Accept & join league').props.onClick();
    assert.deepEqual(responses.at(-1), { inviteId: 'open-invite', accept: true });
    assert.deepEqual(opened, ['joined-room']);
    view = render();
    userId = 'bob';
    view = render(); // Intentionally before cleanup/effects: private data must already disappear.
    assert(!text(view).includes('Open Summer League'));
    assert(!text(view).includes('My Previous Invitation'));
    assert(!text(view).includes('Other Commissioner'));
    assert(!text(view).includes('You joined the league.'), 'Previous-account invitation feedback must disappear before effects');
    button(view, 'Find players').props.onClick();
    view = render();
    assert(!text(view).includes('Amber Owls'), 'Previous-account directory must remain hidden before new fetch');
    userId = null;
    view = render();
    assert(text(view).includes('Sign in'));
    assert(!text(view).includes('Amber Owls'));
    assert(!text(view).includes('Open Summer League'));
    userId = 'alice';
    view = render(); await settle(); view = render();
    button(view, 'Find players').props.onClick();
    view = render(); await settle(); view = render();
    await button(article(view, 'Amber Owls'), 'Invite to my league').props.onClick();
    view = render();
    assert(text(view).includes('Invite Available Rival'));
    userId = 'bob';
    view = render();
    assert.equal(all(view, node => node.props['aria-label'] === 'Compose league invitation').length, 0, 'Previous-account invitation drafts must hide before effects');
    assert(!text(view).includes('Open Room · Open Team'));
    await settle();
    userId = 'alice';
    view = render(); await settle(); view = render();
    all(view, node => node.type === 'button' && text(node).startsWith('Invitations'))[0].props.onClick();
    view = render(); await settle(); view = render();
    let finishResponse;
    App.TimeLeagueRemote.respondCommunityInvite = () => new Promise(resolve => { finishResponse = resolve; });
    const pendingResponse = button(article(view, 'Open Summer League'), 'Accept & join league').props.onClick();
    userId = 'bob';
    render();
    finishResponse({ ok: true, rowId: 'old-account-room' });
    await pendingResponse;
    assert.deepEqual(opened, ['joined-room'], 'An old account acceptance must not navigate the new account');
    view = render();
    assert(!text(view).includes('You joined the league.'));
    console.log('Vault community UI: bounded search, view mapping, own-profile exclusion, controlled seat invites, stale-seat actions and account isolation passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
