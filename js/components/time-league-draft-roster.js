// My draft: public player identities, position counts, and available roster slots.
(function () {
    'use strict';
    const h = React.createElement;
    const Roster = window.App.TimeLeagueRoster;
    const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const SLOTS = new Set([...POSITIONS, 'FLEX', 'SUPER_FLEX', 'BN']);
    const label = slot => ({ DEF: 'D/ST', SUPER_FLEX: 'Super flex', FLEX: 'Flex', BN: 'Bench' }[slot] || slot);

    function WrTimeLeagueDraftRoster({ league, team, onScout }) {
        const [initiallyOpen] = React.useState(() => Boolean(window.matchMedia?.('(min-width: 900px)').matches));
        if (!league || !team) return null;
        const roster = team.roster || [];
        const slots = Roster.expandRosterSlots(league.settings.rosterSlots).filter(slot => SLOTS.has(slot));
        const counts = Object.fromEntries(POSITIONS.map(position => [position, roster.filter(entry => entry.position === position).length]));
        const positions = POSITIONS.filter(position => counts[position] > 0 || slots.some(slot => slot !== 'BN' && Roster.SLOT_ELIGIBILITY[slot].includes(position)));
        const occupants = new Map();
        const used = new Set();
        roster.forEach(entry => {
            if (!occupants.has(entry.slot)) occupants.set(entry.slot, []);
            occupants.get(entry.slot).push(entry);
        });
        const rows = slots.map((slot, index) => {
            const entry = occupants.get(slot)?.shift();
            if (entry) used.add(entry);
            return { slot, entry, key: `${slot}:${index}` };
        });
        // Preserve visibility if a restored league contains an unassigned player.
        roster.filter(entry => !used.has(entry)).forEach(entry => rows.push({ slot: 'Unassigned', entry, key: entry.entryId || entry.identity }));
        const picks = new Map((league.draftPicks || []).filter(pick => pick.teamId === team.teamId).map(pick => [pick.entryId, pick.overall]));
        return h('section', { className: 'tl-draft-roster', 'aria-label': `My draft: ${team.name}` },
            h('div', { className: 'tl-draft-roster-heading' },
                h('div', null, h('h3', null, 'My draft'), h('span', { className: 'tl-draft-roster-team' }, team.name)),
                h('span', { className: 'tl-draft-roster-progress' }, h('strong', { className: 'tabular' }, `${roster.length}/${slots.length}`), h('small', null, 'drafted'))),
            h('dl', { className: 'tl-draft-roster-counts', 'aria-label': 'Players drafted by position' }, positions.map(position => h('div', { key: position, 'data-position': position },
                h('dt', null, label(position)), h('dd', { className: 'tabular' }, counts[position])))),
            roster.length > 0 && h('p', { className: 'tl-draft-roster-recent' }, h('span', null, 'Latest picks'), roster.slice(-2).reverse().map((entry, index) => h('strong', { key: entry.entryId || entry.identity }, index > 0 && h('span', { 'aria-hidden': 'true' }, ' · '), entry.name))),
            !roster.length && h('p', { className: 'tl-draft-roster-empty' }, 'Your picks will appear here.'),
            h('details', { className: 'tl-draft-roster-details', open: initiallyOpen },
                h('summary', null, h('span', null, 'View my team'), h('span', { className: 'tl-draft-roster-chevron', 'aria-hidden': 'true' }, '⌄')),
                h('ul', { className: 'tl-draft-roster-slots', 'aria-label': 'Your draft roster slots' }, rows.map(({ slot, entry, key }) => {
                    const pick = entry && picks.get(entry.entryId);
                    return h('li', { key, 'data-slot': slot, 'data-position': entry?.position || '' },
                        h('span', { className: 'tl-draft-roster-slot' }, label(slot)),
                        entry ? h(onScout ? 'button' : 'span', {
                            className: 'tl-draft-roster-player',
                            ...(onScout ? { type: 'button', 'aria-label': `Scout ${entry.name}`, onClick: event => onScout(entry.identity, event) } : {}),
                        }, h('strong', null, entry.name), h('small', null, label(entry.position), Number.isInteger(pick) && pick > 0 ? ` · Pick ${pick}` : ''))
                            : h('span', { className: 'tl-draft-roster-open' }, 'Open slot'));
                }))));
    }

    window.WrTimeLeagueDraftRoster = WrTimeLeagueDraftRoster;
})();
