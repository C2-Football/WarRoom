'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Session = require('../js/duat/session.js');
const factions = Array.from({ length: 14 }, (_, index) => 'faction-' + (index + 1));
const now = '2026-09-08T18:00:00.000Z';
const context = actorId => ({ actorId, now });
const create = (extra = {}) => Session.createRoom({ roomId: 'test-room', name: 'Test campaign', factions,
    hostFactionId: factions[0], humanFactionIds: [factions[1], factions[2]],
    campaign: { secret: 'hidden engine state', resolved: 0 }, ...extra }, context('host'));
let count = 0;
function test(label, run) { run(); count += 1; console.log('ok ' + count + ' - ' + label); }
function act(room, actorId, type, extra = {}, trusted = {}) {
    return Session.applyIntent(room, { id: actorId + '-' + room.revision + '-' + type, type,
        expectedRevision: room.revision, ...extra }, { ...context(actorId), ...trusted });
}
function success(result) { assert.equal(result.ok, true, result.error); return result.state; }
function claim(room, user, seatId) {
    return success(act(room, user, 'claim-seat', { seatId }, { claimAuthorization: { roomId: room.roomId, seatId, actorId: user } }));
}
function joined() { return claim(claim(create(), 'friend', 'seat-2'), 'third', 'seat-3'); }
function ready(room) {
    for (const seat of room.seats.filter(item => item.controller === 'human')) room = success(act(room, seat.userId, 'set-ready', { seatId: seat.seatId, ready: true }));
    return room;
}
function campaign() { return success(act(ready(joined()), 'host', 'begin-campaign')); }

