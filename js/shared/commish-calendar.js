// ══════════════════════════════════════════════════════════════════
// js/shared/commish-calendar.js — window.App.Commish.Calendar
// CONFLICT RADAR + AUGUST SOLVER. One calendar across every commissioned
// league — draft nights, trade deadlines, playoff starts — then the collisions
// nobody spots until two of their leagues draft the same evening: the
// multi-league humans (from the member graph) who'd be double-booked.
//
//   loadDrafts(leagues)                       — fetch helper (impure)
//     → Promise<{ [leagueId]: [{leagueId, draftId, status, startTime}] }>
//   weekToDate(week, seasonStartDate)         — pure
//     → ms | null  ('YYYY-MM-DD' season start + (week−1) × 7 days)
//   buildCalendar({ leagues, draftsByLeague, seasonStartDate, nowMs }) — pure
//     → [{ type:'draft'|'deadline'|'playoffs', leagueId, leagueName, ts,
//          week|null, approximate, label, past, (draftId, status on drafts) }]
//        sorted by ts; unresolvable ts=null last
//   findConflicts({ events, graph, nowMs })   — pure
//     → [{ kind:'draft_overlap', a, b, sharedHumans, suggestion } |
//        { kind:'deadline_cluster', week, leagues, events, note }]
//
// Week events are APPROXIMATE by construction — Sleeper only gives the week
// number, so we anchor on nflState.season_start_date and never pretend to
// know the hour. Draft times are exact (Sleeper start_time is ms).
// Sleeper is READ-ONLY: the solver *suggests* a shift, it never reschedules.
// Pure compute Node-testable; no Date.now() — callers pass nowMs.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const DAY = 86400000;
    const OVERLAP_MS = 3 * 3600000; // two drafts within 3h = one human can't do both

    function leagueId(l) { return String(l.league_id || l.id || ''); }
    function leagueName(l) { return l.name || ('League ' + leagueId(l)); }

    // Deterministic seeded copy; plain first-variant fallback keeps Node
    // tests (no AlexVoice) byte-stable.
    function say(seed, variants) {
        if (root.AlexVoice && typeof root.AlexVoice.pick === 'function') {
            return root.AlexVoice.pick(seed, variants);
        }
        return variants[0] || '';
    }

    function fmtWhen(ts) {
        const d = new Date(ts);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return d.toDateString() + ' ' + hh + ':' + mm;
    }

    // ── Fetch helper (impure, browser-only) ──────────────────────────
    // Sleeper: GET /league/{id}/drafts → array of draft objects. We keep only
    // what the calendar needs; a failed league yields [] so one bad fetch
    // never blanks the whole radar.
    async function loadDrafts(leagues) {
        const out = {};
        await Promise.all((leagues || []).map(async l => {
            const lid = leagueId(l);
            if (!lid || lid.startsWith('mfl_')) return; // Sleeper calendar only, v1
            out[lid] = [];
            if (typeof root.fetchDrafts !== 'function') return;
            try {
                const drafts = await root.fetchDrafts(lid);
                out[lid] = (drafts || []).map(d => ({
                    leagueId: lid,
                    draftId: d.draft_id != null ? String(d.draft_id) : null,
                    status: d.status || null,
                    startTime: d.start_time != null && Number.isFinite(Number(d.start_time)) ? Number(d.start_time) : null,
                }));
            } catch (e) { if (root.wrLog) root.wrLog('commish.calendar.drafts', e); }
        }));
        return out;
    }

    // ── Week → date (pure) ───────────────────────────────────────────
    // seasonStartDate = Sleeper nflState.season_start_date ('YYYY-MM-DD').
    // Date.parse reads that as UTC midnight — fine, because anything derived
    // from a week number is flagged approximate anyway.
    function weekToDate(week, seasonStartDate) {
        const w = Number(week);
        const base = Date.parse(String(seasonStartDate || ''));
        if (!Number.isFinite(w) || w < 1 || !Number.isFinite(base)) return null;
        return base + (w - 1) * 7 * DAY;
    }

    // ── The calendar (pure) ──────────────────────────────────────────
    function buildCalendar(opts) {
        const leagues = (opts && opts.leagues) || [];
        const draftsByLeague = (opts && opts.draftsByLeague) || {};
        const seasonStartDate = opts && opts.seasonStartDate;
        const nowMs = opts && opts.nowMs;
        const events = [];

        for (const l of leagues) {
            const lid = leagueId(l);
            const lname = leagueName(l);
            const st = l.settings || {};

            for (const d of (draftsByLeague[lid] || [])) {
                events.push({
                    type: 'draft', leagueId: lid, leagueName: lname,
                    ts: Number.isFinite(d.startTime) ? d.startTime : null,
                    week: null, approximate: false,
                    draftId: d.draftId != null ? String(d.draftId) : null,
                    status: d.status || null,
                    label: lname + ' draft' + (Number.isFinite(d.startTime) ? '' : ' (time TBD)'),
                });
            }

            // trade_deadline can be 0 = "no deadline" on Sleeper; only >0 is real.
            const dw = Number(st.trade_deadline);
            if (dw > 0) {
                events.push({
                    type: 'deadline', leagueId: lid, leagueName: lname,
                    ts: weekToDate(dw, seasonStartDate), week: dw, approximate: true,
                    label: lname + ' trade deadline (Week ' + dw + ')',
                });
            }
            const pw = Number(st.playoff_week_start);
            if (pw > 0) {
                events.push({
                    type: 'playoffs', leagueId: lid, leagueName: lname,
                    ts: weekToDate(pw, seasonStartDate), week: pw, approximate: true,
                    label: lname + ' playoffs begin (Week ' + pw + ')',
                });
            }
        }

        for (const e of events) e.past = Number.isFinite(nowMs) && e.ts != null && e.ts < nowMs;

        // ts=null (no season anchor / TBD draft) sinks to the bottom rather
        // than faking a date; within nulls, week then label keeps it stable.
        events.sort((a, b) => {
            if (a.ts != null && b.ts != null) return a.ts - b.ts;
            if (a.ts != null) return -1;
            if (b.ts != null) return 1;
            return (a.week || 99) - (b.week || 99) || a.label.localeCompare(b.label);
        });
        return events;
    }

    // ── Conflicts (pure) ─────────────────────────────────────────────
    // Sleeper draft ids are snowflakes (timestamp in the high bits), so a
    // numerically larger id was created later. Number() drops the low ~7 bits
    // at this magnitude, but creation-time ordering lives far above them.
    function laterCreated(a, b) {
        const ai = Number(a.draftId), bi = Number(b.draftId);
        if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return bi > ai ? b : a;
        return (b.ts || 0) >= (a.ts || 0) ? b : a; // no ids → move the later slot
    }

    // Nearest ±1–3 day slot with no draft inside the 3h window. Shifting by
    // whole days keeps the original clock time, so an evening draft stays an
    // evening draft — no timezone gymnastics.
    function findClearShift(mv, allDrafts) {
        for (const off of [1, -1, 2, -2, 3, -3]) {
            const cand = mv.ts + off * DAY;
            const blocked = allDrafts.some(d =>
                d !== mv && d.ts != null && Math.abs(d.ts - cand) < OVERLAP_MS);
            if (!blocked) return { off, ts: cand };
        }
        return null;
    }

    function shiftText(off) {
        const n = Math.abs(off);
        const dir = off > 0 ? 'later' : 'earlier';
        return (n === 1 ? 'a day' : n + ' days') + ' ' + dir;
    }

    function findConflicts(opts) {
        const events = (opts && opts.events) || [];
        const graph = (opts && opts.graph) || null;
        const nowMs = opts && opts.nowMs;
        const now = Number.isFinite(nowMs) ? nowMs : -Infinity;
        const conflicts = [];

        // (a) Draft overlaps — upcoming, dated, not already completed. Same-
        // league pairs are skipped: one league can't hold two drafts at once,
        // and "shared humans" would trivially be the whole league.
        const drafts = events.filter(e =>
            e.type === 'draft' && e.ts != null && e.ts >= now && e.status !== 'complete');

        for (let i = 0; i < drafts.length; i++) {
            for (let j = i + 1; j < drafts.length; j++) {
                const x = drafts[i], y = drafts[j];
                if (x.leagueId === y.leagueId) continue;
                if (Math.abs(x.ts - y.ts) > OVERLAP_MS) continue;
                const a = x.ts <= y.ts ? x : y;
                const b = x.ts <= y.ts ? y : x;

                const sharedHumans = graph && graph.people
                    ? Object.values(graph.people)
                        .filter(p => !p.isMe
                            && p.leagueIds.includes(a.leagueId)
                            && p.leagueIds.includes(b.leagueId))
                        .map(p => p.name)
                        .sort((m, n) => m.localeCompare(n))
                    : [];

                // The league that scheduled SECOND eats the move — first
                // booking keeps its slot.
                const mv = laterCreated(a, b);
                const slot = findClearShift(mv, drafts);
                const seed = 'cal:shift:' + mv.leagueId + ':' + (mv.draftId || mv.ts);
                const suggestion = slot
                    ? say(seed, [
                        mv.leagueName + ' scheduled its draft later — slide it ' + shiftText(slot.off) + ' to ' + fmtWhen(slot.ts) + '; that slot is clear of your other drafts.',
                        'Move the ' + mv.leagueName + ' draft ' + shiftText(slot.off) + ' (' + fmtWhen(slot.ts) + ') — it booked second, and no other draft sits within 3 hours.',
                        'Suggest shifting ' + mv.leagueName + ' ' + shiftText(slot.off) + ', landing ' + fmtWhen(slot.ts) + ' — the evening is draft-free.',
                    ])
                    : say(seed, [
                        mv.leagueName + ' scheduled its draft later and should move — but every slot within 3 days collides with another draft. Look a week out.',
                        'The ' + mv.leagueName + ' draft booked second and needs to shift, but ±3 days is wall-to-wall drafts — push it a full week.',
                    ]);

                conflicts.push({ kind: 'draft_overlap', a, b, sharedHumans, suggestion });
            }
        }
        conflicts.sort((p, q) => p.a.ts - q.a.ts);

        // (b) Deadline clusters — 2+ trade deadlines in the same NFL week
        // means one frantic multi-league night instead of a spread-out season.
        const byWeek = {};
        for (const e of events) {
            if (e.type !== 'deadline' || e.week == null) continue;
            (byWeek[e.week] = byWeek[e.week] || []).push(e);
        }
        for (const w of Object.keys(byWeek).map(Number).sort((a, b) => a - b)) {
            const evs = byWeek[w];
            if (evs.length < 2) continue;
            const names = evs.map(e => e.leagueName);
            const note = say('cal:cluster:' + w + ':' + evs.map(e => e.leagueId).join(','), [
                'Week ' + w + ' stacks ' + evs.length + ' trade deadlines: ' + names.join(', ') + '. One frantic night — warn your leagues early.',
                evs.length + ' deadlines land in Week ' + w + ' (' + names.join(', ') + ') — consider staggering one next season.',
            ]);
            conflicts.push({ kind: 'deadline_cluster', week: w, leagues: names, events: evs, note });
        }

        return conflicts;
    }

    const api = { loadDrafts, weekToDate, buildCalendar, findConflicts };
    App.Commish = App.Commish || {};
    App.Commish.Calendar = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
