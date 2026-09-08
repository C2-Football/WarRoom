'use strict';
const assert = require('assert');
const { messagesFor, sendMessage } = require('../js/shared/time-league-rivals.js');
const PERSONAS = ['warlord', 'archivist', 'gambler', 'steward', 'broker', 'scout', 'tactician', 'grinder', 'showman', 'contrarian', 'alchemist', 'sentinel'];
const state = { seed: 'mail', currentWeek: 14, settings: { regularSeasonWeeks: 12 }, teams: [{ teamId: 'h', name: 'You', manager: 'human' }, { teamId: 'a', name: 'Kade', manager: 'ai', aiPersona: 'warlord' }, { teamId: 'b', name: 'Sol', manager: 'ai', aiPersona: 'gambler' }], finalizedWeeks: [{ week: 13, matchups: [{ home: 'h', away: 'a', homePoints: 60, awayPoints: 80, winner: 'a' }] }], trades: [{ tradeId: 'tr1', fromTeamId: 'b', toTeamId: 'h', week: 12, status: 'pending' }], waiverResults: [{ week: 12, identity: 'p', name: 'Barry Sanders', winnerTeamId: 'h', contenderTeamIds: ['h', 'a', 'b'] }] };
const mail = messagesFor(state, 'h');
assert.equal(mail.length, 4);
assert.equal(mail.filter(row => row.kind === 'eliminated').length, 1);
assert.equal(mail.filter(row => row.kind === 'waiverLoss').length, 2);
assert.notEqual(mail.find(row => row.fromTeamId === 'a' && row.kind === 'waiverLoss').text, mail.find(row => row.fromTeamId === 'b' && row.kind === 'waiverLoss').text);
assert.deepEqual(mail, messagesFor(JSON.parse(JSON.stringify(state)), 'h'));
assert.equal(messagesFor(state, 'a').length, 0);
assert.equal(messagesFor(state, 'h', { throughWeek: 12 }).some(row => row.kind === 'eliminated'), false);
const lost = { ...state, waiverResults: [{ ...state.waiverResults[0], winnerTeamId: 'a' }] };
assert.equal(messagesFor(lost, 'h').filter(row => row.kind === 'waiverWin').length, 1);
assert.equal(messagesFor({ ...lost, waiverResults: [{ ...lost.waiverResults[0], contenderTeamIds: ['a', 'b'] }] }, 'h').filter(row => row.kind.startsWith('waiver')).length, 0);
assert.equal(messagesFor({ ...state, trades: [{ ...state.trades[0], status: 'accepted' }] }, 'h').filter(row => row.kind === 'accepted').length, 1);
console.log('Rival mail: event grounding, recipients, personas, persistence and spoiler gates passed.');

// The final must celebrate a settled championship, not promise another round.
globalThis.App.TimeLeagueEngine = { seasonEndWeek: () => 14 };
for (const aiPersona of PERSONAS) {
    const final = { ...state, championTeamId: 'a', teams: state.teams.map(team => team.teamId === 'a' ? { ...team, aiPersona } : team), finalizedWeeks: [{ week: 14, matchups: [{ home: 'h', away: 'a', homePoints: 60, awayPoints: 80, winner: 'a' }] }] };
    assert.equal(messagesFor(final, 'h').find(row => row.week === 14).kind, 'titleWon');
    final.championTeamId = 'h';
    final.finalizedWeeks[0].matchups[0].winner = 'h';
    assert.equal(messagesFor(final, 'h').find(row => row.week === 14).kind, 'titleLost');
    assert.equal(messagesFor(final, 'h').find(row => row.week === 14).context, 'Championship final');
}
console.log('Championship messages close the season for all twelve personas.');

const delayed = { ...state, trades: [{ ...state.trades[0], week: 10, delayedWeeks: [10, 11], deferredUntilWeek: 12, status: 'accepted', respondedWeek: 13 }] };
assert.deepEqual(messagesFor(delayed, 'h').filter(row => row.kind === 'delayed').map(row => row.week).sort(), [10, 11]);
assert.equal(messagesFor(delayed, 'h').find(row => row.kind === 'accepted').week, 13);
assert.equal(messagesFor(delayed, 'h', { throughWeek: 11 }).some(row => row.kind === 'accepted' || row.week > 11), false);
console.log('Trade delay history and actual response chronology survive advancing weeks.');

// Every archetype has authored lines for every event, rather than silently falling back to Steward.
const kinds = ['win', 'loss', 'tie', 'eliminated', 'knockedOut', 'titleWon', 'titleLost', 'offer', 'accepted', 'rejected', 'delayed', 'waiverWin', 'waiverLoss'];
for (const kind of kinds) {
    const texts = new Set();
    for (const aiPersona of PERSONAS) {
        let sample = { ...state, teams: state.teams.map(t => t.teamId === 'a' ? { ...t, aiPersona } : t), finalizedWeeks: [], trades: [], waiverResults: [] };
        if (['offer', 'accepted', 'rejected', 'delayed'].includes(kind)) {
            sample.trades = [{ tradeId: 'v1', fromTeamId: 'a', toTeamId: 'h', week: 10, status: kind === 'accepted' || kind === 'rejected' ? kind : 'pending', ...(kind === 'delayed' ? { delayedWeeks: [11], deferredUntilWeek: 12 } : {}) }];
        } else if (kind.startsWith('waiver')) {
            sample.waiverResults = [{ week: 12, identity: 'p', name: 'Barry Sanders', winnerTeamId: kind === 'waiverWin' ? 'a' : 'h', contenderTeamIds: ['h', 'a'] }];
        } else {
            const week = kind.startsWith('title') ? 14 : ['eliminated', 'knockedOut'].includes(kind) ? 13 : 10;
            const winner = ['loss', 'knockedOut', 'titleLost'].includes(kind) ? 'h' : kind === 'tie' ? null : 'a';
            sample = { ...sample, championTeamId: winner, finalizedWeeks: [{ week, matchups: [{ home: 'h', away: 'a', winner, homePoints: 70, awayPoints: 80 }] }] };
        }
        const message = messagesFor(sample, 'h').find(m => m.kind === kind);
        assert(message?.text && !message.text.includes('undefined') && !message.text.includes('{player}'), `${aiPersona} needs a complete ${kind} voice`);
        texts.add(message.text);
    }
    assert.equal(texts.size, 12, `${kind} has a distinct voice for every persona`);
}
for (const tone of ['friendly', 'competitive', 'dismissive', 'neutral']) {
    const texts = new Set();
    for (const aiPersona of PERSONAS) {
        let sample = { ...state, teams: state.teams.map(t => t.teamId === 'a' ? { ...t, aiPersona } : t) };
        for (let i = 0; i < 3; i++) sample = sendMessage(sample, { teamId: 'h', toTeamId: 'a', text: 'Here is my next message.', tone, messageId: `test_chat_${i}` }, '2026-09-07T12:00:00Z');
        const replies = sample.rivalMessages.filter(m => m.fromTeamId === 'a');
        assert.equal(new Set(replies.map(m => m.text)).size, 3, `${aiPersona} rotates its ${tone} replies`);
        texts.add(replies[0].text);
    }
    assert.equal(texts.size, 12, `${tone} replies keep all twelve voices distinct`);
}
console.log('All twelve personalities have unique, complete event voices and rotating replies in every tone.');