test('deterministic 14-faction creation reserves humans and fills AI without credentials', () => {
    const room = create();
    assert.deepEqual(room, create()); assert.equal(room.seats.length, 14);
    assert.equal(room.seats.filter(item => item.controller === 'ai').length, 11);
    assert.equal(room.seats[0].userId, 'host'); assert.equal(room.seats[1].ready, false);
    assert.equal(room.revision, 0); assert.equal(room.turn, 0);
    assert.equal(/password|token|invite_code/i.test(JSON.stringify(room)), false);
});
test('invalid or duplicate factions and unknown human seats are rejected', () => {
    assert.throws(() => create({ factions: factions.slice(1) }), /14/);
    assert.throws(() => create({ factions: factions.map((id, i) => i ? id : factions[1]) }), /unique/);
    assert.throws(() => create({ humanFactionIds: ['outside'] }), /catalog/);
    assert.throws(() => create({ humanFactionIds: [factions[1], factions[1]] }), /unique/);
    assert.throws(() => create({ hostFactionId: 'outside' }), /host faction/);
});
test('outsiders cannot read, control, or claim a seat just by knowing its ID', () => {
    const room = create();
    assert.throws(() => Session.projectForViewer(room, 'stranger'), /seat/);
    assert.match(act(room, 'stranger', 'set-ready', { seatId: 'seat-1', ready: true }).error, /seat/);
    assert.match(act(room, 'stranger', 'claim-seat', { seatId: 'seat-2' }).error, /verified/);
    for (const changed of [{ roomId: 'other' }, { seatId: 'seat-3' }, { actorId: 'host' }]) {
        const claimAuthorization = { roomId: room.roomId, seatId: 'seat-2', actorId: 'stranger', ...changed };
        assert.match(act(room, 'stranger', 'claim-seat', { seatId: 'seat-2' }, { claimAuthorization }).error, /verified/);
    }
});
test('claims cannot steal occupied seats, claim AI, or give one account two factions', () => {
    const room = claim(create(), 'friend', 'seat-2');
    const granted = seatId => ({ claimAuthorization: { roomId: room.roomId, seatId, actorId: 'stranger' } });
    assert.match(act(room, 'stranger', 'claim-seat', { seatId: 'seat-2' }, granted('seat-2')).error, /owner/);
    assert.match(act(room, 'stranger', 'claim-seat', { seatId: 'seat-4' }, granted('seat-4')).error, /human seat/);
    assert.match(act(room, 'friend', 'claim-seat', { seatId: 'seat-3' }).error, /already own/);
    assert.equal(success(act(room, 'friend', 'claim-seat', { seatId: 'seat-2' })).seats[1].userId, 'friend');
});
test('readiness belongs to the joined seat and cannot be assigned by the host', () => {
    const room = joined();
    assert.match(act(room, 'host', 'set-ready', { seatId: 'seat-2', ready: true }).error, /own faction/);
    assert.match(act(room, 'friend', 'set-ready', { seatId: 'seat-4', ready: true }).error, /own faction/);
    const next = success(act(room, 'friend', 'set-ready', { seatId: 'seat-2', ready: true }));
    assert.equal(next.seats[1].ready, true); assert.equal(room.seats[1].ready, false);
    assert.equal(success(act(next, 'friend', 'set-ready', { seatId: 'seat-2', ready: false })).seats[1].ready, false);
});
test('campaign start requires every human joined and ready, and only the host can start', () => {
    let room = success(act(create(), 'host', 'set-ready', { seatId: 'seat-1', ready: true }));
    assert.match(act(room, 'host', 'begin-campaign').error, /Every human/);
    room = joined(); assert.match(act(room, 'host', 'begin-campaign').error, /Every human/);
    room = ready(room); assert.match(act(room, 'friend', 'begin-campaign').error, /host/);
    const next = success(act(room, 'host', 'begin-campaign'));
    assert.equal(next.phase, 'campaign'); assert.equal(next.turn, 1);
    assert(next.seats.filter(item => item.controller === 'human').every(item => !item.ready));
    assert.deepEqual(next.campaign, room.campaign);
    assert.match(act(next, 'friend', 'claim-seat', { seatId: 'seat-2' }).error, /locked/);
});
test('stale writes fail without mutation, including readiness races before start', () => {
    const room = ready(joined());
    const unready = success(act(room, 'friend', 'set-ready', { seatId: 'seat-2', ready: false }));
    const stale = act(unready, 'host', 'begin-campaign', { expectedRevision: room.revision });
    assert.equal(stale.ok, false); assert.equal(stale.conflict, true); assert.equal(stale.state, undefined);
    assert.equal(unready.phase, 'lobby'); assert.equal(room.seats[1].ready, true);
});
test('action IDs deduplicate retries, reject changed intent, and are scoped to actor', () => {
    const room = joined();
    const intent = { id: 'same-id', type: 'set-ready', expectedRevision: room.revision, seatId: 'seat-1', ready: true };
    const first = success(Session.applyIntent(room, intent, context('host')));
    const retry = Session.applyIntent(first, intent, context('host'));
    assert.equal(retry.duplicate, true); assert.equal(retry.state, first); assert.equal(retry.revision, first.revision);
    assert.match(Session.applyIntent(first, { ...intent, ready: false }, context('host')).error, /different intent/);
    const friend = success(Session.applyIntent(first, { ...intent, expectedRevision: first.revision, seatId: 'seat-2' }, context('friend')));
    assert.equal(friend.seats[1].ready, true); assert.equal(friend.actionReceipts.filter(r => r.actionId === 'same-id').length, 2);
    assert.equal(Session.applyIntent(friend, intent, context('host')).revision, friend.revision);
});
test('a successfully claimed invitation can be retried after the room starts', () => {
    const initial = create();
    const intent = { id: 'claim-once', type: 'claim-seat', expectedRevision: 0, seatId: 'seat-2' };
    let room = success(Session.applyIntent(initial, intent, { ...context('friend'), claimAuthorization: { roomId: initial.roomId, seatId: 'seat-2', actorId: 'friend' } }));
    room = success(act(ready(claim(room, 'third', 'seat-3')), 'host', 'begin-campaign'));
    const retry = Session.applyIntent(room, intent, context('friend'));
    assert.equal(retry.duplicate, true); assert.equal(retry.state, room);
});
test('private plans and queues are owned, locked while ready, and omitted for other viewers', () => {
    let room = joined();
    room = success(act(room, 'friend', 'set-plans', { seatId: 'seat-2', plans: { order: 'secret attack' } }));
    room = success(act(room, 'friend', 'set-queue', { seatId: 'seat-2', queue: ['secret recruitment'] }));
    const host = Session.projectForViewer(room, 'host');
    assert.equal(JSON.stringify(host).includes('secret'), false); assert.equal(host.campaign, null);
    assert.equal('actionReceipts' in host, false); assert(host.seats.every(item => !('userId' in item) && !('plans' in item) && !('queue' in item)));
    const friend = Session.projectForViewer(room, 'friend');
    assert.equal(friend.self.plans.order, 'secret attack'); assert.deepEqual(friend.self.queue, ['secret recruitment']);
    friend.self.plans.order = 'tampered'; assert.equal(room.seats[1].plans.order, 'secret attack');
    room = success(act(room, 'friend', 'set-ready', { seatId: 'seat-2', ready: true }));
    assert.match(act(room, 'friend', 'set-plans', { seatId: 'seat-2', plans: {} }).error, /unready/);
    assert.match(act(room, 'host', 'set-queue', { seatId: 'seat-2', queue: [] }).error, /own faction/);
});
test('campaign projection requires an explicit game-specific adapter and receives detached state', () => {
    const room = joined();
    room.futurePrivateField = 'unannounced secret';
    const view = Session.projectForViewer(room, 'friend', (payload, viewer) => {
        payload.secret = 'modified'; return { turnCount: payload.resolved, factionId: viewer.factionId };
    });
    assert.deepEqual(view.campaign, { turnCount: 0, factionId: factions[1] });
    assert.equal(room.campaign.secret, 'hidden engine state'); assert.equal('futurePrivateField' in view, false);
});
test('host-only advancement requires readiness and actual engine resolution', () => {
    let room = campaign();
    assert.match(act(room, 'friend', 'advance-turn').error, /host/);
    assert.match(act(room, 'host', 'advance-turn').error, /Every human/);
    room = ready(room); assert.match(act(room, 'host', 'advance-turn').error, /campaign engine/);
    const before = JSON.stringify(room);
    const broken = act(room, 'host', 'advance-turn', {}, { resolveCampaign({ campaign: data }) { data.resolved = 99; throw new Error('engine failure'); } });
    assert.match(broken.error, /engine failure/); assert.equal(JSON.stringify(room), before);
    const next = success(act(room, 'host', 'advance-turn', {}, { resolveCampaign: ({ campaign: data, turn, seats }) => {
        assert.equal(turn, 1); assert.equal(seats.length, 14); return { ...data, resolved: data.resolved + 1 };
    } }));
    assert.equal(next.turn, 2); assert.equal(next.campaign.resolved, 1); assert.equal(room.campaign.resolved, 0);
    assert(next.seats.filter(item => item.controller === 'human').every(item => !item.ready));
});
test('solo is one human and thirteen AI with the same readiness/start contract', () => {
    const room = create({ humanFactionIds: [] });
    assert.equal(room.seats.filter(item => item.controller === 'ai').length, 13);
    assert.equal(success(act(ready(room), 'host', 'begin-campaign')).phase, 'campaign');
});
test('invalid payloads and asynchronous engine adapters cannot change valid saves', () => {
    const room = ready(campaign());
    assert.match(act(room, 'host', 'advance-turn', {}, { resolveCampaign: () => Promise.resolve({}) }).error, /synchronous/);
    assert.match(act(room, 'host', 'advance-turn', {}, { resolveCampaign: () => ({ bad: NaN }) }).error, /JSON/);
    assert.equal(room.turn, 1);
});
test('intent cannot impersonate the trusted actor or attach replacement state or credentials', () => {
    const room = joined();
    for (const extra of [{ actorId: 'friend' }, { campaign: { forged: true } }, { token: 'never-persist-this' }]) {
        const result = act(room, 'host', 'set-ready', { seatId: 'seat-1', ready: true, ...extra });
        assert.equal(result.ok, false); assert.match(result.error, /Unexpected/);
    }
    assert.equal(JSON.stringify(room).includes('never-persist-this'), false);
});
test('browser UMD exposes the same public contract without Node globals', () => {
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/duat/session.js'), 'utf8'), sandbox);
    assert.equal(sandbox.window.App.DuatSession.GAME_ID, 'duat');
    assert.equal(typeof sandbox.window.App.DuatSession.applyIntent, 'function');
});
console.log('\n' + count + ' Duat session scenarios passed.');
