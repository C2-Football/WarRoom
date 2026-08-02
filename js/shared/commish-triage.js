// ══════════════════════════════════════════════════════════════════
// js/shared/commish-triage.js — window.App.Commish.Triage
// THE TRIAGE QUEUE. Seven walls of the Commissioner's Office each know one
// thing perfectly and nothing about each other. A commissioner with four
// leagues opens the office and gets a 58-issue badge with no order to it —
// which is the same as no information. This engine is the desk: it reads
// every other brick's OUTPUT (read-only, never re-derives them), scores each
// obligation on one scale, ROLLS UP the duplicates a human would never work
// twice, and returns a single ranked queue plus an honest coverage grid.
//
//   buildQueue({ radar, renewal, drift, calendar, conflicts, genesis,
//                treasuries, constitutions, seats, graph, mine, week, nowMs })
//     → { items, counts:{now,soon,backlog}, byCell, notYet, diagnosis }
//
//   items[]  { id, domain, hub, leagueIds[], leagueNames[], leagueTags[],
//              subjectName, score, tier:'NOW'|'SOON'|'BACKLOG', kicker,
//              headline, detail, metric:{value,unit,breach},
//              action:{kind:'deeplink'|'copy'|'inline', label}, dueTs }
//   byCell   one count for EVERY league×domain pair — a lazily-zeroed cell
//            makes the grid a liar ("no row here" and "never looked here"
//            must not render the same).
//   notYet   league×domain pairs that CANNOT hold data yet (a coefficient or
//            a matchday programme with zero scored weeks isn't a gap, it's a
//            calendar fact).
//
// ── THREE RULES THAT MAKE THE NUMBER TRUSTWORTHY ─────────────────────
// 1. ROLLUP. One row per HUMAN, not per league-team: a person dark in three
//    leagues is one message, not three. Same for genesis / drift / dues /
//    constitution — one row per league, with the count in the detail line.
//    Rule Lab contributes NOTHING: it's a tool you choose to open, not an
//    obligation that accrues.
// 2. BLAST RADIUS. Person weights scale ×(1 + 0.08 × (leagueCount − 1)) —
//    losing a human who anchors four of your leagues is a bigger fire than
//    losing one who plays in one. Conflicts take +2 per doubly-booked human.
// 3. OFFSEASON HONESTY CLAMP. At week 0 every in-season kind (person_*,
//    programme_*) is ×0.55 AND hard-capped at tier SOON. Dark in August is
//    not an emergency, and a desk that screams in August gets closed in
//    September. This clamp is what makes the queue usable TODAY.
//
// NO age/rot modifier: an item does not become more urgent because the
// commissioner has been ignoring it. Urgency comes from the calendar.
//
// Pure — no Date.now(), no fetch, no storage. Everything arrives via params
// so the same inputs always produce the same queue (tests, cached renders,
// and the "why is this first?" explainer all depend on it).
// Warroom-local (direct <script> tag), Node-testable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    App.Commish = App.Commish || {};

    const DAY_MS = 86400000;
    const HOUR_MS = 3600000;

    // The office's seven walls. byCell/notYet emit a cell for every league ×
    // every one of these, always, in this order.
    const DOMAINS = ['coefficient', 'people', 'operations', 'programmes', 'rulelab', 'genesis', 'bylaws'];

    // domain → the office's view key (what the deeplink switches to).
    const HUB_BY_DOMAIN = {
        coefficient: 'network',
        people: 'people',
        operations: 'ops',
        programmes: 'programmes',
        rulelab: 'rulelab',
        genesis: 'genesis',
        bylaws: 'governance',
    };

    // ── Base weights ─────────────────────────────────────────────────
    // One table, tunable in one place. Everything else in this file is
    // arithmetic on these numbers — if the queue ranks wrong, it is this
    // table that is wrong, not the code.
    const WEIGHTS = {
        open_seat_draft_within_14d: 92,
        person_DARK_ALL: 88,
        drift_scoring_or_deadline: 82,
        genesis_lt_50_draft_in_30d: 80,
        draft_unscheduled: 78,
        open_seat: 74,
        draft_collision_within_21d: 72,
        person_DARK_ONE: 62,
        renewal_AT_RISK: 58,          // + (0.5 − probability) × 40
        drift_other_path: 55,
        deadline_cluster: 52,
        genesis_blockers_lt_60: 50,
        dues_zero_collected: 48,
        no_constitution: 44,
        renewal_WATCH: 34,
        programme_unpublished: 30,
        person_FADING: 28,
        drift_acked_no_note: 26,
    };

    const BLAST_PER_EXTRA_LEAGUE = 0.08;
    const SHARED_HUMAN_BUMP = 2;
    const RENEWAL_SLOPE = 40;
    const RENEWAL_PIVOT = 0.5;
    const OFFSEASON_FACTOR = 0.55;
    const NOW_AT = 70;
    const SOON_AT = 40;

    // ── Small pure helpers ───────────────────────────────────────────
    function clamp100(n) { return Math.max(0, Math.min(100, Number(n) || 0)); }
    function r1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
    function lidOf(l) { return String((l && (l.league_id || l.id)) || ''); }

    function tierFor(score) {
        const s = Number(score) || 0;
        if (s >= NOW_AT) return 'NOW';
        if (s >= SOON_AT) return 'SOON';
        return 'BACKLOG';
    }

    // In-season kinds — the ones the offseason clamp quiets. renewal_* is
    // deliberately NOT here: renewal risk in August is precisely the thing
    // you can still fix, so it keeps its full weight all summer.
    function isInSeasonKind(kind) {
        return /^person_/.test(kind) || /^programme_/.test(kind);
    }

    // Deterministic seeded copy; plain first-variant fallback keeps Node
    // tests (and any AlexVoice-less page) byte-stable.
    function say(seed, variants) {
        const AV = root.AlexVoice;
        if (AV && typeof AV.pick === 'function') return AV.pick(seed, variants);
        return variants[0] || '';
    }

    // Short chip for a league name: initials for multi-word, first 4 chars
    // otherwise. Collisions inside a single item get a numeric suffix so a
    // three-league row never shows the same tag twice.
    function leagueTag(name) {
        const s = String(name == null ? '' : name).trim();
        if (!s) return '—';
        const words = s.split(/\s+/).map(w => w.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean);
        if (words.length >= 2) return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
        return (words[0] || s).slice(0, 4).toUpperCase();
    }
    function tagsFor(names) {
        const seen = Object.create(null);
        return (names || []).map(n => {
            let t = leagueTag(n);
            if (seen[t]) {
                let k = seen[t] + 1;
                while (seen[t + k]) k++;
                seen[t] = k;
                t = t + k;
            }
            seen[t] = seen[t] || 1;
            return t;
        });
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // UTC on purpose: the same inputs must render the same string on a CI box
    // in UTC and a laptop in Denver.
    function fmtDate(ts) {
        if (ts == null || !isFinite(ts)) return 'TBD';
        const d = new Date(Number(ts));
        return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
    }
    function plural(n, one, many) { return n + ' ' + (Math.abs(n) === 1 ? one : (many || one + 's')); }

    // Completed, SCORED weeks for a league. Offseason (global week 0) is zero
    // by definition — a stale `settings.leg` left over from last season must
    // not convince the desk that this season has games in the books.
    function scoredWeeks(league, week) {
        const w = Number(week);
        if (!isFinite(w) || w <= 0) return 0;
        const leg = Number(league && league.settings && league.settings.leg);
        const cur = isFinite(leg) && leg > 0 ? Math.min(leg, w) : w;
        return Math.max(0, cur - 1);
    }

    // A drift leaf that changes how the game is SCORED or when trading stops
    // is a different animal from a cosmetic rename — members feel it.
    function isHotPath(path) {
        const p = String(path || '');
        return /^scoring\./.test(p) || /deadline/i.test(p) || /^positions$/.test(p) || /playoff_week_start/.test(p);
    }

    // ══════════════════════════════════════════════════════════════════
    // buildQueue
    // ══════════════════════════════════════════════════════════════════
    function buildQueue(opts) {
        const o = opts || {};
        const radar = o.radar || null;
        const renewal = o.renewal || null;
        const drift = Array.isArray(o.drift) ? o.drift : [];
        const cal = o.calendar || {};
        const events = Array.isArray(cal.events) ? cal.events : (Array.isArray(cal) ? cal : []);
        const conflicts = Array.isArray(o.conflicts) ? o.conflicts : [];
        const genesis = Array.isArray(o.genesis) ? o.genesis : [];
        const treasuries = o.treasuries || {};
        const constitutions = o.constitutions || {};
        const graph = o.graph || {};
        const seats = Array.isArray(o.seats) ? o.seats : (Array.isArray(graph.seats) ? graph.seats : []);
        const mine = Array.isArray(o.mine) ? o.mine : [];

        const wk = isFinite(Number(o.week)) ? Number(o.week) : 0;
        const offseason = wk === 0;
        const now = Number(o.nowMs);
        const hasNow = isFinite(now) && now > 0;

        // ── League identity map (every source can name a league; trust
        //    `mine` first, then fill gaps from whatever else carries a name).
        const leagueIds = mine.map(lidOf).filter(Boolean);
        const nameById = Object.create(null);
        mine.forEach(l => { const id = lidOf(l); if (id) nameById[id] = l.name || ('League ' + id); });
        const learnName = (id, name) => {
            const k = String(id || '');
            if (k && name && !nameById[k]) nameById[k] = String(name);
        };
        events.forEach(e => learnName(e && e.leagueId, e && e.leagueName));
        drift.forEach(d => learnName(d && d.leagueId, d && d.leagueName));
        genesis.forEach(g => learnName(g && g.leagueId, g && g.leagueName));
        seats.forEach(s => learnName(s && s.leagueId, s && s.leagueName));
        const nameOf = id => nameById[String(id)] || ('League ' + String(id));

        // ── Draft position per league: the single most load-bearing date on
        //    a commissioner's calendar. `done` means there is nothing left to
        //    schedule (a completed/past draft, or we're past Week 1).
        const draftBy = Object.create(null);
        const draftRec = id => (draftBy[String(id)] = draftBy[String(id)] || { next: null, done: wk >= 2 });
        leagueIds.forEach(draftRec);
        mine.forEach(l => {
            const st = String(l.status || '');
            if (st === 'in_season' || st === 'post_season' || st === 'complete') draftRec(lidOf(l)).done = true;
        });
        events.forEach(e => {
            if (!e || e.type !== 'draft') return;
            const rec = draftRec(e.leagueId);
            const ts = e.ts == null ? null : Number(e.ts);
            const past = ts != null && hasNow && ts < now;
            if (String(e.status || '') === 'complete' || past) { rec.done = true; return; }
            if (ts == null) return;
            if (!rec.next || ts < rec.next.ts) rec.next = { ts, leagueId: String(e.leagueId) };
        });
        // ms until a league's next draft; null when undated/unknown.
        const msToDraft = id => {
            const rec = draftBy[String(id)];
            if (!rec || !rec.next || !hasNow) return null;
            return rec.next.ts - now;
        };
        const daysToDraft = id => {
            const ms = msToDraft(id);
            return ms == null ? null : Math.max(0, Math.round(ms / DAY_MS));
        };

        const items = [];

        // Every item is minted here so the modifier order (blast → offseason
        // → clamp) can never drift between call sites.
        function push(spec) {
            const kind = spec.kind;
            let score = Number(spec.base) || 0;
            const blast = Number(spec.leagueCount) > 1
                ? 1 + BLAST_PER_EXTRA_LEAGUE * (Number(spec.leagueCount) - 1) : 1;
            score = score * blast + (Number(spec.bump) || 0);
            let capped = false;
            if (offseason && isInSeasonKind(kind)) { score *= OFFSEASON_FACTOR; capped = true; }
            score = clamp100(r1(score));
            let tier = tierFor(score);
            // The hard cap: an offseason person item may not sit in NOW no
            // matter how many leagues that human anchors.
            if (capped && tier === 'NOW') tier = 'SOON';

            const lids = (spec.leagueIds || []).map(String);
            const lnames = lids.map(nameOf);
            items.push({
                id: spec.id,
                domain: spec.domain,
                hub: HUB_BY_DOMAIN[spec.domain] || 'network',
                kind,
                leagueIds: lids,
                leagueNames: lnames,
                leagueTags: tagsFor(lnames),
                subjectName: spec.subjectName,
                score,
                tier,
                kicker: spec.kicker,
                headline: spec.headline,
                detail: spec.detail,
                metric: spec.metric || { value: null, unit: '', breach: false },
                action: spec.action,
                dueTs: spec.dueTs == null ? null : Number(spec.dueTs),
            });
        }

        // ── PEOPLE: one row per human ────────────────────────────────
        // The radar says "who went quiet"; the renewal forecast says "who
        // won't come back". Those are two readings of ONE fact about ONE
        // person, so they score as max(), never sum() — and they produce a
        // single row carrying every league that person touches.
        const byUser = Object.create(null);
        const seatPerson = uid => (byUser[uid] = byUser[uid] || { userId: uid, name: '', radar: null, renewal: null });
        ((radar && radar.people) || []).forEach(p => {
            if (!p || p.isMe) return;
            const rec = seatPerson(String(p.userId));
            rec.radar = p; rec.name = rec.name || p.name;
        });
        ((renewal && renewal.people) || []).forEach(p => {
            if (!p || p.isMe) return;
            const rec = seatPerson(String(p.userId));
            rec.renewal = p; rec.name = rec.name || p.name;
        });

        Object.keys(byUser).sort().forEach(uid => {
            const rec = byUser[uid];
            const rp = rec.radar, fp = rec.renewal;
            const gp = (graph.people && graph.people[uid]) || null;
            if (gp && gp.isMe) return;

            const status = rp ? String(rp.status || 'ACTIVE') : 'ACTIVE';
            const band = fp ? String(fp.band || 'SAFE') : 'SAFE';
            const prob = fp && isFinite(Number(fp.probability)) ? Number(fp.probability) : null;

            const radarBase = WEIGHTS['person_' + status] || 0;
            let renewalBase = 0;
            if (band === 'AT_RISK') {
                renewalBase = WEIGHTS.renewal_AT_RISK
                    + (RENEWAL_PIVOT - (prob == null ? RENEWAL_PIVOT : prob)) * RENEWAL_SLOPE;
            } else if (band === 'WATCH') {
                renewalBase = WEIGHTS.renewal_WATCH;
            }
            if (radarBase <= 0 && renewalBase <= 0) return;   // nothing to do about this human

            const radarWins = radarBase >= renewalBase;
            const base = radarWins ? radarBase : renewalBase;
            const kind = radarWins ? ('person_' + status) : ('renewal_' + band);

            // Every league this human sits in — the graph is authoritative,
            // the radar's team list is the fallback.
            const teams = (rp && rp.teams) || [];
            const lids = (gp && gp.leagueIds && gp.leagueIds.length ? gp.leagueIds : teams.map(t => t.leagueId))
                .map(String).filter(Boolean);
            const uniq = lids.filter((v, i) => lids.indexOf(v) === i);
            const leagueCount = Number(gp && gp.leagueCount) || Number(fp && fp.leagueCount) || uniq.length || 1;

            const darkTeams = teams.filter(t => t.status === 'DARK');
            const worstDays = teams.reduce((m, t) => {
                const d = t && t.signals ? t.signals.daysSinceTxn : null;
                return d == null ? m : Math.max(m, Number(d));
            }, -1);
            const name = rec.name || (gp && gp.name) || 'Unknown';
            const first = String(name).split(/\s+/)[0];

            const kicker = status === 'DARK_ALL' ? 'DARK EVERYWHERE'
                : status === 'DARK_ONE' ? 'DARK IN ' + (darkTeams.length || 1)
                    : status === 'FADING' ? 'FADING'
                        : band === 'AT_RISK' ? 'WON\'T RENEW' : 'RENEWAL WATCH';

            const headline = status === 'DARK_ALL'
                ? say('triage:person:' + uid + ':all', [
                    'Check in on ' + first + ' — quiet in all ' + uniq.length + ' of your leagues.',
                    first + ' has gone dark everywhere. That\'s a life thing, not a league thing.',
                ])
                : status === 'DARK_ONE'
                    ? say('triage:person:' + uid + ':one', [
                        first + ' is checked out of ' + (darkTeams[0] ? nameOf(darkTeams[0].leagueId) : 'one league') + ' — still active elsewhere.',
                        'One of ' + first + '\'s leagues has lost them. Ask which part stopped being fun.',
                    ])
                    : status === 'FADING'
                        ? say('triage:person:' + uid + ':fade', [
                            first + ' is drifting — worth a nudge before it becomes silence.',
                            'Nudge ' + first + '; the activity line is bending the wrong way.',
                        ])
                        : band === 'AT_RISK'
                            ? say('triage:person:' + uid + ':risk', [
                                first + ' is unlikely to come back next season — reach out now, not in August.',
                                'Renewal risk on ' + first + '. August is too late to ask.',
                            ])
                            : say('triage:person:' + uid + ':watch', [
                                first + ' is a soft renewal — one good reason to stay would do it.',
                                'Keep an eye on ' + first + '; the renewal signal is soft.',
                            ]);

            const bits = [];
            if (uniq.length > 1) bits.push('Across ' + plural(uniq.length, 'league'));
            if (darkTeams.length) bits.push(plural(darkTeams.length, 'team') + ' dark');
            if (worstDays >= 0) bits.push(worstDays + 'd since a move');
            else if (rp) bits.push('no transactions on record');
            if (prob != null) bits.push(Math.round(prob * 100) + '% renewal odds');
            if (fp && fp.factors && fp.factors.length) bits.push(String(fp.factors[0]));

            const metric = radarWins
                ? { value: worstDays >= 0 ? worstDays : null, unit: 'days quiet', breach: status !== 'ACTIVE' }
                : { value: prob == null ? null : Math.round(prob * 100) / 100, unit: 'renewal odds', breach: band === 'AT_RISK' };

            push({
                id: 'person:' + uid,
                kind,
                domain: 'people',
                base,
                leagueCount,
                leagueIds: uniq,
                subjectName: name,
                kicker,
                headline,
                detail: bits.join(' · '),
                metric,
                // One human, one message — the office pastes the radar's
                // check-in draft or a renewal play straight to the clipboard.
                action: { kind: 'copy', label: 'COPY MSG' },
                dueTs: null,
            });
        });

        // ── PEOPLE: open SEATS, rolled up per league past a threshold ─
        // One row per seat is right when a league has one or two holes — they
        // are genuinely separate recruiting jobs. But a league with fourteen
        // ownerless rosters is ONE fact ("this league is half-empty"), and
        // printing it fourteen times buries every other kind of work in the
        // queue. Verified against real data: a 32-team league contributed 31
        // rows and drowned the desk.
        const SEAT_ROLLUP_AT = 3;
        const seatsByLeague = Object.create(null);
        seats.forEach(s => {
            if (!s) return;
            const lid = String(s.leagueId || '');
            (seatsByLeague[lid] = seatsByLeague[lid] || []).push(s);
        });
        Object.keys(seatsByLeague).forEach(lid => {
            const group = seatsByLeague[lid];
            const dts = draftBy[lid] && draftBy[lid].next ? draftBy[lid].next.ts : null;
            const ms = msToDraft(lid);
            const urgent = ms != null && ms >= 0 && ms <= 14 * DAY_MS;
            const days = daysToDraft(lid);
            const draftNote = dts != null ? 'draft ' + fmtDate(dts) : 'draft not scheduled';

            if (group.length >= SEAT_ROLLUP_AT) {
                push({
                    id: 'seat:' + lid + ':all',
                    kind: urgent ? 'open_seat_draft_within_14d' : 'open_seat',
                    domain: 'people',
                    base: urgent ? WEIGHTS.open_seat_draft_within_14d : WEIGHTS.open_seat,
                    leagueCount: 1,
                    leagueIds: [lid],
                    subjectName: nameOf(lid),
                    kicker: 'OPEN SEATS',
                    // Uniform phrasing on purpose — a scannable list beats a
                    // varied one. Seeded variation belongs in the diagnosis
                    // line, not in rows the eye has to compare.
                    headline: nameOf(lid) + ' has ' + group.length + ' ownerless rosters'
                        + (urgent ? ' and drafts in ' + days + ' days.' : '.'),
                    detail: 'Rosters ' + group.slice(0, 4).map(s => s.rosterId).join(', ')
                        + (group.length > 4 ? ' +' + (group.length - 4) + ' more' : '') + ' · ' + draftNote,
                    metric: { value: group.length, unit: 'seats open', breach: true },
                    action: { kind: 'deeplink', label: 'FILL SEATS' },
                    dueTs: dts,
                });
                return;
            }
            group.forEach(s => {
                push({
                    id: 'seat:' + lid + ':' + String(s.rosterId),
                    kind: urgent ? 'open_seat_draft_within_14d' : 'open_seat',
                    domain: 'people',
                    base: urgent ? WEIGHTS.open_seat_draft_within_14d : WEIGHTS.open_seat,
                    leagueCount: 1,
                    leagueIds: [lid],
                    subjectName: nameOf(lid),
                    kicker: 'OPEN SEAT',
                    headline: 'Roster ' + s.rosterId + ' in ' + nameOf(lid) + ' has no owner'
                        + (urgent ? ' and the draft is ' + days + ' days out.' : '.'),
                    detail: [String(s.reason || 'no owner on the roster'), draftNote].filter(Boolean).join(' · '),
                    metric: days != null
                        ? { value: days, unit: 'days to draft', breach: urgent }
                        : { value: 1, unit: 'seat open', breach: false },
                    action: { kind: 'deeplink', label: 'FILL SEAT' },
                    dueTs: dts,
                });
            });
        });

        // ── GENESIS: at most ONE row per league ──────────────────────
        // "Schedule the draft" and "finish the checklist" are different asks,
        // but a league never gets both — the missing draft IS the checklist's
        // top blocker, and printing it twice is how a queue loses trust.
        const genesisById = Object.create(null);
        genesis.forEach(g => { if (g && g.leagueId) genesisById[String(g.leagueId)] = g; });
        let unscheduledCount = 0;

        leagueIds.forEach(lid => {
            const g = genesisById[lid] || null;
            const rec = draftBy[lid] || { next: null, done: false };
            const dts = rec.next ? rec.next.ts : null;
            const ms = msToDraft(lid);
            const days = daysToDraft(lid);
            const pct = g && isFinite(Number(g.pct)) ? Number(g.pct) : null;
            const blockers = (g && g.blockers) || [];

            if (!rec.next && !rec.done) {
                unscheduledCount++;
                push({
                    id: 'genesis:' + lid,
                    kind: 'draft_unscheduled',
                    domain: 'genesis',
                    base: WEIGHTS.draft_unscheduled,
                    leagueCount: 1,
                    leagueIds: [lid],
                    subjectName: nameOf(lid),
                    kicker: 'NO DRAFT DATE',
                    headline: say('triage:genesis:unsched:' + lid, [
                        nameOf(lid) + ' has no draft on the calendar.',
                        'Nothing is booked for the ' + nameOf(lid) + ' draft yet.',
                    ]),
                    detail: (pct == null ? 'Readiness unknown' : pct + '% ready')
                        + (blockers.length ? ' · top blocker: ' + blockers[0] + (blockers.length > 1 ? ' +' + (blockers.length - 1) + ' more' : '') : ''),
                    metric: { value: pct, unit: '% ready', breach: true },
                    action: { kind: 'deeplink', label: 'SCHEDULE' },
                    dueTs: null,   // no date is the whole problem
                });
                return;
            }
            if (!g || pct == null || !blockers.length) return;

            const draftIn30 = ms != null && ms >= 0 && ms <= 30 * DAY_MS;
            let kind = null, base = 0;
            if (pct < 50 && draftIn30) { kind = 'genesis_lt_50_draft_in_30d'; base = WEIGHTS.genesis_lt_50_draft_in_30d; }
            else if (pct < 60) { kind = 'genesis_blockers_lt_60'; base = WEIGHTS.genesis_blockers_lt_60; }
            if (!kind) return;

            push({
                id: 'genesis:' + lid,
                kind,
                domain: 'genesis',
                base,
                leagueCount: 1,
                leagueIds: [lid],
                subjectName: nameOf(lid),
                kicker: pct + '% READY',
                headline: say('triage:genesis:' + lid, [
                    nameOf(lid) + ' is ' + pct + '% ready' + (days == null ? '.' : ' with ' + days + ' days to the draft.'),
                    (days == null ? nameOf(lid) + ' still has holes in its setup.' : days + ' days to the ' + nameOf(lid) + ' draft and it is ' + pct + '% ready.'),
                ]),
                detail: blockers[0] + (blockers.length > 1 ? ' · +' + (blockers.length - 1) + ' more' : ''),
                metric: { value: pct, unit: '% ready', breach: pct < 60 },
                action: { kind: 'deeplink', label: 'OPEN' },
                dueTs: dts,
            });
        });

        // ── OPERATIONS: one drift row per league ─────────────────────
        let driftChangeTotal = 0, driftLeagueCount = 0;
        drift.forEach(d => {
            if (!d) return;
            const lid = String(d.leagueId || '');
            const res = d.result || {};
            const changes = Array.isArray(res.changes) ? res.changes : [];

            if (!res.firstRun && changes.length) {
                driftChangeTotal += changes.length;
                driftLeagueCount++;
                const hot = changes.filter(c => isHotPath(c && c.path));
                const kind = hot.length ? 'drift_scoring_or_deadline' : 'drift_other_path';
                const top = (hot[0] || changes[0] || {});
                push({
                    id: 'drift:' + lid,
                    kind,
                    domain: 'operations',
                    base: WEIGHTS[kind],
                    leagueCount: 1,
                    leagueIds: [lid],
                    subjectName: nameOf(lid),
                    kicker: hot.length ? 'SCORING MOVED' : 'SETTINGS MOVED',
                    headline: say('triage:drift:' + lid + ':' + changes.length, [
                        nameOf(lid) + ' changed under you — ' + plural(changes.length, 'unsigned change') + '.',
                        plural(changes.length, 'setting') + ' moved in ' + nameOf(lid) + ' without your signature.',
                    ]),
                    detail: plural(changes.length, 'change')
                        + (hot.length ? ' · ' + hot.length + ' scoring' : '')
                        + (top.path ? ' · ' + top.path + ': ' + String(top.from) + ' → ' + String(top.to) : ''),
                    metric: { value: changes.length, unit: 'unsigned changes', breach: true },
                    action: { kind: 'inline', label: 'RATIFY' },
                    dueTs: null,
                });
                return;
            }

            // Acknowledged, but never written into the amendment ledger — the
            // change is live and the constitution still doesn't mention it.
            // Only fires when the caller actually supplies ack history; an
            // absent field must never manufacture a finding.
            const history = Array.isArray(res.history) ? res.history : null;
            const naked = history
                ? history.filter(h => h && !String(h.note || '').trim()).length
                : (Number(res.ackedNoNote) || 0);
            if (naked > 0) {
                push({
                    id: 'drift-note:' + lid,
                    kind: 'drift_acked_no_note',
                    domain: 'operations',
                    base: WEIGHTS.drift_acked_no_note,
                    leagueCount: 1,
                    leagueIds: [lid],
                    subjectName: nameOf(lid),
                    kicker: 'UNRECORDED',
                    headline: nameOf(lid) + ' has ' + plural(naked, 'ratified change') + ' with no note in the record.',
                    detail: 'Acknowledged but never written into the amendment ledger.',
                    metric: { value: naked, unit: 'unrecorded acks', breach: false },
                    action: { kind: 'inline', label: 'RATIFY' },
                    dueTs: null,
                });
            }
        });

        // ── OPERATIONS: one row per conflict ─────────────────────────
        conflicts.forEach((c, i) => {
            if (!c) return;
            if (c.kind === 'draft_overlap') {
                const a = c.a || {}, b = c.b || {};
                const ts = a.ts == null ? null : Number(a.ts);
                const ms = ts == null || !hasNow ? null : ts - now;
                // Further out than three weeks it isn't triage yet — it's a
                // calendar entry, and the calendar wall already shows it.
                if (ms == null || ms < 0 || ms > 21 * DAY_MS) return;
                const shared = Array.isArray(c.sharedHumans) ? c.sharedHumans : [];
                const gapH = b.ts == null ? null : Math.round(Math.abs(Number(b.ts) - ts) / HOUR_MS * 10) / 10;
                push({
                    id: 'conflict:draft:' + String(a.leagueId) + ':' + String(b.leagueId) + ':' + String(ts),
                    kind: 'draft_collision_within_21d',
                    domain: 'operations',
                    base: WEIGHTS.draft_collision_within_21d,
                    bump: SHARED_HUMAN_BUMP * shared.length,
                    leagueCount: 1,
                    leagueIds: [String(a.leagueId), String(b.leagueId)].filter(Boolean),
                    subjectName: (a.leagueName || nameOf(a.leagueId)) + ' × ' + (b.leagueName || nameOf(b.leagueId)),
                    kicker: 'DRAFT COLLISION',
                    headline: say('triage:conflict:' + String(a.leagueId) + ':' + String(b.leagueId), [
                        'Two of your drafts land within hours on ' + fmtDate(ts) + '.',
                        fmtDate(ts) + ' has two of your drafts stacked on it.',
                    ]),
                    detail: (gapH == null ? 'Overlapping start times' : gapH + 'h apart')
                        + (shared.length ? ' · ' + plural(shared.length, 'human') + ' double-booked: ' + shared.slice(0, 3).join(', ') : ' · no shared members')
                        + (c.suggestion ? ' · ' + c.suggestion : ''),
                    metric: { value: gapH, unit: 'hours apart', breach: true },
                    action: { kind: 'deeplink', label: 'RESOLVE' },
                    dueTs: ts,
                });
                return;
            }
            if (c.kind === 'deadline_cluster') {
                const evs = Array.isArray(c.events) ? c.events : [];
                const lids = evs.map(e => String(e.leagueId)).filter(Boolean);
                const dated = evs.map(e => (e.ts == null ? null : Number(e.ts))).filter(t => t != null);
                push({
                    id: 'conflict:cluster:w' + String(c.week == null ? i : c.week),
                    kind: 'deadline_cluster',
                    domain: 'operations',
                    base: WEIGHTS.deadline_cluster,
                    leagueCount: 1,
                    leagueIds: lids,
                    subjectName: 'Week ' + String(c.week == null ? '?' : c.week),
                    kicker: 'DEADLINE STACK',
                    headline: (evs.length || (c.leagues || []).length) + ' trade deadlines land in Week ' + String(c.week) + '.',
                    detail: String(c.note || (c.leagues || []).join(', ')),
                    metric: { value: evs.length || (c.leagues || []).length, unit: 'deadlines in the week', breach: true },
                    action: { kind: 'deeplink', label: 'RESOLVE' },
                    dueTs: dated.length ? Math.min.apply(null, dated) : null,
                });
            }
        });

        // ── OPERATIONS: one dues row per league ──────────────────────
        // BOOKKEEPING ONLY. DHQ never handles, collects, or moves money —
        // this row asks the commissioner to mark what they already collected
        // wherever the money actually lives.
        leagueIds.forEach(lid => {
            const t = treasuries[lid];
            const sum = t && t.summary;
            if (!sum || !Number(sum.total)) return;
            if (Number(sum.paid) !== 0) return;   // partial collection is progress, not a finding
            push({
                id: 'dues:' + lid,
                kind: 'dues_zero_collected',
                domain: 'operations',
                base: WEIGHTS.dues_zero_collected,
                leagueCount: 1,
                leagueIds: [lid],
                subjectName: nameOf(lid),
                kicker: 'NOBODY MARKED PAID',
                headline: 'Not one of ' + nameOf(lid) + '\'s ' + Number(sum.total) + ' members is marked paid.',
                detail: 'Bookkeeping only — DHQ never touches money. Mark who has already settled up.',
                metric: { value: 0, unit: '% marked paid', breach: true },
                action: { kind: 'inline', label: 'MARK PAID' },
                dueTs: null,
            });
        });

        // ── BYLAWS: one row per league with no constitution ──────────
        // An EMPTY constitutions map means the office never ran the lookup —
        // "we didn't look" must not render as "four leagues are lawless".
        const constKeys = Object.keys(constitutions);
        if (constKeys.length) {
            leagueIds.forEach(lid => {
                const c = constitutions[lid];
                const has = !!(c && String(c.text || '').trim());
                if (has) return;
                push({
                    id: 'constitution:' + lid,
                    kind: 'no_constitution',
                    domain: 'bylaws',
                    base: WEIGHTS.no_constitution,
                    leagueCount: 1,
                    leagueIds: [lid],
                    subjectName: nameOf(lid),
                    kicker: 'NO CONSTITUTION',
                    headline: nameOf(lid) + ' has no constitution on file.',
                    detail: 'Every ruling you make in this league is currently a memory, not a citation.',
                    metric: { value: 0, unit: 'clauses on file', breach: true },
                    action: { kind: 'deeplink', label: 'UPLOAD' },
                    dueTs: null,
                });
            });
        }

        // ── PROGRAMMES: one row per league with a week in the books ──
        leagueIds.forEach(lid => {
            const league = mine.find(l => lidOf(l) === lid);
            const sw = scoredWeeks(league, wk);
            if (sw < 1) return;   // notYet territory — nothing to publish
            push({
                id: 'programme:' + lid,
                kind: 'programme_unpublished',
                domain: 'programmes',
                base: WEIGHTS.programme_unpublished,
                leagueCount: 1,
                leagueIds: [lid],
                subjectName: nameOf(lid),
                kicker: 'WEEK ' + sw + ' PROGRAMME',
                headline: nameOf(lid) + '\'s Week ' + sw + ' programme is composed and unsent.',
                detail: 'The broadcast writes itself; it still needs you to press send.',
                metric: { value: sw, unit: 'scored weeks', breach: false },
                action: { kind: 'deeplink', label: 'OPEN' },
                dueTs: null,
            });
        });

        // ── Sort: fully deterministic, no ties left to engine order ──
        // score desc → dueTs asc (undated last) → league name → id.
        items.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const ad = a.dueTs == null ? Infinity : a.dueTs;
            const bd = b.dueTs == null ? Infinity : b.dueTs;
            if (ad !== bd) return ad - bd;
            const an = a.leagueNames[0] || '', bn = b.leagueNames[0] || '';
            if (an !== bn) return an < bn ? -1 : 1;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });

        const counts = { now: 0, soon: 0, backlog: 0 };
        items.forEach(it => {
            if (it.tier === 'NOW') counts.now++;
            else if (it.tier === 'SOON') counts.soon++;
            else counts.backlog++;
        });

        // ── byCell: EVERY league × EVERY domain, zeros included ──────
        const byCell = {};
        leagueIds.forEach(lid => DOMAINS.forEach(d => { byCell[lid + ':' + d] = 0; }));
        items.forEach(it => {
            it.leagueIds.forEach(lid => {
                const k = lid + ':' + it.domain;
                if (Object.prototype.hasOwnProperty.call(byCell, k)) byCell[k]++;
            });
        });

        // ── notYet: domains that cannot hold data yet ────────────────
        // A coefficient and a matchday programme both need scored weeks. In
        // August that cell is not empty, it is unborn — and the grid has to
        // say so or it reads as a gap the commissioner should be closing.
        const notYet = {};
        leagueIds.forEach(lid => {
            const league = mine.find(l => lidOf(l) === lid);
            if (scoredWeeks(league, wk) >= 1) return;
            notYet[lid + ':coefficient'] = true;
            notYet[lid + ':programmes'] = true;
        });

        return {
            items,
            counts,
            byCell,
            notYet,
            diagnosis: diagnose({
                items, counts, leagueIds, events, now, hasNow, nameOf,
                radar, seats, graph, unscheduledCount, driftChangeTotal, driftLeagueCount,
            }),
        };
    }

    // ══════════════════════════════════════════════════════════════════
    // diagnosis — one sentence naming the SHAPE of the workload, chosen by
    // the top NOW item's domain and interpolated with live counts. Never a
    // template that could be true of any desk.
    // ══════════════════════════════════════════════════════════════════
    function diagnose(ctx) {
        const items = ctx.items;
        const m = ctx.leagueIds.length;
        const nowCount = ctx.counts.now;

        // Empty desk: say what's next instead of congratulating them.
        if (!items.length) {
            const future = ctx.events
                .filter(e => e && e.ts != null && (!ctx.hasNow || Number(e.ts) >= ctx.now))
                .sort((a, b) => Number(a.ts) - Number(b.ts));
            const nx = future[0];
            if (!nx) {
                return say('triage:diag:empty:none:' + m, [
                    'Nothing needs you across ' + plural(m, 'league') + '. Nothing dated on the calendar either.',
                    'All ' + m + ' leagues are quiet, and the calendar is blank too.',
                ]);
            }
            const label = String(nx.type || 'event');
            return say('triage:diag:empty:' + m + ':' + nx.leagueId, [
                'Nothing needs you across ' + plural(m, 'league') + '. Next dated item: '
                    + fmtDate(nx.ts) + ', ' + (nx.leagueName || ctx.nameOf(nx.leagueId)) + ' ' + label + '.',
                'All clear in ' + plural(m, 'league') + ' — the next thing on the books is '
                    + (nx.leagueName || ctx.nameOf(nx.leagueId)) + ' ' + label + ' on ' + fmtDate(nx.ts) + '.',
            ]);
        }

        // Work exists but nothing is burning — say that plainly rather than
        // inflating a SOON item into a crisis.
        if (!nowCount) {
            return say('triage:diag:calm:' + m + ':' + ctx.counts.soon, [
                'Nothing is on fire across ' + plural(m, 'league') + ' — ' + plural(ctx.counts.soon, 'thing')
                    + ' worth an hour this week, ' + ctx.counts.backlog + ' that can wait.',
                'No emergencies in ' + plural(m, 'league') + '. ' + plural(ctx.counts.soon, 'item')
                    + ' deserve an hour, the rest can sit.',
            ]);
        }

        const top = items.find(it => it.tier === 'NOW') || items[0];
        const domain = top.domain;

        if (domain === 'genesis' && ctx.unscheduledCount > 0) {
            const n = ctx.unscheduledCount;
            return say('triage:diag:genesis:' + n + ':' + m, [
                n + ' of your ' + m + ' leagues still have no draft on the calendar — ' + nowCount
                    + ' things need you before Week 1 is even a question.',
                'Week 1 is not the problem yet: ' + n + ' of ' + m + ' leagues have no draft date, and '
                    + nowCount + ' items need you first.',
            ]);
        }
        if (domain === 'genesis') {
            return say('triage:diag:genesis-ready:' + m + ':' + nowCount, [
                'Your drafts are booked but the setup behind them is not — ' + top.subjectName
                    + ' leads ' + plural(nowCount, 'item') + ' that need you before Opening Day.',
                top.subjectName + ' is the least-ready league on the board, and ' + nowCount
                    + ' things need you before Opening Day.',
            ]);
        }

        if (domain === 'people') {
            const people = (ctx.radar && ctx.radar.people) || [];
            const humans = people.filter(p => p && !p.isMe).length
                || Object.keys((ctx.graph && ctx.graph.people) || {}).length;
            const dark = people.filter(p => p && !p.isMe && (p.status === 'DARK_ALL' || p.status === 'DARK_ONE')).length;
            const seatN = ctx.seats.length;
            return say('triage:diag:people:' + dark + ':' + humans + ':' + seatN, [
                'Your leagues aren\'t fighting, they\'re going quiet — ' + dark + ' of ' + humans
                    + ' humans have stopped showing up and ' + plural(seatN, 'seat')
                    + (seatN === 1 ? ' is empty.' : ' are empty.'),
                'Nobody is arguing; they are just leaving. ' + dark + ' of your ' + plural(humans, 'human')
                    + ' have gone quiet and ' + plural(seatN, 'seat') + ' sit empty.',
            ]);
        }

        if (domain === 'operations' && ctx.driftChangeTotal > 0) {
            return say('triage:diag:ops:' + ctx.driftChangeTotal + ':' + ctx.driftLeagueCount, [
                'Someone\'s been editing settings you haven\'t signed off on — ' + ctx.driftChangeTotal
                    + ' changes across ' + plural(ctx.driftLeagueCount, 'league') + '.',
                ctx.driftChangeTotal + ' settings moved without your signature, spread over '
                    + plural(ctx.driftLeagueCount, 'league') + '.',
            ]);
        }
        if (domain === 'operations') {
            return say('triage:diag:ops-cal:' + nowCount + ':' + m, [
                'Your calendar is colliding with itself — ' + plural(nowCount, 'item')
                    + ' need a date moved before they cost you a member.',
                plural(nowCount, 'scheduling conflict') + ' on the board, starting with ' + top.subjectName + '.',
            ]);
        }

        // Bylaws / programmes / anything else that reaches the top.
        return say('triage:diag:generic:' + domain + ':' + nowCount + ':' + m, [
            plural(nowCount, 'thing') + ' need you across ' + plural(m, 'league') + ' — start with '
                + top.subjectName + ': ' + top.headline,
            'Start with ' + top.subjectName + '. ' + plural(nowCount, 'item') + ' across '
                + plural(m, 'league') + ' are waiting on you.',
        ]);
    }

    const api = {
        buildQueue,
        // One tunable table — if the ranking is wrong, this is what's wrong.
        WEIGHTS,
        // Exposed pure seams (grid headers, unit tests, "why is this NOW?").
        DOMAINS,
        HUB_BY_DOMAIN,
        tierFor,
        scoredWeeks,
        leagueTag,
    };
    App.Commish.Triage = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
