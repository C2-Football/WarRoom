/* Transport-independent Duat room contract. This is not an online service.
 * A trusted transport must authenticate actorId, authorize seat claims, persist
 * revisions atomically, and supply the real campaign reducer/read projection.
 * No passwords, session tokens, invitation secrets, clocks, or randomness live here.
 */
/* global module */
(function (root, factory) {
    'use strict';
    const api = factory();
    root.App = root.App || {};
    root.App.DuatSession = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    const GAME_ID = 'duat';
    const SEAT_COUNT = 14;
    const ACTION_FIELDS = {
        'claim-seat': ['seatId'], 'set-ready': ['seatId', 'ready'],
        'set-plans': ['seatId', 'plans'], 'set-queue': ['seatId', 'queue'],
        'begin-campaign': [], 'advance-turn': [],
    };
    const fail = message => { throw new Error(message); };
    const identifier = (value, label) => {
        if (typeof value !== 'string' || !value.trim() || value.length > 120) fail('Invalid ' + label + '.');
        return value;
    };
    const timestamp = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) fail('Supply an explicit ISO timestamp.');
        return value;
    };
    function copy(value) {
        const seen = new Set();
        function check(item) {
            if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
            if (typeof item === 'number' && Number.isFinite(item)) return;
            if (typeof item !== 'object' || seen.has(item)) fail('Payloads must contain only acyclic JSON data.');
            if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) fail('Payloads must contain plain JSON objects.');
            seen.add(item);
            Object.values(item).forEach(check);
            seen.delete(item);
        }
        check(value);
        return JSON.parse(JSON.stringify(value));
    }
    function fingerprint(intent) {
        function sorted(value) {
            if (Array.isArray(value)) return value.map(sorted);
            if (!value || typeof value !== 'object') return value;
            return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
        }
        // Revision is a delivery precondition; a retry still denotes the same intent.
        const content = { ...copy(intent) };
        delete content.expectedRevision;
        return JSON.stringify(sorted(content));
    }
    function assertRoom(room) {
        if (!room || room.gameId !== GAME_ID || room.schemaVersion !== 1) fail('Unsupported Duat room.');
        identifier(room.roomId, 'room ID');
        if (!Number.isSafeInteger(room.revision) || room.revision < 0 || !['lobby', 'campaign'].includes(room.phase)) fail('Invalid room revision or phase.');
        if (!Number.isSafeInteger(room.turn) || (room.phase === 'lobby' ? room.turn !== 0 : room.turn < 1)) fail('Invalid campaign turn.');
        if (!Array.isArray(room.seats) || room.seats.length !== SEAT_COUNT) fail('A Duat room needs 14 faction seats.');
        const factions = new Set(), ids = new Set(), users = new Set();
        for (const seat of room.seats) {
            identifier(seat.factionId, 'faction ID'); identifier(seat.seatId, 'seat ID');
            if (factions.has(seat.factionId) || ids.has(seat.seatId)) fail('Faction seats must be unique.');
            factions.add(seat.factionId); ids.add(seat.seatId);
            if (!['human', 'ai'].includes(seat.controller) || !['host', 'player'].includes(seat.role) || typeof seat.ready !== 'boolean') fail('Invalid seat.');
            if (seat.userId !== null) {
                identifier(seat.userId, 'seat owner');
                if (seat.controller !== 'human' || users.has(seat.userId) || !seat.joinedAt) fail('Every human owns at most one joined seat.');
                users.add(seat.userId);
            } else if (seat.joinedAt !== null || (seat.controller === 'human' && seat.ready)) fail('Unclaimed human seats cannot be ready.');
        }
        const hosts = room.seats.filter(seat => seat.role === 'host');
        if (hosts.length !== 1 || hosts[0].seatId !== room.hostSeatId || hosts[0].controller !== 'human' || !hosts[0].userId) fail('A room needs one joined human host.');
        if (!Array.isArray(room.actionReceipts)) fail('Missing action receipt history.');
    }
    const humansReady = room => room.seats.filter(seat => seat.controller === 'human').every(seat => seat.userId && seat.joinedAt && seat.ready);
    const ownSeat = (room, actorId) => room.seats.find(seat => seat.controller === 'human' && seat.userId === actorId && seat.joinedAt);

    // factions is the canonical list of 14 IDs supplied by Duat's game catalog.
    // humanFactionIds may include the host; all remaining factions are AI seats.
    function createRoom(input, context) {
        const actorId = identifier(context?.actorId, 'authenticated actor');
        const now = timestamp(context?.now);
        const roomId = identifier(input?.roomId, 'room ID');
        if (!Array.isArray(input.factions) || input.factions.length !== SEAT_COUNT) fail('Supply all 14 faction IDs.');
        const factions = input.factions.map(id => identifier(id, 'faction ID'));
        if (new Set(factions).size !== SEAT_COUNT) fail('Faction IDs must be unique.');
        if (!factions.includes(input.hostFactionId)) fail('Choose a host faction from the catalog.');
        const invited = input.humanFactionIds || [];
        if (!Array.isArray(invited) || new Set(invited).size !== invited.length || invited.some(id => !factions.includes(id))) fail('Choose unique human factions from the catalog.');
        const humanFactions = new Set([input.hostFactionId, ...invited]);
        const seats = factions.map((factionId, index) => {
            const host = factionId === input.hostFactionId;
            const human = humanFactions.has(factionId);
            return { seatId: 'seat-' + (index + 1), factionId, controller: human ? 'human' : 'ai', role: host ? 'host' : 'player',
                userId: host ? actorId : null, joinedAt: host ? now : null, ready: !human, plans: null, queue: [] };
        });
        const room = { schemaVersion: 1, gameId: GAME_ID, roomId, name: identifier(input.name || 'The Duat', 'room name'),
            phase: 'lobby', turn: 0, revision: 0, hostSeatId: seats.find(seat => seat.role === 'host').seatId,
            createdAt: now, updatedAt: now, seats, campaign: copy(input.campaign ?? null), actionReceipts: [] };
        assertRoom(room);
        return room;
    }

    // Intent: { id, type, expectedRevision, ...action arguments }.
    // context.actorId MUST come from the trusted caller, never from intent.
    // claimAuthorization MUST be supplied only after a real invitation/access
    // check: { roomId, seatId, actorId }. Knowing a seat ID grants no access.
    // resolveCampaign is a synchronous trusted engine adapter, not request data.
    function applyIntent(room, intent, context) {
        try {
            assertRoom(room);
            const actorId = identifier(context?.actorId, 'authenticated actor');
            const now = timestamp(context?.now);
            identifier(intent?.id, 'action ID'); identifier(intent?.type, 'action type');
            if (!Object.hasOwnProperty.call(ACTION_FIELDS, intent.type)) fail('Unknown Duat room action.');
            const allowed = ['id', 'type', 'expectedRevision', ...ACTION_FIELDS[intent.type]];
            if (Object.keys(intent).some(key => !allowed.includes(key))) fail('Unexpected room action field.');
            const signature = fingerprint(intent);
            const actor = ownSeat(room, actorId);
            const receipt = room.actionReceipts.find(item => item.actorId === actorId && item.actionId === intent.id);
            if (receipt) {
                if (!actor) fail('You do not have a seat in this room.');
                if (receipt.signature !== signature) fail('This action ID was already used for a different intent.');
                return { ok: true, duplicate: true, revision: room.revision, appliedRevision: receipt.revision, state: room };
            }
            if (intent.type !== 'claim-seat' && !actor) fail('You do not have a seat in this room.');
            // Check claim authority before exposing room revision/conflict details.
            if (intent.type === 'claim-seat' && !actor) {
                const grant = context.claimAuthorization;
                if (!grant || grant.roomId !== room.roomId || grant.seatId !== intent.seatId || grant.actorId !== actorId) fail('A verified seat invitation is required.');
            }
            if (!Number.isSafeInteger(intent.expectedRevision) || intent.expectedRevision !== room.revision) return { ok: false, conflict: true, error: 'The room changed. Reload before retrying.', revision: room.revision };
            const next = copy(room);
            const seat = actor ? next.seats.find(item => item.seatId === actor.seatId) : null;
            const hostOnly = () => { if (!seat || seat.role !== 'host') fail('Only the host can advance the campaign.'); };
            const owned = () => {
                if (!seat || intent.seatId !== seat.seatId) fail('You can only control your own faction.');
                return seat;
            };
            switch (intent.type) {
            case 'claim-seat': {
                if (next.phase !== 'lobby') fail('Seats are locked after the campaign starts.');
                const target = next.seats.find(item => item.seatId === intent.seatId);
                if (!target || target.controller !== 'human') fail('Choose an open human seat.');
                if (actor && actor.seatId === target.seatId) break;
                if (actor) fail('You already own a faction in this room.');
                if (target.userId) fail('This faction already has an owner.');
                target.userId = actorId; target.joinedAt = now; target.ready = false;
                break;
            }
            case 'set-ready':
                if (typeof intent.ready !== 'boolean') fail('Choose ready or unready.');
                owned().ready = intent.ready;
                break;
            case 'set-plans': {
                const target = owned();
                if (target.ready) fail('Mark yourself unready before editing plans.');
                if (intent.plans !== null && (!intent.plans || typeof intent.plans !== 'object' || Array.isArray(intent.plans))) fail('Plans must be a JSON object or null.');
                target.plans = copy(intent.plans);
                break;
            }
            case 'set-queue': {
                const target = owned();
                if (target.ready) fail('Mark yourself unready before editing the queue.');
                if (!Array.isArray(intent.queue) || intent.queue.length > 100) fail('Supply a queue of at most 100 identifiers.');
                target.queue = intent.queue.map(id => identifier(id, 'queue item'));
                break;
            }
            case 'begin-campaign':
                hostOnly();
                if (next.phase !== 'lobby') fail('The campaign has already started.');
                if (!humansReady(next)) fail('Every human faction must join and be ready.');
                next.phase = 'campaign'; next.turn = 1;
                next.seats.forEach(item => { if (item.controller === 'human') item.ready = false; });
                break;
            case 'advance-turn': {
                hostOnly();
                if (next.phase !== 'campaign') fail('Begin the campaign first.');
                if (!humansReady(next)) fail('Every human faction must be ready for resolution.');
                if (typeof context.resolveCampaign !== 'function') fail('The Duat campaign engine must resolve this turn.');
                // The adapter receives detached data. A throw cannot change the
                // last valid room, and the transport remains responsible for CAS.
                const resolved = context.resolveCampaign({ campaign: copy(next.campaign), turn: next.turn, now,
                    seats: copy(next.seats).map(item => ({ seatId: item.seatId, factionId: item.factionId,
                        controller: item.controller, plans: item.plans, queue: item.queue })) });
                if (resolved === undefined || (resolved && typeof resolved.then === 'function')) fail('The campaign engine must return synchronous JSON state.');
                next.campaign = copy(resolved);
                next.turn += 1;
                next.seats.forEach(item => { if (item.controller === 'human') item.ready = false; item.plans = null; });
                break;
            }
            default: fail('Unknown Duat room action.');
            }
            next.revision += 1; next.updatedAt = now;
            next.actionReceipts.push({ actorId, actionId: intent.id, signature, revision: next.revision });
            assertRoom(next);
            return { ok: true, revision: next.revision, state: next };
        } catch (error) {
            return { ok: false, error: error.message || 'Invalid Duat room action.' };
        }
    }

    // Allowlist projection: future private room fields never become public by
    // accident. The opaque campaign is withheld unless a trusted game-specific
    // projector explicitly provides the state visible to this faction.
    function projectForViewer(room, actorId, projectCampaign) {
        assertRoom(room);
        const own = ownSeat(room, identifier(actorId, 'authenticated viewer'));
        if (!own) fail('You do not have a seat in this room.');
        const campaign = typeof projectCampaign === 'function'
            ? copy(projectCampaign(copy(room.campaign), { seatId: own.seatId, factionId: own.factionId })) : null;
        return { schemaVersion: room.schemaVersion, gameId: GAME_ID, roomId: room.roomId, name: room.name,
            phase: room.phase, turn: room.turn, revision: room.revision, createdAt: room.createdAt, updatedAt: room.updatedAt,
            seats: room.seats.map(seat => ({ seatId: seat.seatId, factionId: seat.factionId, controller: seat.controller,
                role: seat.role, joined: Boolean(seat.userId && seat.joinedAt), ready: seat.ready })),
            self: { seatId: own.seatId, factionId: own.factionId, role: own.role, plans: copy(own.plans), queue: copy(own.queue) },
            canBegin: own.role === 'host' && room.phase === 'lobby' && humansReady(room),
            canAdvance: own.role === 'host' && room.phase === 'campaign' && humansReady(room), campaign };
    }
    return { GAME_ID, SEAT_COUNT, createRoom, applyIntent, projectForViewer };
});
